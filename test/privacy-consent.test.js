'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findSensitiveData, redactText, sanitizeForExternal } = require('../src/ai/privacy');
const { createConversationContext } = require('../src/ai/conversation-context');
const { stripPhones } = require('../src/bot/privacy-data-service');
const { ALL_FEATURES, USERS, createHarness } = require('./helpers/assistant-harness');

const AI_FEATURES = { ...ALL_FEATURES, conversationalAi: true };

test('sanitização: remove e-mail, telefone, tags, CPF, apelidos e nome; mantém valores', () => {
  const { placeholders, text } = redactText(
    'Oi, sou Ana (ana.souza@mail.com, +55 11 98888-7777, CPF 123.456.789-09). Dividi 150 com Carlos trabalho e Bia, tag 222222.',
    { knownTags: ['222222'], names: ['Ana'], nicknames: ['Carlos trabalho', 'Bia'] }
  );

  assert.doesNotMatch(text, /ana\.souza|98888|123\.456|222222|Carlos|Bia|\bAna\b/);
  assert.match(text, /150/);
  assert.deepEqual(placeholders, { PESSOA_1: 'Carlos trabalho', PESSOA_2: 'Bia' });
});

test('sanitização: objetos perdem identificadores e descrições pessoais', () => {
  const sanitized = sanitizeForExternal({
    categorias: [{ categoria: 'Lazer', total: 90 }],
    maioresGastos: [{ descricao: 'Presente da Júlia', id: '-Nabc', valor: 90 }],
    nome: 'Ana',
    perguntaUsuario: 'minha tag é 111111',
    phone: '5511911111111',
    tagOrigem: '111111',
  }, { knownTags: ['111111'] });

  assert.deepEqual(sanitized, {
    categorias: [{ categoria: 'Lazer', total: 90 }],
    maioresGastos: [{ valor: 90 }],
    perguntaUsuario: 'minha tag é [tag]',
  });
  assert.deepEqual(findSensitiveData(JSON.stringify(sanitized), { knownTags: ['111111'], names: ['Ana', 'Júlia'], phones: ['5511911111111'] }), []);
});

test('contexto conversacional: curto (últimas mensagens) e expira em ~24h, só em memória', () => {
  let now = 0;
  const context = createConversationContext({ maxMessages: 3, now: () => now, ttlMs: 24 * 60 * 60 * 1000 });

  ['a', 'b', 'c', 'd'].forEach((text) => context.add('111111', 'user', text));
  assert.deepEqual(context.recent('111111').map((entry) => entry.text), ['b', 'c', 'd']);
  now = 25 * 60 * 60 * 1000;
  assert.deepEqual(context.recent('111111'), []);
});

test('consentimento: aviso antes do primeiro uso da DeepSeek; aceite grava versão e data', async () => {
  const calls = [];
  const aiGateway = {
    complete: async (request) => {
      calls.push(request);
      return { json: { confidence: 0.9, intent: 'smalltalk', resposta: 'Oi! Posso ajudar com seus gastos.' }, ok: true, text: '{}' };
    },
  };
  const harness = createHarness({ aiGateway, features: AI_FEATURES });
  const notice = await harness.say(USERS.ana, 'e aí, tudo certo por aí?');

  assert.match(notice, /DeepSeek/);
  assert.match(notice, /aceito/);
  assert.equal(calls.length, 0);

  const accepted = await harness.say(USERS.ana, 'aceito');
  const consent = harness.userValue(USERS.ana, 'privacidade/ia');

  assert.match(accepted, /IA ativada/);
  assert.match(accepted, /Posso ajudar/);
  assert.equal(consent.estado, 'aceito');
  assert.equal(consent.versao, 'v-test');
  assert.equal(consent.aceitoEm, '2026-09-25T15:00:00.000Z');
  assert.equal(calls.length, 1);
});

test('consentimento: recusa, revogação e nova versão pedem aceite de novo', async () => {
  const aiGateway = { complete: async () => ({ json: { confidence: 0.9, intent: 'smalltalk', resposta: 'oi' }, ok: true }) };
  const harness = createHarness({ aiGateway, features: AI_FEATURES });

  await harness.say(USERS.ana, 'e aí, tudo certo por aí?');
  assert.match(await harness.say(USERS.ana, 'não aceito'), /só com respostas locais/);
  assert.equal(harness.userValue(USERS.ana, 'privacidade/ia/estado'), 'recusado');
  assert.doesNotMatch(await harness.say(USERS.ana, 'e aí, tudo certo por aí?'), /DeepSeek/);

  assert.match(await harness.say(USERS.ana, 'ativar IA'), /DeepSeek/);
  await harness.say(USERS.ana, 'aceito');
  assert.match(await harness.say(USERS.ana, 'desativar IA'), /Consentimento revogado/);
  assert.equal(harness.userValue(USERS.ana, 'privacidade/ia/estado'), 'revogado');
  assert.ok(harness.userValue(USERS.ana, 'privacidade/ia/revogadoEm'));

  harness.firebase.data.grupos.SALVAMONEY.usuarios[111111].privacidade.ia = { estado: 'aceito', versao: 'versao-antiga' };
  assert.match(await harness.say(USERS.ana, 'e aí, tudo certo por aí?'), /DeepSeek/);
});

test('consentimento: IA desativada não impede registrar, consultar ou apagar gastos', async () => {
  const harness = createHarness({ aiGateway: { complete: async () => ({ ok: false, reason: 'erro' }) }, features: AI_FEATURES });

  await harness.say(USERS.ana, 'desativar IA');
  assert.match(await harness.say(USERS.ana, 'gastei 40 no mercado'), /registrado/);
  assert.match(await harness.say(USERS.ana, 'hoje'), /R\$ 40,00/);
  assert.match(await harness.say(USERS.ana, 'apagar último'), /Apaguei/);
});

test('pesquisa externa: ativar e desativar ficam registrados por usuário', async () => {
  const harness = createHarness();

  assert.match(await harness.say(USERS.ana, 'ativar pesquisa externa'), /ativada/);
  assert.equal(harness.userValue(USERS.ana, 'privacidade/pesquisaExterna/ativo'), true);
  assert.match(await harness.say(USERS.ana, 'desativar pesquisa externa'), /desativada/);
  assert.equal(harness.userValue(USERS.ana, 'privacidade/pesquisaExterna/ativo'), false);
});

test('meus dados e exportação mostram os dados sem telefones', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'gastei 12 no café');

  const view = await harness.say(USERS.ana, 'meus dados');
  const exported = await harness.say(USERS.ana, 'exportar meus dados');

  assert.match(view, /Gastos: 1/);
  assert.match(view, /Amigos: 2 · Cartões: 2/);
  assert.match(exported, /"desc":"café"/);
  assert.doesNotMatch(exported, /5511911111111/);
  assert.deepEqual(stripPhones({ a: { phone: '1', phoneOrigem: '2', x: 1 } }), { a: { x: 1 } });
});

test('apagar meus dados exige frase reforçada e preserva cópias dos amigos', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 60 no pix com Carlos');
  await harness.say(USERS.ana, 'sim');

  assert.match(await harness.say(USERS.ana, 'apagar meus dados'), /APAGAR MEUS DADOS 111111/);
  assert.match(await harness.say(USERS.ana, 'APAGAR MEUS DADOS 999999'), /envie exatamente/);
  assert.ok(harness.userValue(USERS.ana), 'frase errada não apaga');

  await harness.say(USERS.ana, 'apagar meus dados');
  assert.match(await harness.say(USERS.ana, 'APAGAR MEUS DADOS 111111'), /foram apagados/);
  assert.equal(harness.userValue(USERS.ana), null);
  assert.equal(harness.firebase.getValue(`users/${USERS.ana.phone}`), null);
  assert.equal(Object.keys(harness.userValue(USERS.carlos, 'cobrancasRecebidas')).length, 1);
  assert.equal(harness.userValue(USERS.carlos, 'amigos/111111/estado'), 'removida');
});
