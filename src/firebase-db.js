'use strict';

const admin = require('firebase-admin');

function parseServiceAccount(value) {
  if (!value) {
    return null;
  }

  const serviceAccount = JSON.parse(value);

  if (serviceAccount.private_key) {
    serviceAccount.private_key = normalizePrivateKey(serviceAccount.private_key);
  }

  if (serviceAccount.privateKey) {
    serviceAccount.privateKey = normalizePrivateKey(serviceAccount.privateKey);
  }

  return serviceAccount;
}

function parseServiceAccountBase64(value) {
  if (!value) {
    return null;
  }

  return parseServiceAccount(Buffer.from(value, 'base64').toString('utf8'));
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function getServiceAccount(firebaseConfig) {
  const serviceAccountFromBase64 = parseServiceAccountBase64(firebaseConfig.serviceAccountBase64);

  if (serviceAccountFromBase64) {
    return serviceAccountFromBase64;
  }

  const serviceAccountFromJson = parseServiceAccount(firebaseConfig.serviceAccountJson);

  if (serviceAccountFromJson) {
    return serviceAccountFromJson;
  }

  if (firebaseConfig.projectId && firebaseConfig.clientEmail && firebaseConfig.privateKey) {
    return {
      projectId: firebaseConfig.projectId,
      clientEmail: firebaseConfig.clientEmail,
      privateKey: normalizePrivateKey(firebaseConfig.privateKey),
    };
  }

  return null;
}

function getCredential(firebaseConfig) {
  const serviceAccount = getServiceAccount(firebaseConfig);

  if (serviceAccount) {
    return admin.credential.cert(serviceAccount);
  }

  return admin.credential.applicationDefault();
}

function createFirebaseDb(firebaseConfig) {
  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
      credential: getCredential(firebaseConfig),
      databaseURL: firebaseConfig.databaseURL,
    });

  return app.database();
}

function ref(db, path) {
  return db.ref(path);
}

async function get(reference) {
  return await reference.once('value');
}

async function once(reference, eventType = 'value') {
  return await reference.once(eventType);
}

async function set(reference, value) {
  return await reference.set(value);
}

async function update(reference, value) {
  return await reference.update(value);
}

async function push(reference, value) {
  if (value === undefined) {
    return reference.push();
  }

  return await reference.push(value);
}

async function remove(reference) {
  return await reference.remove();
}

async function transaction(reference, updateFunction) {
  return await reference.transaction(updateFunction);
}

function getFirebaseOps() {
  return {
    get,
    once,
    push,
    ref,
    remove,
    set,
    transaction,
    update,
  };
}

module.exports = {
  createFirebaseDb,
  getFirebaseOps,
  get,
  once,
  push,
  ref,
  remove,
  set,
  transaction,
  update,
};
