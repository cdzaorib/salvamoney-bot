'use strict';

const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const WEEKLY_PLANNER_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const WEEKLY_PLANNER_COMMANDS = new Set([
  'monte meu plano da semana',
  'plano da semana',
  'como economizar ate domingo',
  'me faca um plano ate o cartao vencer',
  'plano para bater minha meta',
  'me ajude a bater minha meta',
  'o que posso gastar essa semana',
  'quanto posso gastar por dia',
]);

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
}

function isWeeklyPlannerCommand(value) {
  return WEEKLY_PLANNER_COMMANDS.has(normalizedCommand(value));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function validPositiveNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

function categoryName(expense) {
  const category = String(expense?.cat || '').trim();

  return category || 'Outros';
}

function summarizeCategories(expenses) {
  const totals = {};

  expenses.forEach((expense) => {
    const value = Number(expense?.value || 0);

    if (!Number.isFinite(value)) {
      return;
    }

    const category = categoryName(expense);

    totals[category] = (totals[category] || 0) + value;
  });

  return Object.entries(totals)
    .map(([categoria, total]) => ({
      categoria,
      total: roundMoney(total),
    }))
    .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria));
}

function dateMetrics(dateUtils, date = new Date()) {
  const parts = dateUtils.dateParts(date);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const localCalendarDate = new Date(Date.UTC(year, month - 1, day, 12));
  const weekDay = localCalendarDate.getUTCDay();
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();

  return {
    diasAteDomingo: (7 - weekDay) % 7 + 1,
    diasRestantesMes: lastDayOfMonth - day + 1,
  };
}

function activeGoal(goal) {
  if (!goal || goal.ativo === false) {
    return null;
  }

  return validPositiveNumber(goal.valorMeta);
}

function normalizeActiveAlerts(alerts) {
  return Object.values(alerts || {})
    .filter((alert) => alert && alert.ativo !== false)
    .map((alert) => ({
      categoria: alert.tipo === 'categoria' ? alert.categoria || null : null,
      limite: validPositiveNumber(alert.limite),
      tipo: alert.tipo || 'categoria',
    }))
    .filter((alert) => alert.limite);
}

function monthlySpendingLimit({ orcamentoMensal, rendaMensal, valorMeta }) {
  const limits = [];

  if (orcamentoMensal) {
    limits.push(orcamentoMensal);
  }

  if (rendaMensal) {
    limits.push(Math.max(rendaMensal - Number(valorMeta || 0), 0));
  }

  return limits.length ? Math.min(...limits) : null;
}

function buildWeeklyPlannerData({
  alerts,
  dateUtils,
  expenses,
  fixedExpenses,
  goal,
  profile,
  question,
  referenceDate,
}) {
  const totalMesAtual = roundMoney(expenses.reduce((total, expense) => total + Number(expense.value || 0), 0));
  const gastosFixosTotal = roundMoney(fixedExpenses.reduce((total, expense) => total + Number(expense.value || 0), 0));
  const rendaMensal = validPositiveNumber(profile?.rendaMensal);
  const orcamentoMensal = validPositiveNumber(profile?.orcamentoMensal);
  const vencimentoCartao = Number(profile?.vencimentoCartao);
  const valorMeta = activeGoal(goal);
  const { diasAteDomingo, diasRestantesMes } = dateMetrics(dateUtils, referenceDate);
  const economiaProjetada = rendaMensal ? roundMoney(rendaMensal - totalMesAtual) : null;
  const limiteMensal = monthlySpendingLimit({ orcamentoMensal, rendaMensal, valorMeta });
  const saldoDisponivel = limiteMensal === null ? null : roundMoney(Math.max(limiteMensal - totalMesAtual, 0));

  return {
    totalMesAtual,
    categoriasTop: summarizeCategories(expenses).slice(0, 3),
    rendaMensal,
    orcamentoMensal,
    vencimentoCartao: Number.isInteger(vencimentoCartao) && vencimentoCartao >= 1 && vencimentoCartao <= 31
      ? vencimentoCartao
      : null,
    valorMeta,
    economiaProjetada,
    diasAteDomingo,
    diasRestantesMes,
    limiteDiarioSemana: saldoDisponivel === null ? null : roundMoney(saldoDisponivel / diasAteDomingo),
    limiteDiarioMes: saldoDisponivel === null ? null : roundMoney(saldoDisponivel / diasRestantesMes),
    quantoFaltaMeta: rendaMensal && valorMeta
      ? roundMoney(Math.max(valorMeta - economiaProjetada, 0))
      : null,
    gastosFixosTotal,
    alertasAtivos: normalizeActiveAlerts(alerts),
    perguntaUsuario: String(question || '').trim(),
  };
}

function hasPlannerData(data) {
  return Boolean(
    data.totalMesAtual ||
    data.gastosFixosTotal ||
    data.rendaMensal ||
    data.orcamentoMensal ||
    data.valorMeta ||
    data.alertasAtivos.length
  );
}

function buildWeeklyPlannerPrompt(data) {
  return [
    {
      role: 'system',
      content: [
        'Você escreve um plano financeiro semanal curto para o SalvaMoney.',
        'Responda em português brasileiro, de forma direta, prática e amigável.',
        'Use somente os números e categorias recebidos.',
        'Não invente números, categorias, datas ou percentuais.',
        'Os cálculos já foram feitos; não refaça os cálculos principais.',
        'Dê no máximo 5 ações práticas.',
        'Não recomende investimentos específicos.',
        'Não dê aconselhamento financeiro profissional.',
        'Não mande comprar ou vender ativos.',
        'Não prometa resultado.',
        'Não execute nem prometa executar alterações.',
        'Não diga que recebeu JSON ou dados estruturados.',
        'Não use tom alarmista.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Dados calculados para o plano semanal:\n${JSON.stringify(data, null, 2)}`,
    },
  ];
}

function buildDeterministicWeeklyPlan(data) {
  if (!hasPlannerData(data)) {
    return 'Ainda tenho poucos dados para montar um plano. Comece registrando gastos e me diga sua renda com: recebo 3000 todo dia 5';
  }

  const lines = [
    'Plano da semana:',
    '',
    `Você gastou ${formatMoney(data.totalMesAtual)} este mês.`,
  ];

  if (data.categoriasTop[0]) {
    lines.push(`Sua maior categoria é ${data.categoriasTop[0].categoria}.`);
  }

  lines.push('', 'Sugestão para esta semana:');

  const actions = [];

  if (data.limiteDiarioSemana !== null) {
    actions.push(`Limite gastos variáveis a ${formatMoney(data.limiteDiarioSemana)} por dia até domingo.`);
  } else {
    actions.push('Defina um teto simples para os gastos variáveis até domingo.');
  }

  if (data.categoriasTop[0]) {
    actions.push(`Evite novos gastos em ${data.categoriasTop[0].categoria} que não sejam necessários.`);
  }

  if (data.vencimentoCartao) {
    actions.push(`Revise compras no cartão antes do vencimento no dia ${data.vencimentoCartao}.`);
  }

  if (data.valorMeta) {
    actions.push('Acompanhe sua meta enviando: minha meta.');
  } else if (!data.rendaMensal) {
    actions.push('Informe sua renda com: recebo 3000 todo dia 5.');
  }

  actions.slice(0, 5).forEach((action, index) => {
    lines.push(`${index + 1}. ${action}`);
  });

  return lines.join('\n');
}

function createWeeklyPlannerService({
  aiProviderRouter,
  dateUtils,
  db,
  firebaseOps,
  now = () => new Date(),
  transactionStore: providedTransactionStore,
}) {
  const { get, ref } = firebaseOps;
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps: { get, ref },
    monthKey: dateUtils.monthKey,
  });

  function hasValidAccessSession(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
  }

  async function readUserChild(session, child) {
    const snap = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${session.user}/${child}`));

    return snap.val() || {};
  }

  async function processarPlanoSemanal(session, text) {
    if (!isWeeklyPlannerCommand(text)) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return WEEKLY_PLANNER_REQUIRED_MESSAGE;
    }

    const referenceDate = now();
    const [expenses, fixedExpenses, profile, goal, alerts] = await Promise.all([
      transactionStore.listMonthlyExpensesWithIds({ date: referenceDate, group: DEFAULT_GROUP, user: session.user }),
      transactionStore.listFixedExpensesWithIds({ group: DEFAULT_GROUP, user: session.user }),
      readUserChild(session, 'perfilFinanceiro'),
      readUserChild(session, `metasEconomia/${dateUtils.monthKey(referenceDate)}`),
      readUserChild(session, 'alertas'),
    ]);
    const plannerData = buildWeeklyPlannerData({
      alerts,
      dateUtils,
      expenses,
      fixedExpenses,
      goal,
      profile,
      question: text,
      referenceDate,
    });
    const fallback = buildDeterministicWeeklyPlan(plannerData);

    if (!hasPlannerData(plannerData) || !aiProviderRouter?.generateText) {
      return fallback;
    }

    return await aiProviderRouter.generateText({
      task: 'weekly_financial_plan',
      messages: buildWeeklyPlannerPrompt(plannerData),
      fallback,
    });
  }

  return {
    processarPlanoSemanal,
  };
}

module.exports = {
  WEEKLY_PLANNER_REQUIRED_MESSAGE,
  buildDeterministicWeeklyPlan,
  buildWeeklyPlannerData,
  buildWeeklyPlannerPrompt,
  createWeeklyPlannerService,
  dateMetrics,
  isWeeklyPlannerCommand,
};
