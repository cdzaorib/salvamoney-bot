'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdempotencyStore } = require('../src/services/idempotency-store');
const { ALL_FEATURES, USERS, createHarness } = require('./helpers/assistant-harness');
const { createFakeFirebase } = require('./helpers/fake-firebase');

function expenses(harness, user) {
  return Object.values(harness.userValue(user, 'gastos') || {}).flatMap((month) => Object.values(month));
}

test('idempotência: retry do webhook com o mesmo messageId não duplica o gasto', async () => {
  const harness = createHarness();

  const first = await harness.say(USERS.ana, 'gastei 30 no mercado', { messageId: 'wamid-1' });
  const retry = await harness.say(USERS.ana, 'gastei 30 no mercado', { messageId: 'wamid-1' });
  const other = await harness.say(USERS.ana, 'gastei 30 no mercado', { messageId: 'wamid-2' });

  assert.match(first, /registrado/);
  assert.match(retry, /já foi registrada/);
  assert.match(other, /registrado/);
  assert.equal(expenses(harness, USERS.ana).length, 2);
});

test('idempotência: gasto duplicado após reinício do processo (nova instância) continua bloqueado', async () => {
  const harness = createHarness({ features: {} });

  await harness.say(USERS.ana, 'uber 25', { messageId: 'wamid-restart' });

  const restarted = createHarness({ features: {}, seed: JSON.parse(JSON.stringify(harness.firebase.data)) });
  const reply = await restarted.say(USERS.ana, 'uber 25', { messageId: 'wamid-restart' });

  assert.match(reply, /já foi registrada/);
  assert.equal(expenses(restarted, USERS.ana).length, 1);
});

test('idempotência: "sim" repetido após falha ao limpar a prévia grava a divisão uma única vez', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 90 no pix com Carlos');

  const pending = harness.sessions[USERS.ana.phone];

  await harness.say(USERS.ana, 'sim');
  harness.sessions[USERS.ana.phone] = pending;

  const again = await harness.say(USERS.ana, 'sim');

  assert.match(again, /já foi registrada/);
  assert.equal(Object.keys(harness.userValue(USERS.ana, 'cobrancasEnviadas')).length, 1);
  assert.equal(expenses(harness, USERS.ana).filter((expense) => expense.origem === 'divisao').length, 1);
});

test('idempotência: resposta duplicada do modelo não registra o gasto duas vezes', async () => {
  const aiGateway = {
    complete: async () => ({ json: { categoria: 'Lazer', confidence: 0.95, intent: 'register_expense', valor: 42 }, ok: true }),
  };
  const seed = require('./helpers/assistant-harness').friendsSeed();

  seed.grupos.SALVAMONEY.usuarios[111111].privacidade = { ia: { estado: 'aceito', versao: 'v-test' } };

  const harness = createHarness({ aiGateway, features: { ...ALL_FEATURES, conversationalAi: true }, seed });

  assert.match(await harness.say(USERS.ana, 'torrei 42 no cinema'), /Registrar este gasto\? cinema — R\$ 42,00 \(Lazer\)/);

  const pending = harness.sessions[USERS.ana.phone];

  await harness.say(USERS.ana, 'sim');
  harness.sessions[USERS.ana.phone] = pending;
  assert.match(await harness.say(USERS.ana, 'sim'), /já foi registrada/);
  assert.equal(expenses(harness, USERS.ana).length, 1);
});

test('idempotência: chave em processamento antigo pode ser retomada e falha libera a chave', async () => {
  const firebase = createFakeFirebase();
  let now = new Date('2026-09-25T15:00:00.000Z');
  const store = createIdempotencyStore({ db: {}, firebaseOps: firebase.ops, now: () => now });

  await assert.rejects(store.run({ execute: async () => { throw new Error('falhou'); }, key: 'k1', scope: '111111', tipo: 'x' }));

  const retry = await store.run({ execute: async () => 'ok', key: 'k1', scope: '111111', tipo: 'x' });

  assert.deepEqual(retry, { duplicate: false, result: 'ok' });

  firebase.data.grupos.SALVAMONEY.usuarios[111111].idempotencia[store.hashKey('k2')] = { em: '2026-09-25T14:00:00.000Z', estado: 'processando' };
  now = new Date('2026-09-25T15:00:00.000Z');
  assert.equal((await store.run({ execute: async () => 'retomado', key: 'k2', scope: '111111' })).result, 'retomado');
  assert.doesNotMatch(JSON.stringify(firebase.data), /k1|k2|wamid/);
});

test('idempotência: chaves com mais de 7 dias são limpas ocasionalmente', async () => {
  const firebase = createFakeFirebase({
    grupos: { SALVAMONEY: { usuarios: { 111111: { idempotencia: {
      antiga: { concluidoEm: '2026-09-01T00:00:00.000Z', estado: 'concluido' },
      recente: { concluidoEm: '2026-09-24T00:00:00.000Z', estado: 'concluido' },
    } } } } },
  });
  const store = createIdempotencyStore({
    db: {},
    firebaseOps: firebase.ops,
    now: () => new Date('2026-09-25T15:00:00.000Z'),
    random: () => 0,
  });

  await store.run({ execute: async () => 'ok', key: 'nova', scope: '111111' });

  const keys = firebase.getValue('grupos/SALVAMONEY/usuarios/111111/idempotencia');

  assert.equal(keys.antiga, null);
  assert.ok(keys.recente);
  assert.equal(Object.values(keys).filter(Boolean).length, 2);
});
