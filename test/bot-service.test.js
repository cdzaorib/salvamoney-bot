'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotService } = require('../src/bot-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const config = {
  groqApiKey: '',
  monthIndexMode: 'zero',
  siteUrl: 'https://site.example/',
  timeZone: 'UTC',
};

const safeLog = {
  logMediaUrl: (value) => value,
  logText: (value) => value,
  maskPhone: (value) => value,
};

const groq = {
  analisarImagem: async () => {
    throw new Error('vision should not run in characterization tests');
  },
  baixarMediaComoBase64: async () => {
    throw new Error('media download should not run in characterization tests');
  },
  chamarIA: async () => {
    throw new Error('AI should not run in characterization tests');
  },
  transcreverAudio: async () => {
    throw new Error('audio should not run in characterization tests');
  },
};

function utcDateParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

function currentMonthKey() {
  const parts = utcDateParts();

  return `${parts.year}_${Number(parts.month) - 1}`;
}

function monthKeyOffset(offset) {
  const parts = utcDateParts();
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1 + offset, Number(parts.day)));
  const offsetParts = utcDateParts(date);

  return `${offsetParts.year}_${Number(offsetParts.month) - 1}`;
}

function todayIso() {
  const parts = utcDateParts();

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function expenseSeed(expenses = {}) {
  return {
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              [currentMonthKey()]: expenses,
            },
          },
        },
      },
    },
  };
}

function deleteSelectionSeed() {
  return expenseSeed({
    mercado_1: {
      cat: 'Alimentação',
      createdAt: '2026-05-20T10:00:00.000Z',
      date: todayIso(),
      desc: 'Mercado',
      value: 50,
    },
    mercado_2: {
      cat: 'Alimentação',
      createdAt: '2026-05-20T11:00:00.000Z',
      date: todayIso(),
      desc: 'Mercado extra',
      value: 75,
    },
    tv_1: {
      cat: 'Lazer',
      createdAt: '2026-05-20T12:00:00.000Z',
      date: todayIso(),
      desc: 'TV (1/3x)',
      parcelaId: 'tv-123',
      parcelaNum: 1,
      parcelaTotal: 3,
      value: 400,
    },
    uber_1: {
      cat: 'Transporte',
      createdAt: '2026-05-20T09:00:00.000Z',
      date: todayIso(),
      desc: 'Uber',
      value: 20,
    },
  });
}

function installmentDeleteSeed() {
  return {
    grupos: {
      CASA2024: {
        usuarios: {
          Ana: {
            gastos: {
              [monthKeyOffset(0)]: {
                tv_1: {
                  cat: 'Lazer',
                  createdAt: '2026-05-20T12:00:00.000Z',
                  date: todayIso(),
                  desc: 'TV (1/3x)',
                  parcelaId: 'tv-123',
                  parcelaNum: 1,
                  parcelaTotal: 3,
                  value: 400,
                },
                tv_sala_1: {
                  cat: 'Lazer',
                  createdAt: '2026-05-20T11:00:00.000Z',
                  date: todayIso(),
                  desc: 'TV sala (1/2x)',
                  parcelaId: 'tv-456',
                  parcelaNum: 1,
                  parcelaTotal: 2,
                  value: 300,
                },
                tv_normal: {
                  cat: 'Lazer',
                  createdAt: '2026-05-20T10:00:00.000Z',
                  date: todayIso(),
                  desc: 'TV',
                  value: 1200,
                },
              },
              [monthKeyOffset(1)]: {
                tv_2: {
                  cat: 'Lazer',
                  createdAt: '2026-05-20T12:00:00.000Z',
                  desc: 'TV (2/3x)',
                  parcelaId: 'tv-123',
                  parcelaNum: 2,
                  parcelaTotal: 3,
                  value: 400,
                },
                tv_sala_2: {
                  cat: 'Lazer',
                  createdAt: '2026-05-20T11:00:00.000Z',
                  desc: 'TV sala (2/2x)',
                  parcelaId: 'tv-456',
                  parcelaNum: 2,
                  parcelaTotal: 2,
                  value: 300,
                },
                notebook_1: {
                  cat: 'Educação',
                  createdAt: '2026-05-20T09:00:00.000Z',
                  desc: 'Notebook (1/2x)',
                  parcelaId: 'note-999',
                  parcelaNum: 1,
                  parcelaTotal: 2,
                  value: 500,
                },
              },
              [monthKeyOffset(2)]: {
                tv_3: {
                  cat: 'Lazer',
                  createdAt: '2026-05-20T12:00:00.000Z',
                  desc: 'TV (3/3x)',
                  parcelaId: 'tv-123',
                  parcelaNum: 3,
                  parcelaTotal: 3,
                  value: 400,
                },
              },
            },
          },
        },
      },
    },
    transactionsByUser: {
      5511999999999: {
        [monthKeyOffset(0)]: {
          tv_1: {
            desc: 'TV (1/3x)',
            parcelaId: 'tv-123',
            value: 400,
          },
          tv_sala_1: {
            desc: 'TV sala (1/2x)',
            parcelaId: 'tv-456',
            value: 300,
          },
        },
        [monthKeyOffset(1)]: {
          tv_2: {
            desc: 'TV (2/3x)',
            parcelaId: 'tv-123',
            value: 400,
          },
          tv_sala_2: {
            desc: 'TV sala (2/2x)',
            parcelaId: 'tv-456',
            value: 300,
          },
        },
        [monthKeyOffset(2)]: {
          tv_3: {
            desc: 'TV (3/3x)',
            parcelaId: 'tv-123',
            value: 400,
          },
        },
      },
    },
  };
}

function createService({
  configOverrides = {},
  groqOverrides = {},
  seed = {},
  session = null,
  userService,
} = {}) {
  const firebase = createFakeFirebase(seed);
  const savedSessions = [];
  const sessionStore = {
    getSession: async () => session,
    saveSession: async (phone, data) => {
      savedSessions.push({ phone, data });
    },
  };
  const service = createBotService({
    config: {
      ...config,
      ...configOverrides,
    },
    db: {},
    firebaseOps: firebase.ops,
    groq: {
      ...groq,
      ...groqOverrides,
    },
    safeLog,
    sessionStore,
    userService,
  });

  return {
    firebase,
    savedSessions,
    service,
  };
}

function createStatefulService({
  configOverrides = {},
  groqOverrides = {},
  initialSession = null,
  seed = {},
  userService,
} = {}) {
  const firebase = createFakeFirebase(seed);
  const savedSessions = [];
  let session = initialSession;
  const sessionStore = {
    getSession: async () => session,
    saveSession: async (phone, data) => {
      session = data;
      savedSessions.push({ phone, data });
    },
  };
  const service = createBotService({
    config: {
      ...config,
      ...configOverrides,
    },
    db: {},
    firebaseOps: firebase.ops,
    groq: {
      ...groq,
      ...groqOverrides,
    },
    safeLog,
    sessionStore,
    userService,
  });

  return {
    firebase,
    getSession: () => session,
    savedSessions,
    service,
  };
}

function firstNameTag(name) {
  const firstName = String(name || '')
    .trim()
    .split(/\s+/)[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') || 'USUARIO';

  return `${firstName}-8K2P7Q`;
}

function createSignupUserService(initialUsers = {}) {
  const calls = [];
  const users = new Map(Object.entries(initialUsers));
  const service = {
    calls,
    users,
    async getUserByPhone(phone) {
      calls.push({ method: 'getUserByPhone', phone });

      return users.get(phone) || null;
    },
    async getOrCreateUserByPhone(phone, data) {
      calls.push({ method: 'getOrCreateUserByPhone', data, phone });

      const existingUser = users.get(phone);

      if (existingUser) {
        return existingUser;
      }

      const user = {
        phone,
        name: data.name,
        email: data.email,
        shareTag: firstNameTag(data.name),
      };

      users.set(phone, user);

      return user;
    },
    async getUserByShareTag(shareTag) {
      calls.push({ method: 'getUserByShareTag', shareTag });

      return Array.from(users.values()).find(
        (user) => String(user.shareTag || '').toUpperCase() === shareTag
      ) || null;
    },
  };

  return service;
}

const MINHA_TAG_PHRASES = [
  'minha tag',
  'qual minha tag',
  'qual é minha tag',
  'qual é a minha tag',
  'ver minha tag',
  'mostrar minha tag',
  'minha tag?',
];

test('oi returns help without external services', async () => {
  const { service } = createService();
  const resposta = await service.processarMensagem('5511999999999', 'oi');

  assert.match(resposta, /SalvaMoney Bot/);
  assert.match(resposta, /Você ainda não vinculou uma conta/);
});

test('criar codigo without name returns current instructions', async () => {
  const { service } = createService();
  const resposta = await service.processarMensagem('5511999999999', 'criar codigo');

  assert.match(resposta, /Criar código do SalvaMoney/);
  assert.match(resposta, /criar código SEU NOME/);
});

test('entrar links an account without a previous session', async () => {
  const { savedSessions, service } = createService({
    seed: expenseSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'entrar Ana CASA2024');

  assert.match(resposta, /Pronto!/);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      user: 'Ana',
      group: 'CASA2024',
      updatedAt: todayIso(),
    },
  }]);
});

test('trocar conta links the phone to the requested account', async () => {
  const { savedSessions, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'trocar conta Ana CASA2024');

  assert.match(resposta, /Conta trocada/);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      user: 'Ana',
      group: 'CASA2024',
      updatedAt: todayIso(),
    },
  }]);
});

test('criar conta starts the WhatsApp signup flow', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({ userService });
  const resposta = await service.processarMensagem('5511999999999', 'criar conta');

  assert.equal(resposta, [
    'Vamos criar sua conta no SalvaMoney.',
    'Qual é o seu nome?',
  ].join('\n'));
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      signupStep: 'signup_ask_name',
      pendingName: null,
      pendingEmail: null,
    },
  }]);
});

test('signup flow stores the name temporarily before asking for email', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: { signupStep: 'signup_ask_name' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'Anna');

  assert.equal(resposta, 'Agora me envie seu e-mail.');
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      signupStep: 'signup_ask_email',
      pendingName: 'Anna',
      pendingEmail: null,
    },
  }]);
});

test('signup flow rejects invalid email without saving progress', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: {
      signupStep: 'signup_ask_email',
      pendingName: 'Anna',
    },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'email-invalido');

  assert.equal(resposta, [
    'Esse e-mail parece inválido.',
    'Envie novamente um e-mail válido.',
  ].join('\n'));
  assert.deepEqual(savedSessions, []);
});

test('signup flow normalizes a valid email and asks for confirmation', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: {
      signupStep: 'signup_ask_email',
      pendingName: 'Anna',
    },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', '  ANNA@EMAIL.COM  ');

  assert.equal(resposta, [
    'Confirma seus dados?',
    '',
    'Nome: Anna',
    'E-mail: anna@email.com',
    '',
    'Responda:',
    '1 - Confirmar',
    '2 - Corrigir',
  ].join('\n'));
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      signupStep: 'signup_confirm',
      pendingName: 'Anna',
      pendingEmail: 'anna@email.com',
    },
  }]);
});

test('signup flow creates the user when confirmation is accepted', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: {
      signupStep: 'signup_confirm',
      pendingName: 'Anna',
      pendingEmail: 'anna@email.com',
    },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', '1');

  assert.equal(resposta, [
    'Seja bem-vinda, Anna!',
    '',
    'Sua tag no SalvaMoney é: ANNA-8K2P7Q',
    '',
    'Compartilhe essa tag com outras pessoas para dividir gastos e organizar contas.',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getOrCreateUserByPhone',
    phone: '5511999999999',
    data: {
      name: 'Anna',
      email: 'anna@email.com',
    },
  }]);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: null,
  }]);
});

test('signup cancellation clears only temporary signup fields', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: {
      group: 'CASA2024',
      pendingEmail: null,
      pendingName: 'Anna',
      signupStep: 'signup_ask_email',
      user: 'Ana',
    },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'cancelar');

  assert.equal(resposta, 'Cadastro cancelado. Quando quiser, envie "criar conta" novamente.');
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'CASA2024',
      user: 'Ana',
    },
  }]);
});

test('sair da conta logs out from the current session and preserves persisted records', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: {
      grupos: {
        CASA2024: {
          usuarios: {
            Ana: {
              gastos: {
                [currentMonthKey()]: {
                  gasto_1: {
                    cat: 'Transporte',
                    desc: 'uber',
                    value: 35,
                  },
                },
              },
            },
          },
        },
      },
      shareTags: {
        'ANNA-8K2P7Q': {
          phone: '5511999999999',
        },
      },
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Anna',
          email: 'anna@email.com',
          shareTag: 'ANNA-8K2P7Q',
        },
      },
    },
    session: {
      group: 'CASA2024',
      lastSeen: '2026-05-25',
      pendingEmail: 'anna@email.com',
      pendingName: 'Anna',
      signupStep: 'signup_confirm',
      user: 'Ana',
    },
  });
  const resposta = await service.processarMensagem('5511999999999', 'sair da conta');

  assert.equal(resposta, [
    'Você saiu da sua conta atual.',
    '',
    'Seu cadastro, sua tag e seus gastos foram preservados.',
    '',
    'Para entrar novamente, envie:',
    'entrar SEU_NOME SEU_GRUPO',
  ].join('\n'));
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      lastSeen: '2026-05-25',
    },
  }]);
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(firebase.getValue('users/5511999999999'), {
    phone: '5511999999999',
    name: 'Anna',
    email: 'anna@email.com',
    shareTag: 'ANNA-8K2P7Q',
  });
  assert.deepEqual(firebase.getValue('shareTags/ANNA-8K2P7Q'), {
    phone: '5511999999999',
  });
  assert.deepEqual(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/gasto_1`), {
    cat: 'Transporte',
    desc: 'uber',
    value: 35,
  });
});

test('signup correction restarts from the name step', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: {
      signupStep: 'signup_confirm',
      pendingName: 'Anna',
      pendingEmail: 'anna@email.com',
    },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', '2');

  assert.equal(resposta, [
    'Tudo bem. Vamos começar de novo.',
    'Qual é o seu nome?',
  ].join('\n'));
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      signupStep: 'signup_ask_name',
      pendingName: null,
      pendingEmail: null,
    },
  }]);
});

test('criar conta for an existing user does not create a new shareTag', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { savedSessions, service } = createService({ userService });
  const resposta = await service.processarMensagem('5511999999999', 'criar conta');

  assert.match(resposta, /Você já possui uma conta no SalvaMoney/);
  assert.match(resposta, /Nome: Anna/);
  assert.match(resposta, /E-mail: anna@email.com/);
  assert.match(resposta, /Sua tag: ANNA-8K2P7Q/);
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }]);
  assert.deepEqual(savedSessions, []);
});

test('minha tag returns the existing public shareTag', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'minha tag');

  assert.equal(resposta, [
    'Sua tag no SalvaMoney é: ANNA-8K2P7Q',
    '',
    'Compartilhe essa tag com outras pessoas para dividir gastos e organizar contas.',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }]);
  assert.equal(firebase.pushes.length, 0);
});

test('natural minha tag phrases return users phone shareTag and never session user', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'carlos' },
    userService,
  });

  for (const phrase of MINHA_TAG_PHRASES) {
    const resposta = await service.processarMensagem('5511999999999', phrase);

    assert.equal(resposta, [
      'Sua tag no SalvaMoney é: ANNA-8K2P7Q',
      '',
      'Compartilhe essa tag com outras pessoas para dividir gastos e organizar contas.',
    ].join('\n'), phrase);
    assert.doesNotMatch(resposta, /carlos/i, phrase);
  }

  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(userService.calls, MINHA_TAG_PHRASES.map(() => ({
    method: 'getUserByPhone',
    phone: '5511999999999',
  })));
});

test('minha tag without user asks to create an account', async () => {
  const userService = createSignupUserService();
  const { firebase, savedSessions, service } = createService({
    seed: expenseSeed(),
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'minha tag');

  assert.equal(resposta, [
    'Você ainda não criou sua conta no SalvaMoney.',
    '',
    'Para criar, envie:',
    'criar conta',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(savedSessions, []);
});

test('natural minha tag phrase without user asks to create an account', async () => {
  const userService = createSignupUserService();
  const { firebase, savedSessions, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'carlos' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'qual minha tag');

  assert.equal(resposta, [
    'Você ainda não criou sua conta no SalvaMoney.',
    '',
    'Para criar, envie:',
    'criar conta',
  ].join('\n'));
  assert.doesNotMatch(resposta, /carlos/i);
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(savedSessions, []);
});

test('meu perfil returns the existing user profile', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'meu perfil');

  assert.equal(resposta, [
    'Seu perfil no SalvaMoney:',
    '',
    'Nome: Anna',
    'E-mail: anna@email.com',
    'Tag: ANNA-8K2P7Q',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }]);
  assert.equal(firebase.pushes.length, 0);
});

test('meu perfil without user asks to create an account', async () => {
  const userService = createSignupUserService();
  const { firebase, savedSessions, service } = createService({
    seed: expenseSeed(),
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'meu perfil');

  assert.equal(resposta, [
    'Você ainda não criou sua conta no SalvaMoney.',
    '',
    'Para criar, envie:',
    'criar conta',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(savedSessions, []);
});

test('profile lookup commands do not register expenses', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });

  await service.processarMensagem('5511999999999', 'minha tag');
  await service.processarMensagem('5511999999999', 'meu perfil');

  assert.equal(firebase.pushes.length, 0);
});

test('buscar tag returns a public user match without exposing phone or email', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });
  const resposta = await service.processarMensagem('5511888888888', 'buscar tag anna-8k2p7q');

  assert.equal(resposta, [
    'Encontrei:',
    '',
    'Nome: Anna',
    'Tag: ANNA-8K2P7Q',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByShareTag',
    shareTag: 'ANNA-8K2P7Q',
  }]);
  assert.doesNotMatch(resposta, /5511999999999/);
  assert.doesNotMatch(resposta, /anna@email\.com/);
  assert.equal(firebase.pushes.length, 0);
});

test('buscar tag returns not found when shareTag does not exist', async () => {
  const userService = createSignupUserService();
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });
  const resposta = await service.processarMensagem('5511888888888', 'buscar tag NAO-8K2P7Q');

  assert.equal(resposta, [
    'Não encontrei ninguém com essa tag.',
    '',
    'Confira se digitou corretamente.',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByShareTag',
    shareTag: 'NAO-8K2P7Q',
  }]);
  assert.equal(firebase.pushes.length, 0);
});

test('buscar tag without shareTag asks for the tag', async () => {
  const userService = createSignupUserService();
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });
  const resposta = await service.processarMensagem('5511888888888', 'buscar tag');

  assert.equal(resposta, [
    'Envie a tag que deseja buscar.',
    '',
    'Exemplo:',
    'buscar tag ANNA-8K2P7Q',
  ].join('\n'));
  assert.deepEqual(userService.calls, []);
  assert.equal(firebase.pushes.length, 0);
});

test('procurar tag and encontrar tag work as aliases', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });
  const procurar = await service.processarMensagem('5511888888888', 'procurar tag ANNA-8K2P7Q');
  const encontrar = await service.processarMensagem('5511888888888', 'encontrar tag ANNA-8K2P7Q');

  assert.match(procurar, /Encontrei/);
  assert.match(encontrar, /Encontrei/);
  assert.deepEqual(userService.calls, [
    {
      method: 'getUserByShareTag',
      shareTag: 'ANNA-8K2P7Q',
    },
    {
      method: 'getUserByShareTag',
      shareTag: 'ANNA-8K2P7Q',
    },
  ]);
  assert.equal(firebase.pushes.length, 0);
});

test('buscar tag command does not register expenses', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: 'ANNA-8K2P7Q',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
    userService,
  });

  await service.processarMensagem('5511888888888', 'buscar tag ANNA-8K2P7Q');

  assert.equal(firebase.pushes.length, 0);
});

test('signup flow keeps normal expense parsing inactive while waiting for user data', async () => {
  const userService = createSignupUserService();
  const { firebase, service } = createStatefulService({
    initialSession: { signupStep: 'signup_ask_name' },
    seed: expenseSeed(),
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', '35 uber');

  assert.equal(resposta, 'Agora me envie seu e-mail.');
  assert.equal(firebase.pushes.length, 0);
});

test('normal text expense still works when signup is not active', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', '35 uber');

  assert.match(resposta, /uber/);
  assert.match(resposta, /registrado/);
  assert.equal(firebase.pushes.length, 1);
  assert.match(firebase.pushes[0].path, /grupos\/CASA2024\/usuarios\/Ana\/gastos\//);
  assert.equal(firebase.pushes[0].value.origem, 'texto');
  assert.deepEqual(firebase.sets, [{
    path: `transactionsByUser/5511999999999/${currentMonthKey()}/push_1`,
    value: {
      ...firebase.pushes[0].value,
      legacyGroup: 'CASA2024',
      legacyUser: 'Ana',
      legacyExpenseId: 'push_1',
      migrated: false,
      sourcePath: `${firebase.pushes[0].path}/push_1`,
    },
  }]);
});

test('normal text expense asks to link an account after sair da conta', async () => {
  const { firebase, service } = createStatefulService({
    initialSession: { group: 'CASA2024', user: 'Ana' },
    seed: expenseSeed(),
  });
  const logout = await service.processarMensagem('5511999999999', 'sair da conta');
  const resposta = await service.processarMensagem('5511999999999', '35 uber');

  assert.match(logout, /Você saiu da sua conta atual/);
  assert.match(resposta, /Para usar o SalvaMoney, primeiro vincule sua conta/);
  assert.equal(firebase.pushes.length, 0);
});

test('resumo summarizes the current month session expenses', async () => {
  const { service } = createService({
    seed: {
      ...expenseSeed({
        gasto_1: {
          cat: 'Alimentação',
          createdAt: '2026-05-20T10:00:00.000Z',
          desc: 'almoco',
          value: 35,
        },
        gasto_2: {
          cat: 'Transporte',
          createdAt: '2026-05-20T11:00:00.000Z',
          desc: 'uber',
          value: 20,
        },
      }),
      transactionsByUser: {
        5511999999999: {
          [currentMonthKey()]: {
            novo_1: {
              cat: 'Lazer',
              createdAt: '2026-05-20T12:00:00.000Z',
              desc: 'novo caminho',
              value: 999,
            },
          },
        },
      },
    },
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo');

  assert.match(resposta, /Resumo de/);
  assert.match(resposta, /Total: R\$ 55,00/);
  assert.doesNotMatch(resposta, /novo caminho/);
});

test('gastos hoje only totals items recorded today', async () => {
  const { service } = createService({
    seed: expenseSeed({
      hoje: {
        cat: 'Alimentação',
        createdAt: '2026-05-20T10:00:00.000Z',
        date: todayIso(),
        desc: 'cafe',
        value: 10,
      },
      outro_dia: {
        cat: 'Lazer',
        createdAt: '2026-05-19T10:00:00.000Z',
        date: '2000-01-01',
        desc: 'cinema',
        value: 50,
      },
    }),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gastos hoje');

  assert.match(resposta, /Gastos de hoje/);
  assert.match(resposta, /Total: R\$ 10,00/);
  assert.doesNotMatch(resposta, /cinema/);
});

test('listar gastos prints recent month expenses', async () => {
  const { service } = createService({
    seed: {
      ...expenseSeed({
        gasto_1: {
          cat: 'Alimentação',
          createdAt: '2026-05-20T10:00:00.000Z',
          date: todayIso(),
          desc: 'mercado',
          value: 45,
        },
      }),
      transactionsByUser: {
        5511999999999: {
          [currentMonthKey()]: {
            novo_1: {
              cat: 'Lazer',
              createdAt: '2026-05-20T12:00:00.000Z',
              date: todayIso(),
              desc: 'novo caminho',
              value: 999,
            },
          },
        },
      },
    },
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'listar gastos');

  assert.match(resposta, /Últimos gastos/);
  assert.match(resposta, /mercado/);
  assert.match(resposta, /R\$ 45,00/);
  assert.doesNotMatch(resposta, /novo caminho/);
});

test('apagar ultimo removes the latest expense in the fake Firebase tree', async () => {
  const { firebase, service } = createService({
    seed: {
      ...expenseSeed({
        antigo: {
          cat: 'Alimentação',
          createdAt: '2026-05-20T10:00:00.000Z',
          desc: 'almoco',
          value: 35,
        },
        ultimo: {
          cat: 'Transporte',
          createdAt: '2026-05-20T11:00:00.000Z',
          desc: 'uber',
          value: 20,
        },
      }),
      transactionsByUser: {
        5511999999999: {
          [currentMonthKey()]: {
            ultimo: {
              cat: 'Transporte',
              desc: 'uber',
              value: 20,
            },
          },
        },
      },
    },
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar ultimo');

  assert.match(resposta, /Apaguei/);
  assert.match(resposta, /uber/);
  assert.equal(firebase.removals.length, 1);
  assert.equal(firebase.removals[0], `grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/ultimo`);
  assert.deepEqual(firebase.getValue(`transactionsByUser/5511999999999/${currentMonthKey()}/ultimo`), {
    cat: 'Transporte',
    desc: 'uber',
    value: 20,
  });
});

test('apagar mercado lists matching candidates and does not delete immediately', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: { group: 'CASA2024', user: 'Ana' },
    seed: deleteSelectionSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar mercado');

  assert.match(resposta, /Encontrei estes gastos parecidos/);
  assert.match(resposta, /1\. Mercado extra — R\$ 75,00 — Alimentação/);
  assert.match(resposta, /2\. Mercado — R\$ 50,00 — Alimentação/);
  assert.match(resposta, /Responda com o número/);
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
    pendingDelete: {
      type: 'expense_selection',
      candidates: [
        {
          id: 'mercado_2',
          monthKey: currentMonthKey(),
          desc: 'Mercado extra',
          value: 75,
          cat: 'Alimentação',
          date: todayIso(),
        },
        {
          id: 'mercado_1',
          monthKey: currentMonthKey(),
          desc: 'Mercado',
          value: 50,
          cat: 'Alimentação',
          date: todayIso(),
        },
      ],
    },
  });
});

test('pending delete numeric response removes only the selected normal expense', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'expense_selection',
        candidates: [
          {
            id: 'mercado_2',
            monthKey: currentMonthKey(),
            desc: 'Mercado extra',
            value: 75,
            cat: 'Alimentação',
            date: todayIso(),
          },
          {
            id: 'mercado_1',
            monthKey: currentMonthKey(),
            desc: 'Mercado',
            value: 50,
            cat: 'Alimentação',
            date: todayIso(),
          },
        ],
      },
    },
    seed: deleteSelectionSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', '1');

  assert.match(resposta, /Apaguei/);
  assert.match(resposta, /Mercado extra/);
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
  });
  assert.deepEqual(firebase.removals, [
    `grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/mercado_2`,
    `transactionsByUser/5511999999999/${currentMonthKey()}/mercado_2`,
  ]);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/mercado_2`), undefined);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/mercado_1`).desc, 'Mercado');
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/uber_1`).desc, 'Uber');
});

test('pending delete cancellation clears state without removing expenses', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'expense_selection',
        candidates: [{
          id: 'mercado_1',
          monthKey: currentMonthKey(),
          desc: 'Mercado',
          value: 50,
          cat: 'Alimentação',
          date: todayIso(),
        }],
      },
    },
    seed: deleteSelectionSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'cancelar');

  assert.equal(resposta, 'Exclusão cancelada. Nenhum gasto foi apagado.');
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
  });
  assert.deepEqual(firebase.removals, []);
});

test('invalid pending delete response keeps the pending selection active', async () => {
  const pendingDelete = {
    type: 'expense_selection',
    candidates: [{
      id: 'mercado_1',
      monthKey: currentMonthKey(),
      desc: 'Mercado',
      value: 50,
      cat: 'Alimentação',
      date: todayIso(),
    }],
  };
  const { firebase, getSession, savedSessions, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete,
    },
    seed: deleteSelectionSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', '9');

  assert.equal(resposta, 'Responda com um número de 1 a 1 ou "cancelar".');
  assert.deepEqual(getSession().pendingDelete, pendingDelete);
  assert.deepEqual(savedSessions, []);
  assert.deepEqual(firebase.removals, []);
});

test('selected installment candidate deletes only that installment', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'expense_selection',
        candidates: [{
          id: 'tv_1',
          monthKey: currentMonthKey(),
          desc: 'TV (1/3x)',
          value: 400,
          cat: 'Lazer',
          date: todayIso(),
          parcelaId: 'tv-123',
        }],
      },
    },
    seed: deleteSelectionSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', '1');

  assert.match(resposta, /Apaguei somente esta parcela/);
  assert.match(resposta, /próxima etapa|proxima etapa/);
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
  });
  assert.deepEqual(firebase.removals, [
    `grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/tv_1`,
    `transactionsByUser/5511999999999/${currentMonthKey()}/tv_1`,
  ]);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/tv_1`), undefined);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${currentMonthKey()}/uber_1`).desc, 'Uber');
});

test('apagar unknown free text does not remove anything', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: deleteSelectionSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar farmacia');

  assert.equal(resposta, 'Não encontrei nenhum gasto parecido. Nenhum gasto foi apagado.');
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(savedSessions, []);
});

test('apagar parcelas da tv lists installment candidates without deleting immediately', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: { group: 'CASA2024', user: 'Ana' },
    seed: installmentDeleteSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar parcelas da tv');

  assert.match(resposta, /Encontrei estes parcelamentos/);
  assert.match(resposta, /1\. TV — 3 parcelas — R\$ 1\.200,00 total/);
  assert.match(resposta, /2\. TV sala — 2 parcelas — R\$ 600,00 total/);
  assert.doesNotMatch(resposta, /TV — R\$ 1\.200,00/);
  assert.match(resposta, /Responda o número/);
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
    pendingDelete: {
      type: 'installment_selection',
      candidates: [
        {
          parcelaId: 'tv-123',
          desc: 'TV',
          cat: 'Lazer',
          parcelaTotal: 3,
          parcelasEncontradas: 3,
          total: 1200,
        },
        {
          parcelaId: 'tv-456',
          desc: 'TV sala',
          cat: 'Lazer',
          parcelaTotal: 2,
          parcelasEncontradas: 2,
          total: 600,
        },
      ],
    },
  });
});

test('installment selection asks for final confirmation before deleting all installments', async () => {
  const installment = {
    parcelaId: 'tv-123',
    desc: 'TV',
    cat: 'Lazer',
    parcelaTotal: 3,
    parcelasEncontradas: 3,
    total: 1200,
  };
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'installment_selection',
        candidates: [installment],
      },
    },
    seed: installmentDeleteSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', '1');

  assert.equal(resposta, [
    'Tem certeza que deseja apagar todas as 3 parcelas de TV?',
    'Responda SIM para confirmar ou CANCELAR.',
  ].join('\n'));
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
    pendingDelete: {
      type: 'installment_confirmation',
      installment,
    },
  });
});

test('installment final confirmation removes only expenses with the selected parcelaId across months', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'installment_confirmation',
        installment: {
          parcelaId: 'tv-123',
          desc: 'TV',
          cat: 'Lazer',
          parcelaTotal: 3,
          parcelasEncontradas: 3,
          total: 1200,
        },
      },
    },
    seed: installmentDeleteSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'sim');

  assert.match(resposta, /Apaguei 3 parcelas do parcelamento/);
  assert.match(resposta, /TV/);
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
  });
  assert.deepEqual(firebase.removals, [
    `grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(0)}/tv_1`,
    `transactionsByUser/5511999999999/${monthKeyOffset(0)}/tv_1`,
    `grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(1)}/tv_2`,
    `transactionsByUser/5511999999999/${monthKeyOffset(1)}/tv_2`,
    `grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(2)}/tv_3`,
    `transactionsByUser/5511999999999/${monthKeyOffset(2)}/tv_3`,
  ]);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(0)}/tv_1`), undefined);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(1)}/tv_2`), undefined);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(2)}/tv_3`), undefined);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(0)}/tv_sala_1`).parcelaId, 'tv-456');
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(1)}/tv_sala_2`).parcelaId, 'tv-456');
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(0)}/tv_normal`).desc, 'TV');
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(1)}/notebook_1`).parcelaId, 'note-999');
});

test('installment final confirmation cancellation keeps all installments', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'installment_confirmation',
        installment: {
          parcelaId: 'tv-123',
          desc: 'TV',
          cat: 'Lazer',
          parcelaTotal: 3,
          parcelasEncontradas: 3,
          total: 1200,
        },
      },
    },
    seed: installmentDeleteSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'cancelar');

  assert.equal(resposta, 'Exclusão cancelada. Nenhum gasto foi apagado.');
  assert.deepEqual(getSession(), {
    group: 'CASA2024',
    user: 'Ana',
  });
  assert.deepEqual(firebase.removals, []);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(0)}/tv_1`).parcelaId, 'tv-123');
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(1)}/tv_2`).parcelaId, 'tv-123');
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(2)}/tv_3`).parcelaId, 'tv-123');
});

test('new delete command clears an active expense selection before processing installment deletion', async () => {
  const { firebase, getSession, savedSessions, service } = createStatefulService({
    initialSession: {
      group: 'CASA2024',
      user: 'Ana',
      pendingDelete: {
        type: 'expense_selection',
        candidates: [{
          id: 'mercado_1',
          monthKey: currentMonthKey(),
          desc: 'Mercado',
          value: 50,
          cat: 'Alimentação',
          date: todayIso(),
        }],
      },
    },
    seed: installmentDeleteSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar parcelas da tv');

  assert.match(resposta, /Encontrei estes parcelamentos/);
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(savedSessions[0], {
    phone: '5511999999999',
    data: {
      group: 'CASA2024',
      user: 'Ana',
    },
  });
  assert.equal(getSession().pendingDelete.type, 'installment_selection');
  assert.deepEqual(getSession().pendingDelete.candidates.map((item) => item.parcelaId), [
    'tv-123',
    'tv-456',
  ]);
});

test('apagar parcelamento without matching installments does not remove normal expenses', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: installmentDeleteSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar parcelamento geladeira');

  assert.equal(resposta, 'Não encontrei nenhum parcelamento parecido. Nenhum gasto foi apagado.');
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(savedSessions, []);
  assert.equal(firebase.getValue(`grupos/CASA2024/usuarios/Ana/gastos/${monthKeyOffset(0)}/tv_normal`).desc, 'TV');
});

test('AI delete action does not remove expenses directly', async () => {
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => JSON.stringify({
        acao: 'apagar',
        texto: 'apagar mercado',
      }),
    },
    seed: deleteSelectionSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'desfaz aquele gasto do mercado');

  assert.match(resposta, /Para apagar com segurança/);
  assert.deepEqual(firebase.removals, []);
});

test('parcelamento writes one installment per month to the fake Firebase tree', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'parcelei TV 1200 em 12x');

  assert.match(resposta, /TV/);
  assert.match(resposta, /12x de R\$ 100,00/);
  assert.equal(firebase.pushes.length, 12);
  assert.equal(firebase.pushes[0].value.desc, 'TV (1/12x)');
  assert.equal(firebase.pushes[0].value.origem, 'bot');
  assert.equal(firebase.pushes[0].value.parcelaNum, 1);
  assert.equal(firebase.pushes[0].value.parcelaTotal, 12);
  assert.equal(firebase.pushes[0].value.parcela, undefined);
  assert.equal(typeof firebase.pushes[0].value.parcelaId, 'string');
  assert.ok(firebase.pushes[0].value.parcelaId);
  assert.equal(firebase.pushes[11].value.desc, 'TV (12/12x)');
  assert.equal(firebase.pushes[11].value.parcelaId, firebase.pushes[0].value.parcelaId);
  assert.equal(firebase.pushes[11].value.parcelaNum, 12);
  assert.equal(firebase.pushes[11].value.parcelaTotal, 12);
  assert.equal(firebase.sets.length, 12);
  assert.deepEqual(firebase.sets[0], {
    path: `transactionsByUser/5511999999999/${firebase.pushes[0].path.split('/').pop()}/push_1`,
    value: {
      ...firebase.pushes[0].value,
      legacyGroup: 'CASA2024',
      legacyUser: 'Ana',
      legacyExpenseId: 'push_1',
      migrated: false,
      sourcePath: `${firebase.pushes[0].path}/push_1`,
    },
  });
});

test('parcelamento rounds installment values for 100 in 3x using the site-compatible schema', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'parcelei 100 compra em 3x');

  assert.match(resposta, /3x de R\$ 33,33/);
  assert.equal(firebase.pushes.length, 3);

  const parcelaId = firebase.pushes[0].value.parcelaId;

  assert.ok(parcelaId);

  firebase.pushes.forEach((push, index) => {
    assert.match(push.path, /grupos\/CASA2024\/usuarios\/Ana\/gastos\//);
    assert.equal(push.value.desc, `compra (${index + 1}/3x)`);
    assert.equal(push.value.value, 33.33);
    assert.equal(push.value.user, 'Ana');
    assert.equal(push.value.viaBot, true);
    assert.equal(push.value.parcelaId, parcelaId);
    assert.equal(push.value.parcelaNum, index + 1);
    assert.equal(push.value.parcelaTotal, 3);
    assert.equal(push.value.origem, 'bot');
    assert.equal(push.value.parcela, undefined);
  });
});

test('audio transcription can register parcelamento through the current text flow', async () => {
  const { firebase, service } = createService({
    groqOverrides: {
      transcreverAudio: async () => 'parcelei 300 fone em 3x',
    },
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', '', {
    base64: 'audio-base64',
    mimeType: 'audio/ogg',
    type: 'audio',
  });

  assert.match(resposta, /fone/);
  assert.match(resposta, /3x de R\$ 100,00/);
  assert.equal(firebase.pushes.length, 3);
  assert.equal(firebase.pushes[0].value.desc, 'fone (1/3x)');
  assert.equal(firebase.pushes[0].value.origem, 'bot');
  assert.equal(firebase.pushes[0].value.parcelaNum, 1);
  assert.equal(firebase.pushes[0].value.parcelaTotal, 3);
  assert.equal(firebase.pushes[0].value.parcela, undefined);
});

test('audio transcription reuses the current text expense flow', async () => {
  const { firebase, service } = createService({
    groqOverrides: {
      transcreverAudio: async () => '35 uber',
    },
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', '', {
    base64: 'audio-base64',
    mimeType: 'audio/ogg',
    type: 'audio',
  });

  assert.match(resposta, /uber/);
  assert.match(resposta, /registrado/);
  assert.equal(firebase.pushes.length, 1);
  assert.equal(firebase.pushes[0].value.origem, 'texto');
});

test('image analysis registers the extracted expense through the current image flow', async () => {
  const { firebase, service } = createService({
    groqOverrides: {
      analisarImagem: async () => JSON.stringify({
        encontrou_gasto: true,
        desc: 'mercado',
        valor: 45.9,
        cat: 'Alimentação',
        data: todayIso(),
      }),
    },
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', '', {
    base64: 'image-base64',
    mimeType: 'image/jpeg',
    type: 'image',
  });

  assert.match(resposta, /mercado/);
  assert.match(resposta, /registrado/);
  assert.equal(firebase.pushes.length, 1);
  assert.equal(firebase.pushes[0].value.origem, 'imagem');
});

test('AI action can register an expense when the simple parser has no expense', async () => {
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => JSON.stringify({
        acao: 'registrar',
        desc: 'curso',
        valor: 80,
        cat: 'Educação',
        data: todayIso(),
      }),
    },
    seed: expenseSeed(),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gasto do curso');

  assert.match(resposta, /curso/);
  assert.match(resposta, /registrado/);
  assert.equal(firebase.pushes.length, 1);
  assert.equal(firebase.pushes[0].value.origem, 'ia');
});
