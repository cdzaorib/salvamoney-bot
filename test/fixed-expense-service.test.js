'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isFixedExpenseCommand,
  parseFixedExpense,
} = require('../src/bot/fixed-expense-service');

test('parseFixedExpense handles supported fixed expense phrases', () => {
  assert.deepEqual(parseFixedExpense('gasto fixo de 89,90 com internet todo dia 10'), {
    desc: 'internet',
    value: 89.9,
    cat: 'Moradia',
    dia: 10,
  });
  assert.deepEqual(parseFixedExpense('adicionar gasto fixo de 120 academia dia 5'), {
    desc: 'academia',
    value: 120,
    cat: 'Academia',
    dia: 5,
  });
  assert.deepEqual(parseFixedExpense('fixo aluguel 1800 dia 10'), {
    desc: 'aluguel',
    value: 1800,
    cat: 'Moradia',
    dia: 10,
  });
  assert.deepEqual(parseFixedExpense('todo mês pago 45,90 de netflix'), {
    desc: 'netflix',
    value: 45.9,
    cat: 'Lazer',
    dia: null,
  });
  assert.deepEqual(parseFixedExpense('cadastrar fixo internet 99,90'), {
    desc: 'internet',
    value: 99.9,
    cat: 'Moradia',
    dia: null,
  });
});

test('isFixedExpenseCommand recognizes list, create and delete fixed commands', () => {
  assert.equal(isFixedExpenseCommand('fixos'), true);
  assert.equal(isFixedExpenseCommand('meus gastos fixos'), true);
  assert.equal(isFixedExpenseCommand('fixo aluguel 1800 dia 10'), true);
  assert.equal(isFixedExpenseCommand('apagar fixo internet'), true);
  assert.equal(isFixedExpenseCommand('35 uber'), false);
});
