'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FORBIDDEN_WORDS,
  PERSONALITIES,
  containsForbiddenWord,
  economicoComment,
  frame,
  promptStyle,
  resolvePersonality,
} = require('../src/bot/personality-service');
const { USERS, createHarness } = require('./helpers/assistant-harness');

test('personalidades: seis opções com lista, teste e troca por comandos naturais', async () => {
  const harness = createHarness();
  const list = await harness.say(USERS.ana, 'quais são as personalidades?');

  ['Equilibrado', 'Econômico', 'Estrategista', 'Motivador', 'Professor', 'Sincerão'].forEach((name) => {
    assert.match(list, new RegExp(name));
  });
  assert.equal(Object.keys(PERSONALITIES).length, 6);
  assert.match(await harness.say(USERS.ana, 'testar personalidade professor'), /Exemplo 📚 Professor/);
  assert.match(await harness.say(USERS.ana, 'quero o modo sincerão'), /trocada para 😎 Sincerão/);
  assert.equal(harness.userValue(USERS.ana, 'preferencias/personalidade/id'), 'sincerao');
  assert.match(await harness.say(USERS.ana, 'minha personalidade'), /Sincerão/);
});

test('personalidades: reconhece erros de digitação e recusa nomes desconhecidos', async () => {
  assert.equal(resolvePersonality('sincerao'), 'sincerao');
  assert.equal(resolvePersonality('estrategsta'), 'estrategista');
  assert.equal(resolvePersonality('motivadro'), 'motivador');
  assert.equal(resolvePersonality('pirata'), null);

  const harness = createHarness();

  assert.match(await harness.say(USERS.ana, 'mudar personalidade para pirata'), /Não reconheci/);
});

test('personalidades: mudam só o tom — números e instruções do corpo ficam idênticos', () => {
  const body = 'Total R$ 150,00 · Carlos: R$ 75,00\nResponda SIM para gravar ou CANCELAR.';

  Object.keys(PERSONALITIES).forEach((id) => {
    const framed = frame(id, 'preview', body, { closing: true });

    assert.ok(framed.includes(body), id);
    assert.match(promptStyle(id), /Não mude números/);
  });
});

test('personalidades: nenhum texto insulta ou humilha (inclusive o Sincerão)', () => {
  Object.values(PERSONALITIES).forEach((personality) => {
    const texts = [personality.exemplo, ...Object.values(personality.abertura), ...Object.values(personality.fechamento)];

    texts.forEach((text) => assert.equal(containsForbiddenWord(text), false, text));
  });
  assert.ok(FORBIDDEN_WORDS.includes('burro'));
  assert.equal(containsForbiddenWord('isso foi burro'), true);
});

test('Econômico: só critica com orçamento, meta ou prioridade e explica o impacto objetivo', () => {
  assert.equal(economicoComment('economico', { totalMes: 900 }), '');
  assert.equal(economicoComment('equilibrado', { orcamentoMensal: 1000, totalMes: 950 }), '');

  const budget = economicoComment('economico', { orcamentoMensal: 1000, totalMes: 920 });

  assert.match(budget, /92% do orçamento do mês\. Restam R\$ 80,00/);
  assert.equal(containsForbiddenWord(budget), false);
  assert.match(economicoComment('economico', { economiaProjetada: 200, totalMes: 100, valorMeta: 500 }), /abaixo da meta/);
  assert.match(economicoComment('economico', { prioridades: ['quitar o carro'], totalMes: 100 }), /quitar o carro/);
});

test('Econômico: comentário aparece ao registrar gasto somente com orçamento definido', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'mudar personalidade para econômico');
  assert.doesNotMatch(await harness.say(USERS.ana, 'gastei 50 no mercado'), /Impacto/);

  await harness.say(USERS.ana, 'definir orçamento 100');
  assert.match(await harness.say(USERS.ana, 'gastei 40 no mercado'), /Impacto: com esse gasto você usou 90% do orçamento/);
});

test('personalidade vale também para relatório semanal e alertas automáticos', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'mudar personalidade para motivador');
  await harness.say(USERS.ana, 'gastei 50 no mercado');
  await harness.say(USERS.ana, 'alerta de 60 para alimentação');

  const alert = await harness.say(USERS.ana, 'gastei 20 no mercado');
  const report = await harness.service.gerarRelatorioSemanal({ group: 'SALVAMONEY', tag: USERS.ana.tag, user: USERS.ana.tag });

  assert.match(alert, /Ei, vale um olhar aqui:\nAlerta financeiro/);
  assert.match(report, /bora ver o progresso/);
  assert.match(report, /🎯 Prioridade:/);
  assert.ok((report.match(/^\d\. /gm) || []).length <= 3, 'no máximo três ações');
});
