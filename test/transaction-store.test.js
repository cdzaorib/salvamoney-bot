'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransactionStore } = require('../src/services/transaction-store');
const { createFakeFirebase } = require('./helpers/fake-firebase');

function createStore(seed = {}) {
  const firebase = createFakeFirebase(seed);
  const store = createTransactionStore({
    db: {},
    firebaseOps: firebase.ops,
    monthKey: () => '2026_4',
  });

  return {
    firebase,
    store,
  };
}

test('transaction store lists monthly expenses from the legacy group user path', async () => {
  const { store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              '2026_4': {
                gasto_1: {
                  cat: 'Transporte',
                  desc: 'uber',
                  value: 35,
                },
                invalid: {
                  desc: 'sem valor',
                  value: 'abc',
                },
              },
            },
          },
        },
      },
    },
  });

  const items = await store.listMonthlyExpensesWithIds({
    group: 'CASA2024',
    user: 'Ana',
  });

  assert.deepEqual(items, [{
    id: 'gasto_1',
    cat: 'Transporte',
    desc: 'uber',
    value: 35,
  }]);
});

test('transaction store saves expenses to the legacy group user path', async () => {
  const { firebase, store } = createStore();
  const expense = {
    cat: 'Transporte',
    createdAt: '2026-05-26T12:00:00.000Z',
    date: '2026-05-26',
    desc: 'uber',
    origem: 'texto',
    user: 'Ana',
    value: 35,
    viaBot: true,
  };

  await store.saveExpense({
    group: 'CASA2024',
    user: 'Ana',
    expense,
  });

  assert.deepEqual(firebase.pushes, [{
    id: 'push_1',
    path: 'grupos/CASA2024/usuarios/Ana/gastos/2026_4',
    value: expense,
  }]);
  assert.deepEqual(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_4/push_1'), expense);
});

test('transaction store removes expenses from the legacy group user path', async () => {
  const { firebase, store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              '2026_4': {
                gasto_1: {
                  desc: 'uber',
                  value: 35,
                },
              },
            },
          },
        },
      },
    },
  });

  await store.removeExpenseById({
    group: 'CASA2024',
    id: 'gasto_1',
    user: 'Ana',
  });

  assert.deepEqual(firebase.removals, [
    'grupos/CASA2024/usuarios/Ana/gastos/2026_4/gasto_1',
  ]);
  assert.equal(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_4/gasto_1'), undefined);
});
