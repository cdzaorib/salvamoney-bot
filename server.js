'use strict';

const express = require('express');
require('dotenv').config();

const { createAiGateway } = require('./src/ai/ai-gateway');
const { createCircuitBreaker } = require('./src/ai/circuit-breaker');
const { createCostTracker } = require('./src/ai/cost-tracker');
const { createDeepseekClient } = require('./src/ai/deepseek-client');
const { createMeteredGroq } = require('./src/ai/metered-groq');
const { createBotService } = require('./src/bot-service');
const { createProactiveScheduler } = require('./src/bot/proactive-scheduler');
const { createWeeklyReportScheduler } = require('./src/bot/weekly-report-scheduler');
const { config, validateEnv } = require('./src/config');
const { createFirebaseDb, getFirebaseOps } = require('./src/firebase-db');
const { createMessageDedupe } = require('./src/message-dedupe');
const { createGroqClient } = require('./src/providers/groq');
const { createSendMessage } = require('./src/providers/whatsapp');
const { createBraveClient } = require('./src/research/brave-client');
const { registerRoutes } = require('./src/routes');
const { createSafeLog } = require('./src/safe-log');
const { createSessionStore } = require('./src/session-store');
const { createWebhookParser } = require('./src/webhook-parser');

validateEnv();

const app = express();
app.use(express.json({ limit: config.jsonLimit }));

const db = createFirebaseDb(config.firebase);
const firebaseOps = getFirebaseOps();
const safeLog = createSafeLog(config.logSensitiveData);
const sessionStore = createSessionStore(db);
const sendMessage = createSendMessage(config, safeLog);
const circuitBreaker = createCircuitBreaker({
  cooldownMs: config.ai.circuitCooldownMs,
  failureThreshold: config.ai.circuitFailureThreshold,
});
const costTracker = createCostTracker({
  config,
  db,
  firebaseOps,
  notificationSender: sendMessage,
});
const rawGroq = createGroqClient(config);
// Áudio e imagem passam pelo orçamento mensal e pelo circuit breaker.
const groq = createMeteredGroq({ circuitBreaker, costTracker, groq: rawGroq });
const aiGateway = config.features.conversationalAi
  ? createAiGateway({
    circuitBreaker,
    config,
    costTracker,
    deepseekClient: createDeepseekClient({ config }),
    groqClient: rawGroq,
  })
  : null;
const braveClient = config.features.investmentResearch ? createBraveClient({ config }) : null;
const botService = createBotService({
  aiGateway,
  braveClient,
  circuitBreaker,
  config,
  costTracker,
  db,
  groq,
  notificationSender: sendMessage,
  safeLog,
  sessionStore,
});
const messageDedupe = createMessageDedupe();
const webhookParser = createWebhookParser();
const weeklyReportScheduler = createWeeklyReportScheduler({
  db,
  enabled: config.weeklyReportSchedulerEnabled,
  firebaseOps,
  notificationSender: sendMessage,
  timeZone: config.timeZone,
  weeklyReportService: {
    gerarRelatorioSemanal: botService.gerarRelatorioSemanal,
  },
});
const proactiveScheduler = createProactiveScheduler({
  db,
  enabled: config.features.proactive && config.features.splits,
  firebaseOps,
  intervalMs: config.schedulers.proactiveIntervalMs,
  obligationService: botService.obligationService,
  quietHourStart: config.schedulers.quietHourStart,
  reminderHour: config.schedulers.reminderHour,
  timeZone: config.timeZone,
});

registerRoutes({
  app,
  botService,
  config,
  messageDedupe,
  safeLog,
  sendMessage,
  sessionStore,
  webhookParser,
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────
function shutdown() {
  console.log('🛑 Encerrando...');
  weeklyReportScheduler.stop();
  proactiveScheduler.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── START ────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`🚀 SalvaMoney v5.5 · porta ${config.port} · provider: evolution`);
  console.log(`🌐 Site: ${config.siteUrl}`);

  if (config.groqApiKey) {
    console.log('✅ Groq AI ativado (texto + áudio + imagem)');
  } else {
    console.log('⚠️ Groq AI desativado (só parser simples)');
  }

  // Somente o estado das flags (sem valores de configuração ou segredos).
  console.log('🚩 Feature flags:', JSON.stringify(config.features));

  weeklyReportScheduler.start();
  proactiveScheduler.start();
  console.log(
    config.weeklyReportSchedulerEnabled
      ? '✅ Relatório semanal automático ativado para contas opt-in'
      : '⚠️ Scheduler de relatório semanal desativado por configuração'
  );
});
