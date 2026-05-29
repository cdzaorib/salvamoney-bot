'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiProviderRouter } = require('../src/ai/ai-provider-router');
const { createDateUtils } = require('../src/bot/date-utils');
const {
  createWeeklyPlannerService,
  isWeeklyPlannerCommand,
} = require('../src/bot/weekly-planner-service');
const { createFakeFirebase } = require('./helpers/fake-firebase');

const REFERENCE_DATE = new Date('2026-05-20T12:00:00.000Z');
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
        mercado: {
          cat: 'Alimentação',
          date: '2026-05-10',
          desc: 'Mercado',
          value: 600,
        },
        uber: {
          cat: 'Transporte',
          date: '2026-05-12',
          desc: 'Uber',
          value: 250,
        },
      },
    },
    fixos: {
      internet: {
        desc: 'Internet',
        value: 99,
      },
    },
    perfilFinanceiro: {
      orcamentoMensal: 2000,
      rendaMensal: 3000,
      vencimentoCartao: 12,
    },
    metasEconomia: {
      '2026_4': {
        ativo: true,
        valorMeta: 500,
      },
    },
    alertas: {
      alimentacao: {
        ativo: true,
        categoria: 'Alimentação',
        limite: 700,
        tipo: 'categoria',
      },
      inativo: {
        ativo: false,
        limite: 5000,
        tipo: 'orcamento_mensal',
      },
    },
  });
}

function createPlanner({
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
  const service = createWeeklyPlannerService({
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

test('weekly planner recognizes supported natural commands', () => {
  [
    'monte meu plano da semana',
    'plano da semana',
    'como economizar até domingo?',
    'me faça um plano até o cartão vencer',
    'plano para bater minha meta',
    'me ajude a bater minha meta',
    'o que posso gastar essa semana?',
    'quanto posso gastar por dia?',
  ].forEach((command) => {
    assert.equal(isWeeklyPlannerCommand(command), true, command);
  });
});

test('weekly planner requires a valid six digit tag session', async () => {
  const { firebase, service } = createPlanner();
  const response = await service.processarPlanoSemanal({
    group: 'SALVAMONEY',
    user: 'carlos',
  }, 'plano da semana');

  assert.equal(response, 'Entre com sua tag de 6 dígitos usando: entrar 123456');
  assertNoFirebaseWrites(firebase);
});

test('weekly planner calculates deterministic limits, profile, goal, categories and alerts', async () => {
  const calls = [];
  const { firebase, service } = createPlanner({
    aiProviderRouter: {
      generateText: async (options) => {
        calls.push(options);

        return 'Plano inteligente da semana.';
      },
    },
  });
  const response = await service.processarPlanoSemanal(SESSION, 'plano para bater minha meta');
  const options = calls[0];
  const userMessage = options.messages.find((message) => message.role === 'user').content;
  const plannerData = JSON.parse(userMessage.slice(userMessage.indexOf('{')));

  assert.equal(response, 'Plano inteligente da semana.');
  assert.equal(options.task, 'weekly_financial_plan');
  assert.equal(plannerData.totalMesAtual, 850);
  assert.deepEqual(plannerData.categoriasTop, [{
    categoria: 'Alimentação',
    total: 600,
  }, {
    categoria: 'Transporte',
    total: 250,
  }]);
  assert.equal(plannerData.rendaMensal, 3000);
  assert.equal(plannerData.orcamentoMensal, 2000);
  assert.equal(plannerData.vencimentoCartao, 12);
  assert.equal(plannerData.valorMeta, 500);
  assert.equal(plannerData.economiaProjetada, 2150);
  assert.equal(plannerData.diasAteDomingo, 5);
  assert.equal(plannerData.diasRestantesMes, 12);
  assert.equal(plannerData.limiteDiarioSemana, 230);
  assert.equal(plannerData.limiteDiarioMes, 95.83);
  assert.equal(plannerData.quantoFaltaMeta, 0);
  assert.equal(plannerData.gastosFixosTotal, 99);
  assert.deepEqual(plannerData.alertasAtivos, [{
    categoria: 'Alimentação',
    limite: 700,
    tipo: 'categoria',
  }]);
  assert.doesNotMatch(JSON.stringify(options.messages), /5511999999999|482913/);
  assertNoFirebaseWrites(firebase);
});

test('weekly planner uses deterministic fallback when AI fails', async () => {
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
  const { firebase, service } = createPlanner({ aiProviderRouter });
  const response = await service.processarPlanoSemanal(SESSION, 'como economizar até domingo?');

  assert.match(response, /Plano da semana:/);
  assert.match(response, /Você gastou R\$ 850,00 este mês/);
  assert.match(response, /Sua maior categoria é Alimentação/);
  assert.match(response, /Limite gastos variáveis a R\$ 230,00 por dia até domingo/);
  assert.match(response, /Revise compras no cartão antes do vencimento no dia 12/);
  assert.match(response, /Acompanhe sua meta enviando: minha meta/);
  assertNoFirebaseWrites(firebase);
});

test('weekly planner guides setup when no financial data exists', async () => {
  let called = false;
  const { firebase, service } = createPlanner({
    aiProviderRouter: {
      generateText: async () => {
        called = true;

        return 'não deveria chamar';
      },
    },
    seed: userSeed(),
  });
  const response = await service.processarPlanoSemanal(SESSION, 'monte meu plano da semana');

  assert.equal(response, 'Ainda tenho poucos dados para montar um plano. Comece registrando gastos e me diga sua renda com: recebo 3000 todo dia 5');
  assert.equal(called, false);
  assertNoFirebaseWrites(firebase);
});

test('weekly planner does not capture expense or charge commands', async () => {
  const { firebase, service } = createPlanner();

  assert.equal(await service.processarPlanoSemanal(SESSION, 'gastei 20 no mercado'), null);
  assert.equal(await service.processarPlanoSemanal(SESSION, 'cobrar 80 da tag 123456'), null);
  assertNoFirebaseWrites(firebase);
});
