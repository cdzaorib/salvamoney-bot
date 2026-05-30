'use strict';

const nodeEnv = process.env.NODE_ENV || 'production';

const config = {
  nodeEnv,
  jsonLimit: process.env.JSON_LIMIT || '25mb',
  siteUrl: process.env.SITE_URL || 'https://cdzaorib.github.io/Salvamoney-site/',
  webhookToken: String(process.env.WEBHOOK_TOKEN || ''),
  dashboardToken: String(process.env.DASHBOARD_TOKEN || ''),
  logSensitiveData: process.env.LOG_SENSITIVE_DATA === 'true',
  groqApiKey: process.env.GROQ_API_KEY,
  groqChatUrl: 'https://api.groq.com/openai/v1/chat/completions',
  groqAudioUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  groqVisionModel: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
  groqAudioModel: process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3-turbo',
  evolutionApiUrl: process.env.EVOLUTION_API_URL,
  evolutionApiKey: process.env.EVOLUTION_API_KEY,
  evolutionInstance: process.env.EVOLUTION_INSTANCE || 'salvamoney',
  timeZone: process.env.TZ || 'America/Sao_Paulo',
  monthIndexMode: process.env.MONTH_INDEX_MODE === 'one' ? 'one' : 'zero',
  weeklyReportSchedulerEnabled: process.env.WEEKLY_REPORT_SCHEDULER_ENABLED !== 'false',
  requireRouteTokens: !['development', 'test'].includes(nodeEnv),
  port: process.env.PORT || 3000,
  firebase: {
    databaseURL: process.env.FIREBASE_DB_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    serviceAccountBase64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  },
};

function validateEnv() {
  const requiredEnv = [
    'FIREBASE_DB_URL',
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE',
  ];

  const missingEnv = requiredEnv.filter((key) => !process.env[key]);

  if (missingEnv.length) {
    console.error(`❌ Variáveis ausentes: ${missingEnv.join(', ')}`);
    process.exit(1);
  }

  const hasServiceAccount =
    Boolean(config.firebase.serviceAccountBase64) ||
    Boolean(config.firebase.serviceAccountJson) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    Boolean(config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey);

  if (!hasServiceAccount) {
    console.error(
      '❌ Configure credenciais do Firebase Admin: FIREBASE_SERVICE_ACCOUNT_BASE64, ' +
      'FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS ou ' +
      'FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  if (!config.groqApiKey) {
    console.warn('⚠️ GROQ_API_KEY ausente. Sem IA, sem áudio e sem imagem.');
  }

  if (!config.webhookToken) {
    console.warn(
      config.requireRouteTokens
        ? '⚠️ WEBHOOK_TOKEN ausente. O webhook recusará chamadas enquanto o token não for configurado.'
        : '⚠️ WEBHOOK_TOKEN ausente. Webhook aberto somente fora de production.'
    );
  }

  if (!config.dashboardToken) {
    console.warn(
      config.requireRouteTokens
        ? '⚠️ DASHBOARD_TOKEN ausente. A API do dashboard recusará chamadas enquanto o token não for configurado.'
        : '⚠️ DASHBOARD_TOKEN ausente. Dashboard aberto somente fora de production.'
    );
  }
}

module.exports = {
  config,
  validateEnv,
};
