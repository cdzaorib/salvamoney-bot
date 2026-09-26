'use strict';

const { parseMoney } = require('../expense-parser');
const { normalizeText } = require('./text-utils');

const MONEY_TEXT = '(?:R\\$\\s*)?(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[,.]\\d{1,2})?)';

function normalizedCommand(value) {
  return normalizeText(value)
    .trim()
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ');
}

function toCents(value) {
  const number = Number(value);

  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function fromCents(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function roundMoney(value) {
  return fromCents(toCents(value));
}

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCents(cents) {
  return formatMoney(fromCents(cents));
}

function parseMoneyToken(raw) {
  const clean = String(raw || '')
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .trim();

  if (!clean) {
    return null;
  }

  if (/^\d{1,3}(?:\.\d{3})+$/.test(clean)) {
    return Number(clean.replace(/\./g, ''));
  }

  const value = parseMoney(clean);

  return Number.isFinite(value) ? value : null;
}

function parsePositiveMoney(raw) {
  const value = parseMoneyToken(raw);

  return value !== null && value > 0 ? roundMoney(value) : null;
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

function formatDateBr(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);

  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

// Limita respostas comuns a poucas linhas para leitura rápida no WhatsApp.
function limitLines(text, maxLines = 6, maxChars = 700) {
  const lines = String(text || '').split('\n').filter((line, index, all) =>
    !(line.trim() === '' && all[index - 1]?.trim() === '')
  );
  const limited = lines.slice(0, maxLines).join('\n');

  return limited.length > maxChars ? `${limited.slice(0, maxChars - 1).trimEnd()}…` : limited;
}

module.exports = {
  MONEY_TEXT,
  firstName,
  formatCents,
  formatDateBr,
  formatMoney,
  formatPercent,
  fromCents,
  limitLines,
  normalizedCommand,
  parseMoneyToken,
  parsePositiveMoney,
  roundMoney,
  toCents,
};
