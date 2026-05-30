'use strict';

const express = require('express');
require('dotenv').config();

const { createBotService } = require('./src/bot-service');
const { createWeeklyReportScheduler } = require('./src/bot/weekly-report-scheduler');
const { config, validateEnv } = require('./src/config');
const { createFirebaseDb, getFirebaseOps } = require('./src/firebase-db');
const { createMessageDedupe } = require('./src/message-dedupe');
const { createGroqClient } = require('./src/providers/groq');
const { createSendMessage } = require('./src/providers/whatsapp');
const { registerRoutes } = require('./src/routes');
const { createSafeLog } = require('./src/safe-log');
const { createSessionStore } = require('./src/session-store');
const { createWebhookParser } = require('./src/webhook-parser');

validateEnv();

const app = express();
app.use(express.json({ limit: config.jsonLimit }));

const db = createFirebaseDb(config.firebase);
const safeLog = createSafeLog(config.logSensitiveData);
const groq = createGroqClient(config);
const sessionStore = createSessionStore(db);
const sendMessage = createSendMessage(config, safeLog);
const botService = createBotService({
  config,
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
  firebaseOps: getFirebaseOps(),
  notificationSender: sendMessage,
  timeZone: config.timeZone,
  weeklyReportService: {
    gerarRelatorioSemanal: botService.gerarRelatorioSemanal,
  },
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
process.on('SIGTERM', () => {
  console.log('🛑 Encerrando...');
  weeklyReportScheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Encerrando...');
  weeklyReportScheduler.stop();
  process.exit(0);
});

// ─── START ────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`🚀 SalvaMoney v5.5 · porta ${config.port} · provider: evolution`);
  console.log(`🌐 Site: ${config.siteUrl}`);

  if (config.groqApiKey) {
    console.log('✅ Groq AI ativado (texto + áudio + imagem)');
  } else {
    console.log('⚠️ Groq AI desativado (só parser simples)');
  }

  weeklyReportScheduler.start();
  console.log(
    config.weeklyReportSchedulerEnabled
      ? '✅ Relatório semanal automático ativado para contas opt-in'
      : '⚠️ Scheduler de relatório semanal desativado por configuração'
  );
});
