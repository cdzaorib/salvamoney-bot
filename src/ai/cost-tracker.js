'use strict';

// Controle mensal de custos das chamadas externas (IA e pesquisa).
// Nenhuma tarifa é fixada no código: preços e câmbio vêm da configuração.

// Todos os provedores exigem tarifa configurada: sem preço, a chamada é bloqueada
// (falha fechada), para que o teto mensal seja sempre rígido.
const PROVIDERS = {
  brave: {
    bucket: 'pesquisa',
    pricing: 'per1000',
    priceKey: 'braveUsdPer1000Requests',
  },
  deepseek: {
    bucket: 'deepseek',
    inputKey: 'deepseekInputUsdPerMTok',
    outputKey: 'deepseekOutputUsdPerMTok',
    pricing: 'tokens',
  },
  // Whisper é cobrado por duração do áudio, com mínimo de 10 segundos por requisição.
  'groq-audio': {
    bucket: 'reserva',
    pricing: 'duration',
    priceKey: 'groqAudioUsdPerHour',
  },
  'groq-fallback': {
    bucket: 'reserva',
    inputKey: 'groqFallbackInputUsdPerMTok',
    outputKey: 'groqFallbackOutputUsdPerMTok',
    pricing: 'tokens',
  },
  'groq-legacy': {
    bucket: 'reserva',
    inputKey: 'groqLegacyInputUsdPerMTok',
    outputKey: 'groqLegacyOutputUsdPerMTok',
    pricing: 'tokens',
  },
  'groq-vision': {
    bucket: 'reserva',
    pricing: 'request',
    priceKey: 'groqVisionUsdPerRequest',
  },
};

const MIN_AUDIO_SECONDS = 10;

const BUCKET_LIMIT_KEYS = {
  deepseek: 'deepseekBrl',
  pesquisa: 'searchBrl',
  reserva: 'reserveBrl',
};

const CACHE_TTL_MS = 30 * 1000;

function round6(value) {
  return Math.round(Number(value || 0) * 1e6) / 1e6;
}

function formatBrl(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function emptyLedger() {
  return {
    buckets: {
      deepseek: { chamadas: 0, custo: 0 },
      pesquisa: { chamadas: 0, custo: 0 },
      reserva: { chamadas: 0, custo: 0 },
    },
    tokens: { entrada: 0, saida: 0 },
    total: 0,
  };
}

function normalizeLedger(value) {
  const base = emptyLedger();
  const current = value && typeof value === 'object' ? value : {};

  Object.keys(base.buckets).forEach((bucket) => {
    base.buckets[bucket] = {
      chamadas: Number(current.buckets?.[bucket]?.chamadas || 0),
      custo: round6(current.buckets?.[bucket]?.custo || 0),
    };
  });

  base.tokens = {
    entrada: Number(current.tokens?.entrada || 0),
    saida: Number(current.tokens?.saida || 0),
  };
  base.total = round6(current.total || 0);

  if (current.alertas) {
    base.alertas = { ...current.alertas };
  }

  if (current.atualizadoEm) {
    base.atualizadoEm = current.atualizadoEm;
  }

  return base;
}

function createCostTracker({
  config,
  db,
  firebaseOps,
  logger = console,
  notificationSender,
  now = () => new Date(),
}) {
  const { get, ref, transaction } = firebaseOps;
  const budget = config?.budget || {};
  const pricing = config?.pricing || {};
  const timeZone = config?.timeZone || 'America/Sao_Paulo';
  const cache = new Map();

  function monthKey(date = now()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { month: '2-digit', timeZone, year: 'numeric' })
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}`;
  }

  function ledgerPath(key = monthKey()) {
    return `sistema/custosIA/${key}`;
  }

  function pricingConfigured(provider) {
    const meta = PROVIDERS[provider];

    if (!meta || pricing.usdBrlRate === null || pricing.usdBrlRate === undefined) {
      return false;
    }

    if (meta.pricing === 'tokens') {
      return pricing[meta.inputKey] !== null && pricing[meta.inputKey] !== undefined &&
        pricing[meta.outputKey] !== null && pricing[meta.outputKey] !== undefined;
    }

    return pricing[meta.priceKey] !== null && pricing[meta.priceKey] !== undefined;
  }

  function estimateCost(provider, usage = {}) {
    const meta = PROVIDERS[provider];

    if (!meta || !pricingConfigured(provider)) {
      return 0;
    }

    const rate = Number(pricing.usdBrlRate);
    const requests = Number(usage.requests ?? 1);

    if (meta.pricing === 'tokens') {
      const inputCost = Number(usage.inputTokens || 0) * Number(pricing[meta.inputKey]) / 1e6;
      const outputCost = Number(usage.outputTokens || 0) * Number(pricing[meta.outputKey]) / 1e6;

      return round6((inputCost + outputCost) * rate);
    }

    if (meta.pricing === 'per1000') {
      return round6(requests * Number(pricing[meta.priceKey]) / 1000 * rate);
    }

    if (meta.pricing === 'duration') {
      const seconds = Math.max(MIN_AUDIO_SECONDS, Number(usage.audioSeconds || 0)) * Math.max(1, requests);

      return round6(seconds / 3600 * Number(pricing[meta.priceKey]) * rate);
    }

    return round6(requests * Number(pricing[meta.priceKey]) * rate);
  }

  async function readLedger({ fresh = false } = {}) {
    const key = monthKey();
    const cached = cache.get(key);

    if (!fresh && cached && now().getTime() - cached.at < CACHE_TTL_MS) {
      return cached.ledger;
    }

    const snap = await get(ref(db, ledgerPath(key)));
    const ledger = normalizeLedger(snap.val());

    cache.set(key, { at: now().getTime(), ledger });

    return ledger;
  }

  function bucketLimit(bucket) {
    const value = Number(budget[BUCKET_LIMIT_KEYS[bucket]]);

    return Number.isFinite(value) ? value : 0;
  }

  // estimatedUsage permite recusar antes uma chamada que estouraria o teto.
  async function canSpend(provider, estimatedUsage = null) {
    const meta = PROVIDERS[provider];

    if (!meta) {
      return { allowed: false, reason: 'provedor_desconhecido' };
    }

    if (!pricingConfigured(provider)) {
      return { allowed: false, reason: 'tarifa_nao_configurada' };
    }

    let ledger;

    try {
      ledger = await readLedger();
    } catch (_) {
      // Sem leitura do controle de custos, a política é não gastar.
      return { allowed: false, reason: 'controle_indisponivel' };
    }

    const monthlyLimit = Number(budget.monthlyBrl);

    if (Number.isFinite(monthlyLimit) && ledger.total >= monthlyLimit) {
      return { allowed: false, reason: 'limite_mensal' };
    }

    if (ledger.buckets[meta.bucket].custo >= bucketLimit(meta.bucket)) {
      return { allowed: false, reason: 'limite_categoria' };
    }

    const estimate = estimatedUsage ? estimateCost(provider, estimatedUsage) : 0;

    if (estimate > 0 && Number.isFinite(monthlyLimit) && ledger.total + estimate > monthlyLimit) {
      return { allowed: false, reason: 'limite_mensal' };
    }

    if (estimate > 0 && ledger.buckets[meta.bucket].custo + estimate > bucketLimit(meta.bucket)) {
      return { allowed: false, reason: 'limite_categoria' };
    }

    return { allowed: true };
  }

  async function notifyAdmin(message) {
    if (!budget.adminPhone || typeof notificationSender !== 'function') {
      logger.warn?.('[ai-budget] alerta de orçamento sem ADMIN_PHONE configurado.');
      return false;
    }

    try {
      return await notificationSender(budget.adminPhone, message) !== false;
    } catch (_) {
      logger.warn?.('[ai-budget] falha ao enviar alerta de orçamento.');
      return false;
    }
  }

  async function claimAlert(key, name) {
    const result = await transaction(ref(db, `${ledgerPath(key)}/alertas/${name}`), (current) =>
      current ? undefined : now().toISOString()
    );

    return result?.committed === true;
  }

  async function checkThresholds(key, ledger) {
    const limit = Number(budget.monthlyBrl);

    if (!Number.isFinite(limit) || limit <= 0) {
      return;
    }

    const alertAt = limit * Number(budget.alertPercent ?? 80) / 100;

    if (ledger.total >= alertAt && !ledger.alertas?.p80 && await claimAlert(key, 'p80')) {
      await notifyAdmin([
        '⚠️ SalvaMoney: uso de serviços externos atingiu ' +
          `${Math.round((ledger.total / limit) * 100)}% do orçamento mensal.`,
        `Gasto estimado: ${formatBrl(ledger.total)} de ${formatBrl(limit)}.`,
      ].join('\n'));
    }

    if (ledger.total >= limit && !ledger.alertas?.limite && await claimAlert(key, 'limite')) {
      await notifyAdmin([
        '⛔ SalvaMoney: orçamento mensal de serviços externos atingido.',
        'Novas chamadas externas estão bloqueadas até o próximo mês. Funções locais seguem ativas.',
      ].join('\n'));
    }
  }

  async function record(provider, usage = {}) {
    const meta = PROVIDERS[provider];

    if (!meta) {
      return 0;
    }

    const cost = estimateCost(provider, usage);
    const key = monthKey();
    const result = await transaction(ref(db, ledgerPath(key)), (current) => {
      const next = normalizeLedger(current);

      next.total = round6(next.total + cost);
      next.buckets[meta.bucket].custo = round6(next.buckets[meta.bucket].custo + cost);
      next.buckets[meta.bucket].chamadas += Number(usage.requests ?? 1);
      next.tokens.entrada += Number(usage.inputTokens || 0);
      next.tokens.saida += Number(usage.outputTokens || 0);
      next.atualizadoEm = now().toISOString();

      return next;
    });
    const ledger = normalizeLedger(result?.snapshot?.val?.());

    cache.set(key, { at: now().getTime(), ledger });

    try {
      await checkThresholds(key, ledger);
    } catch (_) {
      logger.warn?.('[ai-budget] falha ao verificar limites do orçamento.');
    }

    return cost;
  }

  async function usage() {
    const ledger = await readLedger({ fresh: true });

    return {
      ...ledger,
      limite: Number(budget.monthlyBrl),
      mes: monthKey(),
    };
  }

  return {
    canSpend,
    estimateCost,
    monthKey,
    pricingConfigured,
    record,
    usage,
  };
}

module.exports = {
  PROVIDERS,
  createCostTracker,
  normalizeLedger,
};
