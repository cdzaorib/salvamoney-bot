'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiProviderRouter } = require('../src/ai/ai-provider-router');
const { createDateUtils } = require('../src/bot/date-utils');
const {
  createWeeklyReportService,
  isWeeklyReportCommand,
} = require('../src/bot/weekly-report-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const REFERENCE_DATE = new Date('2026-06-03T12:00:00.000Z');
const SESSION = {
  group: 'SALVAMONEY',
  user: '482913',
  tag: '482913',
};

function assertNoFirebaseWrites(firebase) {
  assert.deepEqual(firebase.pushes, []);
  assert.deepEqual(firebase.sets, []);
  assert.deepEqual(firebase.updates, []);
  assert.deepEqual(firebase.removals, []);
}

function userSeed(user = {}) {
  return {
    grupos: {
      SALVAMONEY: {
        usuarios: {
          482913: {
            phone: '5511999999999',
            tag: '482913',
            ...user,
          },
        },
      },
    },
  };
}

function financialUserSeed() {
  return userSeed({
    gastos: {
      '2026_4': {
        mercado_anterior: {
          cat: 'Alimentação',
          date: '2026-05-27',
          desc: 'Mercado anterior',
          value: 50,
        },
        lazer_anterior: {
          cat: 'Lazer',
          date: '2026-05-21',
          desc: 'Cinema',
          value: 100,
        },
        mercado_atual: {
          cat: 'Alimentação',
          date: '2026-05-28',
          desc: 'Mercado',
          value: 50,
        },
      },
      '2026_5': {
        delivery: {
          cat: 'Alimentação',
          date: '2026-06-01',
          desc: 'Delivery',
          value: 120,
        },
        uber: {
          cat: 'Transporte',
          date: '2026-06-03',
          desc: 'Uber',
          value: 30,
        },
      },
    },
    perfilFinanceiro: {
      orcamentoMensal: 1000,
      rendaMensal: 3000,
    },
    metasEconomia: {
      '2026_5': {
        ativo: true,
        valorMeta: 500,
      },
    },
    alertas: {
      alimentacao: {
        ativo: true,
        categoria: 'Alimentação',
        limite: 400,
        tipo: 'categoria',
      },
    },
  });
}

function createReport({
  aiProviderRouter = {
    generateText: async ({ fallback }) => fallback,
  },
  seed = financialUserSeed(),
} = {}) {
  const firebase = createFakeFirebase(seed);
  const dateUtils = createDateUtils({
    monthIndexMode: 'zero',
    timeZone: 'UTC',
  });
  const service = createWeeklyReportService({
    aiProviderRouter,
    dateUtils,
    db: {},
    firebaseOps: firebase.ops,
    now: () => REFERENCE_DATE,
  });

  return {
    firebase,
    service,
  };
}

test('weekly report recognizes supported natural commands without capturing weekly plans', () => {
  [
    'relatório da semana',
    'relatorio da semana',
    'fechamento semanal',
    'como foi minha semana?',
    'resumo da semana',
    'meu relatório semanal',
    'minha semana financeira',
  ].forEach((command) => {
    assert.equal(isWeeklyReportCommand(command), true, command);
  });

  assert.equal(isWeeklyReportCommand('plano da semana'), false);
});

test('weekly report requires a valid six digit tag session', async () => {
  const { firebase, service } = createReport();
  const response = await service.processarRelatorioSemanal({
    group: 'SALVAMONEY',
    user: 'carlos',
  }, 'relatório da semana');

  assert.equal(response, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('weekly report reads the previous month and calculates structured weekly analysis', async () => {
  const calls = [];
  const { firebase, service } = createReport({
    aiProviderRouter: {
      generateText: async (options) => {
        calls.push(options);

        return 'Relatório semanal inteligente.';
      },
    },
  });
  const response = await service.processarRelatorioSemanal(SESSION, 'como foi minha semana?');
  const options = calls[0];
  const userMessage = options.messages.find((message) => message.role === 'user').content;
  const reportData = JSON.parse(userMessage.slice(userMessage.indexOf('{')));

  assert.equal(response, 'Relatório semanal inteligente.');
  assert.equal(options.task, 'weekly_financial_report');
  assert.equal(reportData.totalSemanaAtual, 200);
  assert.equal(reportData.totalSemanaAnterior, 150);
  assert.equal(reportData.variacaoPercentual, 33);
  assert.equal(reportData.quantidadeRegistros, 3);
  assert.equal(reportData.mediaDiaria, 28.57);
  assert.deepEqual(reportData.topCategorias, [{
    categoria: 'Alimentação',
    total: 170,
  }, {
    categoria: 'Transporte',
    total: 30,
  }]);
  assert.deepEqual(reportData.maiorGasto, {
    data: '2026-06-01',
    descricao: 'Delivery',
    valor: 120,
  });
  assert.deepEqual(reportData.diaMaiorGasto, {
    data: '2026-06-01',
    total: 120,
  });
  assert.equal(reportData.rendaMensal, 3000);
  assert.equal(reportData.orcamentoMensal, 1000);
  assert.equal(reportData.percentualRendaSemana, 7);
  assert.equal(reportData.percentualOrcamentoSemana, 20);
  assert.equal(reportData.valorMeta, 500);
  assert.equal(reportData.economiaProjetada, 2850);
  assert.equal(reportData.statusMeta, 'acima_da_meta');
  assert.equal(reportData.quantoFaltaMeta, 0);
  assert.equal(reportData.periodoInicio, '2026-05-28');
  assert.equal(reportData.periodoFim, '2026-06-03');
  assert.deepEqual(reportData.alertasAtivos, [{
    categoria: 'Alimentação',
    limite: 400,
    tipo: 'categoria',
  }]);
  assert.doesNotMatch(JSON.stringify(options.messages), /5511999999999|482913/);
  assertNoFirebaseWrites(firebase);
});

test('weekly report returns a clear response when there are no recent expenses', async () => {
  let called = false;
  const { firebase, service } = createReport({
    aiProviderRouter: {
      generateText: async () => {
        called = true;

        return 'não deveria chamar';
      },
    },
    seed: userSeed({
      gastos: {
        '2026_4': {
          antigo: {
            cat: 'Lazer',
            date: '2026-05-01',
            desc: 'Cinema antigo',
            value: 80,
          },
        },
      },
    }),
  });
  const response = await service.processarRelatorioSemanal(SESSION, 'resumo da semana');

  assert.equal(response, 'Você ainda não tem gastos registrados nos últimos 7 dias.');
  assert.equal(called, false);
  assertNoFirebaseWrites(firebase);
});

test('weekly report uses deterministic fallback when AI fails', async () => {
  const aiProviderRouter = createAiProviderRouter({
    config: {
      groqApiKey: 'fake-groq-key',
    },
    groq: {
      chamarIA: async () => {
        throw new Error('groq indisponível');
      },
    },
  });
  const { firebase, service } = createReport({ aiProviderRouter });
  const response = await service.processarRelatorioSemanal(SESSION, 'relatório da semana');

  assert.match(response, /Relatório da semana:/);
  assert.match(response, /Você gastou R\$ 200,00 nos últimos 7 dias/);
  assert.match(response, /Registros: 3/);
  assert.match(response, /Média diária: R\$ 28,57/);
  assert.match(response, /Maior categoria: Alimentação - R\$ 170,00/);
  assert.match(response, /seus gastos subiram 33%/);
  assert.match(response, /Maior gasto: Delivery - R\$ 120,00/);
  assertNoFirebaseWrites(firebase);
});

test('weekly report does not capture plan, expense or charge commands', async () => {
  const { firebase, service } = createReport();

  assert.equal(await service.processarRelatorioSemanal(SESSION, 'plano da semana'), null);
  assert.equal(await service.processarRelatorioSemanal(SESSION, 'gastei 20 no mercado'), null);
  assert.equal(await service.processarRelatorioSemanal(SESSION, 'cobrar 80 da tag 123456'), null);
  assertNoFirebaseWrites(firebase);
});
