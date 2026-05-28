'use strict';

const crypto = require('node:crypto');
const { getFirebaseOps } = require('../firebase-db');

const SHARE_TAG_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_TAG_RANDOM_ATTEMPTS = 5;
const SITE_DEFAULT_GROUP = 'SALVAMONEY';
const FIREBASE_INVALID_KEY_CHARS = /[.#$\[\]\/\x00-\x1F\x7F]/g;

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSiteLoginTag(tag) {
  return String(tag || '')
    .trim()
    .replace(/@/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(FIREBASE_INVALID_KEY_CHARS, '-');
}

function getFirstName(name) {
  const firstName = String(name || '')
    .trim()
    .split(/\s+/)[0] || 'USUARIO';

  return firstName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') || 'USUARIO';
}

function codeFromBytes(bytes) {
  return Array.from(bytes)
    .slice(0, 6)
    .map((byte) => SHARE_TAG_CODE_CHARSET[byte % SHARE_TAG_CODE_CHARSET.length])
    .join('');
}

function randomCode(randomBytes) {
  return codeFromBytes(randomBytes(6));
}

function deterministicCode(phone, createdAt) {
  const hash = crypto.createHash('sha256').update(`${phone}:${createdAt}`).digest();

  return codeFromBytes(hash);
}

function createUserService({
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes,
} = {}) {
  const { get, ref, set } = firebaseOps || getFirebaseOps();

  async function getUserByPhone(phone) {
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      return null;
    }

    const snap = await get(ref(db, `users/${cleanPhone}`));

    return snap.val();
  }

  async function shareTagExists(shareTag) {
    const snap = await get(ref(db, `shareTags/${shareTag}`));

    return snap.exists();
  }

  async function createShareTag(phone, name, createdAt) {
    const prefix = getFirstName(name);

    for (let attempt = 0; attempt < SHARE_TAG_RANDOM_ATTEMPTS; attempt++) {
      const shareTag = `${prefix}-${randomCode(randomBytes)}`;

      if (!(await shareTagExists(shareTag))) {
        return shareTag;
      }
    }

    const fallbackShareTag = `${prefix}-${deterministicCode(phone, createdAt)}`;
    const snap = await get(ref(db, `shareTags/${fallbackShareTag}`));

    if (snap.exists() && snap.val()?.phone !== phone) {
      throw new Error('Não foi possível gerar uma shareTag única.');
    }

    return fallbackShareTag;
  }

  async function saveShareTagIndex(shareTag, phone) {
    await set(ref(db, `shareTags/${shareTag}`), { phone });
  }

  async function ensureSiteUserRecord(user) {
    const tag = normalizeSiteLoginTag(user.shareTag);

    if (!tag) {
      return null;
    }

    const siteUserPath = `grupos/${SITE_DEFAULT_GROUP}/usuarios/${tag}`;
    const snap = await get(ref(db, siteUserPath));
    const existing = snap.val() || {};
    const createdAt = existing.createdAt || user.createdAt || now();

    await set(ref(db, `${siteUserPath}/nome`), user.name || '');
    await set(ref(db, `${siteUserPath}/tag`), tag);
    await set(ref(db, `${siteUserPath}/phone`), user.phone || '');
    await set(ref(db, `${siteUserPath}/origem`), existing.origem || 'bot');
    await set(ref(db, `${siteUserPath}/createdAt`), createdAt);

    return {
      ...existing,
      nome: user.name || '',
      tag,
      phone: user.phone || '',
      origem: existing.origem || 'bot',
      createdAt,
    };
  }

  async function getOrCreateUserByPhone(phone, data = {}) {
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      throw new Error('Telefone obrigatório.');
    }

    const userRef = ref(db, `users/${cleanPhone}`);
    const snap = await get(userRef);
    const existingUser = snap.val();
    const timestamp = now();

    if (!existingUser) {
      const name = nonEmptyString(data.name) ? data.name.trim() : '';
      const email = nonEmptyString(data.email) ? normalizeEmail(data.email) : '';
      const shareTag = await createShareTag(cleanPhone, name, timestamp);
      const user = {
        phone: cleanPhone,
        name,
        email,
        shareTag,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await set(userRef, user);
      await saveShareTagIndex(shareTag, cleanPhone);
      await ensureSiteUserRecord(user);

      return user;
    }

    const user = {
      ...existingUser,
      phone: existingUser.phone || cleanPhone,
      updatedAt: timestamp,
    };

    if (nonEmptyString(data.name)) {
      user.name = data.name.trim();
    }

    if (nonEmptyString(data.email)) {
      user.email = normalizeEmail(data.email);
    }

    if (!user.shareTag) {
      user.shareTag = await createShareTag(cleanPhone, user.name, existingUser.createdAt || timestamp);
      await saveShareTagIndex(user.shareTag, cleanPhone);
    }

    await set(userRef, user);
    await ensureSiteUserRecord(user);

    return user;
  }

  async function getUserByShareTag(shareTag) {
    const cleanShareTag = String(shareTag || '').trim().toUpperCase();

    if (!cleanShareTag) {
      return null;
    }

    const tagSnap = await get(ref(db, `shareTags/${cleanShareTag}`));
    const phone = tagSnap.val()?.phone;

    if (!phone) {
      return null;
    }

    return await getUserByPhone(phone);
  }

  return {
    getOrCreateUserByPhone,
    getUserByPhone,
    getUserByShareTag,
  };
}

module.exports = {
  SHARE_TAG_CODE_CHARSET,
  SITE_DEFAULT_GROUP,
  createUserService,
  isValidEmail,
  normalizeEmail,
  normalizeSiteLoginTag,
};
