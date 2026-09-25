'use strict';

const { getContext } = require('./request-context');

function blockedError(reason) {
  const error = new Error(`chamada externa bloqueada: ${reason}`);

  error.code = 'external_call_blocked';
  error.reason = reason;

  return error;
}

// Envolve o cliente Groq para que áudio e imagem respeitem orçamento, circuit
// breaker e a escolha do usuário de desativar a IA. A interface é a mesma do cliente.
function createMeteredGroq({
  circuitBreaker,
  costTracker,
  groq,
  logger = console,
  now = () => Date.now(),
}) {
  async function guarded(provider, task, fn) {
    if (getContext()?.aiDisabled === true) {
      throw blockedError('ia_desativada_pelo_usuario');
    }

    if (circuitBreaker && !circuitBreaker.canRequest(provider)) {
      throw blockedError('circuit_open');
    }

    if (costTracker) {
      const budget = await costTracker.canSpend(provider);

      if (!budget.allowed) {
        throw blockedError(budget.reason);
      }
    }

    const startedAt = now();

    try {
      const result = await fn();
      const costBrl = costTracker ? await costTracker.record(provider, { requests: 1 }).catch(() => 0) : 0;

      circuitBreaker?.recordSuccess(provider);
      logger.info?.('[ai]', { costBrl, durationMs: now() - startedAt, provider, status: 'ok', task, tokensIn: 0, tokensOut: 0 });

      return result;
    } catch (err) {
      circuitBreaker?.recordFailure(provider);
      logger.info?.('[ai]', { costBrl: 0, durationMs: now() - startedAt, provider, status: 'error', task, tokensIn: 0, tokensOut: 0 });
      throw err;
    }
  }

  return {
    ...groq,
    analisarImagem: (...args) => guarded('groq-vision', 'image_reader', () => groq.analisarImagem(...args)),
    transcreverAudio: (...args) => guarded('groq-audio', 'audio_transcription', () => groq.transcreverAudio(...args)),
  };
}

module.exports = {
  createMeteredGroq,
};
