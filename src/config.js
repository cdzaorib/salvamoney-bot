'use strict';

const config = {
  jsonLimit: process.env.JSON_LIMIT || '25mb',
  whatsappProvider: process.env.WHATSAPP_PROVIDER || 'zapi',
  siteUrl: process.env.SITE_URL || 'https://cdzaorib.github.io/Salvamoney2.0/',
  webhookToken: String(process.env.WEBHOOK_TOKEN || ''),
  dashboardToken: String(process.env.DASHBOARD_TOKEN || ''),
  logSensitiveData: process.env.LOG_SENSITIVE_DATA === 'true',
  groqApiKey: process.env.GROQ_API_KEY,
  groqChatUrl: 'https://api.groq.com/openai/v1/chat/completions',
  groqAudioUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  groqVisionModel: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
  groqAudioModel: process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3-turbo',
  zapiClientToken: process.env.ZAPI_CLIENT_TOKEN,
  zapiUrl: process.env.ZAPI_INSTANCE && process.env.ZAPI_TOKEN
    ? `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}`
    : null,
  evolutionApiUrl: process.env.EVOLUTION_API_URL,
  evolutionApiKey: process.env.EVOLUTION_API_KEY,
  evolutionInstance: process.env.EVOLUTION_INSTANCE || 'salvamoney',
  timeZone: process.env.TZ || 'America/Sao_Paulo',
  monthIndexMode: process.env.MONTH_INDEX_MODE === 'one' ? 'one' : 'zero',
  port: process.env.PORT || 3000,
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DB_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID,
  },
};

function validateEnv() {
  const requiredEnv = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DB_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_APP_ID',
  ];

  if (config.whatsappProvider === 'evolution') {
    requiredEnv.push('EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE');
  } else {
    requiredEnv.push('ZAPI_INSTANCE', 'ZAPI_TOKEN');
  }

  const missingEnv = requiredEnv.filter((key) => !process.env[key]);

  if (missingEnv.length) {
    console.error(`❌ Variáveis ausentes: ${missingEnv.join(', ')}`);
    process.exit(1);
  }

  if (config.whatsappProvider !== 'evolution' && !config.zapiClientToken) {
    console.warn('⚠️ ZAPI_CLIENT_TOKEN não configurado. A Z-API pode recusar envios.');
  }

  if (!config.groqApiKey) {
    console.warn('⚠️ GROQ_API_KEY ausente. Sem IA, sem áudio e sem imagem.');
  }

  if (!config.webhookToken) {
    console.warn('⚠️ WEBHOOK_TOKEN ausente. O webhook aceita chamadas sem token.');
  }

  if (!config.dashboardToken) {
    console.warn('⚠️ DASHBOARD_TOKEN ausente. O dashboard usa somente o telefone para consultar dados.');
  }
}

module.exports = {
  config,
  validateEnv,
};
