'use strict';

const { getFirebaseOps } = require('../firebase-db');

function createTransactionStore({
  db,
  firebaseOps,
  monthKey,
} = {}) {
  const { get, push, ref, remove, set } = firebaseOps || getFirebaseOps();

  function normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function legacyMonthlyExpensesPath(group, user, date) {
    return `grupos/${group}/usuarios/${user}/gastos/${monthKey(date)}`;
  }

  function legacyMonthlyExpensesPathByMonthKey(group, user, expenseMonthKey) {
    return `grupos/${group}/usuarios/${user}/gastos/${expenseMonthKey}`;
  }

  function transactionsByUserMonthlyPath(phone, date) {
    return `transactionsByUser/${normalizePhone(phone)}/${monthKey(date)}`;
  }

  function transactionsByUserMonthlyPathByMonthKey(phone, expenseMonthKey) {
    return `transactionsByUser/${normalizePhone(phone)}/${expenseMonthKey}`;
  }

  function resolveExpenseMonthKey(date, expenseMonthKey) {
    return expenseMonthKey || monthKey(date);
  }

  function legacyExpensePath(group, user, date, id, expenseMonthKey) {
    return `${legacyMonthlyExpensesPathByMonthKey(
      group,
      user,
      resolveExpenseMonthKey(date, expenseMonthKey)
    )}/${id}`;
  }

  async function listMonthlyExpensesWithIds({ group, user, date }) {
    const snap = await get(ref(db, legacyMonthlyExpensesPath(group, user, date)));

    return Object.entries(snap.val() || {})
      .map(([id, item]) => ({ id, ...item }))
      .filter((item) => item && Number.isFinite(Number(item.value)));
  }

  async function listExpenseMonths({ group, user }) {
    const snap = await get(ref(db, `grupos/${group}/usuarios/${user}/gastos`));

    return Object.keys(snap.val() || {}).sort();
  }

  async function listAllExpensesWithIds({ group, user }) {
    const expenseMonths = await listExpenseMonths({ group, user });
    const expenses = [];

    for (const expenseMonthKey of expenseMonths) {
      const snap = await get(ref(db, legacyMonthlyExpensesPathByMonthKey(group, user, expenseMonthKey)));

      Object.entries(snap.val() || {}).forEach(([id, item]) => {
        if (item && Number.isFinite(Number(item.value))) {
          expenses.push({
            id,
            monthKey: expenseMonthKey,
            ...item,
          });
        }
      });
    }

    return expenses;
  }

  async function saveExpenseByPhone({
    date,
    expense,
    group,
    legacyExpenseId,
    phone,
    user,
  }) {
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone || !legacyExpenseId) {
      return null;
    }

    const sourcePath = legacyExpensePath(group, user, date, legacyExpenseId);

    await set(ref(db, `${transactionsByUserMonthlyPath(cleanPhone, date)}/${legacyExpenseId}`), {
      ...expense,
      legacyGroup: group,
      legacyUser: user,
      legacyExpenseId,
      migrated: false,
      sourcePath,
    });

    return legacyExpenseId;
  }

  async function saveExpense({ group, user, phone, date, expense }) {
    const legacyResult = await push(ref(db, legacyMonthlyExpensesPath(group, user, date)), expense);
    const legacyExpenseId = legacyResult?.key;

    try {
      await saveExpenseByPhone({
        date,
        expense,
        group,
        legacyExpenseId,
        phone,
        user,
      });
    } catch (err) {
      console.error('Erro ao salvar cópia da transação por telefone:', err.response?.data || err.message || err);
    }

    return legacyResult;
  }

  async function removeExpenseById({
    group,
    user,
    phone,
    date,
    expenseMonthKey,
    id,
    removePhoneCopy = false,
  }) {
    const resolvedMonthKey = resolveExpenseMonthKey(date, expenseMonthKey);

    await remove(ref(db, legacyExpensePath(group, user, date, id, resolvedMonthKey)));

    if (removePhoneCopy && normalizePhone(phone)) {
      await remove(ref(db, `${transactionsByUserMonthlyPathByMonthKey(phone, resolvedMonthKey)}/${id}`));
    }
  }

  async function listExpensesByParcelaId({ group, user, parcelaId }) {
    if (!parcelaId) {
      return [];
    }

    return (await listAllExpensesWithIds({ group, user }))
      .filter((expense) => expense.parcelaId === parcelaId);
  }

  async function removeExpensesByParcelaId({
    group,
    user,
    phone,
    parcelaId,
    removePhoneCopy = true,
  }) {
    const expenses = await listExpensesByParcelaId({ group, user, parcelaId });

    for (const expense of expenses) {
      await removeExpenseById({
        group,
        user,
        phone,
        expenseMonthKey: expense.monthKey,
        id: expense.id,
        removePhoneCopy,
      });
    }

    return expenses;
  }

  return {
    legacyExpensePath,
    legacyMonthlyExpensesPath,
    legacyMonthlyExpensesPathByMonthKey,
    listAllExpensesWithIds,
    listExpenseMonths,
    listExpensesByParcelaId,
    listMonthlyExpensesWithIds,
    removeExpenseById,
    removeExpensesByParcelaId,
    saveExpense,
    saveExpenseByPhone,
    transactionsByUserMonthlyPath,
    transactionsByUserMonthlyPathByMonthKey,
  };
}

module.exports = {
  createTransactionStore,
};
