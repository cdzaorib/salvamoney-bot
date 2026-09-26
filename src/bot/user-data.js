'use strict';

const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { firstName } = require('./finance-utils');

function userPath(tag) {
  return `grupos/${DEFAULT_GROUP}/usuarios/${normalizeAccessTag(tag)}`;
}

function sessionTag(session) {
  return normalizeAccessTag(session?.tag || session?.user);
}

function hasValidAccessSession(session) {
  const tag = sessionTag(session);

  return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
}

// Acesso a dados de usuário por tag, sem expor telefone em mensagens ou logs.
function createUserDataStore({ db, firebaseOps }) {
  const { get, ref, update } = firebaseOps;

  async function read(path) {
    const snap = await get(ref(db, path));

    return snap.val();
  }

  async function getUserRecord(tag) {
    const cleanTag = normalizeAccessTag(tag);

    return cleanTag ? await read(userPath(cleanTag)) : null;
  }

  async function readChild(tag, child) {
    return (await read(`${userPath(tag)}/${child}`)) ?? null;
  }

  async function updateChild(tag, child, fields) {
    await update(ref(db, `${userPath(tag)}/${child}`), fields);
  }

  async function getContact(tag) {
    const cleanTag = normalizeAccessTag(tag);

    if (!cleanTag) {
      return null;
    }

    const record = await getUserRecord(cleanTag);
    let phone = String(record?.phone || '').replace(/\D/g, '');
    let name = record?.nome || record?.name || '';

    if (!phone) {
      const index = await read(`shareTags/${cleanTag}`);

      phone = String(index?.phone || '').replace(/\D/g, '');
    }

    if (phone && !name) {
      const user = await read(`users/${phone}`);

      name = user?.name || '';
    }

    if (!record && !phone) {
      return null;
    }

    return {
      firstName: firstName(name) || 'Alguém',
      phone,
      tag: cleanTag,
    };
  }

  return {
    getContact,
    getUserRecord,
    read,
    readChild,
    updateChild,
  };
}

module.exports = {
  createUserDataStore,
  hasValidAccessSession,
  sessionTag,
  userPath,
};
