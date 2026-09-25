'use strict';

const { getContext } = require('./request-context');

function blockedError(reason) {
  const error = new Error(`chamada externa bloqueada: ${reason}`);

  error.code = 'external_call_blocked';
  error.reason = reason;

  return error;
}

// WhatsApp envia áudio em Opus (~16 kbps ≈ 2 KB/s); usar 1,5 KB/s superestima a
// duração e deixa a checagem prévia do orçamento do lado seguro.
const ESTIMATED_AUDIO_BYTES_PER_SECOND = 1500;

function estimateAudioSeconds(base64Audio) {
  const clean = String(base64Audio || '').replace(/^data:.*?;base64,/, '');
  const bytes = Math.floor(clean.length * 3 / 4);

  return Math.max(10, Math.ceil(bytes / ESTIMATED_AUDIO_BYTES_PER_SECOND));
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
  async function guarded(provider, task, estimatedUsage, fn) {
    if (getContext()?.aiDisabled === true) {
      throw blockedError('ia_desativada_pelo_usuario');
    }

    if (circuitBreaker && !circuitBreaker.canRequest(provider)) {
      throw blockedError('circuit_open');
    }

    if (costTracker) {
      const budget = await costTracker.canSpend(provider, estimatedUsage);

      if (!budget.allowed) {
        throw blockedError(budget.reason);
      }
    }

    const startedAt = now();

    try {
      const { result, usage } = await fn();
      const costBrl = costTracker ? await costTracker.record(provider, { requests: 1, ...usage }).catch(() => 0) : 0;

      circuitBreaker?.recordSuccess(provider);
      logger.info?.('[ai]', { costBrl, durationMs: now() - startedAt, provider, status: 'ok', task, tokensIn: 0, tokensOut: 0 });

      return result;
    } catch (err) {
      circuitBreaker?.recordFailure(provider);
      logger.info?.('[ai]', { costBrl: 0, durationMs: now() - startedAt, provider, status: 'error', task, tokensIn: 0, tokensOut: 0 });
      throw err;
    }
  }

  async function transcreverAudio(base64Audio, mimeType) {
    const estimatedSeconds = estimateAudioSeconds(base64Audio);

    return await guarded('groq-audio', 'audio_transcription', { audioSeconds: estimatedSeconds }, async () => {
      if (typeof groq.transcreverAudioDetalhado === 'function') {
        const detailed = await groq.transcreverAudioDetalhado(base64Audio, mimeType);

        return {
          result: detailed.text,
          usage: { audioSeconds: detailed.durationSeconds ?? estimatedSeconds },
        };
      }

      return {
        result: await groq.transcreverAudio(base64Audio, mimeType),
        usage: { audioSeconds: estimatedSeconds },
      };
    });
  }

  // A variante detalhada fica fora da interface pública para não haver chamada sem medição.
  const { transcreverAudioDetalhado: _unmetered, ...publicGroq } = groq;

  return {
    ...publicGroq,
    analisarImagem: (...args) => guarded('groq-vision', 'image_reader', { requests: 1 }, async () => ({
      result: await groq.analisarImagem(...args),
      usage: {},
    })),
    transcreverAudio,
  };
}

module.exports = {
  createMeteredGroq,
  estimateAudioSeconds,
};
