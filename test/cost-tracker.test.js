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

function createTracker({ budget = BUDGET, optimisticTransactions = false, pricing = PRICED, seed = {} } = {}) {
  const firebase = createFakeFirebase(seed, { optimisticTransactions });
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

async function spend(tracker, provider, usage) {
  const budget = await tracker.reserve(provider, usage);

  assert.equal(budget.allowed, true, `${provider}: ${budget.reason}`);

  return await tracker.settle(budget.reservation, usage);
}

test('custos: sem tarifa configurada todo provedor fica bloqueado (falha fechada, sem preço fixo no código)', async () => {
  const { tracker } = createTracker({ pricing: { usdBrlRate: null } });

  for (const provider of ['deepseek', 'brave', 'groq-fallback', 'groq-legacy', 'groq-audio', 'groq-vision']) {
    assert.deepEqual(await tracker.reserve(provider), { allowed: false, reason: 'tarifa_nao_configurada' }, provider);
  }

  const partial = createTracker({ pricing: { ...PRICED, groqLegacyInputUsdPerMTok: 0.05 } }).tracker;

  assert.deepEqual(await partial.reserve('groq-legacy'), { allowed: false, reason: 'tarifa_nao_configurada' });
  assert.deepEqual(await partial.reserve('provedor-x'), { allowed: false, reason: 'provedor_desconhecido' });
});

test('custos: Whisper é cobrado por duração (mínimo de 10 s por requisição)', async () => {
  const { tracker } = createTracker();

  assert.equal(tracker.estimateCost('groq-audio', { audioSeconds: 3600 }), 0.2);
  assert.equal(tracker.estimateCost('groq-audio', { audioSeconds: 3 }), tracker.estimateCost('groq-audio', { audioSeconds: 10 }));
});

test('custos: chamada cuja estimativa estouraria o teto é recusada antes de acontecer', async () => {
  const { firebase, tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { alertas: { p80: 'x' }, buckets: { deepseek: { custo: 20 } }, total: 59.99 } } } },
  });
  const small = await tracker.reserve('deepseek', { inputTokens: 100, outputTokens: 100 });

  assert.equal(small.allowed, true);
  assert.equal(small.reservation.amount, 0.0015);
  assert.deepEqual(await tracker.reserve('deepseek', { inputTokens: 10_000, outputTokens: 10_000 }), { allowed: false, reason: 'limite_mensal' });

  const ledger = firebase.getValue('sistema/custosIA/2026-09');

  assert.equal(ledger.total, 59.9915, 'a reserva já entra no total');
  assert.equal(ledger.reservasAbertas, 0.0015);
});

test('custos: estimativa usa tarifas e câmbio da configuração e grava por categoria', async () => {
  const { firebase, tracker } = createTracker();
  const cost = await spend(tracker, 'deepseek', { inputTokens: 1_000_000, outputTokens: 500_000, requests: 1 });
  const searchCost = await spend(tracker, 'brave', { requests: 2 });
  const ledger = firebase.getValue('sistema/custosIA/2026-09');

  assert.equal(cost, 10);
  assert.equal(searchCost, 0.05);
  assert.equal(ledger.total, 10.05);
  assert.equal(ledger.buckets.deepseek.custo, 10);
  assert.equal(ledger.buckets.pesquisa.chamadas, 2);
  assert.equal(ledger.reservasAbertas, 0);
});

test('custos: aos 80% o administrador recebe um único alerta', async () => {
  const { sent, tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { buckets: { deepseek: { chamadas: 1, custo: 30 } }, total: 47 } } } },
  });

  await spend(tracker, 'deepseek', { inputTokens: 500_000, outputTokens: 0 });
  await spend(tracker, 'deepseek', { inputTokens: 100_000, outputTokens: 0 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, '5511900000000');
  assert.match(sent[0].message, /atingiu 83% do orçamento mensal/);
});

test('custos: ao atingir o limite bloqueia chamadas externas e avisa o administrador', async () => {
  const { sent, tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { alertas: { p80: 'x' }, buckets: { deepseek: { custo: 20 } }, total: 59.9 } } } },
  });

  await spend(tracker, 'deepseek', { inputTokens: 20_000, outputTokens: 0 });

  assert.deepEqual(await tracker.reserve('deepseek'), { allowed: false, reason: 'limite_mensal' });
  assert.deepEqual(await tracker.reserve('groq-fallback'), { allowed: false, reason: 'limite_mensal' });
  assert.deepEqual(await tracker.reserve('brave', { requests: 1 }), { allowed: false, reason: 'limite_mensal' });
  assert.match(sent.at(-1).message, /orçamento mensal de serviços externos atingido/);
});

test('custos: limite da categoria DeepSeek (R$ 35) bloqueia só a DeepSeek; reserva segue para fallback', async () => {
  const { tracker } = createTracker({
    seed: { sistema: { custosIA: { '2026-09': { buckets: { deepseek: { custo: 35 }, reserva: { custo: 2 } }, total: 37 } } } },
  });

  assert.deepEqual(await tracker.reserve('deepseek'), { allowed: false, reason: 'limite_categoria' });
  assert.equal((await tracker.reserve('groq-fallback', { inputTokens: 100, outputTokens: 100 })).allowed, true);
  assert.equal((await tracker.reserve('brave', { requests: 1 })).allowed, true);
});

test('custos: duas reservas concorrentes perto do teto — só uma passa', async () => {
  // Cada chamada custa R$ 0,01 e só cabe mais uma antes de R$ 60,00.
  const { firebase, tracker } = createTracker({
    optimisticTransactions: true,
    seed: { sistema: { custosIA: { '2026-09': { alertas: { p80: 'x' }, buckets: { deepseek: { custo: 20 } }, total: 59.99 } } } },
  });
  const usage = { inputTokens: 1000, outputTokens: 500, requests: 1 };
  const results = await Promise.all([tracker.reserve('deepseek', usage), tracker.reserve('deepseek', usage)]);

  assert.deepEqual(results.map((result) => result.allowed).sort(), [false, true]);
  assert.equal(results.find((result) => !result.allowed).reason, 'limite_mensal');
  assert.equal(firebase.getValue('sistema/custosIA/2026-09').total, 60);
});

test('custos: rajada de reservas concorrentes nunca ultrapassa o teto', async () => {
  // Espaço para exatamente 3 chamadas de R$ 0,01; 10 chegam juntas.
  const { firebase, tracker } = createTracker({
    optimisticTransactions: true,
    seed: { sistema: { custosIA: { '2026-09': { alertas: { p80: 'x' }, total: 59.97 } } } },
  });
  const usage = { inputTokens: 1000, outputTokens: 500, requests: 1 };
  const results = await Promise.all(Array.from({ length: 10 }, () => tracker.reserve('deepseek', usage)));

  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(firebase.getValue('sistema/custosIA/2026-09').total, 60);
});

test('custos: settle troca a estimativa pelo custo real; release devolve a reserva; liquidação é única', async () => {
  const { firebase, tracker } = createTracker();
  const ledger = () => firebase.getValue('sistema/custosIA/2026-09');
  const first = await tracker.reserve('deepseek', { inputTokens: 1000, outputTokens: 500, requests: 1 });

  assert.equal(ledger().total, 0.01);
  assert.equal(ledger().reservasAbertas, 0.01);
  assert.equal(ledger().buckets.deepseek.chamadas, 0);

  assert.equal(await tracker.settle(first.reservation, { inputTokens: 1000, outputTokens: 100, requests: 1 }), 0.006);
  assert.equal(ledger().total, 0.006);
  assert.equal(ledger().reservasAbertas, 0);
  assert.equal(ledger().buckets.deepseek.chamadas, 1);
  assert.equal(ledger().tokens.saida, 100);

  assert.equal(await tracker.settle(first.reservation, { inputTokens: 9_000_000, outputTokens: 0 }), 0, 'segunda liquidação é ignorada');
  assert.equal(ledger().total, 0.006);

  const second = await tracker.reserve('deepseek', { inputTokens: 1000, outputTokens: 500, requests: 1 });

  assert.equal(ledger().total, 0.016);
  assert.equal(await tracker.release(second.reservation), 0);
  assert.equal(ledger().total, 0.006);
  assert.equal(ledger().reservasAbertas, 0);
  assert.equal(ledger().buckets.deepseek.chamadas, 1, 'erro não faturável não conta chamada');
});

test('custos: falha no controle de custos bloqueia a chamada (falha fechada)', async () => {
  const firebase = createFakeFirebase();
  const tracker = createCostTracker({
    config: { budget: BUDGET, pricing: PRICED },
    db: {},
    firebaseOps: {
      ...firebase.ops,
      transaction: async () => {
        throw new Error('firebase indisponível');
      },
    },
    logger: { warn() {} },
  });

  assert.deepEqual(await tracker.reserve('deepseek', { inputTokens: 10 }), { allowed: false, reason: 'controle_indisponivel' });
});
