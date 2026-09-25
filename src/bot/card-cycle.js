'use strict';

// Cálculo de ciclos de fatura sem integração bancária: o fechamento é uma
// estimativa baseada no dia informado pelo usuário.

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isoFrom(year, monthIndex, day) {
  const normalized = new Date(Date.UTC(year, monthIndex, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();
  const clampedDay = Math.min(day, daysInMonth(y, m));

  return `${y}-${String(m + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

function parseIso(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  return {
    day: Number(match[3]),
    monthIndex: Number(match[2]) - 1,
    year: Number(match[1]),
  };
}

function validDay(value) {
  const day = Number(value);

  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

// Compras no dia do fechamento ou depois entram na fatura seguinte.
function computeCycle(card, purchaseIso, installmentIndex = 0) {
  const purchase = parseIso(purchaseIso);
  const closingDay = validDay(card?.diaFechamento);
  const dueDay = validDay(card?.diaVencimento);

  if (!purchase || !closingDay || !dueDay) {
    return null;
  }

  const closesThisMonth = purchase.day < Math.min(closingDay, daysInMonth(purchase.year, purchase.monthIndex));
  const closingMonth = purchase.monthIndex + (closesThisMonth ? 0 : 1) + installmentIndex;
  const dueMonth = closingMonth + (dueDay > closingDay ? 0 : 1);

  return {
    fechamento: isoFrom(purchase.year, closingMonth, closingDay),
    vencimento: isoFrom(purchase.year, dueMonth, dueDay),
  };
}

function addMonthsIso(iso, months) {
  const parsed = parseIso(iso);

  return parsed ? isoFrom(parsed.year, parsed.monthIndex + months, parsed.day) : null;
}

module.exports = {
  addMonthsIso,
  computeCycle,
  daysInMonth,
  isoFrom,
  parseIso,
  validDay,
};
