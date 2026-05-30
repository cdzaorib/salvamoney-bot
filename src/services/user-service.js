'use strict';

const crypto = require('node:crypto');
const { getFirebaseOps } = require('../firebase-db');

const DEFAULT_GROUP = 'SALVAMONEY';
const ACCESS_TAG_ATTEMPTS = 30;

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

function normalizeAccessTag(tag) {
  const cleanTag = String(tag || '').replace(/\D/g, '');

  return /^\d{6}$/.test(cleanTag) ? cleanTag : '';
}

function randomAccessTag(randomInt) {
  return String(randomInt(100000, 1000000));
}

function createUserService({
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
  randomInt = crypto.randomInt,
} = {}) {
  const { get, ref, set, update } = firebaseOps || getFirebaseOps();

  async function safeUpdate(path, value) {
    if (typeof update === 'function') {
      await update(ref(db, path), value);

      return;
    }

    await Promise.all(
      Object.entries(value).map(([key, fieldValue]) => set(ref(db, `${path}/${key}`), fieldValue))
    );
  }

  async function getUserByPhone(phone) {
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      return null;
    }

    const snap = await get(ref(db, `users/${cleanPhone}`));

    return snap.val();
  }

  async function accessTagExists(tag) {
    const cleanTag = normalizeAccessTag(tag);

    if (!cleanTag) {
      return false;
    }

    const [shareTagSnap, userSnap] = await Promise.all([
      get(ref(db, `shareTags/${cleanTag}`)),
      get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${cleanTag}`)),
    ]);

    return shareTagSnap.exists() || userSnap.exists();
  }

  async function generateAccessTag() {
    for (let attempt = 0; attempt < ACCESS_TAG_ATTEMPTS; attempt++) {
      const tag = randomAccessTag(randomInt);

      if (!(await accessTagExists(tag))) {
        return tag;
      }
    }

    throw new Error('Não foi possível gerar uma tag de acesso agora.');
  }

  async function saveShareTagIndex(tag, phone) {
    await safeUpdate(`shareTags/${tag}`, { phone });
  }

  async function ensureSiteUserRecord(user) {
    const tag = normalizeAccessTag(user.tag || user.shareTag);

    if (!tag) {
      return null;
    }

    const siteUserPath = `grupos/${DEFAULT_GROUP}/usuarios/${tag}`;
    const snap = await get(ref(db, siteUserPath));
    const existing = snap.val() || {};
    const createdAt = existing.createdAt || user.createdAt || now();
    const updatedAt = user.updatedAt || now();
    const name = user.name || user.nome || existing.nome || '';
    const phone = user.phone || existing.phone || '';
    const profileUpdate = {
      nome: name,
      tag,
      phone,
      origem: existing.origem || 'bot',
      updatedAt,
    };

    if (!existing.createdAt) {
      profileUpdate.createdAt = createdAt;
    }

    await safeUpdate(siteUserPath, profileUpdate);

    return {
      ...existing,
      nome: name,
      tag,
      phone,
      origem: existing.origem || 'bot',
      createdAt,
      updatedAt,
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
      const tag = await generateAccessTag();
      const user = {
        phone: cleanPhone,
        name,
        email,
        tag,
        shareTag: tag,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await safeUpdate(`users/${cleanPhone}`, user);
      await saveShareTagIndex(tag, cleanPhone);
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

    const existingTag = normalizeAccessTag(user.tag || user.shareTag);

    if (!existingTag) {
      user.tag = await generateAccessTag();
      user.shareTag = user.tag;
      await saveShareTagIndex(user.tag, cleanPhone);
    } else {
      user.tag = existingTag;
      user.shareTag = existingTag;
      await saveShareTagIndex(existingTag, cleanPhone);
    }

    await safeUpdate(`users/${cleanPhone}`, user);
    await ensureSiteUserRecord(user);

    return user;
  }

  async function getUserByShareTag(shareTag) {
    return await getUserByAccessTag(shareTag);
  }

  async function getUserByAccessTag(tag) {
    const cleanTag = normalizeAccessTag(tag);

    if (!cleanTag) {
      return null;
    }

    const tagSnap = await get(ref(db, `shareTags/${cleanTag}`));
    const phone = tagSnap.val()?.phone;

    if (phone) {
      const user = await getUserByPhone(phone);

      if (user) {
        return {
          ...user,
          phone,
          tag: normalizeAccessTag(user.tag || user.shareTag) || cleanTag,
          shareTag: normalizeAccessTag(user.tag || user.shareTag) || cleanTag,
        };
      }
    }

    const userSnap = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${cleanTag}`));
    const siteUser = userSnap.val();

    if (!siteUser) {
      return null;
    }

    return {
      phone: siteUser.phone || phone || '',
      name: siteUser.nome || siteUser.name || '',
      tag: cleanTag,
      shareTag: cleanTag,
      createdAt: siteUser.createdAt || '',
    };
  }

  return {
    generateAccessTag,
    getUserByAccessTag,
    getOrCreateUserByPhone,
    getUserByPhone,
    getUserByShareTag,
  };
}

module.exports = {
  DEFAULT_GROUP,
  createUserService,
  normalizeAccessTag,
  isValidEmail,
  normalizeEmail,
};
