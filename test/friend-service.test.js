'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNickname } = require('../src/bot/friend-service');
const { USERS, baseSeed, createHarness, friendsSeed } = require('./helpers/assistant-harness');

test('amigos: convite por tag cria pendência dos dois lados e notifica sem expor telefone', async () => {
  const harness = createHarness({ seed: baseSeed() });
  const reply = await harness.say(USERS.ana, 'adicionar amigo 222222');
  const [notice] = harness.takeSent();

  assert.match(reply, /Convite enviado para Carlos/);
  assert.equal(harness.userValue(USERS.ana, 'amigos/222222/estado'), 'convite_enviado');
  assert.equal(harness.userValue(USERS.carlos, 'amigos/111111/estado'), 'convite_recebido');
  assert.equal(notice.phone, USERS.carlos.phone);
  assert.match(notice.message, /aceitar amigo 111111/);
  assert.doesNotMatch(notice.message, /5511911111111|Souza/);
});

test('amigos: aceite ativa a amizade e cada lado escolhe apelido local', async () => {
  const harness = createHarness({ seed: baseSeed() });

  await harness.say(USERS.ana, 'adicionar amigo 222222');
  const accepted = await harness.say(USERS.carlos, 'aceitar amigo 111111');
  const carlosNick = await harness.say(USERS.carlos, 'apelido Aninha');
  const anaNick = await harness.say(USERS.ana, 'apelido 222222 Carlão');

  assert.match(accepted, /Agora vocês são amigos/);
  assert.match(carlosNick, /Aninha/);
  assert.match(anaNick, /Carlão/);
  assert.equal(harness.userValue(USERS.carlos, 'amigos/111111/apelido'), 'Aninha');
  assert.equal(harness.userValue(USERS.ana, 'amigos/222222/apelido'), 'Carlão');
  assert.equal(harness.userValue(USERS.ana, 'amigos/222222/estado'), 'ativa');
});

test('amigos: recusa marca o convite como recusado sem criar amizade', async () => {
  const harness = createHarness({ seed: baseSeed() });

  await harness.say(USERS.ana, 'adicionar amigo 222222');
  const reply = await harness.say(USERS.carlos, 'recusar amigo 111111');

  assert.equal(reply, 'Convite recusado.');
  assert.equal(harness.userValue(USERS.ana, 'amigos/222222/estado'), 'recusada');
  assert.match(await harness.say(USERS.ana, 'adicionar amigo 222222'), /24 horas/);
});

test('amigos: convites cruzados viram aceite automático e auto-convite é bloqueado', async () => {
  const harness = createHarness({ seed: baseSeed() });

  await harness.say(USERS.ana, 'adicionar amigo 222222');
  const reply = await harness.say(USERS.carlos, 'adicionar amigo 111111');

  assert.match(reply, /Agora vocês são amigos/);
  assert.match(await harness.say(USERS.ana, 'adicionar amigo 111111'), /própria tag/);
});

test('amigos: apelido repetido pede um nome diferente e nunca cria "Carlos 2"', async () => {
  const seed = friendsSeed();

  seed.grupos.SALVAMONEY.usuarios[111111].amigos[444444] = { estado: 'ativa' };
  seed.grupos.SALVAMONEY.usuarios[444444] = { nome: 'Carlos Dias', phone: '5511944444444', tag: '444444' };

  const harness = createHarness({ seed });
  const reply = await harness.say(USERS.ana, 'apelido 444444 Carlos');

  assert.match(reply, /já tem um amigo chamado Carlos/);
  assert.match(reply, /Carlos trabalho/);
  assert.equal(harness.userValue(USERS.ana, 'amigos/444444/apelido'), undefined);
  assert.doesNotMatch(JSON.stringify(harness.userValue(USERS.ana, 'amigos')), /Carlos 2/);
  assert.match(await harness.say(USERS.ana, 'apelido 444444 Carlos trabalho'), /Carlos Trabalho/);
});

test('amigos: validação de apelido recusa palavras reservadas e só números', () => {
  assert.match(validateNickname('pix').error, /reservada/);
  assert.match(validateNickname('123').error, /letras/);
  assert.equal(validateNickname('carlos trabalho').nickname, 'Carlos Trabalho');
});

test('amigos: remoção pede confirmação, bloqueia novas operações e preserva histórico', async () => {
  const seed = friendsSeed();

  seed.grupos.SALVAMONEY.usuarios[111111].cobrancasEnviadas = {
    old1: { descricao: 'Pizza', estado: 'aguardando_aceite', id: 'old1', status: 'pendente', tagDestino: '222222', tagOrigem: '111111', valorCobrado: 40 },
  };
  seed.grupos.SALVAMONEY.usuarios[222222].cobrancasRecebidas = {
    old1: { descricao: 'Pizza', estado: 'aguardando_aceite', id: 'old1', status: 'pendente', tagDestino: '222222', tagOrigem: '111111', valorCobrado: 40 },
  };

  const harness = createHarness({ seed });

  assert.match(await harness.say(USERS.ana, 'remover amigo Carlos'), /Responda SIM/);
  assert.match(await harness.say(USERS.ana, 'sim'), /removida/);
  assert.equal(harness.userValue(USERS.ana, 'amigos/222222/estado'), 'removida');
  assert.equal(harness.userValue(USERS.carlos, 'amigos/111111/estado'), 'removida');
  assert.equal(harness.userValue(USERS.ana, 'cobrancasEnviadas/old1/valorCobrado'), 40);
  assert.match(await harness.say(USERS.carlos, 'cobranças'), /Pizza/);
  assert.match(await harness.say(USERS.ana, 'dividir 50 com Carlos'), /Não encontrei Carlos/);
});

test('amigos: privacidade — amigo não vê gastos pessoais do outro', async () => {
  const harness = createHarness();
  const reply = await harness.say(USERS.ana, 'quanto o Carlos gastou esse mês?');

  assert.match(reply, /Não mostro os gastos pessoais de Carlos/);
  assert.match(await harness.say(USERS.ana, 'carteira compartilhada'), /permissão diferente/);
});
