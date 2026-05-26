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

  function transactionsByUserMonthlyPath(phone, date) {
    return `transactionsByUser/${normalizePhone(phone)}/${monthKey(date)}`;
  }

  function legacyExpensePath(group, user, date, id) {
    return `${legacyMonthlyExpensesPath(group, user, date)}/${id}`;
  }

  async function listMonthlyExpensesWithIds({ group, user, date }) {
    const snap = await get(ref(db, legacyMonthlyExpensesPath(group, user, date)));

    return Object.entries(snap.val() || {})
      .map(([id, item]) => ({ id, ...item }))
      .filter((item) => item && Number.isFinite(Number(item.value)));
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

  async function removeExpenseById({ group, user, date, id }) {
    await remove(ref(db, legacyExpensePath(group, user, date, id)));
  }

  return {
    legacyExpensePath,
    legacyMonthlyExpensesPath,
    listMonthlyExpensesWithIds,
    removeExpenseById,
    saveExpense,
    saveExpenseByPhone,
    transactionsByUserMonthlyPath,
  };
}

module.exports = {
  createTransactionStore,
};
