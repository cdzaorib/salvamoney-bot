'use strict';

const { getContext } = require('./request-context');
const { sanitizeMessages } = require('./privacy');

// Tarefas que podem ir para a DeepSeek (e para o fallback GPT-OSS). Tarefas ligadas a
// descrições de transações continuam fora da DeepSeek por regra de privacidade.
const TASK_POLICIES = {
  advisor_writer: { deepseek: true, maxTokens: 500 },
  conversation_interpret: { deepseek: true, json: true, maxTokens: 400 },
  conversation_reply: { deepseek: true, maxTokens: 400 },
  expense_category_classifier: { deepseek: false },
  financial_advice: { deepseek: true, maxTokens: 500 },
  intent_router: { deepseek: true, json: true, maxTokens: 200 },
  legacy_financial_text_parser: { deepseek: false },
  monthly_summary: { deepseek: true, maxTokens: 500 },
  savings_goal_tip: { deepseek: true, maxTokens: 200 },
  weekly_financial_plan: { deepseek: true, maxTokens: 500 },
  weekly_financial_report: { deepseek: true, maxTokens: 500 },
};

const MIN_ATTEMPT_MS = 250;

function estimateTokens(messages) {
  const chars = (messages || []).reduce((total, message) => total + String(message.content || '').length, 0);

  return Math.ceil(chars / 4);
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('timeout');

        error.code = 'timeout';
        error.retryable = false;
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createAiGateway({
  circuitBreaker,
  config,
  costTracker,
  deepseekClient,
  groqClient,
  logger = console,
  now = () => Date.now(),
}) {
  const features = config?.features || {};
  const aiSettings = config?.ai || {};
  const maxRetries = Math.max(0, Math.min(1, Number(aiSettings.maxRetries ?? 1)));

  const providers = [
    {
      name: 'deepseek',
      available: () => Boolean(deepseekClient?.isConfigured?.()),
      call: (request) => deepseekClient.chat(request),
      timeoutMs: Number(config?.deepseek?.timeoutMs || 2500),
    },
    {
      name: 'groq-fallback',
      available: () => Boolean(config?.groqApiKey && typeof groqClient?.chatCompletion === 'function'),
      call: (request) => groqClient.chatCompletion(request),
      timeoutMs: Number(config?.groqFallbackTimeoutMs || 2500),
    },
  ];

  function logCall({ durationMs, provider, status, task, usage = {}, costBrl = 0 }) {
    // Somente metadados técnicos: nunca conteúdo, telefone, tag ou valores do usuário.
    logger.info?.('[ai]', {
      costBrl: Math.round(Number(costBrl || 0) * 1e6) / 1e6,
      durationMs,
      provider,
      status,
      task,
      tokensIn: Number(usage.inputTokens || 0),
      tokensOut: Number(usage.outputTokens || 0),
    });
  }

  function isEnabled() {
    return Boolean(features.conversationalAi);
  }

  // Motivo pelo qual a tarefa não pode usar a DeepSeek neste contexto (ou null).
  function eligibility(task, { requireConsent = true } = {}) {
    const policy = TASK_POLICIES[task];
    const context = getContext();

    if (!isEnabled()) {
      return 'feature_desativada';
    }

    if (!policy?.deepseek) {
      return 'tarefa_nao_permitida';
    }

    if (requireConsent && context?.aiConsent !== true) {
      return 'sem_consentimento';
    }

    if (!providers.some((provider) => provider.available())) {
      return 'sem_provedor';
    }

    return null;
  }

  async function record(provider, usage) {
    if (!costTracker) {
      return 0;
    }

    try {
      return await costTracker.record(provider, usage);
    } catch (_) {
      logger.warn?.('[ai] falha ao registrar custo.');
      return 0;
    }
  }

  async function attemptProvider(provider, request, deadline, task) {
    let attempt = 0;
    let lastError = null;

    while (attempt <= maxRetries) {
      const remaining = deadline - now();

      if (remaining < MIN_ATTEMPT_MS) {
        return { error: lastError || new Error('deadline') };
      }

      if (circuitBreaker && !circuitBreaker.canRequest(provider.name)) {
        return { error: new Error('circuit_open'), skipped: 'circuit_open' };
      }

      const timeoutMs = Math.min(provider.timeoutMs, remaining);
      const startedAt = now();

      try {
        const result = await withTimeout(provider.call({ ...request, timeoutMs }), timeoutMs);
        const usage = result?.usage || {};
        const costBrl = await record(provider.name, { ...usage, requests: 1 });

        circuitBreaker?.recordSuccess(provider.name);
        logCall({ costBrl, durationMs: now() - startedAt, provider: provider.name, status: 'ok', task, usage });

        return { result };
      } catch (err) {
        lastError = err;
        circuitBreaker?.recordFailure(provider.name);

        const usage = err?.code === 'timeout' ? { inputTokens: estimateTokens(request.messages) } : {};
        const costBrl = err?.code === 'timeout' ? await record(provider.name, { ...usage, requests: 1 }) : 0;

        logCall({
          costBrl,
          durationMs: now() - startedAt,
          provider: provider.name,
          status: err?.code === 'timeout' ? 'timeout' : 'error',
          task,
          usage,
        });

        // Retry limitado a uma nova tentativa para falhas transitórias; nunca em loop.
        if (!err?.retryable) {
          break;
        }
      }

      attempt += 1;
    }

    return { error: lastError };
  }

  async function complete({
    deadlineMs,
    json,
    maxTokens,
    messages,
    privacy = {},
    requireConsent = true,
    task,
    temperature = 0.2,
  }) {
    const reason = eligibility(task, { requireConsent });

    if (reason) {
      return { ok: false, reason };
    }

    const policy = TASK_POLICIES[task] || {};
    const wantsJson = json ?? Boolean(policy.json);
    const deadline = now() + Number(deadlineMs || aiSettings.textDeadlineMs || 3000);
    const sanitized = sanitizeMessages(messages, privacy);
    const request = {
      json: wantsJson,
      maxTokens: maxTokens || policy.maxTokens || 500,
      messages: sanitized,
      temperature,
    };
    let lastReason = 'sem_provedor';

    for (const provider of providers) {
      if (!provider.available()) {
        continue;
      }

      if (costTracker) {
        const budget = await costTracker.canSpend(provider.name, {
          inputTokens: estimateTokens(sanitized),
          outputTokens: request.maxTokens,
        });

        if (!budget.allowed) {
          lastReason = budget.reason;
          logCall({ durationMs: 0, provider: provider.name, status: `bloqueado_${budget.reason}`, task });
          continue;
        }
      }

      const { error, result, skipped } = await attemptProvider(provider, request, deadline, task);

      if (skipped) {
        lastReason = skipped;
        continue;
      }

      if (error) {
        lastReason = error.code === 'timeout' ? 'timeout' : 'erro_provedor';
        continue;
      }

      const text = String(result?.text || '').trim();

      if (!text) {
        lastReason = 'resposta_vazia';
        continue;
      }

      if (wantsJson) {
        const parsed = parseJsonObject(text);

        if (!parsed) {
          lastReason = 'json_invalido';
          logCall({ durationMs: 0, provider: provider.name, status: 'json_invalido', task });
          continue;
        }

        return { json: parsed, ok: true, provider: provider.name, text };
      }

      return { ok: true, provider: provider.name, text };
    }

    return { ok: false, reason: lastReason };
  }

  return {
    complete,
    eligibility,
    isEnabled,
  };
}

module.exports = {
  TASK_POLICIES,
  createAiGateway,
  estimateTokens,
  parseJsonObject,
};
