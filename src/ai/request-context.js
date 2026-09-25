'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

// Contexto por mensagem (tag, consentimento, personalidade) disponível para os
// provedores de IA sem precisar alterar a assinatura dos serviços existentes.
const storage = new AsyncLocalStorage();

function runWithContext(context, fn) {
  return storage.run({ ...(context || {}) }, fn);
}

function getContext() {
  return storage.getStore() || null;
}

module.exports = {
  getContext,
  runWithContext,
};
