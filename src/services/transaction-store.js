'use strict';

const { getFirebaseOps } = require('../firebase-db');

function createTransactionStore({
  db,
  firebaseOps,
  monthKey,
} = {}) {
  const { get, push, ref, remove } = firebaseOps || getFirebaseOps();

  function legacyMonthlyExpensesPath(group, user, date) {
    return `grupos/${group}/usuarios/${user}/gastos/${monthKey(date)}`;
  }

  async function listMonthlyExpensesWithIds({ group, user, date }) {
    const snap = await get(ref(db, legacyMonthlyExpensesPath(group, user, date)));

    return Object.entries(snap.val() || {})
      .map(([id, item]) => ({ id, ...item }))
      .filter((item) => item && Number.isFinite(Number(item.value)));
  }

  async function saveExpense({ group, user, date, expense }) {
    return await push(ref(db, legacyMonthlyExpensesPath(group, user, date)), expense);
  }

  async function removeExpenseById({ group, user, date, id }) {
    await remove(ref(db, `${legacyMonthlyExpensesPath(group, user, date)}/${id}`));
  }

  return {
    legacyMonthlyExpensesPath,
    listMonthlyExpensesWithIds,
    removeExpenseById,
    saveExpense,
  };
}

module.exports = {
  createTransactionStore,
};
