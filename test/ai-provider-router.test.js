'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiProviderRouter } = require('../src/ai/ai-provider-router');

function createRouter({
  apiKey = 'fake-groq-key',
  chamarIA,
} = {}) {
  return createAiProviderRouter({
    config: {
      groqApiKey: apiKey,
    },
    groq: {
      chamarIA,
    },
  });
}

test('AI provider router generateText uses Groq when available', async () => {
  const prompts = [];
  const router = createRouter({
    chamarIA: async (messages) => {
      prompts.push(messages);

      return '  resposta útil  ';
    },
  });
  const response = await router.generateText({
    task: 'test_text',
    messages: [{ role: 'user', content: 'olá' }],
    fallback: 'fallback',
  });

  assert.equal(response, 'resposta útil');
  assert.deepEqual(prompts, [[{ role: 'user', content: 'olá' }]]);
});

test('AI provider router generateText returns fallback when Groq fails', async () => {
  const router = createRouter({
    chamarIA: async () => {
      throw new Error('groq indisponível');
    },
  });
  const response = await router.generateText({
    task: 'test_failure',
    prompt: 'mensagem',
    fallback: 'fallback seguro',
  });

  assert.equal(response, 'fallback seguro');
});

test('AI provider router generateText returns fallback without configuration', async () => {
  let called = false;
  const router = createRouter({
    apiKey: '',
    chamarIA: async () => {
      called = true;

      return 'não deveria chamar';
    },
  });
  const response = await router.generateText({
    task: 'test_missing_key',
    prompt: 'mensagem',
    fallback: 'fallback seguro',
  });

  assert.equal(response, 'fallback seguro');
  assert.equal(called, false);
});

test('AI provider router generateJson parses valid JSON', async () => {
  const router = createRouter({
    chamarIA: async () => '{"intent":"financial_advice","confidence":0.92}',
  });
  const response = await router.generateJson({
    task: 'test_json',
    prompt: 'classifique',
    fallback: null,
  });

  assert.deepEqual(response, {
    intent: 'financial_advice',
    confidence: 0.92,
  });
});

test('AI provider router generateJson returns fallback for invalid JSON', async () => {
  const fallback = { intent: 'unknown' };
  const router = createRouter({
    chamarIA: async () => '```json\n{"intent":"financial_advice"}\n```',
  });
  const response = await router.generateJson({
    task: 'test_invalid_json',
    prompt: 'classifique',
    fallback,
  });

  assert.deepEqual(response, fallback);
});

test('AI provider router timeout returns fallback safely', async () => {
  const router = createRouter({
    chamarIA: async () => await new Promise(() => {}),
  });
  const response = await router.generateText({
    task: 'test_timeout',
    prompt: 'mensagem',
    timeoutMs: 5,
    fallback: 'fallback de timeout',
  });

  assert.equal(response, 'fallback de timeout');
});
