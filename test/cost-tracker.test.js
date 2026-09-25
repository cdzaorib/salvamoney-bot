'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCostTracker } = require('../src/ai/cost-tracker');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const PRICED = {
  braveUsdPer1000Requests: 5,
  deepseekInputUsdPerMTok: 1,
  deepseekOutputUsdPerMTok: 2,
  groqAudioUsdPerHour: 0.04,
  groqFallbackInputUsdPerMTok: 0.1,
  groqFallbackOutputUsdPerMTok: 0.5,
  usdBrlRate: 5,
};
const BUDGET = {
  adminPhone: '5511900000000',
  alertPercent: 80,
  deepseekBrl: 35,
  monthlyBrl: 60,
  reserveBrl: 15,
  searchBrl: 10,
};

function createTracker({ budget = BUDGET, pricing = PRICED, seed = {} } = {}) {
  const firebase = createFakeFirebase(seed);
  const sent = [];
  const tracker = createCostTracker({
    config: { budget, pricing, timeZone: 'America/Sao_Paulo' },
    db: {},
    firebaseOps: firebase.ops,
    logger: { warn() {} },
    notificationSender: async (phone, message) => {
      sent.push({ message, phone });
      return true;
    },
    now: () => new Date('2026-09-25T15:00:00.000Z'),
  });

  return { firebase, sent, tracker };
}

test('custos: sem tarifa configurada todo provedor fica bloqueado (falha fechada, sem preço fixo no código)', async () => {
  const { tracker } = createTracker({ pricing: { usdBrlRate: null } });

  for (const provider of ['deepseek', 'brave', 'groq-fallback', 'groq-legacy', 'groq-audio', 'groq-vision']) {
    assert.deepEqual(await tracker.canSpend(provider), { allowed: false, reason: 'tarifa_nao_configurada' }, provider);
  }

  const partial = createTracker({ pricing: { ...PRICED, groqLegacyInputUsdPerMTok: 0.05 } }).tracker;

  assert.deepEqual(await partial.canSpend('groq-legacy'), { allowed: false, reason: 'tarifa_nao_configurada' });
});

test('custos: Whisper é cobrado por duração (mínimo de 10 s por requisição)', async () => {
  const { tracker } = createTracker();

  assert.equal(tracker.estimateCost('groq-audio', { audioSeconds: 3600 }), 0.2);
  assert.equal(tracker.estimateCost('groq-audio', { audioSeconds: 3 }), tracker.estimateCost('groq-audio', { audioSeconds: 10 }));
});

test('custos: chamada cuja estimativa estouraria o teto é recusada antes de acontecer', async () => {
  const { tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { alertas: { p80: 'x' }, buckets: { deepseek: { custo: 20 } }, total: 59.99 } } } },
  });

  assert.deepEqual(await tracker.canSpend('deepseek', { inputTokens: 100, outputTokens: 100 }), { allowed: true });
  assert.deepEqual(await tracker.canSpend('deepseek', { inputTokens: 10_000, outputTokens: 10_000 }), { allowed: false, reason: 'limite_mensal' });
});

test('custos: estimativa usa tarifas e câmbio da configuração e grava por categoria', async () => {
  const { firebase, tracker } = createTracker();
  const cost = await tracker.record('deepseek', { inputTokens: 1_000_000, outputTokens: 500_000, requests: 1 });
  const searchCost = await tracker.record('brave', { requests: 2 });
  const ledger = firebase.getValue('sistema/custosIA/2026-09');

  assert.equal(cost, 10);
  assert.equal(searchCost, 0.05);
  assert.equal(ledger.total, 10.05);
  assert.equal(ledger.buckets.deepseek.custo, 10);
  assert.equal(ledger.buckets.pesquisa.chamadas, 2);
});

test('custos: aos 80% o administrador recebe um único alerta', async () => {
  const { sent, tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { buckets: { deepseek: { chamadas: 1, custo: 30 } }, total: 47 } } } },
  });

  await tracker.record('deepseek', { inputTokens: 500_000, outputTokens: 0 });
  await tracker.record('deepseek', { inputTokens: 100_000, outputTokens: 0 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, '5511900000000');
  assert.match(sent[0].message, /atingiu 83% do orçamento mensal/);
});

test('custos: ao atingir o limite bloqueia chamadas externas e avisa o administrador', async () => {
  const { sent, tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { alertas: { p80: 'x' }, buckets: { deepseek: { custo: 20 } }, total: 59.9 } } } },
  });

  await tracker.record('deepseek', { inputTokens: 100_000, outputTokens: 0 });

  assert.deepEqual(await tracker.canSpend('deepseek'), { allowed: false, reason: 'limite_mensal' });
  assert.deepEqual(await tracker.canSpend('groq-fallback'), { allowed: false, reason: 'limite_mensal' });
  assert.deepEqual(await tracker.canSpend('brave'), { allowed: false, reason: 'limite_mensal' });
  assert.match(sent.at(-1).message, /orçamento mensal de serviços externos atingido/);
});

test('custos: limite da categoria DeepSeek (R$ 35) bloqueia só a DeepSeek; reserva segue para fallback', async () => {
  const { tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { buckets: { deepseek: { custo: 35 }, reserva: { custo: 2 } }, total: 37 } } } },
  });

  assert.deepEqual(await tracker.canSpend('deepseek'), { allowed: false, reason: 'limite_categoria' });
  assert.deepEqual(await tracker.canSpend('groq-fallback'), { allowed: true });
  assert.deepEqual(await tracker.canSpend('brave'), { allowed: true });
});
