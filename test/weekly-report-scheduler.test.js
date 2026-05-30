'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWeeklyReportScheduler,
  isoWeekKey,
  localDateParts,
  shouldSendWeeklyReport,
} = require('../src/bot/weekly-report-scheduler');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const SUNDAY_AT_20_05 = new Date('2026-05-31T23:05:00.000Z');

function user({
  ativo = true,
  phone = '5511999999999',
  ultimoEnvioSemana,
} = {}) {
  return {
    gastos: {
      preservado: true,
    },
    phone,
    preferencias: {
      relatorioSemanal: {
        ativo,
        diaSemana: 0,
        hora: 20,
        minuto: 0,
        timezone: 'America/Sao_Paulo',
        ...(ultimoEnvioSemana ? { ultimoEnvioSemana } : {}),
      },
    },
  };
}

function createScheduler({
  notificationSender = async () => true,
  seed,
  weeklyReportService = {
    gerarRelatorioSemanal: async () => 'Relatório automático.',
  },
} = {}) {
  const firebase = createFakeFirebase(seed || {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: user(),
        },
      },
    },
  });
  const logs = [];
  const scheduler = createWeeklyReportScheduler({
    db: {},
    firebaseOps: firebase.ops,
    logger: {
      error: (...args) => logs.push(['error', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    notificationSender,
    now: () => SUNDAY_AT_20_05,
    weeklyReportService,
  });

  return {
    firebase,
    logs,
    scheduler,
  };
}

test('weekly report scheduler matches Sunday schedule in America/Sao_Paulo and computes ISO week', () => {
  const parts = localDateParts(SUNDAY_AT_20_05, 'America/Sao_Paulo');

  assert.deepEqual(parts, {
    day: 31,
    dayOfWeek: 0,
    hour: 20,
    minute: 5,
    month: 5,
    year: 2026,
  });
  assert.equal(isoWeekKey(parts), '2026-W22');
  assert.equal(shouldSendWeeklyReport(user().preferencias.relatorioSemanal, SUNDAY_AT_20_05), true);
  assert.equal(shouldSendWeeklyReport(user({ ativo: false }).preferencias.relatorioSemanal, SUNDAY_AT_20_05), false);
});

test('scheduler ignores users without opt-in', async () => {
  let generated = 0;
  const { firebase, scheduler } = createScheduler({
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: user({ ativo: false }),
          },
        },
      },
    },
    weeklyReportService: {
      gerarRelatorioSemanal: async () => {
        generated++;
      },
    },
  });

  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 0 });
  assert.equal(generated, 0);
  assert.deepEqual(firebase.transactions, []);
});

test('scheduler ignores opt-in users without phone', async () => {
  const { firebase, logs, scheduler } = createScheduler({
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            482913: user({ phone: '' }),
          },
        },
      },
    },
  });

  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 0 });
  assert.deepEqual(firebase.transactions, []);
  assert.match(logs[0][1], /sem telefone/);
});

test('scheduler sends one automatic report and safely updates only weekly preference fields', async () => {
  const generated = [];
  const sent = [];
  const { firebase, scheduler } = createScheduler({
    notificationSender: async (phone, message) => {
      sent.push({ message, phone });

      return true;
    },
    weeklyReportService: {
      gerarRelatorioSemanal: async (session, question) => {
        generated.push({ question, session });

        return 'Relatório automático.';
      },
    },
  });

  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 1 });
  assert.deepEqual(generated, [{
    question: 'relatório da semana',
    session: {
      group: 'SALVAMONEY',
      tag: '482913',
      user: '482913',
    },
  }]);
  assert.deepEqual(sent, [{
    message: 'Relatório automático.',
    phone: '5511999999999',
  }]);
  assert.equal(
    firebase.getValue('grupos/SALVAMONEY/usuarios/482913/preferencias/relatorioSemanal/ultimoEnvioSemana'),
    '2026-W22'
  );
  assert.deepEqual(firebase.updates, [{
    path: 'grupos/SALVAMONEY/usuarios/482913/preferencias/relatorioSemanal',
    value: {
      updatedAt: '2026-05-31T23:05:00.000Z',
    },
  }]);
  assert.equal(firebase.getValue('grupos/SALVAMONEY/usuarios/482913/gastos/preservado'), true);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.pushes, []);
  assert.deepEqual(firebase.removals, []);
});

test('scheduler does not send the same user twice in the same week', async () => {
  let sent = 0;
  const { scheduler } = createScheduler({
    notificationSender: async () => {
      sent++;

      return true;
    },
  });

  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 1 });
  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 0 });
  assert.equal(sent, 1);
});

test('scheduler keeps weekly claim when only the auxiliary updatedAt write fails after sending', async () => {
  let sent = 0;
  const firebase = createFakeFirebase({
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: user(),
        },
      },
    },
  });
  const scheduler = createWeeklyReportScheduler({
    db: {},
    firebaseOps: {
      ...firebase.ops,
      update: async () => {
        throw new Error('updatedAt indisponível');
      },
    },
    logger: {
      warn: () => {},
    },
    notificationSender: async () => {
      sent++;

      return true;
    },
    now: () => SUNDAY_AT_20_05,
    weeklyReportService: {
      gerarRelatorioSemanal: async () => 'Relatório automático.',
    },
  });

  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 1 });
  assert.deepEqual(await scheduler.runOnce(), { failed: 0, sent: 0 });
  assert.equal(sent, 1);
  assert.equal(
    firebase.getValue('grupos/SALVAMONEY/usuarios/482913/preferencias/relatorioSemanal/ultimoEnvioSemana'),
    '2026-W22'
  );
});

test('scheduler isolates a failed send and continues processing other users', async () => {
  const sent = [];
  const { firebase, scheduler } = createScheduler({
    notificationSender: async (phone) => {
      sent.push(phone);

      if (phone === '5511111111111') {
        throw new Error('evolution indisponível');
      }

      return true;
    },
    seed: {
      grupos: {
        SALVAMONEY: {
          usuarios: {
            111111: user({ phone: '5511111111111' }),
            222222: user({ phone: '5522222222222' }),
          },
        },
      },
    },
  });

  assert.deepEqual(await scheduler.runOnce(), { failed: 1, sent: 1 });
  assert.deepEqual(sent, ['5511111111111', '5522222222222']);
  assert.equal(
    firebase.getValue('grupos/SALVAMONEY/usuarios/111111/preferencias/relatorioSemanal/ultimoEnvioSemana'),
    null
  );
  assert.equal(
    firebase.getValue('grupos/SALVAMONEY/usuarios/222222/preferencias/relatorioSemanal/ultimoEnvioSemana'),
    '2026-W22'
  );
});
