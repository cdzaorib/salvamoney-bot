'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotService } = require('../src/bot-service');
const { createUserService } = require('../src/services/user-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const config = {
  groqApiKey: '',
  monthIndexMode: 'zero',
  siteUrl: 'https://cdzaorib.github.io/Salvamoney-site/',
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

function isoDayOffset(offset) {
  const parts = utcDateParts();
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset, 12));
  const offsetParts = utcDateParts(date);

  return `${offsetParts.year}-${offsetParts.month}-${offsetParts.day}`;
}

function monthKeyForIso(isoDate) {
  const [year, month] = String(isoDate || '').split('-');

  return `${year}_${Number(month) - 1}`;
}

function expenseSeed(expenses = {}) {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            gastos: {
              [currentMonthKey()]: expenses,
            },
          },
        },
      },
    },
  };
}

function expenseMonthsSeed(gastos = {}, extraUserFields = {}) {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            ...extraUserFields,
            gastos,
          },
        },
      },
    },
  };
}

function alertSeed({ alertas = {}, gastos = {}, extraUserFields = {} } = {}) {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            ...extraUserFields,
            alertas,
            gastos: {
              [currentMonthKey()]: gastos,
            },
          },
        },
      },
    },
  };
}

function chargeUsersSeed({
  origin = {},
  destination = {},
  originCharges = {},
  destinationCharges = {},
  gastos = {},
} = {}) {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            nome: 'Carlos',
            tag: '482913',
            phone: '5511999999999',
            ...origin,
            cobrancasEnviadas: originCharges,
            gastos: {
              [currentMonthKey()]: gastos,
            },
          },
          123456: {
            nome: 'Anna',
            tag: '123456',
            phone: '5511888888888',
            ...destination,
            cobrancasRecebidas: destinationCharges,
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
      SALVAMONEY: {
        usuarios: {
          482913: {
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

function fixedExpenseSeed() {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            fixos: {
              fixo_internet: {
                cat: 'Moradia',
                desc: 'internet',
                dia: 10,
                value: 99.9,
              },
              fixo_academia: {
                cat: 'Academia',
                desc: 'academia',
                dia: 5,
                value: 120,
              },
            },
            gastos: {
              [currentMonthKey()]: {
                gasto_internet: {
                  cat: 'Moradia',
                  createdAt: '2026-05-20T10:00:00.000Z',
                  date: todayIso(),
                  desc: 'internet',
                  value: 99.9,
                },
              },
            },
          },
        },
      },
    },
  };
}

function protectedAccountSeed() {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            nome: 'Carlos',
            tag: '482913',
            phone: '5511999999999',
            origem: 'bot',
            createdAt: '2026-01-01T00:00:00.000Z',
            gastos: {
              [currentMonthKey()]: {
                gasto_mercado: {
                  cat: 'Alimentação',
                  desc: 'Mercado',
                  value: 120,
                },
              },
            },
            fixos: {
              fixo_internet: {
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
    shareTags: {
      482913: {
        phone: '5511999999999',
      },
    },
    users: {
      5511999999999: {
        phone: '5511999999999',
        name: 'Carlos',
        email: 'carlos@example.com',
        tag: '482913',
        shareTag: '482913',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  };
}

function assertProtectedFinancialData(firebase) {
  assert.deepEqual(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/gasto_mercado`), {
    cat: 'Alimentação',
    desc: 'Mercado',
    value: 120,
  });
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/fixo_internet'), {
    desc: 'Internet',
    value: 100,
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
}

function assertNoFirebaseWrites(firebase) {
  assert.deepEqual(firebase.pushes, []);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
}

function createService({
  configOverrides = {},
  groqOverrides = {},
  notificationSender,
  randomInt,
  seed = {},
  session = null,
  useRealUserService = false,
  userService,
} = {}) {
  const firebase = createFakeFirebase(seed);
  const resolvedUserService = userService || (useRealUserService ? createRealUserService(firebase, randomInt) : undefined);
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
    logger: { info: () => {} },
    notificationSender,
    safeLog,
    sessionStore,
    userService: resolvedUserService,
  });

  return {
    firebase,
    savedSessions,
    service,
  };
}

function createRealUserService(firebase, randomInt = () => 482913) {
  return createUserService({
    db: {},
    firebaseOps: firebase.ops,
    now: () => '2026-05-25T12:00:00.000Z',
    randomInt,
  });
}

function createStatefulService({
  configOverrides = {},
  groqOverrides = {},
  initialSession = null,
  notificationSender,
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
    logger: { info: () => {} },
    notificationSender,
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
  return '482913';
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
        tag: firstNameTag(data.name),
        shareTag: firstNameTag(data.name),
      };

      users.set(phone, user);

      return user;
    },
    async getUserByShareTag(shareTag) {
      calls.push({ method: 'getUserByShareTag', shareTag });

      return Array.from(users.values()).find(
        (user) => String(user.shareTag || '') === shareTag
      ) || null;
    },
    async getUserByAccessTag(tag) {
      calls.push({ method: 'getUserByAccessTag', tag });

      return Array.from(users.values()).find(
        (user) => String(user.tag || user.shareTag || '') === tag
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

  assert.match(resposta, /Olá, eu sou o SalvaMoney/);
  assert.match(resposta, /- gastei 120 em 3x no cartão/);
  assert.match(resposta, /- onde posso economizar\?/);
  assert.match(resposta, /- recebi cobrança 1/);
  assert.match(resposta, /https:\/\/cdzaorib\.github\.io\/Salvamoney-site\//);
  assert.doesNotMatch(resposta, /Você ainda não vinculou uma conta/);
});

test('criar codigo without name returns tag-only instructions', async () => {
  const { service } = createService();
  const resposta = await service.processarMensagem('5511999999999', 'criar codigo');

  assert.equal(resposta, 'Agora o SalvaMoney usa apenas sua tag de 6 dígitos. Use: criar conta SeuNome ou entrar 123456.');
});

test('entrar with legacy name and group returns tag-only instructions', async () => {
  const { savedSessions, service } = createService({
    seed: expenseSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'entrar Ana SALVAMONEY');

  assert.equal(resposta, 'Agora o SalvaMoney usa apenas sua tag de 6 dígitos. Use: criar conta SeuNome ou entrar 123456.');
  assert.deepEqual(savedSessions, []);
});

test('trocar conta returns tag-only instructions', async () => {
  const { savedSessions, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'Carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'trocar conta Ana SALVAMONEY');

  assert.equal(resposta, 'Agora o SalvaMoney usa apenas sua tag de 6 dígitos. Use: criar conta SeuNome ou entrar 123456.');
  assert.deepEqual(savedSessions, []);
});

test('entrar 123456 links the phone to the access tag', async () => {
  const { savedSessions, service } = createService({
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
              nome: 'Anna',
              tag: '482913',
              phone: '5511999999999',
            },
          },
        },
      },
      shareTags: {
        482913: {
          phone: '5511999999999',
        },
      },
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Anna',
          tag: '482913',
          shareTag: '482913',
        },
      },
    },
  });
  const resposta = await service.processarMensagem('5511999999999', 'entrar 482913');

  assert.match(resposta, /Pronto/);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
      name: 'Anna',
      tag: '482913',
      updatedAt: todayIso(),
    },
  }]);
});

test('entrar with missing tag asks to create an account', async () => {
  const { savedSessions, service } = createService();
  const resposta = await service.processarMensagem('5511999999999', 'entrar 999999');

  assert.equal(resposta, 'Tag não encontrada. Crie sua conta pelo WhatsApp usando: criar conta SeuNome');
  assert.deepEqual(savedSessions, []);
});

test('criar conta preserves existing financial children on the SALVAMONEY tag node', async () => {
  const { firebase, savedSessions, service } = createService({
    randomInt: () => {
      throw new Error('existing numeric tag should not be regenerated');
    },
    seed: protectedAccountSeed(),
    useRealUserService: true,
  });

  const resposta = await service.processarMensagem('5511999999999', 'criar conta Carlos');

  assert.match(resposta, /Você já possui uma conta/);
  assertProtectedFinancialData(firebase);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/createdAt'), '2026-01-01T00:00:00.000Z');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/updatedAt'), '2026-05-25T12:00:00.000Z');
  assert.equal(firebase.sets.some((write) => write.path === 'grupos/SALVAMONEY/usuarios/482913'), false);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
      name: 'Carlos',
      tag: '482913',
      updatedAt: todayIso(),
    },
  }]);
});

test('entrar 482913 only saves the session and preserves existing financial children', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: protectedAccountSeed(),
    useRealUserService: true,
  });

  const resposta = await service.processarMensagem('5511999999999', 'entrar 482913');

  assert.match(resposta, /Pronto/);
  assertProtectedFinancialData(firebase);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
      name: 'Carlos',
      tag: '482913',
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

test('signup flow creates the user after receiving the name', async () => {
  const userService = createSignupUserService();
  const { savedSessions, service } = createService({
    session: { signupStep: 'signup_ask_name' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'Anna');

  assert.equal(resposta, [
    'Conta criada, Anna!',
    '',
    'Sua tag de acesso é: 482913',
    '',
    'Use essa tag para entrar no site e no WhatsApp.',
  ].join('\n'));
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
      name: 'Anna',
      tag: '482913',
      updatedAt: todayIso(),
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
    'Conta criada, Anna!',
    '',
    'Sua tag de acesso é: 482913',
    '',
    'Use essa tag para entrar no site e no WhatsApp.',
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
      group: 'SALVAMONEY',
      pendingEmail: null,
      pendingName: 'Anna',
      signupStep: 'signup_ask_email',
      user: '482913',
    },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'cancelar');

  assert.equal(resposta, 'Cadastro cancelado. Quando quiser, envie "criar conta" novamente.');
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
    },
  }]);
});

test('sair da conta logs out from the current session and preserves persisted records', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
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
        '482913': {
          phone: '5511999999999',
        },
      },
      users: {
        5511999999999: {
          phone: '5511999999999',
          name: 'Anna',
          email: 'anna@email.com',
          shareTag: '482913',
        },
      },
    },
    session: {
      group: 'SALVAMONEY',
      lastSeen: '2026-05-25',
      pendingEmail: 'anna@email.com',
      pendingName: 'Anna',
      signupStep: 'signup_confirm',
      user: '482913',
    },
  });
  const resposta = await service.processarMensagem('5511999999999', 'sair da conta');

  assert.equal(resposta, [
    'Você saiu da sua conta atual.',
    '',
    'Seu cadastro, sua tag e seus gastos foram preservados.',
    '',
    'Para entrar novamente, envie:',
    'entrar 123456',
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
    shareTag: '482913',
  });
  assert.deepEqual(firebase.getValue('shareTags/482913'), {
    phone: '5511999999999',
  });
  assert.deepEqual(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/gasto_1`), {
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
      shareTag: '482913',
    },
  });
  const { savedSessions, service } = createService({ userService });
  const resposta = await service.processarMensagem('5511999999999', 'criar conta');

  assert.match(resposta, /Você já possui uma conta no SalvaMoney/);
  assert.match(resposta, /Nome: Anna/);
  assert.match(resposta, /Sua tag de acesso é: 482913/);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
      name: 'Anna',
      tag: '482913',
      updatedAt: todayIso(),
    },
  }]);
});

test('minha tag returns the existing public shareTag', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'minha tag');

  assert.equal(resposta, 'Sua tag de acesso é: 482913');
  assert.equal(firebase.pushes.length, 0);
});

test('minha tag updates an old session to SALVAMONEY tag without overwriting financial children', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: protectedAccountSeed(),
    session: { group: 'LEGADO', user: 'Carlos' },
    useRealUserService: true,
  });

  const resposta = await service.processarMensagem('5511999999999', 'minha tag');

  assert.equal(resposta, 'Sua tag de acesso é: 482913');
  assertProtectedFinancialData(firebase);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/createdAt'), '2026-01-01T00:00:00.000Z');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/updatedAt'), '2026-05-25T12:00:00.000Z');
  assert.equal(firebase.sets.some((write) => write.path === 'grupos/SALVAMONEY/usuarios/482913'), false);
  assert.deepEqual(savedSessions, [{
    phone: '5511999999999',
    data: {
      group: 'SALVAMONEY',
      user: '482913',
      name: 'Carlos',
      tag: '482913',
      updatedAt: todayIso(),
    },
  }]);
});

test('natural minha tag phrases return users phone shareTag and never session user', async () => {
  const userService = createSignupUserService({
    5511999999999: {
      phone: '5511999999999',
      name: 'Anna',
      email: 'anna@email.com',
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
    userService,
  });

  for (const phrase of MINHA_TAG_PHRASES) {
    const resposta = await service.processarMensagem('5511999999999', phrase);

    assert.equal(resposta, 'Sua tag de acesso é: 482913', phrase);
    assert.doesNotMatch(resposta, /carlos/i, phrase);
  }

  assert.equal(firebase.pushes.length, 0);
  assert.equal(userService.calls.filter((call) => call.method === 'getUserByPhone').length, MINHA_TAG_PHRASES.length);
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
    session: { group: 'SALVAMONEY', user: 'carlos' },
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
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });
  const resposta = await service.processarMensagem('5511999999999', 'meu perfil');

  assert.equal(resposta, [
    'Seu perfil no SalvaMoney:',
    '',
    'Nome: Anna',
    'E-mail: anna@email.com',
    'Tag: 482913',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByPhone',
    phone: '5511999999999',
  }, {
    method: 'getOrCreateUserByPhone',
    phone: '5511999999999',
    data: {
      email: 'anna@email.com',
      name: 'Anna',
    },
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
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
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
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });
  const resposta = await service.processarMensagem('5511888888888', 'buscar tag 482913');

  assert.equal(resposta, [
    'Encontrei:',
    '',
    'Nome: Anna',
    'Tag: 482913',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByShareTag',
    shareTag: '482913',
  }]);
  assert.doesNotMatch(resposta, /5511999999999/);
  assert.doesNotMatch(resposta, /anna@email\.com/);
  assert.equal(firebase.pushes.length, 0);
});

test('buscar tag returns not found when shareTag does not exist', async () => {
  const userService = createSignupUserService();
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });
  const resposta = await service.processarMensagem('5511888888888', 'buscar tag 999999');

  assert.equal(resposta, [
    'Não encontrei ninguém com essa tag.',
    '',
    'Confira se digitou corretamente.',
  ].join('\n'));
  assert.deepEqual(userService.calls, [{
    method: 'getUserByShareTag',
    shareTag: '999999',
  }]);
  assert.equal(firebase.pushes.length, 0);
});

test('buscar tag without shareTag asks for the tag', async () => {
  const userService = createSignupUserService();
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });
  const resposta = await service.processarMensagem('5511888888888', 'buscar tag');

  assert.equal(resposta, [
    'Envie a tag que deseja buscar.',
    '',
    'Exemplo:',
    'buscar tag 123456',
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
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });
  const procurar = await service.processarMensagem('5511888888888', 'procurar tag 482913');
  const encontrar = await service.processarMensagem('5511888888888', 'encontrar tag 482913');

  assert.match(procurar, /Encontrei/);
  assert.match(encontrar, /Encontrei/);
  assert.deepEqual(userService.calls, [
    {
      method: 'getUserByShareTag',
      shareTag: '482913',
    },
    {
      method: 'getUserByShareTag',
      shareTag: '482913',
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
      shareTag: '482913',
    },
  });
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
    userService,
  });

  await service.processarMensagem('5511888888888', 'buscar tag 482913');

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

  assert.match(resposta, /Conta criada, 35 uber!/);
  assert.equal(firebase.pushes.length, 0);
});

test('normal text expense still works when signup is not active', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', '35 uber');

  assert.match(resposta, /uber/);
  assert.match(resposta, /registrado/);
  assert.equal(firebase.pushes.length, 1);
  assert.match(firebase.pushes[0].path, /grupos\/SALVAMONEY\/usuarios\/482913\/gastos\//);
  assert.equal(firebase.pushes[0].value.origem, 'texto');
  assert.deepEqual(firebase.sets, [{
    path: `transactionsByUser/5511999999999/${currentMonthKey()}/push_1`,
    value: {
      ...firebase.pushes[0].value,
      legacyGroup: 'SALVAMONEY',
      legacyUser: '482913',
      legacyExpenseId: 'push_1',
      migrated: false,
      sourcePath: `${firebase.pushes[0].path}/push_1`,
    },
  }]);
});

test('recebo 3000 por mes saves monthly income in the financial profile', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'recebo 3000 por mês');

  assert.equal(resposta, [
    'Perfil atualizado ✅',
    'Renda mensal: R$ 3.000,00',
  ].join('\n'));
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/rendaMensal'), 3000);
  assert.equal(typeof firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/updatedAt'), 'string');
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro',
  ]);
  assert.equal(firebase.pushes.length, 0);
});

test('recebo dia 5 saves the receiving day without requiring income', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'recebo dia 5');

  assert.equal(resposta, [
    'Perfil atualizado ✅',
    'Dia de recebimento: 5',
  ].join('\n'));
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/diaRecebimento'), 5);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/rendaMensal'), undefined);
});

test('cartao vence todo dia 12 saves the card due day', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'meu cartão vence dia 12');

  assert.equal(resposta, [
    'Perfil atualizado ✅',
    'Vencimento do cartão: dia 12',
  ].join('\n'));
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/vencimentoCartao'), 12);
});

test('definir orcamento 2000 saves the monthly budget', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'definir orçamento 2000');

  assert.equal(resposta, [
    'Perfil atualizado ✅',
    'Orçamento mensal: R$ 2.000,00',
  ].join('\n'));
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/orcamentoMensal'), 2000);
  assert.equal(firebase.pushes.length, 0);
});

test('meu perfil financeiro reads the saved financial profile', async () => {
  const { firebase, service } = createService({
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
              perfilFinanceiro: {
                diaRecebimento: 5,
                orcamentoMensal: 2000,
                rendaMensal: 3000,
                vencimentoCartao: 12,
              },
            },
          },
        },
      },
    },
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'meu perfil financeiro');

  assert.equal(resposta, [
    'Seu perfil financeiro:',
    'Renda mensal: R$ 3.000,00',
    'Dia de recebimento: 5',
    'Vencimento do cartão: dia 12',
    'Orçamento mensal: R$ 2.000,00',
  ].join('\n'));
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.updates, []);
});

test('financial profile update does not overwrite existing financial children', async () => {
  const { firebase, service } = createService({
    seed: protectedAccountSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'recebo 3000 todo dia 5');

  assert.equal(resposta, [
    'Perfil atualizado ✅',
    'Renda mensal: R$ 3.000,00',
    'Dia de recebimento: 5',
  ].join('\n'));
  assertProtectedFinancialData(firebase);
  assert.equal(firebase.sets.some((write) => write.path === 'grupos/SALVAMONEY/usuarios/482913'), false);
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro',
  ]);
});

test('financial profile command without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'recebo 3000 por mês');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.updates, []);
});

test('monthly summary command without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo mensal');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('monthly summary without current expenses answers clearly and writes nothing', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'relatório do mês');

  assert.equal(resposta, 'Você ainda não tem gastos registrados neste mês.');
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('monthly summary reports totals, categories, profile usage, card and previous month comparison', async () => {
  const { firebase, service } = createService({
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
              perfilFinanceiro: {
                orcamentoMensal: 300,
                rendaMensal: 1000,
                vencimentoCartao: 12,
              },
              fixos: {
                internet: {
                  desc: 'Internet',
                  value: 100,
                },
                streaming: {
                  desc: 'Streaming',
                  value: 30,
                },
              },
              gastos: {
                [currentMonthKey()]: {
                  almoco: {
                    cat: 'Alimentação',
                    desc: 'Almoço',
                    value: 100,
                  },
                  uber: {
                    cat: 'Transporte',
                    desc: 'Uber',
                    value: 50,
                  },
                  cinema: {
                    cat: 'Lazer',
                    desc: 'Cinema',
                    value: 25,
                  },
                  taxa: {
                    desc: 'Taxa',
                    value: 5,
                  },
                },
                [monthKeyOffset(-1)]: {
                  mercado: {
                    cat: 'Alimentação',
                    desc: 'Mercado',
                    value: 50,
                  },
                  onibus: {
                    cat: 'Transporte',
                    desc: 'Ônibus',
                    value: 100,
                  },
                  jogo: {
                    cat: 'Lazer',
                    desc: 'Jogo',
                    value: 25,
                  },
                },
              },
            },
          },
        },
      },
    },
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'como estou indo esse mês?');

  assert.match(resposta, /Resumo de .+ 📊/);
  assert.match(resposta, /Total gasto: R\$ 180,00/);
  assert.match(resposta, /Registros: 4/);
  assert.match(resposta, /Maior categoria: Alimentação - R\$ 100,00/);
  assert.match(resposta, /Gastos fixos cadastrados: R\$ 130,00/);
  assert.match(resposta, /1\. Alimentação - R\$ 100,00/);
  assert.match(resposta, /2\. Transporte - R\$ 50,00/);
  assert.match(resposta, /3\. Lazer - R\$ 25,00/);
  assert.match(resposta, /Você usou 18% da sua renda mensal e 60% do seu orçamento\./);
  assert.match(resposta, /Comparado ao mês passado, seus gastos subiram 3%\./);
  assert.match(resposta, /Alimentação foi a categoria que mais cresceu: subiu 100%/);
  assert.match(resposta, /Seu cartão vence dia 12\./);
  assert.match(resposta, /Dica: acompanhe Alimentação/);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('monthly summary says when previous month history is missing and suggests profile setup', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        desc: 'Mercado',
        value: 80,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'análise do mês');

  assert.match(resposta, /Total gasto: R\$ 80,00/);
  assert.match(resposta, /Ainda não tenho histórico suficiente para comparar com o mês passado\./);
  assert.match(resposta, /Para análises melhores, me diga sua renda com: recebo 3000 todo dia 5/);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('monthly summary uses AI response when Groq returns valid text', async () => {
  const calls = [];
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async (messages) => {
        calls.push(messages);

        return 'Resumo IA: você usou 18% da renda. Dica: acompanhe alimentação.';
      },
    },
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
              perfilFinanceiro: {
                orcamentoMensal: 300,
                rendaMensal: 1000,
              },
              fixos: {
                internet: {
                  value: 100,
                },
              },
              gastos: {
                [currentMonthKey()]: {
                  almoco: {
                    cat: 'Alimentação',
                    desc: 'Almoço',
                    value: 180,
                  },
                },
                [monthKeyOffset(-1)]: {
                  mercado: {
                    cat: 'Alimentação',
                    desc: 'Mercado',
                    value: 100,
                  },
                },
              },
            },
          },
        },
      },
    },
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo mensal');

  assert.equal(resposta, 'Resumo IA: você usou 18% da renda. Dica: acompanhe alimentação.');
  assert.equal(calls.length, 1);
  assert.match(calls[0][0].content, /Não invente números/);
  assert.match(calls[0][0].content, /Não recomende investimentos específicos/);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('monthly summary sends structured calculated data to AI', async () => {
  let sentSummaryData = null;
  const { service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async (messages) => {
        const jsonText = messages[1].content.match(/\{[\s\S]*\}$/)[0];
        sentSummaryData = JSON.parse(jsonText);

        return 'Resumo com IA.';
      },
    },
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: {
              perfilFinanceiro: {
                orcamentoMensal: 300,
                rendaMensal: 1000,
                vencimentoCartao: 12,
              },
              fixos: {
                internet: {
                  value: 100,
                },
                streaming: {
                  value: 30,
                },
              },
              gastos: {
                [currentMonthKey()]: {
                  almoco: {
                    cat: 'Alimentação',
                    value: 100,
                  },
                  uber: {
                    cat: 'Transporte',
                    value: 50,
                  },
                  cinema: {
                    cat: 'Lazer',
                    value: 25,
                  },
                  taxa: {
                    value: 5,
                  },
                },
                [monthKeyOffset(-1)]: {
                  mercado: {
                    cat: 'Alimentação',
                    value: 50,
                  },
                  onibus: {
                    cat: 'Transporte',
                    value: 100,
                  },
                  jogo: {
                    cat: 'Lazer',
                    value: 25,
                  },
                },
              },
            },
          },
        },
      },
    },
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });

  await service.processarMensagem('5511999999999', 'meu resumo');

  assert.equal(sentSummaryData.totalAtual, 180);
  assert.equal(sentSummaryData.totalAnterior, 175);
  assert.equal(sentSummaryData.variacaoPercentual, 3);
  assert.equal(sentSummaryData.quantidadeRegistros, 4);
  assert.deepEqual(sentSummaryData.maiorCategoria, {
    categoria: 'Alimentação',
    total: 100,
  });
  assert.deepEqual(sentSummaryData.topCategorias, [{
    categoria: 'Alimentação',
    total: 100,
  }, {
    categoria: 'Transporte',
    total: 50,
  }, {
    categoria: 'Lazer',
    total: 25,
  }]);
  assert.deepEqual(sentSummaryData.categoriaQueMaisSubiu, {
    categoria: 'Alimentação',
    diferenca: 50,
    percentual: 100,
    totalAtual: 100,
    totalAnterior: 50,
  });
  assert.equal(sentSummaryData.rendaMensal, 1000);
  assert.equal(sentSummaryData.orcamentoMensal, 300);
  assert.equal(sentSummaryData.percentualRenda, 18);
  assert.equal(sentSummaryData.percentualOrcamento, 60);
  assert.equal(sentSummaryData.vencimentoCartao, 12);
  assert.equal(sentSummaryData.gastosFixosTotal, 130);
  assert.equal(sentSummaryData.temHistoricoAnterior, true);
  assert.equal(Object.hasOwn(sentSummaryData, 'phone'), false);
  assert.equal(Object.hasOwn(sentSummaryData, 'tag'), false);
});

test('monthly summary falls back to deterministic response when Groq fails', async () => {
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        throw new Error('timeout');
      },
    },
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        desc: 'Mercado',
        value: 80,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo do mês');

  assert.match(resposta, /Resumo de .+ 📊/);
  assert.match(resposta, /Total gasto: R\$ 80,00/);
  assert.match(resposta, /Ainda não tenho histórico suficiente/);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('monthly summary falls back without Groq configuration and does not call AI', async () => {
  let called = false;
  const { service } = createService({
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        return 'não deveria chamar';
      },
    },
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        desc: 'Mercado',
        value: 80,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo mensal');

  assert.equal(called, false);
  assert.match(resposta, /Total gasto: R\$ 80,00/);
});

test('monthly summary does not call AI when there are no current expenses', async () => {
  let called = false;
  const { service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        return 'não deveria chamar';
      },
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'relatório do mês');

  assert.equal(resposta, 'Você ainda não tem gastos registrados neste mês.');
  assert.equal(called, false);
});

test('financial advisor without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'onde posso economizar?');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('financial advisor answers open questions with Groq and structured data', async () => {
  const messages = [];
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async (prompt) => {
        messages.push(prompt);

        return 'Seu maior ponto de atenção é Alimentação. Sugestões: defina um teto semanal e acompanhe o cartão.';
      },
    },
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        delivery: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Delivery',
          value: 150,
        },
        mercado: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado',
          value: 300,
        },
        uber: {
          cat: 'Transporte',
          date: todayIso(),
          desc: 'Uber',
          value: 150,
        },
      },
      [monthKeyOffset(-1)]: {
        delivery_antigo: {
          cat: 'Alimentação',
          date: isoDayOffset(-30),
          desc: 'Delivery antigo',
          value: 100,
        },
        uber_antigo: {
          cat: 'Transporte',
          date: isoDayOffset(-30),
          desc: 'Uber antigo',
          value: 200,
        },
      },
    }, {
      alertas: {
        alimentacao: {
          ativo: true,
          categoria: 'Alimentação',
          limite: 500,
          tipo: 'categoria',
        },
      },
      fixos: {
        internet: {
          desc: 'Internet',
          value: 100,
        },
      },
      perfilFinanceiro: {
        orcamentoMensal: 1000,
        rendaMensal: 3000,
        vencimentoCartao: 12,
      },
      phone: '5511999999999',
      tag: '482913',
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'onde posso economizar?');
  const prompt = messages[0];
  const userMessage = prompt.find((message) => message.role === 'user').content;
  const advisorData = JSON.parse(userMessage.slice(userMessage.indexOf('{')));

  assert.equal(resposta, 'Seu maior ponto de atenção é Alimentação. Sugestões: defina um teto semanal e acompanhe o cartão.');
  assert.equal(messages.length, 1);
  assert.equal(advisorData.totalMesAtual, 600);
  assert.equal(advisorData.totalMesAnterior, 300);
  assert.equal(advisorData.variacaoPercentual, 100);
  assert.deepEqual(advisorData.categoriasMesAtual[0], {
    categoria: 'Alimentação',
    percentualDoMes: 75,
    total: 450,
  });
  assert.equal(advisorData.gastosFixosTotal, 100);
  assert.equal(advisorData.rendaMensal, 3000);
  assert.equal(advisorData.orcamentoMensal, 1000);
  assert.equal(advisorData.percentualRendaUsado, 20);
  assert.equal(advisorData.percentualOrcamentoUsado, 60);
  assert.equal(advisorData.vencimentoCartao, 12);
  assert.equal(advisorData.perguntaUsuario, 'onde posso economizar?');
  assert.deepEqual(advisorData.alertasAtivos, [{
    categoria: 'Alimentação',
    limite: 500,
    tipo: 'categoria',
  }]);
  assert.doesNotMatch(JSON.stringify(prompt), /5511999999999|482913/);
  assertNoFirebaseWrites(firebase);
});

test('financial advisor handles delivery analysis questions', async () => {
  let called = false;
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        return 'Delivery está dentro de Alimentação. Revise frequência e valor médio antes de cortar tudo.';
      },
    },
    seed: expenseSeed({
      delivery: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Delivery',
        value: 90,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'estou gastando muito com delivery?');

  assert.equal(called, true);
  assert.equal(resposta, 'Delivery está dentro de Alimentação. Revise frequência e valor médio antes de cortar tudo.');
  assertNoFirebaseWrites(firebase);
});

test('financial advisor falls back when Groq fails', async () => {
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        throw new Error('groq indisponível');
      },
    },
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Mercado',
        value: 180,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'como estou financeiramente?');

  assert.match(resposta, /Ainda não consegui gerar uma análise avançada agora, mas pelo seu resumo atual:/);
  assert.match(resposta, /Total do mês: R\$ 180,00/);
  assert.match(resposta, /Maior categoria: Alimentação/);
  assertNoFirebaseWrites(firebase);
});

test('financial advisor falls back without Groq configuration', async () => {
  let called = false;
  const { firebase, service } = createService({
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        return 'não deveria chamar';
      },
    },
    seed: expenseSeed({
      uber: {
        cat: 'Transporte',
        date: todayIso(),
        desc: 'Uber',
        value: 40,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'me ajude a economizar esse mês');

  assert.equal(called, false);
  assert.match(resposta, /Ainda não consegui gerar uma análise avançada agora/);
  assert.match(resposta, /Total do mês: R\$ 40,00/);
  assertNoFirebaseWrites(firebase);
});

test('financial advisor does not capture normal expense commands', async () => {
  let called = false;
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('advisor should not run');
      },
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gastei 20 no mercado');

  assert.equal(called, false);
  assert.match(resposta, /registrado/i);
  assert.equal(firebase.pushes.length, 1);
});

test('financial advisor does not capture charge commands', async () => {
  let called = false;
  const { service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('advisor should not run');
      },
    },
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobrar 80 da tag 123456');

  assert.equal(called, false);
  assert.match(resposta, /Cobrança criada/);
});

test('financial advisor does not capture delete commands', async () => {
  let called = false;
  const { service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('advisor should not run');
      },
    },
    seed: deleteSelectionSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar mercado');

  assert.equal(called, false);
  assert.match(resposta, /Encontrei estes gastos parecidos/);
});

test('intent router routes broad financial advice questions to advisor', async () => {
  const prompts = [];
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async (prompt) => {
        prompts.push(prompt);

        if (/roteador seguro de intenção/.test(prompt[0].content)) {
          return JSON.stringify({
            intent: 'financial_advice',
            confidence: 0.91,
            reason: 'Usuário pede ajuda para organizar dinheiro',
            entities: {
              amount: null,
              category: null,
              period: null,
              targetTag: null,
            },
          });
        }

        return 'Separe seus gastos por categoria e defina um limite simples para o restante do mês.';
      },
    },
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Mercado',
        value: 120,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'me ajuda a organizar meu dinheiro');

  assert.equal(resposta, 'Separe seus gastos por categoria e defina um limite simples para o restante do mês.');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0][0].content, /roteador seguro de intenção/);
  assert.doesNotMatch(JSON.stringify(prompts[0]), /5511999999999|482913|perfilFinanceiro|gastos|fake-groq-key/);
  assertNoFirebaseWrites(firebase);
});

test('intent router without Groq configuration does not break the bot', async () => {
  let called = false;
  const { firebase, service } = createService({
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('router should not run without key');
      },
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'me ajuda a organizar meu dinheiro');

  assert.equal(called, false);
  assert.match(resposta, /Não entendi/);
  assertNoFirebaseWrites(firebase);
});

test('intent router invalid JSON falls back to the old flow without writes', async () => {
  let calls = 0;
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        calls += 1;

        return 'resposta livre sem json';
      },
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'me ajuda a organizar meu dinheiro');

  assert.equal(calls, 2);
  assert.equal(resposta, 'resposta livre sem json');
  assertNoFirebaseWrites(firebase);
});

test('intent router low confidence classification does not trigger advisor', async () => {
  let calls = 0;
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        calls += 1;

        return JSON.stringify({
          intent: 'financial_advice',
          confidence: 0.6,
          reason: 'Pouco contexto',
          entities: {},
        });
      },
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'me ajuda a organizar meu dinheiro');

  assert.equal(calls, 2);
  assert.match(resposta, /"confidence":0\.6/);
  assertNoFirebaseWrites(firebase);
});

test('intent router does not steal normal expense commands', async () => {
  let called = false;
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('router should not run');
      },
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gastei 20 no mercado');

  assert.equal(called, false);
  assert.match(resposta, /registrado/i);
  assert.equal(firebase.pushes.length, 1);
});

test('intent router does not steal expense query commands', async () => {
  let called = false;
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('router should not run');
      },
    },
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Mercado',
        value: 70,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei com mercado?');

  assert.equal(called, false);
  assert.match(resposta, /Você gastou R\$ 70,00/);
  assertNoFirebaseWrites(firebase);
});

test('intent router does not steal charge accept commands', async () => {
  let called = false;
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorTotal: null,
    valorCobrado: 80,
    percentual: null,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    phoneOrigem: '5511999999999',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    phoneDestino: '5511888888888',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        throw new Error('router should not run');
      },
    },
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'aceitar cobrança 1');

  assert.equal(called, false);
  assert.equal(resposta, 'Você aceitou a cobrança de R$ 80,00 referente a Almoço.');
});

test('savings goal without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'minha meta');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('creates a monthly savings goal without overwriting financial data', async () => {
  const { firebase, service } = createService({
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        mercado: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado',
          value: 120,
        },
      },
    }, {
      fixos: {
        internet: {
          desc: 'Internet',
          value: 100,
        },
      },
      meta: {
        desc: 'Meta antiga do site',
        value: 1000,
      },
      perfilFinanceiro: {
        rendaMensal: 3000,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'criar meta de economizar 500 esse mês');
  const goalPath = `grupos/SALVAMONEY/usuarios/482913/metasEconomia/${currentMonthKey()}`;
  const goal = firebase.getValue(goalPath);

  assert.equal(resposta, [
    'Meta criada ✅',
    'Você quer economizar R$ 500,00 este mês.',
    '',
    'Para acompanhar, envie: minha meta',
  ].join('\n'));
  assert.equal(goal.valorMeta, 500);
  assert.equal(goal.descricao, 'Economia mensal');
  assert.equal(goal.ativo, true);
  assert.equal(typeof goal.createdAt, 'string');
  assert.equal(typeof goal.updatedAt, 'string');
  assert.deepEqual(firebase.updates.map((write) => write.path), [goalPath]);
  assert.equal(firebase.updates.every((write) => write.path.includes('/metasEconomia/')), true);
  assert.deepEqual(firebase.pushes, []);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.removals, []);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/mercado/value`), 120);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/internet/value'), 100);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/perfilFinanceiro/rendaMensal'), 3000);
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/meta'), {
    desc: 'Meta antiga do site',
    value: 1000,
  });
});

test('consults a monthly savings goal with income and current month expenses', async () => {
  let called = false;
  const goal = {
    ativo: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    descricao: 'Economia mensal',
    updatedAt: '2026-05-01T00:00:00.000Z',
    valorMeta: 500,
  };
  const { firebase, service } = createService({
    groqOverrides: {
      chamarIA: async () => {
        called = true;

        return 'não deveria chamar sem chave';
      },
    },
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        mercado: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado',
          value: 1200,
        },
        uber: {
          cat: 'Transporte',
          date: todayIso(),
          desc: 'Uber',
          value: 300,
        },
      },
      [monthKeyOffset(-1)]: {
        antigo: {
          cat: 'Lazer',
          date: isoDayOffset(-30),
          desc: 'Cinema antigo',
          value: 9999,
        },
      },
    }, {
      metasEconomia: {
        [currentMonthKey()]: goal,
      },
      perfilFinanceiro: {
        rendaMensal: 3000,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'minha meta');

  assert.equal(called, false);
  assert.match(resposta, /Sua meta de economia este mês é R\$ 500,00\./);
  assert.match(resposta, /Renda mensal: R\$ 3\.000,00/);
  assert.match(resposta, /Gasto até agora: R\$ 1\.500,00/);
  assert.match(resposta, /Economia projetada: R\$ 1\.500,00/);
  assert.match(resposta, /Você está acima da meta por enquanto ✅/);
  assert.match(resposta, /Alimentação/);
  assertNoFirebaseWrites(firebase);
});

test('consults a monthly savings goal without income and asks for financial profile', async () => {
  const { firebase, service } = createService({
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        mercado: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado',
          value: 250,
        },
      },
    }, {
      metasEconomia: {
        [currentMonthKey()]: {
          ativo: true,
          descricao: 'Economia mensal',
          valorMeta: 400,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto falta para minha meta?');

  assert.match(resposta, /Sua meta de economia este mês é R\$ 400,00\./);
  assert.match(resposta, /Gasto até agora: R\$ 250,00/);
  assert.doesNotMatch(resposta, /Renda mensal:/);
  assert.match(resposta, /Para calcular melhor, me diga sua renda com: recebo 3000 todo dia 5/);
  assertNoFirebaseWrites(firebase);
});

test('cancels a savings goal by deactivating the month node', async () => {
  const goal = {
    ativo: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    descricao: 'Economia mensal',
    updatedAt: '2026-05-01T00:00:00.000Z',
    valorMeta: 700,
  };
  const { firebase, service } = createService({
    seed: expenseMonthsSeed({}, {
      metasEconomia: {
        [currentMonthKey()]: goal,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cancelar meta');
  const goalPath = `grupos/SALVAMONEY/usuarios/482913/metasEconomia/${currentMonthKey()}`;

  assert.equal(resposta, 'Meta cancelada: R$ 700,00 este mês.');
  assert.equal(firebase.getValue(`${goalPath}/ativo`), false);
  assert.equal(typeof firebase.getValue(`${goalPath}/updatedAt`), 'string');
  assert.deepEqual(firebase.updates.map((write) => write.path), [goalPath]);
  assert.deepEqual(Object.keys(firebase.updates[0].value).sort(), ['ativo', 'updatedAt']);
  assert.deepEqual(firebase.pushes, []);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.removals, []);
});

test('canceled savings goal does not appear as active', async () => {
  const { firebase, service } = createService({
    seed: expenseMonthsSeed({}, {
      metasEconomia: {
        [currentMonthKey()]: {
          ativo: false,
          descricao: 'Economia mensal',
          valorMeta: 700,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'minha meta');

  assert.match(resposta, /Você ainda não tem uma meta de economia ativa neste mês/);
  assertNoFirebaseWrites(firebase);
});

test('weekly planner without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'plano da semana');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('weekly planner routes weekly planning commands through AI provider router', async () => {
  const prompts = [];
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async (prompt) => {
        prompts.push(prompt);

        return 'Plano semanal: controle Alimentação e use um teto diário simples até domingo.';
      },
    },
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        mercado: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado',
          value: 180,
        },
      },
    }, {
      perfilFinanceiro: {
        orcamentoMensal: 1200,
        rendaMensal: 3000,
        vencimentoCartao: 12,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'monte meu plano da semana');

  assert.equal(resposta, 'Plano semanal: controle Alimentação e use um teto diário simples até domingo.');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0][0].content, /plano financeiro semanal/);
  assert.doesNotMatch(JSON.stringify(prompts[0]), /5511999999999|482913|fake-groq-key/);
  assertNoFirebaseWrites(firebase);
});

test('weekly report without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'relatório da semana');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('weekly report routes report commands through AI provider router', async () => {
  const prompts = [];
  const { firebase, service } = createService({
    configOverrides: {
      groqApiKey: 'fake-groq-key',
    },
    groqOverrides: {
      chamarIA: async (prompt) => {
        prompts.push(prompt);

        return 'Relatório semanal: Alimentação foi o principal peso. Revise compras pequenas antes do fim de semana.';
      },
    },
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        mercado: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado',
          value: 180,
        },
      },
    }, {
      perfilFinanceiro: {
        orcamentoMensal: 1200,
        rendaMensal: 3000,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo da semana');

  assert.equal(resposta, 'Relatório semanal: Alimentação foi o principal peso. Revise compras pequenas antes do fim de semana.');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0][0].content, /relatório financeiro semanal/);
  assert.doesNotMatch(JSON.stringify(prompts[0]), /5511999999999|482913|fake-groq-key/);
  assertNoFirebaseWrites(firebase);
});

test('expense query without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei com mercado esse mês?');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('expense query for mercado in current month sums matching food category expenses', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed({
      delivery: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Delivery',
        value: 80.5,
      },
      mercado: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Mercado Guanabara',
        value: 120,
      },
      uber: {
        cat: 'Transporte',
        date: todayIso(),
        desc: 'Uber',
        value: 40,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei com mercado esse mês?');

  assert.match(resposta, /Você gastou R\$ 200,50 com mercado\/alimentação neste mês\./);
  assert.match(resposta, /Registros encontrados: 2/);
  assert.match(resposta, /1\. Mercado Guanabara - R\$ 120,00 - \d{2}\/\d{2}/);
  assert.match(resposta, /2\. Delivery - R\$ 80,50 - \d{2}\/\d{2}/);
  assert.doesNotMatch(resposta, /Uber/);
  assertNoFirebaseWrites(firebase);
});

test('expense query for transport in previous month reads only previous month expenses', async () => {
  const { firebase, service } = createService({
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        uber_atual: {
          cat: 'Transporte',
          date: todayIso(),
          desc: 'Uber atual',
          value: 999,
        },
      },
      [monthKeyOffset(-1)]: {
        mercado: {
          cat: 'Alimentação',
          desc: 'Mercado',
          value: 100,
        },
        onibus: {
          cat: 'Transporte',
          desc: 'Ônibus',
          value: 25,
        },
        uber: {
          cat: 'Transporte',
          desc: 'Uber',
          value: 50,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei com transporte mês passado?');

  assert.match(resposta, /Você gastou R\$ 75,00 com Transporte no mês passado\./);
  assert.match(resposta, /Registros encontrados: 2/);
  assert.match(resposta, /Uber/);
  assert.match(resposta, /Ônibus/);
  assert.doesNotMatch(resposta, /Uber atual/);
  assertNoFirebaseWrites(firebase);
});

test('expense query for today filters by current date', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed({
      hoje_1: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Almoço',
        value: 30,
      },
      hoje_2: {
        cat: 'Transporte',
        date: todayIso(),
        desc: 'Uber',
        value: 20,
      },
      ontem: {
        cat: 'Lazer',
        date: isoDayOffset(-1),
        desc: 'Cinema ontem',
        value: 999,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei hoje?');

  assert.match(resposta, /Você gastou R\$ 50,00 hoje\./);
  assert.match(resposta, /Registros encontrados: 2/);
  assert.doesNotMatch(resposta, /Cinema ontem/);
  assertNoFirebaseWrites(firebase);
});

test('expense query for yesterday filters by previous date', async () => {
  const yesterday = isoDayOffset(-1);
  const gastos = {
    [monthKeyForIso(yesterday)]: {
      hoje: {
        cat: 'Transporte',
        date: todayIso(),
        desc: 'Uber hoje',
        value: 20,
      },
      ontem: {
        cat: 'Alimentação',
        date: yesterday,
        desc: 'Mercado ontem',
        value: 70,
      },
    },
  };

  if (monthKeyForIso(todayIso()) !== monthKeyForIso(yesterday)) {
    gastos[monthKeyForIso(todayIso())] = gastos[monthKeyForIso(todayIso())] || {};
    gastos[monthKeyForIso(todayIso())].hoje = {
      cat: 'Transporte',
      date: todayIso(),
      desc: 'Uber hoje',
      value: 20,
    };
  }

  const { firebase, service } = createService({
    seed: expenseMonthsSeed(gastos),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei ontem?');

  assert.match(resposta, /Você gastou R\$ 70,00 ontem\./);
  assert.match(resposta, /Mercado ontem/);
  assert.doesNotMatch(resposta, /Uber hoje/);
  assertNoFirebaseWrites(firebase);
});

test('expense query for this week filters the current week', async () => {
  const oldDate = isoDayOffset(-8);
  const gastos = {
    [monthKeyForIso(todayIso())]: {
      semana: {
        cat: 'Lazer',
        date: todayIso(),
        desc: 'Cinema',
        value: 40,
      },
    },
  };
  gastos[monthKeyForIso(oldDate)] = {
    ...(gastos[monthKeyForIso(oldDate)] || {}),
    antigo: {
      cat: 'Lazer',
      date: oldDate,
      desc: 'Cinema antigo',
      value: 100,
    },
  };

  const { firebase, service } = createService({
    seed: expenseMonthsSeed(gastos),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'quanto gastei essa semana?');

  assert.match(resposta, /Você gastou R\$ 40,00 nesta semana\./);
  assert.match(resposta, /Cinema/);
  assert.doesNotMatch(resposta, /Cinema antigo/);
  assertNoFirebaseWrites(firebase);
});

test('expense query without explicit period uses the current month', async () => {
  const { firebase, service } = createService({
    seed: expenseMonthsSeed({
      [currentMonthKey()]: {
        mercado_atual: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado atual',
          value: 55,
        },
      },
      [monthKeyOffset(-1)]: {
        mercado_passado: {
          cat: 'Alimentação',
          desc: 'Mercado passado',
          value: 100,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gastos com mercado');

  assert.match(resposta, /Você gastou R\$ 55,00 com mercado\/alimentação neste mês\./);
  assert.match(resposta, /Mercado atual/);
  assert.doesNotMatch(resposta, /Mercado passado/);
  assertNoFirebaseWrites(firebase);
});

test('expense query by description finds matching desc text', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed({
      mercado: {
        cat: 'Alimentação',
        date: todayIso(),
        desc: 'Mercado',
        value: 20,
      },
      pet: {
        cat: 'Outros',
        date: todayIso(),
        desc: 'Pet shop',
        value: 60,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gastos com pet');

  assert.match(resposta, /Você gastou R\$ 60,00 com pet neste mês\./);
  assert.match(resposta, /Pet shop/);
  assert.doesNotMatch(resposta, /Mercado/);
  assertNoFirebaseWrites(firebase);
});

test('expense query without results answers clearly', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed({
      uber: {
        cat: 'Transporte',
        date: todayIso(),
        desc: 'Uber',
        value: 20,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'total de alimentação');

  assert.equal(resposta, 'Não encontrei gastos com Alimentação neste mês.');
  assertNoFirebaseWrites(firebase);
});

test('alert command without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'alerta de 300 para alimentação');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('creates a category alert without touching financial data', async () => {
  const { firebase, service } = createService({
    seed: protectedAccountSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'me avise quando eu gastar mais de 300 com delivery');

  assert.equal(resposta, [
    'Alerta criado ✅',
    'Vou te avisar quando Alimentação passar de R$ 300,00 no mês.',
  ].join('\n'));
  assert.deepEqual(firebase.pushes.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/alertas',
  ]);
  assert.equal(firebase.pushes[0].value.tipo, 'categoria');
  assert.equal(firebase.pushes[0].value.categoria, 'Alimentação');
  assert.equal(firebase.pushes[0].value.limite, 300);
  assert.equal(firebase.pushes[0].value.ativo, true);
  assert.equal(typeof firebase.pushes[0].value.createdAt, 'string');
  assertProtectedFinancialData(firebase);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('creates a monthly budget alert', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'limite mensal 2500');

  assert.equal(resposta, [
    'Alerta criado ✅',
    'Vou te avisar quando seus gastos do mês passarem de R$ 2.500,00.',
  ].join('\n'));
  assert.equal(firebase.pushes[0].path, 'grupos/SALVAMONEY/usuarios/482913/alertas');
  assert.equal(firebase.pushes[0].value.tipo, 'orcamento_mensal');
  assert.equal(firebase.pushes[0].value.limite, 2500);
  assert.equal(firebase.pushes[0].value.ativo, true);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
});

test('lists only active alerts', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        alimentacao: {
          tipo: 'categoria',
          categoria: 'Alimentação',
          limite: 300,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        mensal: {
          tipo: 'orcamento_mensal',
          limite: 2000,
          ativo: true,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        transporte: {
          tipo: 'categoria',
          categoria: 'Transporte',
          limite: 100,
          ativo: false,
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'meus alertas');

  assert.equal(resposta, [
    'Seus alertas ativos:',
    '1. Alimentação acima de R$ 300,00',
    '2. Orçamento mensal acima de R$ 2.000,00',
  ].join('\n'));
  assertNoFirebaseWrites(firebase);
});

test('removes an alert by number by deactivating it', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        mensal: {
          tipo: 'orcamento_mensal',
          limite: 2000,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        alimentacao: {
          tipo: 'categoria',
          categoria: 'Alimentação',
          limite: 300,
          ativo: true,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'remover alerta 1');

  assert.equal(resposta, 'Alerta de orçamento mensal removido.');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/mensal/ativo'), false);
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/alertas/mensal',
  ]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.removals, []);
});

test('removes an alert by category by deactivating the matching alert', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        alimentacao: {
          tipo: 'categoria',
          categoria: 'Alimentação',
          limite: 300,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar alerta delivery');

  assert.equal(resposta, 'Alerta de Alimentação removido.');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/alimentacao/ativo'), false);
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/alertas/alimentacao',
  ]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.removals, []);
});

test('inactive category alert does not fire after a new expense', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        alimentacao: {
          tipo: 'categoria',
          categoria: 'Alimentação',
          limite: 10,
          ativo: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'mercado 20');

  assert.match(resposta, /mercado/);
  assert.match(resposta, /registrado/);
  assert.doesNotMatch(resposta, /Alerta financeiro/);
  assert.equal(firebase.pushes.length, 1);
  assert.match(firebase.pushes[0].path, /grupos\/SALVAMONEY\/usuarios\/482913\/gastos\//);
  assert.deepEqual(firebase.updates, []);
});

test('category alert fires after a new expense pushes the category over the limit', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        alimentacao: {
          tipo: 'categoria',
          categoria: 'Alimentação',
          limite: 100,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      gastos: {
        mercado_antigo: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado antigo',
          value: 90,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'mercado 20');

  assert.match(resposta, /mercado/);
  assert.match(resposta, /registrado/);
  assert.match(resposta, /Alerta financeiro ⚠️/);
  assert.match(resposta, /Você passou de R\$ 100,00 em Alimentação neste mês\./);
  assert.match(resposta, /Total atual: R\$ 110,00\./);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/alimentacao/ultimoDisparoMes'), currentMonthKey());
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/alimentacao/limite'), 100);
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/alertas/alimentacao',
  ]);
  assert.deepEqual(Object.keys(firebase.updates[0].value).sort(), ['ultimoDisparoMes', 'updatedAt']);
});

test('monthly alert fires after a new expense pushes the month over the limit', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        mensal: {
          tipo: 'orcamento_mensal',
          limite: 100,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      gastos: {
        mercado_antigo: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado antigo',
          value: 90,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'uber 20');

  assert.match(resposta, /uber/);
  assert.match(resposta, /registrado/);
  assert.match(resposta, /Seus gastos do mês passaram de R\$ 100,00\./);
  assert.match(resposta, /Total atual: R\$ 110,00\./);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/mensal/ultimoDisparoMes'), currentMonthKey());
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/alertas/mensal',
  ]);
});

test('alert does not fire twice in the same month', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        alimentacao: {
          tipo: 'categoria',
          categoria: 'Alimentação',
          limite: 100,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      gastos: {
        mercado_antigo: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado antigo',
          value: 90,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const primeiro = await service.processarMensagem('5511999999999', 'mercado 20');
  const segundo = await service.processarMensagem('5511999999999', 'delivery 30');

  assert.match(primeiro, /Alerta financeiro/);
  assert.doesNotMatch(segundo, /Alerta financeiro/);
  assert.equal(firebase.updates.length, 1);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/alimentacao/ultimoDisparoMes'), currentMonthKey());
});

test('monthly alert status update preserves the rest of the alert object', async () => {
  const { firebase, service } = createService({
    seed: alertSeed({
      alertas: {
        mensal: {
          tipo: 'orcamento_mensal',
          limite: 100,
          ativo: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      gastos: {
        mercado_antigo: {
          cat: 'Alimentação',
          date: todayIso(),
          desc: 'Mercado antigo',
          value: 90,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });

  await service.processarMensagem('5511999999999', 'uber 20');

  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/mensal'), {
    tipo: 'orcamento_mensal',
    limite: 100,
    ativo: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ultimoDisparoMes: currentMonthKey(),
    updatedAt: firebase.getValue('grupos/SALVAMONEY/usuarios/482913/alertas/mensal/updatedAt'),
  });
  assert.equal(firebase.updates[0].path, 'grupos/SALVAMONEY/usuarios/482913/alertas/mensal');
  assert.deepEqual(Object.keys(firebase.updates[0].value).sort(), ['ultimoDisparoMes', 'updatedAt']);
});

test('charge command without a valid tag session asks to enter', async () => {
  const { firebase, service } = createService({
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: 'carlos' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobrar 80 de 123456');

  assert.equal(resposta, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('creates a direct charge and notifies the destination phone', async () => {
  const notifications = [];
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobrar 80 da tag 123456 pelo almoço');
  const sent = firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas');
  const received = firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas');
  const id = Object.keys(sent)[0];

  assert.equal(resposta, [
    'Cobrança criada ✅',
    'Almoço — R$ 80,00 para Anna.',
  ].join('\n'));
  assert.equal(id, Object.keys(received)[0]);
  assert.equal(sent[id].id, id);
  assert.equal(sent[id].descricao, 'Almoço');
  assert.equal(sent[id].valorCobrado, 80);
  assert.equal(sent[id].valorTotal, 80);
  assert.equal(sent[id].status, 'pendente');
  assert.deepEqual(received[id], sent[id]);
  assert.deepEqual(notifications, [{
    phone: '5511888888888',
    message: [
      'Carlos te enviou uma cobrança:',
      'Almoço',
      'Valor: R$ 80,00',
      '',
      'Responda:',
      'aceitar cobrança 1',
      'ou',
      'recusar cobrança 1',
    ].join('\n'),
  }]);
  assert.equal(firebase.sets.some((write) => write.path === 'grupos/SALVAMONEY/usuarios/482913'), false);
  assert.equal(firebase.sets.some((write) => write.path === 'grupos/SALVAMONEY/usuarios/123456'), false);
  assert.deepEqual(firebase.updates, []);
  assert.equal(firebase.removals.length, 0);
});

test('creates a percentage charge and registers the origin expense when the user spent money', async () => {
  const notifications = [];
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913', name: 'Carlos' },
  });
  const resposta = await service.processarMensagem(
    '5511999999999',
    'almocei com Anna e gastei 100, ela paga 80%, tag dela 123456'
  );
  const sent = firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas');
  const id = Object.keys(sent)[0];
  const expense = firebase.pushes.find((write) =>
    write.path === `grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}`
  );

  assert.match(resposta, /Cobrança criada ✅/);
  assert.match(resposta, /Almoço — R\$ 80,00 para Anna\./);
  assert.match(resposta, /Também registrei o gasto total de R\$ 100,00 para você\./);
  assert.equal(sent[id].valorTotal, 100);
  assert.equal(sent[id].valorCobrado, 80);
  assert.equal(sent[id].percentual, 80);
  assert.equal(sent[id].origemGastoId, expense.id);
  assert.equal(sent[id].origemGastoMes, currentMonthKey());
  assert.equal(expense.value.desc, 'Almoço');
  assert.equal(expense.value.value, 100);
  assert.equal(expense.value.cobranca, true);
  assert.equal(expense.value.cobrancaId, id);
  assert.equal(notifications.length, 1);
  assert.deepEqual(firebase.getValue(`grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/${id}`), sent[id]);
});

test('charge creation rejects an unknown destination tag', async () => {
  const { firebase, service } = createService({
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobrar 80 de 999999');

  assert.equal(resposta, 'Não encontrei essa tag. Confira a tag de 6 dígitos da pessoa.');
  assertNoFirebaseWrites(firebase);
});

test('charge creation rejects charging the own tag', async () => {
  const { firebase, service } = createService({
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobrar 80 de 482913');

  assert.equal(resposta, 'Você não pode cobrar sua própria tag.');
  assertNoFirebaseWrites(firebase);
});

test('charge creation rejects invalid values', async () => {
  const { firebase, service } = createService({
    seed: chargeUsersSeed(),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobrar 0 de 123456');

  assert.equal(resposta, 'Informe um valor positivo para a cobrança. Exemplo: cobrar 80 de 123456');
  assertNoFirebaseWrites(firebase);
});

test('lists received charges with pending items first', async () => {
  const chargeAccepted = {
    id: 'c2',
    descricao: 'Cinema',
    valorCobrado: 40,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'aceita',
    createdAt: '2026-05-01T12:00:00.000Z',
  };
  const chargePending = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      destinationCharges: {
        c1: chargePending,
        c2: chargeAccepted,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'cobranças recebidas');

  assert.match(resposta, /Cobranças recebidas:/);
  assert.match(resposta, /1\. Almoço — R\$ 80,00 — de Carlos — pendente/);
  assert.match(resposta, /2\. Cinema — R\$ 40,00 — de Carlos — aceita/);
  assert.match(resposta, /Use: aceitar cobrança 1 ou recusar cobrança 1/);
  assertNoFirebaseWrites(firebase);
});

test('lists sent charges', async () => {
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cobranças enviadas');

  assert.match(resposta, /Cobranças enviadas:/);
  assert.match(resposta, /1\. Almoço — R\$ 80,00 — para Anna — pendente/);
  assert.match(resposta, /Use: cancelar cobrança 1/);
  assertNoFirebaseWrites(firebase);
});

test('accepting a charge updates both copies and notifies the origin', async () => {
  const notifications = [];
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    phoneOrigem: '5511999999999',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    phoneDestino: '5511888888888',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'aceitar cobrança 1');

  assert.equal(resposta, 'Você aceitou a cobrança de R$ 80,00 referente a Almoço.');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/status'), 'aceita');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1/status'), 'aceita');
  assert.equal(typeof firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/respondedAt'), 'string');
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1',
    'grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1',
  ]);
  assert.deepEqual(notifications, [{
    phone: '5511999999999',
    message: 'Anna aceitou sua cobrança de R$ 80,00 referente a Almoço.',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
});

test('declining a charge updates both copies and notifies the origin', async () => {
  const notifications = [];
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    phoneOrigem: '5511999999999',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    phoneDestino: '5511888888888',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'recusar 1');

  assert.equal(resposta, 'Você recusou a cobrança de R$ 80,00 referente a Almoço.');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/status'), 'recusada');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1/status'), 'recusada');
  assert.deepEqual(notifications, [{
    phone: '5511999999999',
    message: 'Anna recusou sua cobrança de R$ 80,00 referente a Almoço.',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
});

test('canceling a sent charge updates both copies and notifies the destination', async () => {
  const notifications = [];
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    phoneOrigem: '5511999999999',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    phoneDestino: '5511888888888',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cancelar cobrança almoço');

  assert.equal(resposta, 'Cobrança cancelada: Almoço — R$ 80,00.');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/status'), 'cancelada');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1/status'), 'cancelada');
  assert.deepEqual(notifications, [{
    phone: '5511888888888',
    message: 'Carlos cancelou a cobrança de R$ 80,00 referente a Almoço.',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
});

test('marking an accepted sent charge as paid updates both copies and notifies the destination', async () => {
  const notifications = [];
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    phoneOrigem: '5511999999999',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    phoneDestino: '5511888888888',
    status: 'aceita',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed({
      origin: {
        fixos: {
          internet: {
            desc: 'Internet',
            value: 100,
          },
        },
      },
      originCharges: {
        c1: charge,
      },
      destinationCharges: {
        c1: charge,
      },
      gastos: {
        antigo: {
          desc: 'Mercado',
          value: 45,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'recebi cobrança 1');

  assert.equal(resposta, [
    'Cobrança marcada como paga ✅',
    'Almoço — R$ 80,00',
  ].join('\n'));
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/status'), 'paga');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1/status'), 'paga');
  assert.equal(typeof firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/paidAt'), 'string');
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1',
    'grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1',
  ]);
  assert.deepEqual(Object.keys(firebase.updates[0].value).sort(), ['paidAt', 'status', 'updatedAt']);
  assert.deepEqual(notifications, [{
    phone: '5511888888888',
    message: 'Carlos marcou como paga a cobrança de R$ 80,00 referente a Almoço.',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/antigo/value`), 45);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/internet/value'), 100);
});

test('marking an accepted received charge as paid updates both copies and notifies the origin', async () => {
  const notifications = [];
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    phoneOrigem: '5511999999999',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    phoneDestino: '5511888888888',
    status: 'aceita',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    notificationSender: async (phone, message) => {
      notifications.push({ phone, message });
    },
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
      destination: {
        gastos: {
          [currentMonthKey()]: {
            antigo: {
              desc: 'Farmácia',
              value: 30,
            },
          },
        },
      },
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'paguei a cobrança 1');

  assert.equal(resposta, [
    'Cobrança marcada como paga ✅',
    'Almoço — R$ 80,00',
  ].join('\n'));
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1/status'), 'paga');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1/status'), 'paga');
  assert.deepEqual(firebase.updates.map((write) => write.path), [
    'grupos/SALVAMONEY/usuarios/482913/cobrancasEnviadas/c1',
    'grupos/SALVAMONEY/usuarios/123456/cobrancasRecebidas/c1',
  ]);
  assert.deepEqual(notifications, [{
    phone: '5511999999999',
    message: 'Anna marcou como paga a cobrança de R$ 80,00 referente a Almoço.',
  }]);
  assert.equal(firebase.pushes.length, 0);
  assert.deepEqual(firebase.sets, []);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/123456/gastos/${currentMonthKey()}/antigo/value`), 30);
});

test('marking a pending charge as paid is blocked', async () => {
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'pendente',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'paguei cobrança 1');

  assert.equal(resposta, 'Essa cobrança ainda está pendente e não pode ser marcada como paga.');
  assertNoFirebaseWrites(firebase);
});

test('marking a declined charge as paid is blocked', async () => {
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'recusada',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'paguei cobrança 1');

  assert.equal(resposta, 'Essa cobrança está recusada e não pode ser marcada como paga.');
  assertNoFirebaseWrites(firebase);
});

test('marking a canceled charge as paid is blocked', async () => {
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'cancelada',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      originCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'recebi cobrança 1');

  assert.equal(resposta, 'Essa cobrança está cancelada e não pode ser marcada como paga.');
  assertNoFirebaseWrites(firebase);
});

test('ambiguous paid charge command asks the user to list charges first', async () => {
  const receivedCharge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '123456',
    nomeOrigem: 'Anna',
    tagDestino: '482913',
    nomeDestino: 'Carlos',
    status: 'aceita',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const sentCharge = {
    id: 'c2',
    descricao: 'Cinema',
    valorCobrado: 40,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'aceita',
    createdAt: '2026-05-03T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      originCharges: {
        c2: sentCharge,
      },
      origin: {
        cobrancasRecebidas: {
          c1: receivedCharge,
        },
      },
    }),
    session: { group: 'SALVAMONEY', user: '482913', tag: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'marcar cobrança 1 como paga');

  assert.equal(
    resposta,
    'Essa cobrança pode estar nas recebidas ou enviadas. Liste primeiro com: cobranças recebidas ou cobranças enviadas.'
  );
  assertNoFirebaseWrites(firebase);
});

test('accepting an already answered charge is blocked', async () => {
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'aceita',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'aceitar cobrança 1');

  assert.equal(resposta, 'Não encontrei cobranças pendentes para responder.');
  assertNoFirebaseWrites(firebase);
});

test('declining an already answered charge is blocked', async () => {
  const charge = {
    id: 'c1',
    descricao: 'Almoço',
    valorCobrado: 80,
    tagOrigem: '482913',
    nomeOrigem: 'Carlos',
    tagDestino: '123456',
    nomeDestino: 'Anna',
    status: 'recusada',
    createdAt: '2026-05-02T12:00:00.000Z',
  };
  const { firebase, service } = createService({
    seed: chargeUsersSeed({
      destinationCharges: {
        c1: charge,
      },
    }),
    session: { group: 'SALVAMONEY', user: '123456', tag: '123456' },
  });
  const resposta = await service.processarMensagem('5511888888888', 'recusar cobrança 1');

  assert.equal(resposta, 'Não encontrei cobranças pendentes para responder.');
  assertNoFirebaseWrites(firebase);
});

test('normal text expense asks to link an account after sair da conta', async () => {
  const { firebase, service } = createStatefulService({
    initialSession: { group: 'SALVAMONEY', user: '482913' },
    seed: expenseSeed(),
  });
  const logout = await service.processarMensagem('5511999999999', 'sair da conta');
  const resposta = await service.processarMensagem('5511999999999', '35 uber');

  assert.match(logout, /Você saiu da sua conta atual/);
  assert.match(resposta, /crie sua conta pelo WhatsApp/);
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
    session: { group: 'SALVAMONEY', user: '482913' },
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
    session: { group: 'SALVAMONEY', user: '482913' },
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
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'listar gastos');

  assert.match(resposta, /Últimos gastos/);
  assert.match(resposta, /mercado/);
  assert.match(resposta, /R\$ 45,00/);
  assert.doesNotMatch(resposta, /novo caminho/);
});

test('cadastrar fixo with day saves the site-compatible fixed expense schema', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem(
    '5511999999999',
    'gasto fixo de 89,90 com internet todo dia 10'
  );

  assert.match(resposta, /Gasto fixo cadastrado/);
  assert.match(resposta, /internet/);
  assert.match(resposta, /R\$ 89,90/);
  assert.match(resposta, /Dia: 10/);
  assert.match(resposta, /não gerou gasto mensal agora/);
  assert.deepEqual(firebase.pushes, [{
    id: 'push_1',
    path: 'grupos/SALVAMONEY/usuarios/482913/fixos',
    value: {
      desc: 'internet',
      value: 89.9,
      cat: 'Moradia',
      dia: 10,
    },
  }]);
  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/push_1'), {
    desc: 'internet',
    value: 89.9,
    cat: 'Moradia',
    dia: 10,
  });
});

test('cadastrar fixo without day asks for the day and does not save', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'cadastrar fixo internet 99,90');

  assert.equal(resposta, [
    'Informe o dia do mês para esse gasto fixo.',
    '',
    'Exemplo:',
    'fixo internet 99,90 dia 10',
  ].join('\n'));
  assert.deepEqual(firebase.pushes, []);
});

test('listar fixos reads the legacy site fixed expenses path', async () => {
  const { service } = createService({
    seed: fixedExpenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'listar fixos');

  assert.match(resposta, /Gastos fixos/);
  assert.match(resposta, /1\. academia — R\$ 120,00 — Academia — dia 5/);
  assert.match(resposta, /2\. internet — R\$ 99,90 — Moradia — dia 10/);
});

test('remover fixo unique match removes only the fixed expense', async () => {
  const { firebase, service } = createService({
    seed: fixedExpenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar fixo internet');

  assert.match(resposta, /Gasto fixo removido/);
  assert.match(resposta, /internet/);
  assert.deepEqual(firebase.removals, [
    'grupos/SALVAMONEY/usuarios/482913/fixos/fixo_internet',
  ]);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/fixo_internet'), undefined);
  assert.deepEqual(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/gasto_internet`), {
    cat: 'Moradia',
    createdAt: '2026-05-20T10:00:00.000Z',
    date: todayIso(),
    desc: 'internet',
    value: 99.9,
  });
});

test('remover fixo ambiguous match lists candidates and waits for a number', async () => {
  const seed = fixedExpenseSeed();
  seed.grupos.SALVAMONEY.usuarios[482913].fixos.fixo_internet_casa = {
    cat: 'Moradia',
    desc: 'internet casa',
    dia: 15,
    value: 119.9,
  };
  const { firebase, getSession, service } = createStatefulService({
    initialSession: { group: 'SALVAMONEY', user: '482913' },
    seed,
  });
  const resposta = await service.processarMensagem('5511999999999', 'remover fixo internet');

  assert.match(resposta, /Encontrei estes gastos fixos/);
  assert.match(resposta, /1\. internet — R\$ 99,90 — Moradia — dia 10/);
  assert.match(resposta, /2\. internet casa — R\$ 119,90 — Moradia — dia 15/);
  assert.deepEqual(firebase.removals, []);
  assert.equal(getSession().pendingDelete.type, 'fixed_expense_selection');
  assert.deepEqual(getSession().pendingDelete.candidates.map((item) => item.id), [
    'fixo_internet',
    'fixo_internet_casa',
  ]);
});

test('pending fixed expense selection removes only the selected fixed expense', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'SALVAMONEY',
      user: '482913',
      pendingDelete: {
        type: 'fixed_expense_selection',
        candidates: [
          {
            id: 'fixo_internet',
            desc: 'internet',
            value: 99.9,
            cat: 'Moradia',
            dia: 10,
          },
          {
            id: 'fixo_academia',
            desc: 'academia',
            value: 120,
            cat: 'Academia',
            dia: 5,
          },
        ],
      },
    },
    seed: fixedExpenseSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', '2');

  assert.match(resposta, /Gasto fixo removido/);
  assert.match(resposta, /academia/);
  assert.deepEqual(getSession(), {
    group: 'SALVAMONEY',
    user: '482913',
  });
  assert.deepEqual(firebase.removals, [
    'grupos/SALVAMONEY/usuarios/482913/fixos/fixo_academia',
  ]);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/fixo_academia'), undefined);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/fixos/fixo_internet').desc, 'internet');
});

test('apagar fixo command does not fall through to normal expense deletion', async () => {
  const { firebase, service } = createService({
    seed: fixedExpenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar fixo telefone');

  assert.equal(resposta, 'Não encontrei nenhum gasto fixo parecido. Nenhum gasto foi apagado.');
  assert.deepEqual(firebase.removals, []);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/gasto_internet`).desc, 'internet');
});

test('fixed expense commands require a linked session', async () => {
  const { firebase, service } = createService({
    seed: fixedExpenseSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'fixo aluguel 1800 dia 10');

  assert.match(resposta, /crie sua conta pelo WhatsApp/);
  assert.deepEqual(firebase.pushes, []);
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
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar ultimo');

  assert.match(resposta, /Apaguei/);
  assert.match(resposta, /uber/);
  assert.equal(firebase.removals.length, 1);
  assert.equal(firebase.removals[0], `grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/ultimo`);
  assert.deepEqual(firebase.getValue(`transactionsByUser/5511999999999/${currentMonthKey()}/ultimo`), {
    cat: 'Transporte',
    desc: 'uber',
    value: 20,
  });
});

test('apagar mercado lists matching candidates and does not delete immediately', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: { group: 'SALVAMONEY', user: '482913' },
    seed: deleteSelectionSeed(),
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar mercado');

  assert.match(resposta, /Encontrei estes gastos parecidos/);
  assert.match(resposta, /1\. Mercado extra — R\$ 75,00 — Alimentação/);
  assert.match(resposta, /2\. Mercado — R\$ 50,00 — Alimentação/);
  assert.match(resposta, /Responda com o número/);
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(getSession(), {
    group: 'SALVAMONEY',
    user: '482913',
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
      group: 'SALVAMONEY',
      user: '482913',
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
    group: 'SALVAMONEY',
    user: '482913',
  });
  assert.deepEqual(firebase.removals, [
    `grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/mercado_2`,
    `transactionsByUser/5511999999999/${currentMonthKey()}/mercado_2`,
  ]);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/mercado_2`), undefined);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/mercado_1`).desc, 'Mercado');
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/uber_1`).desc, 'Uber');
});

test('pending delete cancellation clears state without removing expenses', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'SALVAMONEY',
      user: '482913',
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
    group: 'SALVAMONEY',
    user: '482913',
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
      group: 'SALVAMONEY',
      user: '482913',
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
      group: 'SALVAMONEY',
      user: '482913',
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
    group: 'SALVAMONEY',
    user: '482913',
  });
  assert.deepEqual(firebase.removals, [
    `grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/tv_1`,
    `transactionsByUser/5511999999999/${currentMonthKey()}/tv_1`,
  ]);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/tv_1`), undefined);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${currentMonthKey()}/uber_1`).desc, 'Uber');
});

test('apagar unknown free text does not remove anything', async () => {
  const { firebase, savedSessions, service } = createService({
    seed: deleteSelectionSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar farmacia');

  assert.equal(resposta, 'Não encontrei nenhum gasto parecido. Nenhum gasto foi apagado.');
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(savedSessions, []);
});

test('apagar parcelas da tv lists installment candidates without deleting immediately', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: { group: 'SALVAMONEY', user: '482913' },
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
    group: 'SALVAMONEY',
    user: '482913',
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
      group: 'SALVAMONEY',
      user: '482913',
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
    group: 'SALVAMONEY',
    user: '482913',
    pendingDelete: {
      type: 'installment_confirmation',
      installment,
    },
  });
});

test('installment final confirmation removes only expenses with the selected parcelaId across months', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'SALVAMONEY',
      user: '482913',
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
    group: 'SALVAMONEY',
    user: '482913',
  });
  assert.deepEqual(firebase.removals, [
    `grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(0)}/tv_1`,
    `transactionsByUser/5511999999999/${monthKeyOffset(0)}/tv_1`,
    `grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(1)}/tv_2`,
    `transactionsByUser/5511999999999/${monthKeyOffset(1)}/tv_2`,
    `grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(2)}/tv_3`,
    `transactionsByUser/5511999999999/${monthKeyOffset(2)}/tv_3`,
  ]);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(0)}/tv_1`), undefined);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(1)}/tv_2`), undefined);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(2)}/tv_3`), undefined);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(0)}/tv_sala_1`).parcelaId, 'tv-456');
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(1)}/tv_sala_2`).parcelaId, 'tv-456');
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(0)}/tv_normal`).desc, 'TV');
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(1)}/notebook_1`).parcelaId, 'note-999');
});

test('installment final confirmation cancellation keeps all installments', async () => {
  const { firebase, getSession, service } = createStatefulService({
    initialSession: {
      group: 'SALVAMONEY',
      user: '482913',
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
    group: 'SALVAMONEY',
    user: '482913',
  });
  assert.deepEqual(firebase.removals, []);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(0)}/tv_1`).parcelaId, 'tv-123');
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(1)}/tv_2`).parcelaId, 'tv-123');
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(2)}/tv_3`).parcelaId, 'tv-123');
});

test('new delete command clears an active expense selection before processing installment deletion', async () => {
  const { firebase, getSession, savedSessions, service } = createStatefulService({
    initialSession: {
      group: 'SALVAMONEY',
      user: '482913',
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
      group: 'SALVAMONEY',
      user: '482913',
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
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar parcelamento geladeira');

  assert.equal(resposta, 'Não encontrei nenhum parcelamento parecido. Nenhum gasto foi apagado.');
  assert.deepEqual(firebase.removals, []);
  assert.deepEqual(savedSessions, []);
  assert.equal(firebase.getValue(`grupos/SALVAMONEY/usuarios/482913/gastos/${monthKeyOffset(0)}/tv_normal`).desc, 'TV');
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
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'desfaz aquele gasto do mercado');

  assert.match(resposta, /Para apagar com segurança/);
  assert.deepEqual(firebase.removals, []);
});

test('parcelamento writes one installment per month to the fake Firebase tree', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
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
      legacyGroup: 'SALVAMONEY',
      legacyUser: '482913',
      legacyExpenseId: 'push_1',
      migrated: false,
      sourcePath: `${firebase.pushes[0].path}/push_1`,
    },
  });
});

test('parcelamento rounds installment values for 100 in 3x using the site-compatible schema', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'parcelei 100 compra em 3x');

  assert.match(resposta, /3x de R\$ 33,33/);
  assert.equal(firebase.pushes.length, 3);

  const parcelaId = firebase.pushes[0].value.parcelaId;

  assert.ok(parcelaId);

  firebase.pushes.forEach((push, index) => {
    assert.match(push.path, /grupos\/SALVAMONEY\/usuarios\/482913\/gastos\//);
    assert.equal(push.value.desc, `compra (${index + 1}/3x)`);
    assert.equal(push.value.value, 33.33);
    assert.equal(push.value.user, '482913');
    assert.equal(push.value.viaBot, true);
    assert.equal(push.value.parcelaId, parcelaId);
    assert.equal(push.value.parcelaNum, index + 1);
    assert.equal(push.value.parcelaTotal, 3);
    assert.equal(push.value.origem, 'bot');
    assert.equal(push.value.parcela, undefined);
  });
});

test('parcelamento accepts the help menu example with amount before installments', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gastei 120 em 3x no cartão');

  assert.match(resposta, /3x de R\$ 40,00/);
  assert.equal(firebase.pushes.length, 3);
  assert.equal(firebase.pushes[0].value.desc, 'cartão (1/3x)');
  assert.equal(firebase.pushes[0].value.value, 40);
  assert.equal(firebase.pushes[0].value.user, '482913');
});

test('audio transcription can register parcelamento through the current text flow', async () => {
  const { firebase, service } = createService({
    groqOverrides: {
      transcreverAudio: async () => 'parcelei 300 fone em 3x',
    },
    seed: expenseSeed(),
    session: { group: 'SALVAMONEY', user: '482913' },
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
    session: { group: 'SALVAMONEY', user: '482913' },
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
    session: { group: 'SALVAMONEY', user: '482913' },
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
    session: { group: 'SALVAMONEY', user: '482913' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'gasto do curso');

  assert.match(resposta, /curso/);
  assert.match(resposta, /registrado/);
  assert.equal(firebase.pushes.length, 1);
  assert.equal(firebase.pushes[0].value.origem, 'ia');
});
