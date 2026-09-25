'use strict';

const nodeEnv = process.env.NODE_ENV || 'production';

const FEATURE_FLAG_ENV = {
  conversationalAi: 'FEATURE_CONVERSATIONAL_AI',
  personalities: 'FEATURE_PERSONALITIES',
  friends: 'FEATURE_FRIENDS',
  splits: 'FEATURE_SPLITS',
  cards: 'FEATURE_CARDS',
  advisor: 'FEATURE_FINANCIAL_ADVISOR',
  investmentResearch: 'FEATURE_INVESTMENT_RESEARCH',
  proactive: 'FEATURE_PROACTIVE_MESSAGES',
};

// Em produção (e sempre que NODE_ENV não for "development") cada flag exige
// ativação explícita com o valor "true". Qualquer outro valor desliga a flag.
function envFlag(name, env = process.env, currentNodeEnv = nodeEnv) {
  const raw = env[name];

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return currentNodeEnv === 'development';
  }

  return String(raw).trim().toLowerCase() === 'true';
}

function envNumber(name, fallback, env = process.env) {
  const raw = env[name];

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }

  const value = Number(String(raw).replace(',', '.'));

  return Number.isFinite(value) ? value : fallback;
}

// Tarifas não têm valor padrão: sem configuração explícita o custo é desconhecido.
function envOptionalNumber(name, env = process.env) {
  const value = envNumber(name, null, env);

  return value !== null && value >= 0 ? value : null;
}

function resolveFeatureFlags(env = process.env, currentNodeEnv = nodeEnv) {
  return Object.fromEntries(
    Object.entries(FEATURE_FLAG_ENV).map(([key, envName]) => [key, envFlag(envName, env, currentNodeEnv)])
  );
}

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
  groqFallbackModel: process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b',
  groqFallbackTimeoutMs: envNumber('GROQ_FALLBACK_TIMEOUT_MS', 2500),
  groqMaxRetries: envNumber('GROQ_MAX_RETRIES', 1),
  // Download + transcrição/leitura cabem na meta de 20 segundos para áudio e imagem.
  groqAudioTimeoutMs: envNumber('GROQ_AUDIO_TIMEOUT_MS', 14000),
  groqVisionTimeoutMs: envNumber('GROQ_VISION_TIMEOUT_MS', 14000),
  mediaDownloadTimeoutMs: envNumber('MEDIA_DOWNLOAD_TIMEOUT_MS', 5000),
  aiLegacyTimeoutMs: envNumber('AI_LEGACY_TIMEOUT_MS', 3000),
  evolutionApiUrl: process.env.EVOLUTION_API_URL,
  evolutionApiKey: process.env.EVOLUTION_API_KEY,
  evolutionInstance: process.env.EVOLUTION_INSTANCE || 'salvamoney',
  timeZone: process.env.TZ || 'America/Sao_Paulo',
  monthIndexMode: process.env.MONTH_INDEX_MODE === 'one' ? 'one' : 'zero',
  weeklyReportSchedulerEnabled: process.env.WEEKLY_REPORT_SCHEDULER_ENABLED !== 'false',
  requireRouteTokens: !['development', 'test'].includes(nodeEnv),
  port: process.env.PORT || 3000,
  features: resolveFeatureFlags(),
  deepseek: {
    apiKey: String(process.env.DEEPSEEK_API_KEY || ''),
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    timeoutMs: envNumber('DEEPSEEK_TIMEOUT_MS', 2500),
    maxTokens: envNumber('DEEPSEEK_MAX_TOKENS', 600),
  },
  brave: {
    apiKey: String(process.env.BRAVE_API_KEY || ''),
    url: process.env.BRAVE_SEARCH_URL || 'https://api.search.brave.com/res/v1/web/search',
    timeoutMs: envNumber('BRAVE_TIMEOUT_MS', 5000),
    country: process.env.RESEARCH_COUNTRY || 'BR',
    searchLang: process.env.RESEARCH_SEARCH_LANG || 'pt-br',
    resultsPerQuery: envNumber('RESEARCH_RESULTS_PER_QUERY', 8),
  },
  ai: {
    textDeadlineMs: envNumber('AI_TEXT_DEADLINE_MS', 3000),
    researchDeadlineMs: envNumber('AI_RESEARCH_DEADLINE_MS', 12000),
    maxRetries: envNumber('AI_MAX_RETRIES', 1),
    circuitFailureThreshold: envNumber('AI_CIRCUIT_FAILURE_THRESHOLD', 3),
    circuitCooldownMs: envNumber('AI_CIRCUIT_COOLDOWN_MS', 60000),
    contextMaxMessages: envNumber('AI_CONTEXT_MAX_MESSAGES', 6),
    contextTtlMs: envNumber('AI_CONTEXT_TTL_MS', 24 * 60 * 60 * 1000),
    consentVersion: process.env.AI_CONSENT_VERSION || '2026-09-v1',
  },
  budget: {
    monthlyBrl: envNumber('AI_MONTHLY_BUDGET_BRL', 60),
    deepseekBrl: envNumber('AI_BUDGET_DEEPSEEK_BRL', 35),
    searchBrl: envNumber('AI_BUDGET_SEARCH_BRL', 10),
    reserveBrl: envNumber('AI_BUDGET_RESERVE_BRL', 15),
    alertPercent: envNumber('AI_BUDGET_ALERT_PERCENT', 80),
    adminPhone: String(process.env.ADMIN_PHONE || '').replace(/\D/g, ''),
  },
  pricing: {
    usdBrlRate: envOptionalNumber('USD_BRL_RATE'),
    deepseekInputUsdPerMTok: envOptionalNumber('DEEPSEEK_PRICE_INPUT_USD_PER_MTOK'),
    deepseekOutputUsdPerMTok: envOptionalNumber('DEEPSEEK_PRICE_OUTPUT_USD_PER_MTOK'),
    groqFallbackInputUsdPerMTok: envOptionalNumber('GROQ_FALLBACK_PRICE_INPUT_USD_PER_MTOK'),
    groqFallbackOutputUsdPerMTok: envOptionalNumber('GROQ_FALLBACK_PRICE_OUTPUT_USD_PER_MTOK'),
    groqLegacyInputUsdPerMTok: envOptionalNumber('GROQ_LEGACY_PRICE_INPUT_USD_PER_MTOK'),
    groqLegacyOutputUsdPerMTok: envOptionalNumber('GROQ_LEGACY_PRICE_OUTPUT_USD_PER_MTOK'),
    groqAudioUsdPerRequest: envOptionalNumber('GROQ_AUDIO_PRICE_USD_PER_REQUEST'),
    groqVisionUsdPerRequest: envOptionalNumber('GROQ_VISION_PRICE_USD_PER_REQUEST'),
    braveUsdPer1000Requests: envOptionalNumber('BRAVE_PRICE_USD_PER_1000_REQUESTS'),
  },
  schedulers: {
    proactiveIntervalMs: envNumber('PROACTIVE_SCHEDULER_INTERVAL_MS', 15 * 60 * 1000),
    reminderHour: envNumber('PROACTIVE_REMINDER_HOUR', 9),
    quietHourStart: envNumber('PROACTIVE_QUIET_HOUR_START', 21),
  },
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

  for (const warning of featureWarnings(config)) {
    console.warn(warning);
  }
}

// Avisos de configuração sem valores secretos: apenas nomes de variáveis.
function featureWarnings(currentConfig = config) {
  const warnings = [];
  const { features = {}, deepseek = {}, brave = {}, pricing = {} } = currentConfig;

  if (features.conversationalAi && !deepseek.apiKey) {
    warnings.push('⚠️ FEATURE_CONVERSATIONAL_AI ativa sem DEEPSEEK_API_KEY. A IA conversacional usará somente regras locais.');
  }

  if (features.conversationalAi && (
    pricing.deepseekInputUsdPerMTok === null ||
    pricing.deepseekOutputUsdPerMTok === null ||
    pricing.usdBrlRate === null
  )) {
    warnings.push('⚠️ Tarifas da DeepSeek ou USD_BRL_RATE não configuradas. Chamadas à DeepSeek ficam bloqueadas até configurar.');
  }

  if (features.investmentResearch && !brave.apiKey) {
    warnings.push('⚠️ FEATURE_INVESTMENT_RESEARCH ativa sem BRAVE_API_KEY. Pesquisas usarão somente conhecimento interno com aviso.');
  }

  if (features.investmentResearch && (pricing.braveUsdPer1000Requests === null || pricing.usdBrlRate === null)) {
    warnings.push('⚠️ Tarifa da Brave ou USD_BRL_RATE não configurada. Pesquisas ao vivo ficam bloqueadas até configurar.');
  }

  if (features.splits && !features.friends) {
    warnings.push('⚠️ FEATURE_SPLITS depende de FEATURE_FRIENDS para usar apelidos.');
  }

  return warnings;
}

module.exports = {
  FEATURE_FLAG_ENV,
  config,
  envFlag,
  featureWarnings,
  resolveFeatureFlags,
  validateEnv,
};
