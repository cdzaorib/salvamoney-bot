'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRoutes } = require('../src/routes');
const { createWebhookParser } = require('../src/webhook-parser');
const { USERS, createHarness, friendsSeed } = require('./helpers/assistant-harness');

async function createCardSplit(harness) {
  await harness.say(USERS.ana, 'dividir 90 no pix com Carlos');
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();
}

test('rollback: cobrança criada no fluxo novo continua utilizável com as flags desligadas', async () => {
  const harness = createHarness();

  await createCardSplit(harness);

  const legacy = createHarness({ features: {}, seed: JSON.parse(JSON.stringify(harness.firebase.data)) });
  const list = await legacy.say(USERS.carlos, 'cobranças recebidas');
  const accepted = await legacy.say(USERS.carlos, 'aceitar cobrança 1');
  const [notice] = legacy.takeSent();

  assert.match(list, /R\$ 45,00/);
  assert.match(accepted, /Você aceitou a cobrança de R\$ 45,00/);
  assert.equal(notice.phone, USERS.ana.phone, 'notificação usa o telefone do cadastro da tag');
});

test('compatibilidade: comandos antigos ("cobranças recebidas", "marcar como paga") usam o fluxo novo', async () => {
  const harness = createHarness();

  await createCardSplit(harness);
  assert.match(await harness.say(USERS.carlos, 'cobranças recebidas'), /A pagar \(R\$ 45,00\)/);
  assert.match(await harness.say(USERS.ana, 'cobranças enviadas'), /A receber \(R\$ 45,00\)/);
  assert.match(await harness.say(USERS.carlos, 'marcar cobrança 1 como paga'), /informado/);
  assert.equal(harness.userValue(USERS.ana, `cobrancasEnviadas/${Object.keys(harness.userValue(USERS.ana, 'cobrancasEnviadas'))[0]}/estado`), 'pagamento_informado');
});

test('idempotência por mensagem: retry do webhook não duplica cobrança antiga por tag', async () => {
  const harness = createHarness({ features: {}, seed: friendsSeed() });

  await harness.say(USERS.ana, 'cobrar 80 de 222222 pelo almoço', { messageId: 'wamid-charge' });
  assert.match(await harness.say(USERS.ana, 'cobrar 80 de 222222 pelo almoço', { messageId: 'wamid-charge' }), /já foi registrada/);
  assert.equal(Object.keys(harness.userValue(USERS.ana, 'cobrancasEnviadas')).length, 1);
});

test('webhook repassa o messageId para a chave idempotente do processamento', async () => {
  const handlers = new Map();
  const processed = [];

  registerRoutes({
    app: {
      delete: () => {},
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: (path, handler) => handlers.set(`POST ${path}`, handler),
    },
    botService: {
      processarMensagem: async (phone, text, mediaInfo, options) => {
        processed.push(options);
        return null;
      },
    },
    config: { requireRouteTokens: false, webhookToken: '' },
    messageDedupe: { isDuplicateMessage: () => false },
    safeLog: { logPhoneCandidates: (value) => value, logText: () => '', maskPhone: () => '' },
    sendMessage: async () => true,
    sessionStore: { getSession: async () => null },
    webhookParser: createWebhookParser(),
  });

  await handlers.get('POST /webhook')({
    body: { data: { key: { id: 'WAMID-42', remoteJid: '5511911111111@s.whatsapp.net' }, message: { conversation: 'oi' } }, event: 'messages.upsert' },
    get: () => '',
    query: {},
  }, { sendStatus: () => {}, status: () => ({ json: () => {} }) });

  assert.deepEqual(processed, [{ messageId: 'WAMID-42' }]);
});

test('health: expõe apenas o estado (booleano) de cada feature flag', async () => {
  const handlers = new Map();

  registerRoutes({
    app: {
      delete: () => {},
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: () => {},
    },
    botService: {},
    config: { features: { cards: true, splits: false }, groqApiKey: 'segredo', siteUrl: 'x' },
    messageDedupe: {},
    safeLog: { logPhoneCandidates: () => ({}), logText: () => '', maskPhone: () => '' },
    sendMessage: async () => true,
    sessionStore: { getSession: async () => null },
    webhookParser: createWebhookParser(),
  });

  let body;

  handlers.get('GET /')({}, { json: (value) => { body = value; } });

  assert.equal(body.features.cards, true);
  assert.equal(body.features.splits, false);
  assert.doesNotMatch(JSON.stringify(body), /segredo/);
});
