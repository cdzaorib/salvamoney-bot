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

test('transaction store ignores canceled charge commitments but keeps their history in Firebase', async () => {
  const { firebase, store } = createStore({
    grupos: {
      SALVAMONEY: {
        usuarios: {
          123456: {
            gastos: {
              '2026_4': {
                cob_c1: {
                  cobrancaId: 'c1',
                  cobrancaStatus: 'cancelada',
                  cancelado: true,
                  desc: 'Cobrança pendente - Almoço',
                  origem: 'cobranca',
                  value: 80,
                },
                mercado: {
                  desc: 'Mercado',
                  value: 50,
                },
              },
            },
          },
        },
      },
    },
  });

  const items = await store.listMonthlyExpensesWithIds({
    group: 'SALVAMONEY',
    user: '123456',
  });

  assert.deepEqual(items, [{
    id: 'mercado',
    desc: 'Mercado',
    value: 50,
  }]);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/123456/gastos/2026_4/cob_c1/cobrancaStatus'), 'cancelada');
});

test('transaction store saves expenses only to the legacy group user path when phone is missing', async () => {
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
  assert.deepEqual(firebase.sets, []);
  assert.equal(firebase.getValue('transactionsByUser/5511999999999/2026_4/push_1'), undefined);
});

test('transaction store saves an optional copy by phone using the legacy push id', async () => {
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
    phone: '55 (11) 99999-9999',
    user: 'Ana',
    expense,
  });

  assert.deepEqual(firebase.pushes, [{
    id: 'push_1',
    path: 'grupos/CASA2024/usuarios/Ana/gastos/2026_4',
    value: expense,
  }]);
  assert.deepEqual(firebase.sets, [{
    path: 'transactionsByUser/5511999999999/2026_4/push_1',
    value: {
      ...expense,
      legacyGroup: 'CASA2024',
      legacyUser: 'Ana',
      legacyExpenseId: 'push_1',
      migrated: false,
      sourcePath: 'grupos/CASA2024/usuarios/Ana/gastos/2026_4/push_1',
    },
  }]);
  assert.deepEqual(firebase.getValue('transactionsByUser/5511999999999/2026_4/push_1'), {
    ...expense,
    legacyGroup: 'CASA2024',
    legacyUser: 'Ana',
    legacyExpenseId: 'push_1',
    migrated: false,
    sourcePath: 'grupos/CASA2024/usuarios/Ana/gastos/2026_4/push_1',
  });
});

test('transaction store saves fixed expenses to the legacy site path', async () => {
  const { firebase, store } = createStore();
  const fixedExpense = {
    desc: 'internet',
    value: 99.9,
    cat: 'Moradia',
    dia: 10,
  };

  await store.saveFixedExpense({
    group: 'CASA2024',
    user: 'Ana',
    fixedExpense,
  });

  assert.deepEqual(firebase.pushes, [{
    id: 'push_1',
    path: 'grupos/CASA2024/usuarios/Ana/fixos',
    value: fixedExpense,
  }]);
  assert.deepEqual(firebase.getValue('grupos/CASA2024/usuarios/Ana/fixos/push_1'), fixedExpense);
});

test('transaction store lists fixed expenses from the legacy site path', async () => {
  const { store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            fixos: {
              fixo_1: {
                desc: 'internet',
                value: 99.9,
                cat: 'Moradia',
                dia: 10,
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
  });

  const items = await store.listFixedExpensesWithIds({
    group: 'CASA2024',
    user: 'Ana',
  });

  assert.deepEqual(items, [{
    id: 'fixo_1',
    desc: 'internet',
    value: 99.9,
    cat: 'Moradia',
    dia: 10,
  }]);
});

test('transaction store keeps the legacy save when the phone copy fails', async () => {
  const firebase = createFakeFirebase();
  const errors = [];
  const originalError = console.error;
  const store = createTransactionStore({
    db: {},
    firebaseOps: {
      ...firebase.ops,
      async set(path, value) {
        if (String(path || '').startsWith('transactionsByUser/')) {
          throw new Error('new path failed');
        }

        return await firebase.ops.set(path, value);
      },
    },
    monthKey: () => '2026_4',
  });
  const expense = {
    cat: 'Transporte',
    desc: 'uber',
    origem: 'texto',
    user: 'Ana',
    value: 35,
    viaBot: true,
  };

  console.error = (...args) => errors.push(args);

  try {
    await store.saveExpense({
      group: 'CASA2024',
      phone: '5511999999999',
      user: 'Ana',
      expense,
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(firebase.pushes, [{
    id: 'push_1',
    path: 'grupos/CASA2024/usuarios/Ana/gastos/2026_4',
    value: expense,
  }]);
  assert.deepEqual(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_4/push_1'), expense);
  assert.equal(firebase.getValue('transactionsByUser/5511999999999/2026_4/push_1'), undefined);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /Erro ao salvar cópia/);
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

test('transaction store removes fixed expenses from the legacy site path', async () => {
  const { firebase, store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            fixos: {
              fixo_1: {
                desc: 'internet',
                value: 99.9,
                cat: 'Moradia',
                dia: 10,
              },
            },
          },
        },
      },
    },
  });

  await store.removeFixedExpenseById({
    group: 'CASA2024',
    id: 'fixo_1',
    user: 'Ana',
  });

  assert.deepEqual(firebase.removals, [
    'grupos/CASA2024/usuarios/Ana/fixos/fixo_1',
  ]);
  assert.equal(firebase.getValue('grupos/CASA2024/usuarios/Ana/fixos/fixo_1'), undefined);
});

test('transaction store removes expenses using an explicit month key', async () => {
  const { firebase, store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              '2026_5': {
                gasto_futuro: {
                  desc: 'TV (2/3x)',
                  value: 400,
                },
              },
            },
          },
        },
      },
    },
    transactionsByUser: {
      5511999999999: {
        '2026_5': {
          gasto_futuro: {
            desc: 'TV (2/3x)',
            value: 400,
          },
        },
      },
    },
  });

  await store.removeExpenseById({
    group: 'CASA2024',
    id: 'gasto_futuro',
    expenseMonthKey: '2026_5',
    phone: '5511999999999',
    removePhoneCopy: true,
    user: 'Ana',
  });

  assert.deepEqual(firebase.removals, [
    'grupos/CASA2024/usuarios/Ana/gastos/2026_5/gasto_futuro',
    'transactionsByUser/5511999999999/2026_5/gasto_futuro',
  ]);
  assert.equal(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_5/gasto_futuro'), undefined);
  assert.equal(firebase.getValue('transactionsByUser/5511999999999/2026_5/gasto_futuro'), undefined);
});

test('transaction store lists all legacy expenses with their month keys', async () => {
  const { store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              '2026_4': {
                tv_1: {
                  desc: 'TV (1/3x)',
                  parcelaId: 'tv-123',
                  value: 400,
                },
                invalid: {
                  desc: 'sem valor',
                  value: 'abc',
                },
              },
              '2026_5': {
                tv_2: {
                  desc: 'TV (2/3x)',
                  parcelaId: 'tv-123',
                  value: 400,
                },
              },
            },
          },
        },
      },
    },
  });

  const items = await store.listAllExpensesWithIds({
    group: 'CASA2024',
    user: 'Ana',
  });

  assert.deepEqual(items, [
    {
      id: 'tv_1',
      monthKey: '2026_4',
      desc: 'TV (1/3x)',
      parcelaId: 'tv-123',
      value: 400,
    },
    {
      id: 'tv_2',
      monthKey: '2026_5',
      desc: 'TV (2/3x)',
      parcelaId: 'tv-123',
      value: 400,
    },
  ]);
});

test('transaction store removes only expenses with the requested parcelaId across months', async () => {
  const { firebase, store } = createStore({
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              '2026_4': {
                tv_1: {
                  desc: 'TV (1/3x)',
                  parcelaId: 'tv-123',
                  value: 400,
                },
                tv_normal: {
                  desc: 'TV',
                  value: 1200,
                },
              },
              '2026_5': {
                tv_2: {
                  desc: 'TV (2/3x)',
                  parcelaId: 'tv-123',
                  value: 400,
                },
                notebook_1: {
                  desc: 'Notebook (1/2x)',
                  parcelaId: 'note-456',
                  value: 500,
                },
              },
              '2026_6': {
                tv_3: {
                  desc: 'TV (3/3x)',
                  parcelaId: 'tv-123',
                  value: 400,
                },
              },
            },
          },
        },
      },
    },
    transactionsByUser: {
      5511999999999: {
        '2026_4': {
          tv_1: {
            desc: 'TV (1/3x)',
            parcelaId: 'tv-123',
            value: 400,
          },
        },
        '2026_5': {
          tv_2: {
            desc: 'TV (2/3x)',
            parcelaId: 'tv-123',
            value: 400,
          },
        },
        '2026_6': {
          tv_3: {
            desc: 'TV (3/3x)',
            parcelaId: 'tv-123',
            value: 400,
          },
        },
      },
    },
  });

  const removed = await store.removeExpensesByParcelaId({
    group: 'CASA2024',
    phone: '5511999999999',
    parcelaId: 'tv-123',
    user: 'Ana',
  });

  assert.deepEqual(removed.map((expense) => ({
    id: expense.id,
    monthKey: expense.monthKey,
    parcelaId: expense.parcelaId,
  })), [
    { id: 'tv_1', monthKey: '2026_4', parcelaId: 'tv-123' },
    { id: 'tv_2', monthKey: '2026_5', parcelaId: 'tv-123' },
    { id: 'tv_3', monthKey: '2026_6', parcelaId: 'tv-123' },
  ]);
  assert.deepEqual(firebase.removals, [
    'grupos/CASA2024/usuarios/Ana/gastos/2026_4/tv_1',
    'transactionsByUser/5511999999999/2026_4/tv_1',
    'grupos/CASA2024/usuarios/Ana/gastos/2026_5/tv_2',
    'transactionsByUser/5511999999999/2026_5/tv_2',
    'grupos/CASA2024/usuarios/Ana/gastos/2026_6/tv_3',
    'transactionsByUser/5511999999999/2026_6/tv_3',
  ]);
  assert.equal(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_4/tv_1'), undefined);
  assert.equal(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_5/tv_2'), undefined);
  assert.equal(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_6/tv_3'), undefined);
  assert.deepEqual(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_4/tv_normal'), {
    desc: 'TV',
    value: 1200,
  });
  assert.deepEqual(firebase.getValue('grupos/CASA2024/usuarios/Ana/gastos/2026_5/notebook_1'), {
    desc: 'Notebook (1/2x)',
    parcelaId: 'note-456',
    value: 500,
  });
});
