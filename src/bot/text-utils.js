'use strict';

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function sanitizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/[.#$\[\]\/]/g, '-');
}

module.exports = {
  normalizeText,
  sanitizeKey,
};
