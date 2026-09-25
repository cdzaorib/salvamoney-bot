'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiGateway } = require('../src/ai/ai-gateway');
const { createAiProviderRouter } = require('../src/ai/ai-provider-router');
const { createCircuitBreaker } = require('../src/ai/circuit-breaker');
const { runWithContext } = require('../src/ai/request-context');

const BASE_CONFIG = {
  ai: { maxRetries: 1, textDeadlineMs: 3000 },
  deepseek: { timeoutMs: 200 },
  features: { conversationalAi: true },
  groqApiKey: 'fake-key',
  groqFallbackTimeoutMs: 200,
};

function fakeProvider(responses) {
  const calls = [];

  return {
    calls,
    chat: async (request) => {
      calls.push(request);
      const next = responses.shift();

      if (next instanceof Error) {
        throw next;
      }

      if (typeof next === 'function') {
        return await next(request);
      }

      return next;
    },
    isConfigured: () => true,
  };
}

function fakeGroq(responses) {
  const provider = fakeProvider(responses);

  return { calls: provider.calls, chatCompletion: provider.chat };
}

function httpError(status) {
  return Object.assign(new Error(`http_${status}`), { retryable: status >= 500 || status === 429, status });
}

function createGateway({ config = BASE_CONFIG, costTracker = null, deepseek, groq, logs = [], breaker } = {}) {
  return createAiGateway({
    circuitBreaker: breaker || createCircuitBreaker({ cooldownMs: 60000, failureThreshold: 3 }),
    config,
    costTracker,
    deepseekClient: deepseek,
    groqClient: groq,
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  });
}

const consented = (fn) => runWithContext({ aiConsent: true, tag: '111111' }, fn);
const messages = [{ content: 'Qual meu maior gasto?', role: 'user' }];

test('gateway: sem consentimento a DeepSeek não é chamada', async () => {
  const deepseek = fakeProvider([{ text: 'oi', usage: {} }]);
  const gateway = createGateway({ deepseek, groq: fakeGroq([]) });
  const result = await runWithContext({ aiConsent: false }, () =>
    gateway.complete({ messages, task: 'conversation_reply' }));

  assert.deepEqual(result, { ok: false, reason: 'sem_consentimento' });
  assert.equal(deepseek.calls.length, 0);
});

test('gateway: flag desligada e tarefa com descrição de gasto nunca vão para a DeepSeek', async () => {
  const deepseek = fakeProvider([{ text: 'oi', usage: {} }]);
  const offGateway = createGateway({ config: { ...BASE_CONFIG, features: { conversationalAi: false } }, deepseek, groq: fakeGroq([]) });
  const gateway = createGateway({ deepseek, groq: fakeGroq([]) });

  assert.equal((await consented(() => offGateway.complete({ messages, task: 'conversation_reply' }))).reason, 'feature_desativada');
  assert.equal((await consented(() => gateway.complete({ messages, task: 'expense_category_classifier' }))).reason, 'tarefa_nao_permitida');
  assert.equal(deepseek.calls.length, 0);
});

test('gateway: DeepSeek responde e registra só metadados técnicos no log', async () => {
  const logs = [];
  const deepseek = fakeProvider([{ text: 'Resposta curta', usage: { inputTokens: 120, outputTokens: 30 } }]);
  const gateway = createGateway({ deepseek, groq: fakeGroq([]), logs });
  const result = await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));
  const [, entry] = logs.find((item) => item[0] === '[ai]');

  assert.deepEqual(result, { ok: true, provider: 'deepseek', text: 'Resposta curta' });
  assert.deepEqual(Object.keys(entry).sort(), ['costBrl', 'durationMs', 'provider', 'status', 'task', 'tokensIn', 'tokensOut']);
  assert.doesNotMatch(JSON.stringify(logs), /maior gasto|Resposta curta/);
});

test('gateway: timeout da DeepSeek cai no fallback GPT-OSS (Groq)', async () => {
  const deepseek = fakeProvider([() => new Promise(() => {})]);
  const groq = fakeGroq([{ text: 'Resposta do fallback', usage: { inputTokens: 10, outputTokens: 5 } }]);
  const gateway = createGateway({ deepseek, groq });
  const started = Date.now();
  const result = await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));

  assert.equal(result.provider, 'groq-fallback');
  assert.equal(result.text, 'Resposta do fallback');
  assert.ok(Date.now() - started < 1500);
});

test('gateway: falha dos dois provedores devolve erro para a resposta determinística', async () => {
  const gateway = createGateway({
    deepseek: fakeProvider([httpError(400)]),
    groq: fakeGroq([httpError(400)]),
  });
  const result = await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'erro_provedor');
});

test('gateway: retry limitado a uma nova tentativa em erro transitório, nunca em loop', async () => {
  const deepseek = fakeProvider([httpError(503), httpError(503), httpError(503)]);
  const groq = fakeGroq([httpError(503), httpError(503), httpError(503)]);
  const gateway = createGateway({ deepseek, groq });
  const result = await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));

  assert.equal(result.ok, false);
  assert.equal(deepseek.calls.length, 2);
  assert.equal(groq.calls.length, 2);

  const recovering = fakeProvider([httpError(502), { text: 'ok na segunda', usage: {} }]);
  const second = await consented(() => createGateway({ deepseek: recovering, groq: fakeGroq([]) })
    .complete({ messages, task: 'conversation_reply' }));

  assert.equal(second.text, 'ok na segunda');
  assert.equal(recovering.calls.length, 2);
});

test('gateway: circuit breaker abre após falhas seguidas e pula o provedor', async () => {
  const breaker = createCircuitBreaker({ cooldownMs: 60000, failureThreshold: 2 });
  const deepseek = fakeProvider([httpError(400), httpError(400), { text: 'não deveria', usage: {} }]);
  const groq = fakeGroq([{ text: 'a', usage: {} }, { text: 'b', usage: {} }, { text: 'c', usage: {} }]);
  const gateway = createGateway({ breaker, deepseek, groq });

  await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));
  await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));
  const third = await consented(() => gateway.complete({ messages, task: 'conversation_reply' }));

  assert.equal(breaker.status('deepseek'), 'open');
  assert.equal(deepseek.calls.length, 2);
  assert.equal(third.provider, 'groq-fallback');
});

test('gateway: JSON inválido do modelo usa o fallback', async () => {
  const gateway = createGateway({
    deepseek: fakeProvider([{ text: 'não é json', usage: {} }]),
    groq: fakeGroq([{ text: '{"intent":"unknown","confidence":0.2}', usage: {} }]),
  });
  const result = await consented(() => gateway.complete({ json: true, messages, task: 'conversation_interpret' }));

  assert.equal(result.provider, 'groq-fallback');
  assert.deepEqual(result.json, { confidence: 0.2, intent: 'unknown' });
});

test('gateway: orçamento bloqueado impede chamadas externas', async () => {
  const deepseek = fakeProvider([{ text: 'x', usage: {} }]);
  const groq = fakeGroq([{ text: 'y', usage: {} }]);
  const costTracker = {
    canSpend: async () => ({ allowed: false, reason: 'limite_mensal' }),
    record: async () => 0,
  };
  const result = await consented(() => createGateway({ costTracker, deepseek, groq }).complete({ messages, task: 'conversation_reply' }));

  assert.deepEqual(result, { ok: false, reason: 'limite_mensal' });
  assert.equal(deepseek.calls.length + groq.calls.length, 0);
});

test('gateway: mensagens enviadas são sanitizadas (sem e-mail, telefone, tag, apelidos e descrições)', async () => {
  const deepseek = fakeProvider([{ text: 'ok', usage: {} }]);
  const gateway = createGateway({ deepseek, groq: fakeGroq([]) });

  await consented(() => gateway.complete({
    messages: [
      { content: 'Sou a Ana, email ana@x.com, fone 11 98888-7777, tag 111111. Dividi com Carlos.', role: 'user' },
      { content: `Dados:\n${JSON.stringify({ maiorGasto: { descricao: 'Presente da Júlia', valor: 90 }, tagOrigem: '111111', total: 300 })}`, role: 'user' },
    ],
    privacy: { knownTags: ['111111'], names: ['Ana'], nicknames: ['Carlos'] },
    task: 'conversation_reply',
  }));

  const sentText = deepseek.calls[0].messages.map((message) => message.content).join('\n');

  assert.doesNotMatch(sentText, /ana@x\.com|98888|111111|Carlos|Ana\b|Júlia|Presente/);
  assert.match(sentText, /PESSOA_1/);
  assert.match(sentText, /"total": 300/);
  assert.match(sentText, /"valor": 90/);
});

test('router legado: usuário que desativou a IA recebe só resposta determinística', async () => {
  let called = false;
  const router = createAiProviderRouter({
    config: { groqApiKey: 'key' },
    groq: { chamarIA: async () => { called = true; return 'resposta'; } },
  });
  const result = await runWithContext({ aiDisabled: true }, () =>
    router.generateText({ fallback: 'determinístico', prompt: 'oi', task: 'monthly_summary' }));

  assert.equal(result, 'determinístico');
  assert.equal(called, false);
});

test('router legado: com gateway elegível que falha não empilha chamada extra ao Groq antigo', async () => {
  let legacyCalls = 0;
  const gateway = createGateway({
    deepseek: fakeProvider([httpError(400)]),
    groq: fakeGroq([httpError(400)]),
  });
  const router = createAiProviderRouter({
    aiGateway: gateway,
    config: { groqApiKey: 'key' },
    groq: { chamarIA: async () => { legacyCalls += 1; return 'legado'; } },
  });
  const result = await consented(() => router.generateText({ fallback: 'determinístico', prompt: 'oi', task: 'monthly_summary' }));

  assert.equal(result, 'determinístico');
  assert.equal(legacyCalls, 0);
});

test('router legado: com a IA conversacional ativa, sem consentimento o Groq não é chamado', async () => {
  let sent = null;
  const gateway = createGateway({ deepseek: fakeProvider([{ text: 'x', usage: {} }]), groq: fakeGroq([]) });
  const router = createAiProviderRouter({
    aiGateway: gateway,
    config: { groqApiKey: 'key' },
    groq: { chamarIA: async (messages) => { sent = messages; return 'legado'; } },
  });
  const payload = [{ content: `Dados:\n${JSON.stringify({ maioresGastos: [{ descricao: 'Presente da Julia', valor: 90 }] })}`, role: 'user' }];

  for (const task of ['financial_advice', 'expense_category_classifier']) {
    const result = await runWithContext({ aiConsent: false, tag: '111111' }, () =>
      router.generateText({ fallback: 'determinístico', messages: payload, task }));

    assert.equal(result, 'determinístico', task);
  }

  assert.equal(sent, null);
});

test('router legado: com consentimento, o Groq recebe o conteúdo já sanitizado', async () => {
  let sent = null;
  const gateway = createGateway({ config: { ...BASE_CONFIG, features: { conversationalAi: true } }, deepseek: fakeProvider([]), groq: fakeGroq([]) });
  const router = createAiProviderRouter({
    aiGateway: gateway,
    config: { groqApiKey: 'key' },
    groq: { chamarIA: async (messages) => { sent = messages; return 'ok'; } },
  });

  await runWithContext({ aiConsent: true, tag: '111111' }, () => router.generateText({
    fallback: 'x',
    messages: [{ content: `Dados:\n${JSON.stringify({ maioresGastos: [{ descricao: 'Presente da Julia', valor: 90 }], tag: '111111' })}`, role: 'user' }],
    task: 'expense_category_classifier',
  }));

  const text = sent.map((message) => message.content).join('\n');

  assert.doesNotMatch(text, /Julia|111111/);
  assert.match(text, /"valor": 90/);
});

test('áudio: bloqueado sem tarifa e cobrado pela duração real informada pela Groq', async () => {
  const { createMeteredGroq, estimateAudioSeconds } = require('../src/ai/metered-groq');
  const recorded = [];
  let calls = 0;
  const groq = {
    transcreverAudio: async () => 'texto',
    transcreverAudioDetalhado: async () => {
      calls += 1;
      return { durationSeconds: 42, text: 'gastei 30 no mercado' };
    },
  };
  const blocked = createMeteredGroq({ costTracker: { canSpend: async () => ({ allowed: false, reason: 'tarifa_nao_configurada' }) }, groq, logger: {} });

  await assert.rejects(blocked.transcreverAudio('AAAA'), /tarifa_nao_configurada/);
  assert.equal(calls, 0);

  const metered = createMeteredGroq({
    costTracker: { canSpend: async () => ({ allowed: true }), record: async (provider, usage) => { recorded.push({ provider, usage }); return 0; } },
    groq,
    logger: {},
  });

  assert.equal(await metered.transcreverAudio('AAAA'), 'gastei 30 no mercado');
  assert.deepEqual(recorded, [{ provider: 'groq-audio', usage: { audioSeconds: 42, requests: 1 } }]);
  assert.equal(metered.transcreverAudioDetalhado, undefined, 'variante sem medição não é exposta');
  assert.equal(estimateAudioSeconds('A'.repeat(4000)), 10);
  assert.equal(estimateAudioSeconds('A'.repeat(40000)), 20);
});

test('config: modelo legado padrão da Groq é GPT-OSS (llama-3.1-8b-instant foi desativado)', () => {
  const configPath = require.resolve('../src/config');
  const previous = process.env.GROQ_MODEL;

  try {
    delete process.env.GROQ_MODEL;
    delete require.cache[configPath];
    assert.equal(require('../src/config').config.groqModel, 'openai/gpt-oss-20b');
  } finally {
    if (previous !== undefined) {
      process.env.GROQ_MODEL = previous;
    }

    delete require.cache[configPath];
  }
});
