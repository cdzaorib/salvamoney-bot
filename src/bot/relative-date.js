'use strict';

const { foldText } = require('../ai/privacy');

function shiftIso(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

// Data citada na mensagem ("ontem", "anteontem", "dia 12/09"); padrão: hoje.
function relativeDateIso(text, todayIso) {
  const folded = foldText(text);

  if (/\banteontem\b/.test(folded)) {
    return shiftIso(todayIso, -2);
  }

  if (/\bontem\b/.test(folded)) {
    return shiftIso(todayIso, -1);
  }

  const match = folded.match(/\bdia\s+(\d{1,2})\/(\d{1,2})\b/);

  if (match) {
    const [year] = todayIso.split('-');
    const candidate = `${year}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
    const parsed = new Date(`${candidate}T12:00:00Z`);

    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) {
      return candidate > todayIso ? `${Number(year) - 1}${candidate.slice(4)}` : candidate;
    }
  }

  return todayIso;
}

module.exports = {
  relativeDateIso,
  shiftIso,
};
