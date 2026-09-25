'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMigrationService } = require('../src/services/migration-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

function legacySeed() {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          111111: {
            alertas: { a1: { ativo: true, limite: 300, tipo: 'orcamento_mensal' } },
            cobrancasEnviadas: {
              c1: { descricao: 'Almoço', id: 'c1', status: 'aceita', tagDestino: '222222', tagOrigem: '111111', valorCobrado: 40 },
              c2: { id: 'c2', status: 'paga', tagDestino: '222222', tagOrigem: '111111', valorCobrado: '25.5' },
              parcial: { descricao: 'sem destino', status: 'pendente' },
            },
            gastos: { '2026_8': { g1: { cat: 'Alimentação', desc: 'Mercado', value: 50 } } },
            meta: { desc: 'Reserva', value: 1000 },
            perfilFinanceiro: { orcamentoMensal: 2000, rendaMensal: 4000, vencimentoCartao: 12 },
            preferencias: { relatorioSemanal: { ativo: true, hora: 20 } },
            tag: '111111',
          },
          222222: {
            cobrancasRecebidas: {
              c1: { descricao: 'Almoço', id: 'c1', status: 'aceita', tagDestino: '222222', tagOrigem: '111111', valorCobrado: 40 },
            },
            tag: '222222',
          },
        },
      },
    },
  };
}

function createMigration(seed = legacySeed()) {
  const firebase = createFakeFirebase(seed);
  const service = createMigrationService({
    db: {},
    firebaseOps: firebase.ops,
    logger: { warn() {} },
    now: () => new Date('2026-09-25T15:00:00.000Z'),
  });

  return { firebase, service };
}

test('migração: vencimento antigo do perfil vira "Cartão principal" sem apagar o perfil', async () => {
  const { firebase, service } = createMigration();

  await service.ensureUser('111111');

  assert.deepEqual(firebase.getValue('grupos/SALVAMONEY/usuarios/111111/cartoes/legado'), {
    apelido: 'Cartão principal',
    atualizadoEm: '2026-09-25T15:00:00.000Z',
    diaFechamento: 5,
    diaVencimento: 12,
    padrao: true,
  });
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/111111/perfilFinanceiro/vencimentoCartao'), 12);
});

test('migração: cobranças antigas ganham estado e totais nas duas cópias, preservando o resto', async () => {
  const { firebase, service } = createMigration();

  await service.ensureUser('111111');

  const sent = firebase.getValue('grupos/SALVAMONEY/usuarios/111111/cobrancasEnviadas');
  const received = firebase.getValue('grupos/SALVAMONEY/usuarios/222222/cobrancasRecebidas/c1');

  assert.equal(sent.c1.estado, 'aceita');
  assert.equal(sent.c1.valorOriginal, 40);
  assert.equal(sent.c1.valorPago, 0);
  assert.equal(sent.c1.status, 'aceita');
  assert.equal(received.estado, 'aceita');
  assert.equal(sent.c2.estado, 'paga');
  assert.equal(sent.c2.valorPago, 25.5);
  assert.deepEqual(sent.parcial, { descricao: 'sem destino', status: 'pendente' }, 'registro parcial fica intacto');
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/222222/cobrancasRecebidas/c2'), undefined, 'não cria cópia inexistente');
});

test('migração: dados antigos (gastos, metas, alertas, preferências) ficam intactos', async () => {
  const { firebase, service } = createMigration();
  const before = JSON.parse(JSON.stringify(firebase.getValue('grupos/SALVAMONEY/usuarios/111111')));

  await service.ensureUser('111111');

  const after = firebase.getValue('grupos/SALVAMONEY/usuarios/111111');

  ['alertas', 'gastos', 'meta', 'preferencias', 'perfilFinanceiro', 'tag'].forEach((key) => {
    assert.deepEqual(after[key], before[key], key);
  });
});

test('migração: é idempotente (rodar de novo não duplica nem reescreve)', async () => {
  const { firebase, service } = createMigration();

  await service.ensureUser('111111');

  const snapshot = JSON.stringify(firebase.data);
  const second = createMigrationService({ db: {}, firebaseOps: firebase.ops, now: () => new Date('2026-10-01T00:00:00Z') });
  const result = await second.ensureUser('111111');

  assert.deepEqual(result.applied, []);
  assert.equal(JSON.stringify(firebase.data), snapshot);
  assert.equal(Object.keys(firebase.getValue('grupos/SALVAMONEY/usuarios/111111/cartoes')).length, 1);
});

test('migração: usuário com cartões já cadastrados ou sem dados não recebe cartão legado', async () => {
  const seed = legacySeed();

  seed.grupos.SALVAMONEY.usuarios[111111].cartoes = { meu: { apelido: 'Nubank', diaFechamento: 3, diaVencimento: 10, padrao: true } };
  seed.grupos.SALVAMONEY.usuarios[333333] = { tag: '333333' };

  const { firebase, service } = createMigration(seed);

  await service.ensureUser('111111');
  await service.ensureUser('333333');

  assert.deepEqual(Object.keys(firebase.getValue('grupos/SALVAMONEY/usuarios/111111/cartoes')), ['meu']);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/333333/cartoes'), undefined);
  assert.ok(firebase.getValue('grupos/SALVAMONEY/usuarios/333333/migracoes/2026_09_cobrancas_estado'));
});
