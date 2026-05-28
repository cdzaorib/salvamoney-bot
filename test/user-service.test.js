'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHARE_TAG_CODE_CHARSET,
  createUserService,
  isValidEmail,
  normalizeEmail,
  normalizeSiteLoginTag,
} = require('../src/services/user-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

function createService({ seed = {}, now = () => '2026-05-25T12:00:00.000Z', randomBytes } = {}) {
  const firebase = createFakeFirebase(seed);

  const service = createUserService({
    db: {},
    firebaseOps: firebase.ops,
    now,
    randomBytes: randomBytes || (() => Buffer.from([0, 1, 2, 3, 4, 5])),
  });

  return {
    firebase,
    service,
  };
}

test('normalizeEmail trims and lowercases email values', () => {
  assert.equal(normalizeEmail('  ANA@Example.COM  '), 'ana@example.com');
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(undefined), '');
});

test('isValidEmail accepts simple valid email formats', () => {
  assert.equal(isValidEmail('ana@example.com'), true);
  assert.equal(isValidEmail(' ANA.SILVA+teste@sub.example.com '), true);
});

test('isValidEmail rejects invalid email formats', () => {
  assert.equal(isValidEmail('ana'), false);
  assert.equal(isValidEmail('ana@'), false);
  assert.equal(isValidEmail('@example.com'), false);
  assert.equal(isValidEmail('ana example@example.com'), false);
});

test('getOrCreateUserByPhone creates a user with a unique shareTag format and allowed charset', async () => {
  const { firebase, service } = createService();

  const user = await service.getOrCreateUserByPhone('55 (11) 99999-9999', {
    name: 'João Silva',
    email: '  JOAO@EXAMPLE.COM ',
  });

  assert.deepEqual(user, {
    phone: '5511999999999',
    name: 'João Silva',
    email: 'joao@example.com',
    shareTag: 'JOAO-ABCDEF',
    createdAt: '2026-05-25T12:00:00.000Z',
    updatedAt: '2026-05-25T12:00:00.000Z',
  });
  assert.match(user.shareTag, /^[A-Z0-9]+-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

  const code = user.shareTag.split('-')[1];

  assert.equal([...code].every((char) => SHARE_TAG_CODE_CHARSET.includes(char)), true);
  assert.equal(/[IO01]/.test(code), false);
});

test('getOrCreateUserByPhone creates the site login record for the generated tag', async () => {
  const { firebase, service } = createService();

  const user = await service.getOrCreateUserByPhone('55 (11) 99999-9999', {
    name: 'João Silva',
    email: 'joao@example.com',
  });

  assert.equal(user.shareTag, 'JOAO-ABCDEF');
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/joao-abcdef'), {
    nome: 'João Silva',
    tag: 'joao-abcdef',
    phone: '5511999999999',
    origem: 'bot',
    createdAt: '2026-05-25T12:00:00.000Z',
  });
});

test('normalizeSiteLoginTag removes @ and spaces, lowercases, and makes a Firebase key', () => {
  assert.equal(normalizeSiteLoginTag('@Tag'), 'tag');
  assert.equal(normalizeSiteLoginTag(' @Ta g '), 'tag');
  assert.equal(normalizeSiteLoginTag('@Ana.Silva#/[]'), 'ana-silva----');
});

test('site login record uses the normalized existing tag', async () => {
  const { firebase, service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Ana',
          email: 'ana@example.com',
          shareTag: '@Tag',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  });

  await service.getOrCreateUserByPhone('5511999999999');

  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/tag'), {
    nome: 'Ana',
    tag: 'tag',
    phone: '5511999999999',
    origem: 'bot',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

test('site login validation can find the normalized tag under SALVAMONEY', async () => {
  const { firebase, service } = createService();

  await service.getOrCreateUserByPhone('5511999999999', {
    name: 'Ana',
    email: 'ana@example.com',
  });

  const snap = await firebase.ops.get('grupos/SALVAMONEY/usuarios/ana-abcdef');

  assert.equal(snap.exists(), true);
  assert.equal(snap.val().tag, 'ana-abcdef');
});

test('site login record does not overwrite existing financial data', async () => {
  const { firebase, service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Ana',
          email: 'ana@example.com',
          shareTag: 'ANA-ABCDEF',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      grupos: {
        SALVAMONEY: {
          usuarios: {
            'ana-abcdef': {
              gastos: {
                '2026_4': {
                  gasto_1: {
                    desc: 'Mercado',
                    value: 120,
                  },
                },
              },
              fixos: {
                fixo_1: {
                  desc: 'Internet',
                  value: 100,
                },
              },
            },
          },
        },
      },
    },
  });

  await service.getOrCreateUserByPhone('5511999999999');

  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/ana-abcdef/gastos'), {
    '2026_4': {
      gasto_1: {
        desc: 'Mercado',
        value: 120,
      },
    },
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/ana-abcdef/fixos'), {
    fixo_1: {
      desc: 'Internet',
      value: 100,
    },
  });
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/ana-abcdef/tag'), 'ana-abcdef');
});

test('shareTags index contains only the phone field', async () => {
  const { firebase, service } = createService();

  const user = await service.getOrCreateUserByPhone('5511999999999', {
    name: 'Anna',
    email: 'anna@example.com',
  });

  assert.deepEqual(firebase.getValue(`shareTags/${user.shareTag}`), {
    phone: '5511999999999',
  });
});

test('getOrCreateUserByPhone preserves existing shareTag and createdAt', async () => {
  const { firebase, service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Ana',
          email: 'ana@example.com',
          shareTag: 'ANA-234567',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
    now: () => '2026-05-25T12:00:00.000Z',
    randomBytes: () => {
      throw new Error('shareTag should not be regenerated');
    },
  });

  const user = await service.getOrCreateUserByPhone('5511999999999', {
    name: 'Ana Maria',
    email: 'ANA.MARIA@EXAMPLE.COM',
  });

  assert.equal(user.shareTag, 'ANA-234567');
  assert.equal(user.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(user.updatedAt, '2026-05-25T12:00:00.000Z');
  assert.equal(user.name, 'Ana Maria');
  assert.equal(user.email, 'ana.maria@example.com');
  assert.deepEqual(firebase.getValue('shareTags/ANA-234567'), undefined);
});

test('getOrCreateUserByPhone ignores undefined and empty name or email updates', async () => {
  const { service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Carlos',
          email: 'carlos@example.com',
          shareTag: 'CARLOS-234567',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  });

  const user = await service.getOrCreateUserByPhone('5511999999999', {
    name: '',
    email: '   ',
  });

  assert.equal(user.name, 'Carlos');
  assert.equal(user.email, 'carlos@example.com');

  const sameUser = await service.getOrCreateUserByPhone('5511999999999', {});

  assert.equal(sameUser.name, 'Carlos');
  assert.equal(sameUser.email, 'carlos@example.com');
});

test('getUserByShareTag reads shareTags first and then users by phone', async () => {
  const firebase = createFakeFirebase({
    shareTags: {
      'ANA-ABCDEF': {
        phone: '5511999999999',
      },
    },
    users: {
      5511999999999: {
        phone: '5511999999999',
        name: 'Ana',
        email: 'ana@example.com',
        shareTag: 'ANA-ABCDEF',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  });
  const getPaths = [];
  const service = createUserService({
    db: {},
    firebaseOps: {
      ...firebase.ops,
      get: async (path) => {
        getPaths.push(path);
        return await firebase.ops.get(path);
      },
    },
  });

  const user = await service.getUserByShareTag('ana-abcdef');

  assert.equal(user.phone, '5511999999999');
  assert.deepEqual(getPaths, [
    'shareTags/ANA-ABCDEF',
    'users/5511999999999',
  ]);
});
