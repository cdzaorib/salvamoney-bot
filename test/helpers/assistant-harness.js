'use strict';

const { createBotService } = require('../../src/bot-service');
const { createFakeFirebase } = require('./fake-firebase');

const ALL_FEATURES = {
  advisor: true,
  cards: true,
  conversationalAi: false,
  friends: true,
  investmentResearch: true,
  personalities: true,
  proactive: true,
  splits: true,
};

const USERS = {
  ana: { name: 'Ana Souza', phone: '5511911111111', tag: '111111' },
  carlos: { name: 'Carlos Lima', phone: '5511922222222', tag: '222222' },
  bia: { name: 'Beatriz Rocha', phone: '5511933333333', tag: '333333' },
};

function baseSeed(extraUsers = {}) {
  const usuarios = {};
  const shareTags = {};
  const users = {};

  Object.values(USERS).forEach((user) => {
    usuarios[user.tag] = { nome: user.name, phone: user.phone, tag: user.tag, ...(extraUsers[user.tag] || {}) };
    shareTags[user.tag] = { phone: user.phone };
    users[user.phone] = { name: user.name, phone: user.phone, shareTag: user.tag, tag: user.tag };
  });

  return {
    grupos: { SALVAMONEY: { usuarios } },
    shareTags,
    users,
  };
}

function friendsSeed() {
  return baseSeed({
    111111: {
      amigos: {
        222222: { apelido: 'Carlos', estado: 'ativa' },
        333333: { apelido: 'Bia', estado: 'ativa' },
      },
      cartoes: {
        c_nubank: { apelido: 'Nubank', diaFechamento: 3, diaVencimento: 10, padrao: true },
        c_inter: { apelido: 'Inter', diaFechamento: 20, diaVencimento: 28, padrao: false },
      },
    },
    222222: { amigos: { 111111: { apelido: 'Ana', estado: 'ativa' } } },
    333333: { amigos: { 111111: { apelido: 'Ana', estado: 'ativa' } } },
  });
}

function sessionFor(user) {
  return { group: 'SALVAMONEY', name: user.name.split(' ')[0], tag: user.tag, user: user.tag };
}

function createHarness({
  aiGateway = null,
  braveClient = null,
  configOverrides = {},
  costTracker = null,
  features = ALL_FEATURES,
  firebaseOpsOverrides = {},
  groq = {},
  logger = { error() {}, info() {}, warn() {} },
  now = new Date('2026-09-25T15:00:00.000Z'),
  seed = friendsSeed(),
} = {}) {
  const firebase = createFakeFirebase(seed);
  const sessions = Object.fromEntries(Object.values(USERS).map((user) => [user.phone, sessionFor(user)]));
  const sent = [];
  const clock = { now };
  const service = createBotService({
    aiGateway,
    braveClient,
    config: {
      ai: { consentVersion: 'v-test', researchDeadlineMs: 12000, textDeadlineMs: 3000 },
      features,
      groqApiKey: '',
      monthIndexMode: 'zero',
      siteUrl: 'https://site.example/',
      timeZone: 'America/Sao_Paulo',
      ...configOverrides,
    },
    costTracker,
    db: {},
    firebaseOps: { ...firebase.ops, ...firebaseOpsOverrides },
    groq,
    logger,
    notificationSender: async (phone, message) => {
      sent.push({ message, phone });
      return true;
    },
    now: () => clock.now,
    safeLog: { logMediaUrl: (value) => value, logText: (value) => value, maskPhone: (value) => value },
    sessionStore: {
      getSession: async (phone) => sessions[phone] || null,
      saveSession: async (phone, data) => {
        sessions[phone] = data;
      },
    },
  });
  let counter = 0;

  async function say(user, text, { messageId } = {}) {
    counter += 1;

    return await service.processarMensagem(user.phone, text, null, { messageId: messageId || `msg-${counter}` });
  }

  function takeSent() {
    return sent.splice(0);
  }

  function userValue(user, path = '') {
    return firebase.getValue(`grupos/SALVAMONEY/usuarios/${user.tag}${path ? `/${path}` : ''}`);
  }

  return {
    clock,
    firebase,
    say,
    sent,
    service,
    sessions,
    takeSent,
    userValue,
  };
}

module.exports = {
  ALL_FEATURES,
  USERS,
  baseSeed,
  createHarness,
  friendsSeed,
  sessionFor,
};
