'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_GROUP,
  createUserService,
  isValidEmail,
  normalizeAccessTag,
  normalizeEmail,
} = require('../src/services/user-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

function createRandomIntSequence(values) {
  let index = 0;

  return () => values[index++] || values[values.length - 1];
}

function createService({
  seed = {},
  now = () => '2026-05-25T12:00:00.000Z',
  randomInt = createRandomIntSequence([482913]),
} = {}) {
  const firebase = createFakeFirebase(seed);

  const service = createUserService({
    db: {},
    firebaseOps: firebase.ops,
    now,
    randomInt,
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

test('normalizeAccessTag keeps exactly six digits after removing non-numeric chars', () => {
  assert.equal(normalizeAccessTag('482913'), '482913');
  assert.equal(normalizeAccessTag(' 482 913 '), '482913');
  assert.equal(normalizeAccessTag('@482-913'), '482913');
  assert.equal(normalizeAccessTag('48291'), '');
  assert.equal(normalizeAccessTag('4829137'), '');
});

test('getOrCreateUserByPhone creates a user with a six digit access tag', async () => {
  const { service } = createService();

  const user = await service.getOrCreateUserByPhone('55 (11) 99999-9999', {
    name: 'João Silva',
    email: '  JOAO@EXAMPLE.COM ',
  });

  assert.deepEqual(user, {
    phone: '5511999999999',
    name: 'João Silva',
    email: 'joao@example.com',
    tag: '482913',
    shareTag: '482913',
    createdAt: '2026-05-25T12:00:00.000Z',
    updatedAt: '2026-05-25T12:00:00.000Z',
  });
});

test('generateAccessTag skips tags that already exist in shareTags or SALVAMONEY users', async () => {
  const { service } = createService({
    randomInt: createRandomIntSequence([111111, 222222, 333333]),
    seed: {
      shareTags: {
        111111: {
          phone: '5511888888888',
        },
      },
      grupos: {
        [DEFAULT_GROUP]: {
          usuarios: {
            222222: {
              nome: 'Outra pessoa',
            },
          },
        },
      },
    },
  });

  assert.equal(await service.generateAccessTag(), '333333');
});

test('getOrCreateUserByPhone creates the site login record for the generated tag', async () => {
  const { firebase, service } = createService();

  const user = await service.getOrCreateUserByPhone('55 (11) 99999-9999', {
    name: 'João Silva',
    email: 'joao@example.com',
  });

  assert.equal(user.tag, '482913');
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913'), {
    nome: 'João Silva',
    tag: '482913',
    phone: '5511999999999',
    origem: 'bot',
    createdAt: '2026-05-25T12:00:00.000Z',
    updatedAt: '2026-05-25T12:00:00.000Z',
  });
});

test('site login validation can find the numeric tag under SALVAMONEY', async () => {
  const { firebase, service } = createService();

  await service.getOrCreateUserByPhone('5511999999999', {
    name: 'Ana',
    email: 'ana@example.com',
  });

  const snap = await firebase.ops.get('grupos/SALVAMONEY/usuarios/482913');

  assert.equal(snap.exists(), true);
  assert.equal(snap.val().tag, '482913');
});

test('site login record does not overwrite existing financial data', async () => {
  const { firebase, service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Ana',
          email: 'ana@example.com',
          tag: '482913',
          shareTag: '482913',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
              createdAt: '2026-01-01T00:00:00.000Z',
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
              limites: {
                alimentacao: 800,
              },
              meta: {
                desc: 'Reserva',
                value: 1000,
              },
              orcamento: {
                mensal: 3000,
              },
              parcelamentos: {
                tv: {
                  parcelas: 3,
                },
              },
            },
          },
        },
      },
    },
  });

  await service.getOrCreateUserByPhone('5511999999999');

  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/gastos'), {
    '2026_4': {
      gasto_1: {
        desc: 'Mercado',
        value: 120,
      },
    },
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos'), {
    fixo_1: {
      desc: 'Internet',
      value: 100,
    },
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/orcamento'), {
    mensal: 3000,
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/limites'), {
    alimentacao: 800,
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/meta'), {
    desc: 'Reserva',
    value: 1000,
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/parcelamentos'), {
    tv: {
      parcelas: 3,
    },
  });
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/createdAt'), '2026-01-01T00:00:00.000Z');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/updatedAt'), '2026-05-25T12:00:00.000Z');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/tag'), '482913');
  assert.equal(firebase.sets.some((write) => write.path === 'grupos/SALVAMONEY/usuarios/482913'), false);
});

test('shareTags index contains only the phone field', async () => {
  const { firebase, service } = createService();

  const user = await service.getOrCreateUserByPhone('5511999999999', {
    name: 'Anna',
    email: 'anna@example.com',
  });

  assert.deepEqual(firebase.getValue(`shareTags/${user.tag}`), {
    phone: '5511999999999',
  });
});

test('getOrCreateUserByPhone preserves existing numeric tag and createdAt', async () => {
  const { firebase, service } = createService({
    randomInt: () => {
      throw new Error('tag should not be regenerated');
    },
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Ana',
          email: 'ana@example.com',
          tag: '482913',
          shareTag: '482913',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
    now: () => '2026-05-25T12:00:00.000Z',
  });

  const user = await service.getOrCreateUserByPhone('5511999999999', {
    name: 'Ana Maria',
    email: 'ANA.MARIA@EXAMPLE.COM',
  });

  assert.equal(user.tag, '482913');
  assert.equal(user.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(user.updatedAt, '2026-05-25T12:00:00.000Z');
  assert.equal(user.name, 'Ana Maria');
  assert.equal(user.email, 'ana.maria@example.com');
  assert.deepEqual(firebase.getValue('shareTags/482913'), { phone: '5511999999999' });
});

test('getOrCreateUserByPhone replaces legacy non-numeric shareTag with a numeric tag', async () => {
  const { service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Carlos',
          email: 'carlos@example.com',
          shareTag: 'CARLOS-ABCDEF',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  });

  const user = await service.getOrCreateUserByPhone('5511999999999');

  assert.equal(user.tag, '482913');
  assert.equal(user.shareTag, '482913');
});

test('getOrCreateUserByPhone ignores undefined and empty name or email updates', async () => {
  const { service } = createService({
    seed: {
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Carlos',
          email: 'carlos@example.com',
          tag: '482913',
          shareTag: '482913',
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

test('getUserByAccessTag reads shareTags first and then users by phone', async () => {
  const firebase = createFakeFirebase({
    shareTags: {
      482913: {
        phone: '5511999999999',
      },
    },
    users: {
      5511999999999: {
        phone: '5511999999999',
        name: 'Ana',
        email: 'ana@example.com',
        tag: '482913',
        shareTag: '482913',
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

  const user = await service.getUserByAccessTag('482 913');

  assert.equal(user.phone, '5511999999999');
  assert.deepEqual(getPaths, [
    'shareTags/482913',
    'users/5511999999999',
  ]);
});
