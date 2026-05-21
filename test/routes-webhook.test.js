'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRoutes } = require('../src/routes');
const { createWebhookParser } = require('../src/webhook-parser');

function createFakeApp() {
  const handlers = new Map();

  return {
    delete(path, handler) {
      handlers.set(`DELETE ${path}`, handler);
    },
    get(path, handler) {
      handlers.set(`GET ${path}`, handler);
    },
    handler(method, path) {
      return handlers.get(`${method} ${path}`);
    },
    post(path, handler) {
      handlers.set(`POST ${path}`, handler);
    },
  };
}

function createResponse() {
  return {
    body: null,
    headers: {},
    statusCode: null,
    json(body) {
      this.body = body;
      return this;
    },
    send() {
      return this;
    },
    sendStatus(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function evolutionTextPayload(event = 'messages.upsert') {
  return {
    event,
    data: {
      key: {
        id: `id-${event}`,
        remoteJid: '5511987654321@s.whatsapp.net',
      },
      message: {
        conversation: 'oi',
      },
    },
  };
}

function createWebhookHarness() {
  const app = createFakeApp();
  const processed = [];
  const sent = [];

  registerRoutes({
    app,
    botService: {
      apagarGastoPorId: async () => {},
      dateParts: () => ({ month: '05' }),
      getGastosMesComIds: async () => [],
      MESES: [],
      processarMensagem: async (phone, text, mediaInfo) => {
        processed.push({ phone, text, mediaInfo });
        return 'resposta';
      },
    },
    config: {
      dashboardToken: '',
      groqApiKey: '',
      siteUrl: 'https://site.example/',
      webhookToken: '',
      whatsappProvider: 'evolution',
    },
    messageDedupe: {
      isDuplicateMessage: () => false,
    },
    safeLog: {
      logPhoneCandidates: (value) => value,
      logText: (value) => value,
      maskPhone: (value) => value,
    },
    sendMessage: async (phone, message, messageId) => {
      sent.push({ phone, message, messageId });
    },
    sessionStore: {
      getSession: async () => null,
    },
    webhookParser: createWebhookParser('evolution'),
  });

  return {
    handler: app.handler('POST', '/webhook'),
    processed,
    sent,
  };
}

test('webhook route processes Evolution messages.upsert and sends a reply through the fake sender', async () => {
  const { handler, processed, sent } = createWebhookHarness();
  const res = createResponse();

  await handler({ body: evolutionTextPayload(), get: () => '', query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(processed, [{
    phone: '5511987654321',
    text: 'oi',
    mediaInfo: {
      type: null,
      base64: null,
      mediaUrl: null,
      mimeType: null,
    },
  }]);
  assert.deepEqual(sent, [{
    phone: '5511987654321',
    message: 'resposta',
    messageId: 'id-messages.upsert',
  }]);
});

test('webhook route keeps accepting Evolution MESSAGES_UPSERT casing', async () => {
  const { handler, processed, sent } = createWebhookHarness();

  await handler({ body: evolutionTextPayload('MESSAGES_UPSERT'), get: () => '', query: {} }, createResponse());

  assert.equal(processed.length, 1);
  assert.equal(sent.length, 1);
});

test('webhook route ignores fromMe payload before bot processing', async () => {
  const { handler, processed, sent } = createWebhookHarness();
  const payload = evolutionTextPayload();

  payload.data.key.fromMe = true;
  await handler({ body: payload, get: () => '', query: {} }, createResponse());

  assert.equal(processed.length, 0);
  assert.equal(sent.length, 0);
});

test('webhook route ignores group payload before bot processing', async () => {
  const { handler, processed, sent } = createWebhookHarness();
  const payload = evolutionTextPayload();

  payload.data.key.remoteJid = '120363000000000000@g.us';
  await handler({ body: payload, get: () => '', query: {} }, createResponse());

  assert.equal(processed.length, 0);
  assert.equal(sent.length, 0);
});
