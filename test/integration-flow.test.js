'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiGateway } = require('../src/ai/ai-gateway');
const { createCircuitBreaker } = require('../src/ai/circuit-breaker');
const { createCostTracker } = require('../src/ai/cost-tracker');
const { FEATURE_FLAG_ENV, featureWarnings, resolveFeatureFlags } = require('../src/config');
const { ALL_FEATURES, USERS, baseSeed, createHarness, friendsSeed } = require('./helpers/assistant-harness');

const AI_FEATURES = { ...ALL_FEATURES, conversationalAi: true };
const AI_CONFIG = {
  ai: { consentVersion: 'v-test', maxRetries: 1, textDeadlineMs: 800 },
  budget: { adminPhone: '5511900000000', alertPercent: 80, deepseekBrl: 35, monthlyBrl: 60, reserveBrl: 15, searchBrl: 10 },
  deepseek: { timeoutMs: 300 },
  groqApiKey: 'fake',
  groqFallbackTimeoutMs: 300,
  pricing: { deepseekInputUsdPerMTok: 1, deepseekOutputUsdPerMTok: 2, usdBrlRate: 5 },
};

function consentedSeed() {
  const seed = friendsSeed();

  seed.grupos.SALVAMONEY.usuarios[111111].privacidade = { ia: { estado: 'aceito', versao: 'v-test' } };

  return seed;
}

// Harness com gateway real (DeepSeek/GPT-OSS simulados) e controle de custos real.
function createAiHarness({ deepseekChat, groqChat, seed = consentedSeed() } = {}) {
  const prompts = [];
  let harness;
  const deepseekClient = {
    chat: async (request) => {
      prompts.push(request.messages);
      return await deepseekChat(request);
    },
    isConfigured: () => true,
  };
  const groqClient = {
    chatCompletion: async (request) => {
      prompts.push(request.messages);
      return await (groqChat ? groqChat(request) : Promise.reject(Object.assign(new Error('x'), { retryable: false })));
    },
  };
  const lazyTracker = {
    canSpend: (provider) => harness.costTracker.canSpend(provider),
    record: (provider, usage) => harness.costTracker.record(provider, usage),
  };
  const aiGateway = createAiGateway({
    circuitBreaker: createCircuitBreaker(),
    config: { ...AI_CONFIG, features: AI_FEATURES },
    costTracker: lazyTracker,
    deepseekClient,
    groqClient,
    logger: { info() {}, warn() {} },
  });

  harness = createHarness({ aiGateway, configOverrides: AI_CONFIG, costTracker: null, features: AI_FEATURES, seed });
  harness.costTracker = createCostTracker({
    config: { ...AI_CONFIG, timeZone: 'America/Sao_Paulo' },
    db: {},
    firebaseOps: harness.firebase.ops,
    logger: { warn() {} },
    notificationSender: async () => true,
    now: () => harness.clock.now,
  });
  harness.prompts = prompts;

  return harness;
}

test('integração: fluxo completo amigo → divisão no cartão → fechamento → pagamento → relatório', async () => {
  const harness = createHarness({ seed: baseSeed() });

  await harness.say(USERS.ana, 'adicionar amigo 222222');
  await harness.say(USERS.carlos, 'aceitar amigo 111111');
  await harness.say(USERS.ana, 'apelido Carlos');
  await harness.say(USERS.carlos, 'apelido Ana');
  await harness.say(USERS.ana, 'adicionar cartão Nubank fecha dia 3 vence dia 10');
  await harness.say(USERS.ana, 'dividir 200 do jantar com Carlos');
  await harness.say(USERS.ana, '3');
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();

  assert.match(await harness.say(USERS.carlos, 'cobranças'), /aguardando fechamento/);

  harness.clock.now = new Date('2026-10-03T15:00:00.000Z');

  assert.match(await harness.say(USERS.carlos, 'cobranças'), /A pagar \(R\$ 100,00\)/);
  await harness.say(USERS.carlos, 'paguei');
  assert.match(await harness.say(USERS.ana, 'balanço'), /aguardando confirmação: R\$ 100,00 \(1\)/);
  await harness.say(USERS.ana, 'recebi');
  assert.match(await harness.say(USERS.carlos, 'cobranças'), /não tem cobranças em aberto/);

  const report = await harness.say(USERS.ana, 'balanço');

  assert.match(report, /Valores a receber: R\$ 0,00/);
  assert.match(await harness.say(USERS.ana, 'resumo'), /Gastos pagos: R\$ 100,00/);
});

test('integração: IA conversacional com DeepSeek simulada registra gasto só após prévia', async () => {
  const harness = createAiHarness({
    deepseekChat: async () => ({
      text: JSON.stringify({ categoria: 'Lazer', confidence: 0.92, intent: 'register_expense', valor: 55 }),
      usage: { inputTokens: 400, outputTokens: 40 },
    }),
  });
  const preview = await harness.say(USERS.ana, 'ontem torrei uns 55 conto no boliche com a galera');

  assert.match(preview, /Registrar este gasto\? boliche galera — R\$ 55,00 \(Lazer\) em 24\/09\/2026/);
  assert.equal(Object.keys(harness.userValue(USERS.ana, 'gastos') || {}).length, 0);
  assert.match(await harness.say(USERS.ana, 'sim'), /registrado/);

  const ledger = harness.firebase.getValue('sistema/custosIA/2026-09');

  assert.equal(ledger.buckets.deepseek.chamadas, 1);
  assert.ok(ledger.total > 0);
});

test('integração: divisão interpretada pela IA usa placeholders e mapeia de volta para o amigo', async () => {
  const harness = createAiHarness({
    deepseekChat: async ({ messages }) => {
      const userText = messages.at(-1).content;

      assert.doesNotMatch(userText, /Carlos/);

      return {
        text: JSON.stringify({ confidence: 0.9, intent: 'split', meio: 'pix', pessoas: ['PESSOA_1'], total: 120 }),
        usage: {},
      };
    },
  });
  const preview = await harness.say(USERS.ana, 'a gente foi no japa, eu e o Carlos, ficou 120 no total');

  assert.match(preview, /Carlos: R\$ 60,00 a cobrar/);
  assert.match(preview, /Pagamento: Pix/);
  assert.ok(harness.prompts.length >= 1);
});

test('integração: timeout da IA cai no fallback e, se tudo falhar, a resposta local segue funcionando', async () => {
  const harness = createAiHarness({
    deepseekChat: () => new Promise(() => {}),
    groqChat: async () => ({ text: JSON.stringify({ confidence: 0.9, intent: 'smalltalk', resposta: 'Oi! Tudo certo por aqui.' }), usage: {} }),
  });

  assert.match(await harness.say(USERS.ana, 'e aí, beleza?'), /Tudo certo/);

  const failing = createAiHarness({ deepseekChat: () => new Promise(() => {}) });

  assert.match(await failing.say(USERS.ana, 'e aí, beleza?'), /Não entendi/);
  assert.match(await failing.say(USERS.ana, 'gastei 18 no pão de queijo'), /registrado/);
});

test('integração: prompt enviado à IA não contém nome, telefone, tag nem apelidos', async () => {
  const harness = createAiHarness({
    deepseekChat: async () => ({ text: JSON.stringify({ confidence: 0.9, intent: 'question', precisaDados: false, resposta: 'Priorize a reserva.' }), usage: {} }),
  });

  await harness.say(USERS.ana, 'sou a Ana, minha tag é 111111 e o Carlos disse que devo investir, o que acha? meu zap 11 91111-1111');

  const sent = JSON.stringify(harness.prompts);

  assert.doesNotMatch(sent, /Ana|111111|Carlos|91111|Souza/);
});

test('integração: resposta da IA com insulto é descartada e resposta de schema inválido é ignorada', async () => {
  const insulting = createAiHarness({
    deepseekChat: async () => ({ text: JSON.stringify({ confidence: 0.9, intent: 'smalltalk', resposta: 'Que gasto burro, hein' }), usage: {} }),
  });

  assert.doesNotMatch(await insulting.say(USERS.ana, 'comprei um videogame'), /burro/);

  const invalid = createAiHarness({
    deepseekChat: async () => ({ text: JSON.stringify({ confidence: 'alta', intent: 'apagar_tudo' }), usage: {} }),
  });

  assert.match(await invalid.say(USERS.ana, 'faz aquela coisa lá'), /Não entendi/);
});

test('integração: limite de custo atingido bloqueia a IA e preserva as funções locais', async () => {
  const seed = consentedSeed();

  seed.sistema = { custosIA: { '2026-09': { alertas: { limite: 'x', p80: 'x' }, total: 60 } } };

  let calls = 0;
  const harness = createAiHarness({
    deepseekChat: async () => {
      calls += 1;
      return { text: '{}', usage: {} };
    },
    seed,
  });

  assert.match(await harness.say(USERS.ana, 'e aí, beleza?'), /Não entendi/);
  assert.equal(calls, 0);
  assert.match(await harness.say(USERS.ana, 'gastei 10 no café'), /registrado/);
  assert.match(await harness.say(USERS.ana, 'dividir 40 no pix com Carlos'), /Responda SIM/);
});

test('feature flags: tudo desligado mantém o comportamento antigo (rollback)', async () => {
  const harness = createHarness({ features: {} });

  assert.match(await harness.say(USERS.ana, 'dividir 150 com Carlos'), /tag de 6 dígitos/);
  assert.doesNotMatch(await harness.say(USERS.ana, 'personalidades'), /Sincerão/);
  assert.doesNotMatch(await harness.say(USERS.ana, 'ajuda'), /Amigos:|Divisões/);
  assert.match(await harness.say(USERS.ana, 'gastei 20 no uber'), /registrado/);
});

test('feature flags: cada subsistema liga e desliga de forma independente', async () => {
  const onlyCards = createHarness({ features: { cards: true } });

  assert.match(await onlyCards.say(USERS.ana, 'meus cartões'), /Nubank/);
  assert.doesNotMatch(await onlyCards.say(USERS.ana, 'personalidades'), /Sincerão/);
  assert.doesNotMatch(await onlyCards.say(USERS.ana, 'meus amigos'), /Carlos/);

  const onlyPersonalities = createHarness({ features: { personalities: true } });

  assert.match(await onlyPersonalities.say(USERS.ana, 'personalidades'), /Sincerão/);
  assert.doesNotMatch(await onlyPersonalities.say(USERS.ana, 'meus cartões'), /Nubank/);
});

test('config: em produção as flags exigem "true" explícito; em desenvolvimento ficam ligadas por padrão', () => {
  const allTrue = Object.fromEntries(Object.values(FEATURE_FLAG_ENV).map((name) => [name, 'true']));

  assert.deepEqual(Object.values(resolveFeatureFlags({}, 'production')), Array(8).fill(false));
  assert.deepEqual(Object.values(resolveFeatureFlags({ FEATURE_SPLITS: '1' }, 'production')), Array(8).fill(false));
  assert.deepEqual(Object.values(resolveFeatureFlags(allTrue, 'production')), Array(8).fill(true));
  assert.equal(resolveFeatureFlags({}, 'development').splits, true);
  assert.equal(resolveFeatureFlags({ FEATURE_SPLITS: 'false' }, 'development').splits, false);
  assert.equal(Object.keys(FEATURE_FLAG_ENV).length, 8);
});

test('config: avisos de configuração não expõem segredos', () => {
  const warnings = featureWarnings({
    brave: { apiKey: '' },
    deepseek: { apiKey: '' },
    features: { conversationalAi: true, investmentResearch: true, splits: true },
    pricing: { usdBrlRate: null },
  });

  assert.ok(warnings.length >= 3);
  assert.ok(warnings.every((warning) => !/sk-|secret|=\S/.test(warning)));
});
