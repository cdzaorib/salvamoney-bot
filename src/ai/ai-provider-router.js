'use strict';

const { sanitizeMessages } = require('./privacy');
const { getContext } = require('./request-context');

const DEFAULT_TIMEOUT_MS = 8000;
// Mesmo teto de saída usado por groq.chamarIA; base da reserva de orçamento.
const LEGACY_MAX_OUTPUT_TOKENS = 500;

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

  function inputTokensOf(messages) {
    return estimateTokens(messages.map((message) => message.content).join('\n'));
  }

  // Reserva atômica do custo estimado antes da chamada ao Groq legado.
  async function reserveLegacy(messages) {
    if (circuitBreaker && !circuitBreaker.canRequest('groq-legacy')) {
      return { allowed: false };
    }

    if (!costTracker) {
      return { allowed: true, reservation: null };
    }

    try {
      return await costTracker.reserve('groq-legacy', {
        inputTokens: inputTokensOf(messages),
        outputTokens: LEGACY_MAX_OUTPUT_TOKENS,
        requests: 1,
      });
    } catch (_) {
      return { allowed: false };
    }
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

    let legacyMessages = resolvedMessages;

    // Com a IA conversacional ativa, o Groq legado segue as mesmas regras:
    // só com consentimento e sempre com o conteúdo sanitizado.
    if (aiGateway?.isEnabled?.()) {
      const context = getContext();

      if (context?.aiConsent !== true) {
        return resolveFallback(fallback);
      }

      legacyMessages = sanitizeMessages(resolvedMessages, { knownTags: context.tag ? [context.tag] : [] });
    }

    if (!hasGroq()) {
      return resolveFallback(fallback);
    }

    const budget = await reserveLegacy(legacyMessages);

    if (!budget.allowed) {
      return resolveFallback(fallback);
    }

    try {
      const response = await withTimeout(
        groq.chamarIA(legacyMessages),
        timeoutMs
      );
      const cleanResponse = String(response || '').trim();

      circuitBreaker?.recordSuccess('groq-legacy');
      await costTracker?.settle(budget.reservation, {
        inputTokens: inputTokensOf(legacyMessages),
        outputTokens: estimateTokens(cleanResponse),
        requests: 1,
      }).catch(() => 0);

      return cleanResponse || resolveFallback(fallback);
    } catch (err) {
      circuitBreaker?.recordFailure('groq-legacy');
      // Timeout pode ter sido faturado: a estimativa reservada fica lançada.
      // Erro recusado pelo provedor devolve a reserva.
      const timedOut = err?.message === 'timeout';

      await costTracker?.settle(
        budget.reservation,
        timedOut ? { inputTokens: inputTokensOf(legacyMessages), outputTokens: LEGACY_MAX_OUTPUT_TOKENS, requests: 1 } : null
      ).catch(() => 0);

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
