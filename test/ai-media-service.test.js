'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiMediaService } = require('../src/bot/ai-media-service');

function createService({
  generateText,
  groqOverrides = {},
} = {}) {
  const calls = [];
  const service = createAiMediaService({
    aiProviderRouter: {
      generateText: async (options) => {
        calls.push(options);

        return await generateText?.(options);
      },
    },
    expenseService: {
      getResumoTexto: async () => 'Total: R$ 10,00',
      montarResumoFormatado: async () => 'Resumo',
      registrarGasto: async (_, expense) => `Registrado: ${expense.desc}`,
      registrarParcelamento: async () => 'Parcelado',
    },
    groq: {
      analisarImagem: async () => {
        throw new Error('imagem não esperada');
      },
      baixarMediaComoBase64: async () => {
        throw new Error('download não esperado');
      },
      transcreverAudio: async () => {
        throw new Error('áudio não esperado');
      },
      ...groqOverrides,
    },
    safeLog: {
      logMediaUrl: (value) => value,
      logText: (value) => value,
      maskPhone: (value) => value,
    },
    todayIso: () => '2026-05-30',
  });

  return {
    calls,
    service,
  };
}

test('legacy text AI uses provider router without sending tag or phone', async () => {
  const { calls, service } = createService({
    generateText: async () => JSON.stringify({
      acao: 'registrar',
      cat: 'Educação',
      desc: 'curso',
      valor: 80,
    }),
  });
  const response = await service.processarTextoComIA('gasto do curso', {
    group: 'SALVAMONEY',
    name: 'Carlos',
    phone: '5511999999999',
    tag: '482913',
    user: '482913',
  });
  const prompt = JSON.stringify(calls[0].messages);

  assert.equal(response, 'Registrado: curso');
  assert.equal(calls[0].task, 'legacy_financial_text_parser');
  assert.doesNotMatch(prompt, /482913/);
  assert.doesNotMatch(prompt, /5511999999999/);
});

test('legacy text AI returns a safe fallback when provider router fails', async () => {
  const { service } = createService({
    generateText: async () => null,
  });
  const response = await service.processarTextoComIA('mensagem livre', {
    group: 'SALVAMONEY',
    phone: '5511999999999',
    tag: '482913',
    user: '482913',
  });

  assert.equal(response, undefined);
});
