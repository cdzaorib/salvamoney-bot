'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIntentRouterPrompt,
  createIntentRouterService,
  parseIntentRouterResponse,
  shouldSkipIntentRouter,
} = require('../src/bot/intent-router-service');

function createRouter({
  config = { groqApiKey: 'fake-groq-key' },
  response,
  onPrompt,
} = {}) {
  let calls = 0;
  const service = createIntentRouterService({
    config,
    groq: {
      chamarIA: async (prompt) => {
        calls += 1;

        if (onPrompt) {
          onPrompt(prompt);
        }

        return response;
      },
    },
    logger: { info: () => {} },
  });

  return {
    calls: () => calls,
    service,
  };
}

test('intent router classifies open financial advice questions', async () => {
  const prompts = [];
  const { calls, service } = createRouter({
    response: JSON.stringify({
      intent: 'financial_advice',
      confidence: 0.92,
      reason: 'Usuário pede orientação financeira geral',
      entities: {
        amount: null,
        category: null,
        period: null,
        targetTag: null,
      },
    }),
    onPrompt: (prompt) => prompts.push(prompt),
  });
  const result = await service.classificarIntencao('onde posso economizar?');

  assert.equal(calls(), 1);
  assert.equal(result.intent, 'financial_advice');
  assert.equal(result.confidence, 0.92);
  assert.deepEqual(result.entities, {
    amount: null,
    category: null,
    period: null,
    targetTag: null,
  });
  assert.doesNotMatch(JSON.stringify(prompts[0]), /5511999999999|482913|fake-groq-key/i);
});

test('intent router classifies money organization questions as financial advice', async () => {
  const { service } = createRouter({
    response: JSON.stringify({
      intent: 'financial_advice',
      confidence: 0.88,
      reason: 'Usuário pede ajuda para organizar dinheiro',
      entities: {
        amount: null,
        category: null,
        period: null,
        targetTag: null,
      },
    }),
  });
  const result = await service.classificarIntencao('me ajuda a organizar meu dinheiro');

  assert.equal(result.intent, 'financial_advice');
  assert.equal(result.confidence, 0.88);
});

test('intent router skips deterministic expense query commands', async () => {
  const { calls, service } = createRouter({
    response: JSON.stringify({
      intent: 'expense_query',
      confidence: 0.95,
      reason: 'Usuário pergunta total gasto',
      entities: {
        amount: null,
        category: 'mercado',
        period: null,
        targetTag: null,
      },
    }),
  });
  const result = await service.classificarIntencao('quanto gastei com mercado?');

  assert.equal(result, null);
  assert.equal(calls(), 0);
  assert.equal(shouldSkipIntentRouter('quanto gastei com mercado?'), true);
});

test('intent router skips risky commands', async () => {
  const risky = [
    'apagar mercado',
    'cobrar 80 da tag 123456',
    'aceitar cobrança 1',
    'recusar cobrança 1',
    'marcar cobrança 1 como paga',
  ];

  risky.forEach((message) => {
    assert.equal(shouldSkipIntentRouter(message), true, message);
  });
});

test('intent router returns unknown when confidence is low', () => {
  const result = parseIntentRouterResponse(JSON.stringify({
    intent: 'financial_advice',
    confidence: 0.62,
    reason: 'Pouco contexto',
    entities: {},
  }));

  assert.equal(result.intent, 'unknown');
  assert.equal(result.confidence, 0.62);
});

test('intent router returns null when Groq is not configured', async () => {
  const { calls, service } = createRouter({
    config: { groqApiKey: '' },
    response: JSON.stringify({
      intent: 'financial_advice',
      confidence: 0.95,
      entities: {},
    }),
  });
  const result = await service.classificarIntencao('me ajuda a organizar meu dinheiro');

  assert.equal(result, null);
  assert.equal(calls(), 0);
});

test('intent router returns null for invalid JSON', async () => {
  const { calls, service } = createRouter({
    response: 'financial_advice',
  });
  const result = await service.classificarIntencao('me ajuda a organizar meu dinheiro');

  assert.equal(result, null);
  assert.equal(calls(), 1);
});

test('intent router prompt only sends text and intent examples', () => {
  const prompt = buildIntentRouterPrompt('me ajuda a organizar meu dinheiro');
  const serialized = JSON.stringify(prompt);

  assert.match(serialized, /financial_advice/);
  assert.match(serialized, /me ajuda a organizar meu dinheiro/);
  assert.doesNotMatch(serialized, /perfilFinanceiro|gastos|482913|5511999999999|fake-groq-key/);
});
