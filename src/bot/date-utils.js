'use strict';

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function createDateUtils({ monthIndexMode, timeZone }) {
  function dateParts(date = new Date()) {
    return Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
  }

  function monthKey(date = new Date()) {
    const parts = dateParts(date);
    const month = monthIndexMode === 'one' ? Number(parts.month) : Number(parts.month) - 1;

    return `${parts.year}_${month}`;
  }

  function todayIso(date = new Date()) {
    const parts = dateParts(date);

    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  return {
    dateParts,
    monthKey,
    todayIso,
  };
}

module.exports = {
  MESES,
  createDateUtils,
};
