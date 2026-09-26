'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeShares, parseSplitMessage } = require('../src/bot/split-parser');

const FRIENDS = [
  { apelido: 'Carlos', estado: 'ativa', tag: '222222' },
  { apelido: 'Ana', estado: 'ativa', tag: '333333' },
  { apelido: 'Beto trabalho', estado: 'ativa', tag: '444444' },
  { apelido: 'Beto faculdade', estado: 'ativa', tag: '555555' },
];
const CARDS = [
  { apelido: 'Nubank', diaFechamento: 3, diaVencimento: 10, id: 'c1', padrao: true },
  { apelido: 'Inter', diaFechamento: 20, diaVencimento: 28, id: 'c2' },
];

function parse(text) {
  return parseSplitMessage(text, { cards: CARDS, friends: FRIENDS });
}

function shares(result) {
  return Object.fromEntries(result.draft.participants.map((person) => [person.apelido, person.cents]));
}

test('split: "dividir 150 com Carlos" divide igualmente entre quem pagou e Carlos', () => {
  const result = parse('dividir 150 com Carlos');

  assert.equal(result.draft.totalCents, 15000);
  assert.deepEqual(shares(result), { Carlos: 7500 });
  assert.equal(result.draft.payerCents, 7500);
  assert.equal(result.draft.includePayer, true);
});

test('split: valor devido explícito tem prioridade ("Carlos me deve 150")', () => {
  const result = parse('a conta deu 300 e Carlos me deve 150');

  assert.equal(result.draft.totalCents, 30000);
  assert.deepEqual(result.draft.participants.map((person) => person.mode), ['explicito']);
  assert.deepEqual(shares(result), { Carlos: 15000 });
  assert.equal(result.draft.payerCents, 15000);
});

test('split: fração explícita ("Carlos deve metade") vem antes da divisão igual', () => {
  const result = parse('a conta deu 300 e Carlos deve metade');

  assert.deepEqual(shares(result), { Carlos: 15000 });
  assert.equal(result.draft.participants[0].mode, 'fracao');
});

test('split: três participantes dividem 180 em R$ 60 cada', () => {
  const result = parse('dividir 180 com Carlos e Ana');

  assert.deepEqual(shares(result), { Ana: 6000, Carlos: 6000 });
  assert.equal(result.draft.payerCents, 6000);
});

test('split: "somente entre" exclui quem pagou da divisão', () => {
  const result = parse('dividir 180 somente entre Carlos e Ana');

  assert.equal(result.draft.includePayer, false);
  assert.deepEqual(shares(result), { Ana: 9000, Carlos: 9000 });
  assert.equal(result.draft.payerCents, 0);
});

test('split: valores diferentes explícitos por pessoa', () => {
  const result = parse('dividir 200 com Carlos e Ana, Carlos 50 e Ana 80');

  assert.deepEqual(shares(result), { Ana: 8000, Carlos: 5000 });
  assert.equal(result.draft.payerCents, 7000);
});

test('split: arredondamento fica com quem pagou e nunca passa de 2 casas', () => {
  const result = parse('dividir 100 com Carlos e Ana');
  const all = [...result.draft.participants.map((person) => person.cents), result.draft.payerCents];

  assert.deepEqual(shares(result), { Ana: 3333, Carlos: 3333 });
  assert.equal(result.draft.payerCents, 3334);
  assert.equal(all.reduce((sum, value) => sum + value, 0), 10000);
  assert.ok(all.every(Number.isInteger));
});

test('split: arredondamento sem o pagador participar também é absorvido por ele', () => {
  const computed = computeShares({
    includePayer: false,
    people: [{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }],
    totalCents: 10000,
  });

  assert.deepEqual(computed.participants.map((person) => person.cents), [3333, 3333, 3333]);
  assert.equal(computed.payerCents, 1);
});

test('split: português informal e erros de digitação ("divdir", "c carlos", "rachar")', () => {
  const typo = parse('divdir 90 do almoço c carlos');
  const informal = parse('rachar a pizza 80 com carlos no pix');

  assert.deepEqual(shares(typo), { Carlos: 4500 });
  assert.equal(typo.draft.description, 'Almoço');
  assert.deepEqual(shares(informal), { Carlos: 4000 });
  assert.equal(informal.draft.payment.tipo, 'pix');
  assert.equal(informal.draft.description, 'Pizza');
});

test('split: frase explícita com cartão identifica o cartão pelo apelido', () => {
  const result = parse('dividir 150 no Nubank com Carlos');

  assert.deepEqual(result.draft.payment, { cardId: 'c1', cardName: 'Nubank', tipo: 'cartao' });
});

test('split: parcelamento em cartão é identificado', () => {
  const result = parse('dividir 1200 em 3x no Inter com Carlos');

  assert.equal(result.draft.installments, 3);
  assert.equal(result.draft.payment.cardId, 'c2');
  assert.equal(result.draft.totalCents, 120000);
});

test('split: "Almocei com Carlos" não cria cobrança (sem verbo financeiro)', () => {
  assert.equal(parse('Almocei com Carlos'), null);
  assert.equal(parse('fui ao cinema com Ana ontem'), null);
});

test('split: nomes repetidos pedem o apelido completo em vez de adivinhar', () => {
  const result = parse('dividir 100 com Beto');

  assert.match(result.ambiguity, /Beto trabalho ou Beto faculdade/);
  assert.deepEqual(shares(parse('dividir 100 com Beto trabalho')), { 'Beto trabalho': 5000 });
});

test('split: amigo desconhecido e valor ausente geram perguntas claras', () => {
  assert.match(parse('dividir 150 com Pedro').error, /Não encontrei Pedro/);
  assert.match(parse('dividir com Carlos').error, /valor total/);
  assert.match(parse('dividir 150').error, /Com quem/);
});

test('split: percentual explícito e pronome com um único amigo', () => {
  const result = parse('dividir 200 com Carlos, ele paga 30%');

  assert.deepEqual(shares(result), { Carlos: 6000 });
  assert.equal(result.draft.participants[0].mode, 'percentual');
  assert.match(parse('dividir 90 com Carlos e Ana, ela paga 30').ambiguity, /ele\/ela/);
});

test('split: valores acima do total são recusados', () => {
  assert.match(parse('dividir 100 com Carlos e Ana, Carlos 80 e Ana 50').error, /mais que o total/);
});

test('split: cobrança direta por apelido e mensagens com tag seguem o fluxo antigo', () => {
  const charge = parse('cobrar 80 do Carlos pelo almoço');

  assert.equal(charge.draft.kind, 'charge');
  assert.equal(charge.draft.totalCents, null);
  assert.deepEqual(shares(charge), { Carlos: 8000 });
  assert.equal(parse('dividir 150 tag 123456'), null);
});
