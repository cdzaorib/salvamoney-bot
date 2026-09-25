'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCycle } = require('../src/bot/card-cycle');
const { hasSensitiveCardData } = require('../src/bot/card-service');
const { USERS, baseSeed, createHarness } = require('./helpers/assistant-harness');

test('cartões: cadastro guarda só apelido, dias e indicador de padrão', async () => {
  const harness = createHarness({ seed: baseSeed() });
  const reply = await harness.say(USERS.ana, 'adicionar cartão Nubank fecha dia 3 vence dia 10');
  const cards = harness.userValue(USERS.ana, 'cartoes');
  const [card] = Object.values(cards);

  assert.match(reply, /Nubank cadastrado/);
  assert.deepEqual(Object.keys(card).sort(), ['apelido', 'atualizadoEm', 'diaFechamento', 'diaVencimento', 'padrao']);
  assert.equal(card.padrao, true);
});

test('cartões: número, validade e CVV nunca são aceitos', async () => {
  const harness = createHarness({ seed: baseSeed() });
  const reply = await harness.say(USERS.ana, 'adicionar cartão Nubank 5502 0912 3456 7890 cvv 123 vence dia 10');

  assert.match(reply, /Não guardo número do cartão/);
  assert.equal(harness.userValue(USERS.ana, 'cartoes'), undefined);
  assert.equal(hasSensitiveCardData('validade 12/29'), true);
  assert.equal(hasSensitiveCardData('Nubank fecha dia 3'), false);
});

test('cartões: vários cartões, troca do padrão e remoção reatribuindo o padrão', async () => {
  const harness = createHarness({ seed: baseSeed() });

  await harness.say(USERS.ana, 'adicionar cartão Nubank fecha dia 3 vence dia 10');
  await harness.say(USERS.ana, 'cadastrar cartão Inter fechamento 20 vencimento 28');
  assert.match(await harness.say(USERS.ana, 'cartão padrão Inter'), /Inter agora é seu cartão padrão/);

  const list = await harness.say(USERS.ana, 'meus cartões');

  assert.match(list, /1\. Inter \(padrão\)/);
  assert.match(list, /2\. Nubank/);
  await harness.say(USERS.ana, 'remover cartão Inter');
  assert.match(await harness.say(USERS.ana, 'meus cartões'), /Nubank \(padrão\)/);
});

test('cartões: ciclo estimado — compra antes do fechamento cai na fatura do mês', () => {
  const card = { diaFechamento: 3, diaVencimento: 10 };

  assert.deepEqual(computeCycle(card, '2026-09-02'), { fechamento: '2026-09-03', vencimento: '2026-09-10' });
  assert.deepEqual(computeCycle(card, '2026-09-03'), { fechamento: '2026-10-03', vencimento: '2026-10-10' });
  assert.deepEqual(computeCycle({ diaFechamento: 25, diaVencimento: 5 }, '2026-09-10'), {
    fechamento: '2026-09-25',
    vencimento: '2026-10-05',
  });
  assert.deepEqual(computeCycle(card, '2026-09-25', 2), { fechamento: '2026-12-03', vencimento: '2026-12-10' });
  assert.deepEqual(computeCycle({ diaFechamento: 31, diaVencimento: 8 }, '2026-02-10'), {
    fechamento: '2026-02-28',
    vencimento: '2026-03-08',
  });
});

test('cartões: fechamento sem dia é estimado e pode ser corrigido ("minha fatura fechou hoje")', async () => {
  const harness = createHarness({ seed: baseSeed() });
  const reply = await harness.say(USERS.ana, 'adicionar cartão Inter vence dia 15');

  assert.match(reply, /estimei 7 dias antes/);
  assert.equal(Object.values(harness.userValue(USERS.ana, 'cartoes'))[0].diaFechamento, 8);

  const corrected = await harness.say(USERS.ana, 'minha fatura Inter fechou hoje');

  assert.match(corrected, /corrigido para dia 25/);
  assert.equal(Object.values(harness.userValue(USERS.ana, 'cartoes'))[0].diaFechamento, 25);
});
