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
    reservasAbertas: 0,
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
  base.reservasAbertas = round6(current.reservasAbertas || 0);

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

  async function readLedger() {
    const snap = await get(ref(db, ledgerPath(monthKey())));

    return normalizeLedger(snap.val());
  }

  function bucketLimit(bucket) {
    const value = Number(budget[BUCKET_LIMIT_KEYS[bucket]]);

    return Number.isFinite(value) ? value : 0;
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

  function limitReason(ledger, bucket, amount) {
    const monthlyLimit = Number(budget.monthlyBrl);

    if (Number.isFinite(monthlyLimit) && (ledger.total >= monthlyLimit || round6(ledger.total + amount) > monthlyLimit)) {
      return 'limite_mensal';
    }

    const categoryLimit = bucketLimit(bucket);
    const categorySpent = ledger.buckets[bucket].custo;

    if (categorySpent >= categoryLimit || round6(categorySpent + amount) > categoryLimit) {
      return 'limite_categoria';
    }

    return null;
  }

  // Reserva atômica: numa única transação do Firebase confere o teto (mês e
  // categoria) e já lança o custo estimado. Chamadas concorrentes não passam
  // juntas do limite. Deve ser chamada antes de CADA tentativa (inclusive retry).
  async function reserve(provider, estimatedUsage = {}) {
    const meta = PROVIDERS[provider];

    if (!meta) {
      return { allowed: false, reason: 'provedor_desconhecido' };
    }

    if (!pricingConfigured(provider)) {
      return { allowed: false, reason: 'tarifa_nao_configurada' };
    }

    const amount = estimateCost(provider, estimatedUsage || {});
    const key = monthKey();
    let denied = null;
    let result;

    try {
      result = await transaction(ref(db, ledgerPath(key)), (current) => {
        const next = normalizeLedger(current);

        denied = limitReason(next, meta.bucket, amount);

        if (denied) {
          return undefined;
        }

        next.total = round6(next.total + amount);
        next.buckets[meta.bucket].custo = round6(next.buckets[meta.bucket].custo + amount);
        next.reservasAbertas = round6(next.reservasAbertas + amount);
        next.atualizadoEm = now().toISOString();

        return next;
      });
    } catch (_) {
      // Sem o controle de custos disponível, a política é não gastar.
      return { allowed: false, reason: 'controle_indisponivel' };
    }

    if (result?.committed !== true) {
      return { allowed: false, reason: denied || 'controle_indisponivel' };
    }

    return {
      allowed: true,
      reservation: {
        amount,
        bucket: meta.bucket,
        monthKey: key,
        provider,
        settled: false,
      },
    };
  }

  // Troca o valor reservado pelo custo real (pode ser menor ou maior). Uma
  // reserva só é liquidada uma vez; sem uso faturável, devolve o valor reservado.
  async function settle(reservation, actualUsage = null) {
    if (!reservation || reservation.settled) {
      return 0;
    }

    reservation.settled = true;

    const billable = actualUsage !== null && actualUsage !== undefined;
    const cost = billable ? estimateCost(reservation.provider, actualUsage) : 0;
    const delta = round6(cost - reservation.amount);
    const result = await transaction(ref(db, ledgerPath(reservation.monthKey)), (current) => {
      const next = normalizeLedger(current);

      next.total = round6(Math.max(0, next.total + delta));
      next.buckets[reservation.bucket].custo = round6(Math.max(0, next.buckets[reservation.bucket].custo + delta));
      next.reservasAbertas = round6(Math.max(0, next.reservasAbertas - reservation.amount));

      if (billable) {
        next.buckets[reservation.bucket].chamadas += Number(actualUsage.requests ?? 1);
        next.tokens.entrada += Number(actualUsage.inputTokens || 0);
        next.tokens.saida += Number(actualUsage.outputTokens || 0);
      }

      next.atualizadoEm = now().toISOString();

      return next;
    });
    const ledger = normalizeLedger(result?.snapshot?.val?.());

    try {
      await checkThresholds(reservation.monthKey, ledger);
    } catch (_) {
      logger.warn?.('[ai-budget] falha ao verificar limites do orçamento.');
    }

    return cost;
  }

  async function release(reservation) {
    return await settle(reservation, null);
  }

  async function usage() {
    const ledger = await readLedger();

    return {
      ...ledger,
      limite: Number(budget.monthlyBrl),
      mes: monthKey(),
    };
  }

  return {
    estimateCost,
    monthKey,
    pricingConfigured,
    release,
    reserve,
    settle,
    usage,
  };
}

module.exports = {
  PROVIDERS,
  createCostTracker,
  normalizeLedger,
};
