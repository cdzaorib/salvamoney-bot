'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMoney,
  parsearGasto,
  parsearParcelamento,
} = require('../src/expense-parser');

test('parseMoney supports common Brazilian money formats', () => {
  assert.equal(parseMoney('R$ 1.234,56'), 1234.56);
  assert.equal(parseMoney('45,90'), 45.9);
  assert.equal(parseMoney('35'), 35);
  assert.equal(parseMoney('valor desconhecido'), null);
});

test('parsearGasto handles value before and after description', () => {
  assert.deepEqual(parsearGasto('gastei 50 almoço'), {
    valor: 50,
    desc: 'almoço',
  });
  assert.deepEqual(parsearGasto('mercado 120,50'), {
    valor: 120.5,
    desc: 'mercado',
  });
});

test('parsearGasto ignores invalid expenses', () => {
  assert.equal(parsearGasto('gastei mercado'), null);
  assert.equal(parsearGasto('0 uber'), null);
});

test('parsearParcelamento handles amount before and after description', () => {
  assert.deepEqual(parsearParcelamento('parcelei 1200 TV em 12x'), {
    valor: 1200,
    desc: 'TV',
    parcelas: 12,
  });
  assert.deepEqual(parsearParcelamento('comprei parcelado notebook 3.000,00 em 10x'), {
    valor: 3000,
    desc: 'notebook',
    parcelas: 10,
  });
  assert.deepEqual(parsearParcelamento('gastei 120 em 3x no cartão'), {
    valor: 120,
    desc: 'cartão',
    parcelas: 3,
  });
  assert.equal(parsearParcelamento('paguei notebook a vista'), null);
});
