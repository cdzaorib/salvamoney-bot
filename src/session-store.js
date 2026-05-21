'use strict';

const { ref, get, set } = require('firebase/database');

const SESSION_TTL = 5 * 60 * 1000;

function createSessionStore(db) {
  const sessionCache = new Map();

  async function getSession(phone) {
    const cached = sessionCache.get(phone);

    if (cached && Date.now() - cached.ts < SESSION_TTL) {
      return cached.data;
    }

    const snap = await get(ref(db, `bot_sessions/${phone}`));
    const data = snap.val();

    sessionCache.set(phone, { data, ts: Date.now() });

    return data;
  }

  async function saveSession(phone, data) {
    await set(ref(db, `bot_sessions/${phone}`), data);
    sessionCache.set(phone, { data, ts: Date.now() });
  }

  return {
    getSession,
    saveSession,
  };
}

module.exports = {
  createSessionStore,
};
