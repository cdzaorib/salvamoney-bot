'use strict';

// Contexto conversacional curto e somente em memória: últimas mensagens (já
// redigidas) por até ~24 horas. Nada daqui é persistido no Firebase.
function createConversationContext({
  maxMessages = 6,
  now = () => Date.now(),
  ttlMs = 24 * 60 * 60 * 1000,
} = {}) {
  const entries = new Map();

  function prune(key) {
    const list = (entries.get(key) || [])
      .filter((entry) => now() - entry.at <= ttlMs)
      .slice(-maxMessages);

    if (list.length) {
      entries.set(key, list);
    } else {
      entries.delete(key);
    }

    return list;
  }

  function add(key, role, text) {
    if (!key || !text) {
      return;
    }

    const list = entries.get(key) || [];

    list.push({
      at: now(),
      role: role === 'assistant' ? 'assistant' : 'user',
      text: String(text).slice(0, 400),
    });
    entries.set(key, list);
    prune(key);
  }

  function recent(key) {
    return prune(key).map(({ role, text }) => ({ role, text }));
  }

  function clear(key) {
    entries.delete(key);
  }

  return {
    add,
    clear,
    recent,
  };
}

module.exports = {
  createConversationContext,
};
