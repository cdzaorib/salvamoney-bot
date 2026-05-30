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

function createWebhookHarness({
  configOverrides = {},
  session = null,
} = {}) {
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
      requireRouteTokens: false,
      siteUrl: 'https://site.example/',
      webhookToken: '',
      ...configOverrides,
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
      getSession: async () => session,
    },
    webhookParser: createWebhookParser(),
  });

  return {
    app,
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

test('production webhook refuses requests while token is missing', async () => {
  const { handler, processed } = createWebhookHarness({
    configOverrides: {
      requireRouteTokens: true,
    },
  });
  const res = createResponse();

  await handler({ body: evolutionTextPayload(), get: () => '', query: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Webhook não autorizado.' });
  assert.deepEqual(processed, []);
});

test('production webhook accepts the configured token and refuses a wrong token', async () => {
  const { handler, processed } = createWebhookHarness({
    configOverrides: {
      requireRouteTokens: true,
      webhookToken: 'webhook-secret',
    },
  });
  const accepted = createResponse();
  const refused = createResponse();

  await handler({
    body: evolutionTextPayload(),
    get: (name) => name === 'x-webhook-token' ? 'webhook-secret' : '',
    query: {},
  }, accepted);
  await handler({
    body: evolutionTextPayload(),
    get: (name) => name === 'x-webhook-token' ? 'wrong-secret' : '',
    query: {},
  }, refused);

  assert.equal(accepted.statusCode, 200);
  assert.equal(refused.statusCode, 401);
  assert.equal(processed.length, 1);
});

test('production dashboard API refuses requests while token is missing', async () => {
  const { app } = createWebhookHarness({
    configOverrides: {
      requireRouteTokens: true,
    },
  });
  const res = createResponse();

  await app.handler('GET', '/api/dashboard')({
    get: () => '',
    query: { phone: '5511999999999' },
  }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Dashboard não autorizado.' });
});

test('production dashboard delete refuses requests while token is missing', async () => {
  const { app } = createWebhookHarness({
    configOverrides: {
      requireRouteTokens: true,
    },
  });
  const res = createResponse();

  await app.handler('DELETE', '/api/gasto/:id')({
    get: () => '',
    params: { id: 'gasto_1' },
    query: { phone: '5511999999999' },
  }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'Dashboard não autorizado.' });
});

test('production dashboard API accepts the configured token and refuses a wrong token', async () => {
  const { app } = createWebhookHarness({
    configOverrides: {
      dashboardToken: 'dashboard-secret',
      requireRouteTokens: true,
    },
    session: {
      group: 'SALVAMONEY',
      user: '482913',
    },
  });
  const accepted = createResponse();
  const refused = createResponse();
  const handler = app.handler('GET', '/api/dashboard');

  await handler({
    get: (name) => name === 'x-dashboard-token' ? 'dashboard-secret' : '',
    query: { phone: '5511999999999' },
  }, accepted);
  await handler({
    get: (name) => name === 'x-dashboard-token' ? 'wrong-secret' : '',
    query: { phone: '5511999999999' },
  }, refused);

  assert.equal(accepted.body.ok, true);
  assert.equal(refused.statusCode, 401);
});
