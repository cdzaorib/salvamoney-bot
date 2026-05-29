'use strict';

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

function createAiProviderRouter({
  config,
  groq,
}) {
  function hasGroq() {
    return Boolean(config?.groqApiKey && groq?.chamarIA);
  }

  async function generateText({
    fallback = null,
    messages,
    prompt,
    task,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    void task;

    if (!hasGroq()) {
      return resolveFallback(fallback);
    }

    try {
      const response = await withTimeout(
        groq.chamarIA(resolveMessages({ messages, prompt })),
        timeoutMs
      );
      const cleanResponse = String(response || '').trim();

      return cleanResponse || resolveFallback(fallback);
    } catch (_) {
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
