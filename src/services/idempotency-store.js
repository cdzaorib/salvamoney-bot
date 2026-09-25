'use strict';

const crypto = require('node:crypto');
const { DEFAULT_GROUP, normalizeAccessTag } = require('./user-service');

const STALE_PROCESSING_MS = 2 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_PROBABILITY = 0.02;

function hashKey(value, pepper = '') {
  return crypto.createHash('sha256').update(`${pepper}:${String(value || '')}`).digest('hex').slice(0, 32);
}

// Garante que uma ação mutável rode uma única vez por chave, mesmo após retry do
// webhook, reinício do processo ou resposta duplicada do modelo. As chaves são
// armazenadas como hash para não expor telefone, mensagem ou identificadores.
function createIdempotencyStore({
  db,
  firebaseOps,
  now = () => new Date(),
  pepper = '',
  random = Math.random,
}) {
  const { get, ref, transaction, update } = firebaseOps;

  function hash(value) {
    return hashKey(value, pepper);
  }

  function pathFor(scope, key) {
    const tag = normalizeAccessTag(scope);
    const hashed = hash(key);

    return tag
      ? `grupos/${DEFAULT_GROUP}/usuarios/${tag}/idempotencia/${hashed}`
      : `sistema/idempotencia/${hash(scope)}/${hashed}`;
  }

  async function claim(path, tipo) {
    const startedAt = now();
    const result = await transaction(ref(db, path), (current) => {
      if (current?.estado === 'concluido') {
        return undefined;
      }

      if (current?.estado === 'processando') {
        const age = startedAt.getTime() - new Date(current.em || 0).getTime();

        if (Number.isFinite(age) && age < STALE_PROCESSING_MS) {
          return undefined;
        }
      }

      return {
        em: startedAt.toISOString(),
        estado: 'processando',
        tipo: String(tipo || 'acao').slice(0, 40),
      };
    });

    return result?.committed === true;
  }

  async function run({ execute, key, scope, tipo }) {
    if (!key || !scope) {
      return {
        duplicate: false,
        result: await execute(),
      };
    }

    const path = pathFor(scope, key);

    if (!(await claim(path, tipo))) {
      return { duplicate: true, result: null };
    }

    let result;

    try {
      result = await execute();
    } catch (err) {
      await transaction(ref(db, path), (current) => (current?.estado === 'processando' ? null : undefined))
        .catch(() => null);
      throw err;
    }

    // Se a ação apagou os dados do usuário (ex.: "apagar meus dados"), não recria nada.
    await transaction(ref(db, path), (current) => (current ? {
      concluidoEm: now().toISOString(),
      estado: 'concluido',
      tipo: String(tipo || 'acao').slice(0, 40),
    } : undefined)).catch(() => null);

    await maybePrune(path);

    return { duplicate: false, result };
  }

  // Limpeza ocasional: chaves com mais de 7 dias não protegem mais contra retry.
  async function maybePrune(path) {
    if (typeof get !== 'function' || typeof update !== 'function' || random() >= PRUNE_PROBABILITY) {
      return;
    }

    try {
      const folder = path.slice(0, path.lastIndexOf('/'));
      const snap = await get(ref(db, folder));
      const limit = now().getTime() - RETENTION_MS;
      const stale = Object.entries(snap.val() || {})
        .filter(([, record]) => new Date(record?.concluidoEm || record?.em || 0).getTime() < limit)
        .map(([key]) => [`${folder}/${key}`, null]);

      if (stale.length) {
        await update(ref(db), Object.fromEntries(stale));
      }
    } catch (_) {
      // A limpeza é opcional; nunca interrompe a ação principal.
    }
  }

  return {
    hashKey: hash,
    pathFor,
    run,
  };
}

module.exports = {
  createIdempotencyStore,
  hashKey,
};
