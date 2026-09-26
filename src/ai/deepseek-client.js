'use strict';

// Cliente mínimo da API compatível com OpenAI da DeepSeek. Não registra prompts,
// respostas nem cabeçalhos; erros carregam somente status e se podem ser repetidos.

function providerError(message, { retryable = false, status = null, code = null } = {}) {
  const error = new Error(message);

  error.retryable = retryable;
  error.status = status;
  error.code = code;

  return error;
}

function classifyHttpError(err) {
  const status = err?.response?.status || null;
  const code = err?.code || null;

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(String(err?.message || ''))) {
    return providerError('timeout', { code: 'timeout', retryable: false, status });
  }

  if (status === 429 || (status !== null && status >= 500)) {
    return providerError(`http_${status}`, { retryable: true, status });
  }

  if (!status && ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) {
    return providerError('network', { code, retryable: true });
  }

  return providerError(status ? `http_${status}` : 'request_failed', { retryable: false, status });
}

function createDeepseekClient({ config, httpClient }) {
  const settings = config?.deepseek || {};
  const http = httpClient || require('axios');

  function isConfigured() {
    return Boolean(settings.apiKey && settings.model && settings.baseUrl);
  }

  async function chat({
    json = false,
    maxTokens = settings.maxTokens || 600,
    messages,
    temperature = 0.2,
    timeoutMs = settings.timeoutMs || 2500,
  }) {
    if (!isConfigured()) {
      throw providerError('not_configured');
    }

    try {
      const response = await http.post(
        `${String(settings.baseUrl).replace(/\/$/, '')}/chat/completions`,
        {
          model: settings.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: timeoutMs,
        }
      );
      const data = response?.data || {};

      return {
        text: String(data.choices?.[0]?.message?.content || '').trim(),
        usage: {
          inputTokens: Number(data.usage?.prompt_tokens || 0),
          outputTokens: Number(data.usage?.completion_tokens || 0),
        },
      };
    } catch (err) {
      throw classifyHttpError(err);
    }
  }

  return {
    chat,
    isConfigured,
  };
}

module.exports = {
  classifyHttpError,
  createDeepseekClient,
  providerError,
};
