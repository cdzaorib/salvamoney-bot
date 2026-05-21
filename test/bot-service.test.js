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

function createService({
  configOverrides = {},
  groqOverrides = {},
  seed = {},
  session = null,
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
  });

  return {
    firebase,
    savedSessions,
    service,
  };
}

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

test('resumo summarizes the current month session expenses', async () => {
  const { service } = createService({
    seed: expenseSeed({
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
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'resumo');

  assert.match(resposta, /Resumo de/);
  assert.match(resposta, /Total: R\$ 55,00/);
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
    seed: expenseSeed({
      gasto_1: {
        cat: 'Alimentação',
        createdAt: '2026-05-20T10:00:00.000Z',
        date: todayIso(),
        desc: 'mercado',
        value: 45,
      },
    }),
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'listar gastos');

  assert.match(resposta, /Últimos gastos/);
  assert.match(resposta, /mercado/);
  assert.match(resposta, /R\$ 45,00/);
});

test('apagar ultimo removes the latest expense in the fake Firebase tree', async () => {
  const { firebase, service } = createService({
    seed: expenseSeed({
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
    session: { group: 'CASA2024', user: 'Ana' },
  });
  const resposta = await service.processarMensagem('5511999999999', 'apagar ultimo');

  assert.match(resposta, /Apaguei/);
  assert.match(resposta, /uber/);
  assert.equal(firebase.removals.length, 1);
  assert.match(firebase.removals[0], /\/ultimo$/);
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
  assert.equal(firebase.pushes[0].value.origem, 'parcelamento');
  assert.deepEqual(firebase.pushes[0].value.parcela, {
    numero: 1,
    total: 12,
    valorTotal: 1200,
  });
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
