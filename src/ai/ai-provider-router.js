'use strict';

const { getContext } = require('./request-context');

const DEFAULT_TIMEOUT_MS = 8000;

function resolveMessages({ messages, prompt }) {
  if (Array.isArray(messages)) {
    return messages;
  }

  if (prompt === undefined || prompt === null) {
    return [];
  }

  return [
    {
      role: 'user',
      content: String(prompt),
    },
  ];
}

function resolveFallback(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback;
}

async function withTimeout(promise, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timeout;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(value) {
  const text = String(value || '').trim();

  if (!text || !text.startsWith('{') || !text.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_) {
    return null;
  }
}

function estimateTokens(value) {
  return Math.ceil(String(value || '').length / 4);
}

// Roteador usado pelos serviços existentes. Sem aiGateway o comportamento é o
// original (Groq). Com aiGateway, tarefas permitidas e usuários com consentimento
// usam DeepSeek → GPT-OSS; o caminho Groq legado respeita orçamento e circuit breaker.
function createAiProviderRouter({
  aiGateway,
  circuitBreaker,
  config,
  costTracker,
  groq,
}) {
  const defaultTimeoutMs = Number(config?.aiLegacyTimeoutMs) > 0
    ? Number(config.aiLegacyTimeoutMs)
    : DEFAULT_TIMEOUT_MS;

  function hasGroq() {
    return Boolean(config?.groqApiKey && groq?.chamarIA);
  }

  async function legacyAllowed() {
    if (circuitBreaker && !circuitBreaker.canRequest('groq-legacy')) {
      return false;
    }

    if (!costTracker) {
      return true;
    }

    const budget = await costTracker.canSpend('groq-legacy');

    return budget.allowed;
  }

  async function generateText({
    fallback = null,
    json = false,
    messages,
    prompt,
    task,
    timeoutMs = defaultTimeoutMs,
  }) {
    const resolvedMessages = resolveMessages({ messages, prompt });

    // Usuário desativou a IA: somente respostas determinísticas.
    if (getContext()?.aiDisabled === true) {
      return resolveFallback(fallback);
    }

    if (aiGateway) {
      const result = await aiGateway.complete({
        json,
        messages: resolvedMessages,
        task,
      });

      if (result.ok) {
        return json && result.json ? JSON.stringify(result.json) : result.text;
      }

      // A DeepSeek era elegível e falhou (ou o orçamento bloqueou): não empilha
      // uma terceira chamada externa; devolve a resposta determinística.
      if (!['feature_desativada', 'tarefa_nao_permitida', 'sem_consentimento', 'sem_provedor'].includes(result.reason)) {
        return resolveFallback(fallback);
      }
    }

    if (!hasGroq() || !(await legacyAllowed())) {
      return resolveFallback(fallback);
    }

    try {
      const response = await withTimeout(
        groq.chamarIA(resolvedMessages),
        timeoutMs
      );
      const cleanResponse = String(response || '').trim();

      circuitBreaker?.recordSuccess('groq-legacy');
      await costTracker?.record('groq-legacy', {
        inputTokens: estimateTokens(resolvedMessages.map((message) => message.content).join('\n')),
        outputTokens: estimateTokens(cleanResponse),
        requests: 1,
      }).catch(() => 0);

      return cleanResponse || resolveFallback(fallback);
    } catch (_) {
      circuitBreaker?.recordFailure('groq-legacy');

      return resolveFallback(fallback);
    }
  }

  async function generateJson({
    fallback = null,
    messages,
    prompt,
    task,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    const response = await generateText({
      fallback: null,
      json: true,
      messages,
      prompt,
      task,
      timeoutMs,
    });
    const parsed = parseJson(response);

    return parsed || resolveFallback(fallback);
  }

  return {
    generateJson,
    generateText,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  createAiProviderRouter,
  parseJson,
  resolveMessages,
  withTimeout,
};
