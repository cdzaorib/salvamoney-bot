'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWeeklyReportPreferencesService,
  parseWeeklyReportPreferenceCommand,
} = require('../src/bot/weekly-report-preferences-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const SESSION = {
  group: 'SALVAMONEY',
  tag: '482913',
  user: '482913',
};
const PREFERENCE_PATH = 'grupos/SALVAMONEY/usuarios/482913/preferencias/relatorioSemanal';

function createPreferences(seed = {}) {
  const firebase = createFakeFirebase(seed);
  const service = createWeeklyReportPreferencesService({
    db: {},
    firebaseOps: firebase.ops,
    now: () => '2026-05-30T12:00:00.000Z',
  });

  return {
    firebase,
    service,
  };
}

test('weekly report preference parser recognizes opt-in, opt-out, status and schedule configuration', () => {
  assert.deepEqual(parseWeeklyReportPreferenceCommand('ativar relatório semanal'), { type: 'activate' });
  assert.deepEqual(parseWeeklyReportPreferenceCommand('desativar relatorio semanal'), { type: 'deactivate' });
  assert.deepEqual(parseWeeklyReportPreferenceCommand('status relatório semanal'), { type: 'status' });
  assert.deepEqual(parseWeeklyReportPreferenceCommand('configurar relatório semanal domingo 20h'), {
    hour: 20,
    minute: 0,
    type: 'configure',
    valid: true,
  });
  assert.equal(parseWeeklyReportPreferenceCommand('relatório da semana'), null);
});

test('activating weekly report writes the default preference only under preferencias', async () => {
  const { firebase, service } = createPreferences({
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            gastos: {
              existente: true,
            },
          },
        },
      },
    },
  });
  const response = await service.processarPreferenciaRelatorioSemanal(SESSION, 'ativar relatório semanal');

  assert.equal(response, 'Relatório semanal ativado ✅ Vou te enviar todo domingo às 20h.');
  assert.deepEqual(firebase.updates, [{
    path: PREFERENCE_PATH,
    value: {
      ativo: true,
      diaSemana: 0,
      hora: 20,
      minuto: 0,
      timezone: 'America/Sao_Paulo',
      updatedAt: '2026-05-30T12:00:00.000Z',
    },
  }]);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/gastos/existente'), true);
  assert.deepEqual(firebase.sets, []);
});

test('deactivating weekly report safely marks ativo false', async () => {
  const { firebase, service } = createPreferences();
  const response = await service.processarPreferenciaRelatorioSemanal(SESSION, 'parar relatório semanal');

  assert.equal(response, 'Relatório semanal desativado.');
  assert.deepEqual(firebase.updates, [{
    path: PREFERENCE_PATH,
    value: {
      ativo: false,
      updatedAt: '2026-05-30T12:00:00.000Z',
    },
  }]);
});

test('weekly report status describes active and disabled preferences', async () => {
  const active = createPreferences({
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            preferencias: {
              relatorioSemanal: {
                ativo: true,
                hora: 19,
                minuto: 30,
              },
            },
          },
        },
      },
    },
  });
  const disabled = createPreferences();

  assert.equal(
    await active.service.processarPreferenciaRelatorioSemanal(SESSION, 'status relatório semanal'),
    'Relatório semanal automático está ativo: domingo às 19:30.'
  );
  assert.equal(
    await disabled.service.processarPreferenciaRelatorioSemanal(SESSION, 'relatório semanal automático'),
    'Relatório semanal automático está desativado. Para ativar, envie: ativar relatório semanal'
  );
  assert.deepEqual(active.firebase.updates, []);
  assert.deepEqual(disabled.firebase.updates, []);
});

test('weekly report preference commands require a valid access session', async () => {
  const { firebase, service } = createPreferences();
  const response = await service.processarPreferenciaRelatorioSemanal({
    group: 'SALVAMONEY',
    user: 'carlos',
  }, 'ativar relatório semanal');

  assert.equal(response, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assert.deepEqual(firebase.updates, []);
});
