'use strict';

const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const WEEKLY_REPORT_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const WEEKLY_REPORT_COMMANDS = new Set([
  'relatorio da semana',
  'fechamento semanal',
  'como foi minha semana',
  'resumo da semana',
  'meu relatorio semanal',
  'minha semana financeira',
]);

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
}

function isWeeklyReportCommand(value) {
  return WEEKLY_REPORT_COMMANDS.has(normalizedCommand(value));
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

function calendarDate(dateUtils, date = new Date()) {
  const parts = dateUtils.dateParts(date);

  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
}

function shiftCalendarDate(date, days) {
  const shifted = new Date(date);

  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted;
}

function formatCalendarIso(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function weeklyPeriods(dateUtils, date = new Date()) {
  const currentEnd = calendarDate(dateUtils, date);

  return {
    current: {
      end: formatCalendarIso(currentEnd),
      start: formatCalendarIso(shiftCalendarDate(currentEnd, -6)),
    },
    previous: {
      end: formatCalendarIso(shiftCalendarDate(currentEnd, -7)),
      start: formatCalendarIso(shiftCalendarDate(currentEnd, -13)),
    },
  };
}

function expenseDate(expense) {
  const date = String(expense?.date || '').slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function expensesInPeriod(expenses, period) {
  return expenses.filter((expense) => {
    const date = expenseDate(expense);

    return date && date >= period.start && date <= period.end;
  });
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

function biggestExpense(expenses) {
  const expense = [...expenses]
    .filter((item) => Number.isFinite(Number(item?.value)))
    .sort((a, b) => Number(b.value) - Number(a.value) || String(a.desc || '').localeCompare(String(b.desc || '')))[0];

  return expense
    ? {
        data: expenseDate(expense),
        descricao: String(expense.desc || 'Gasto').slice(0, 80),
        valor: roundMoney(expense.value),
      }
    : null;
}

function biggestSpendingDay(expenses) {
  const totals = {};

  expenses.forEach((expense) => {
    const date = expenseDate(expense);
    const value = Number(expense?.value || 0);

    if (!date || !Number.isFinite(value)) {
      return;
    }

    totals[date] = (totals[date] || 0) + value;
  });

  const result = Object.entries(totals)
    .map(([data, total]) => ({
      data,
      total: roundMoney(total),
    }))
    .sort((a, b) => b.total - a.total || a.data.localeCompare(b.data))[0];

  return result || null;
}

function percentChange(currentTotal, previousTotal) {
  if (!previousTotal || previousTotal <= 0) {
    return null;
  }

  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
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

function buildWeeklyReportData({
  alerts,
  currentMonthExpenses,
  expenses,
  goal,
  periods,
  profile,
  question,
}) {
  const currentExpenses = expensesInPeriod(expenses, periods.current);
  const previousExpenses = expensesInPeriod(expenses, periods.previous);
  const totalSemanaAtual = roundMoney(currentExpenses.reduce((total, expense) => total + Number(expense.value || 0), 0));
  const totalSemanaAnterior = roundMoney(previousExpenses.reduce((total, expense) => total + Number(expense.value || 0), 0));
  const totalMesAtual = roundMoney(currentMonthExpenses.reduce((total, expense) => total + Number(expense.value || 0), 0));
  const rendaMensal = validPositiveNumber(profile?.rendaMensal);
  const orcamentoMensal = validPositiveNumber(profile?.orcamentoMensal);
  const valorMeta = activeGoal(goal);
  const economiaProjetada = rendaMensal ? roundMoney(rendaMensal - totalMesAtual) : null;

  return {
    totalSemanaAtual,
    totalSemanaAnterior,
    variacaoPercentual: percentChange(totalSemanaAtual, totalSemanaAnterior),
    quantidadeRegistros: currentExpenses.length,
    mediaDiaria: roundMoney(totalSemanaAtual / 7),
    topCategorias: summarizeCategories(currentExpenses).slice(0, 3),
    maiorGasto: biggestExpense(currentExpenses),
    diaMaiorGasto: biggestSpendingDay(currentExpenses),
    rendaMensal,
    orcamentoMensal,
    percentualRendaSemana: rendaMensal ? Math.round((totalSemanaAtual / rendaMensal) * 100) : null,
    percentualOrcamentoSemana: orcamentoMensal ? Math.round((totalSemanaAtual / orcamentoMensal) * 100) : null,
    valorMeta,
    economiaProjetada,
    statusMeta: valorMeta && economiaProjetada !== null
      ? (economiaProjetada >= valorMeta ? 'acima_da_meta' : 'abaixo_da_meta')
      : null,
    quantoFaltaMeta: valorMeta && economiaProjetada !== null
      ? roundMoney(Math.max(valorMeta - economiaProjetada, 0))
      : null,
    alertasAtivos: normalizeActiveAlerts(alerts),
    periodoInicio: periods.current.start,
    periodoFim: periods.current.end,
    perguntaUsuario: String(question || '').trim(),
  };
}

function buildWeeklyReportPrompt(data) {
  return [
    {
      role: 'system',
      content: [
        'Você escreve um relatório financeiro semanal curto para o SalvaMoney.',
        'Responda em português brasileiro, de forma direta, prática e amigável.',
        'Use somente os números e categorias recebidos.',
        'Não invente números, categorias, datas ou percentuais.',
        'Os cálculos já foram feitos; não refaça os cálculos principais.',
        'Dê no máximo 4 observações práticas.',
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
      content: `Dados calculados para o relatório semanal:\n${JSON.stringify(data, null, 2)}`,
    },
  ];
}

function comparisonLine(data) {
  if (data.variacaoPercentual === null) {
    return 'Ainda não tenho histórico suficiente para comparar com os 7 dias anteriores.';
  }

  if (data.variacaoPercentual === 0) {
    return 'Comparado aos 7 dias anteriores, seus gastos ficaram praticamente iguais.';
  }

  return data.variacaoPercentual > 0
    ? `Comparado aos 7 dias anteriores, seus gastos subiram ${Math.abs(data.variacaoPercentual)}%.`
    : `Comparado aos 7 dias anteriores, seus gastos caíram ${Math.abs(data.variacaoPercentual)}%.`;
}

function buildDeterministicWeeklyReport(data) {
  if (!data.quantidadeRegistros) {
    return 'Você ainda não tem gastos registrados nos últimos 7 dias.';
  }

  const lines = [
    'Relatório da semana:',
    '',
    `Você gastou ${formatMoney(data.totalSemanaAtual)} nos últimos 7 dias.`,
    `Registros: ${data.quantidadeRegistros}`,
    `Média diária: ${formatMoney(data.mediaDiaria)}`,
  ];

  if (data.topCategorias[0]) {
    lines.push(`Maior categoria: ${data.topCategorias[0].categoria} - ${formatMoney(data.topCategorias[0].total)}`);
  }

  lines.push('', comparisonLine(data));

  if (data.maiorGasto) {
    lines.push('', `Maior gasto: ${data.maiorGasto.descricao} - ${formatMoney(data.maiorGasto.valor)}.`);
  }

  if (data.topCategorias[0]) {
    lines.push(`Dica: acompanhe ${data.topCategorias[0].categoria}, que foi o maior peso da semana.`);
  }

  return lines.join('\n');
}

function createWeeklyReportService({
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

  async function gerarRelatorioSemanal(session, text = 'relatório da semana') {
    if (!hasValidAccessSession(session)) {
      return WEEKLY_REPORT_REQUIRED_MESSAGE;
    }

    const referenceDate = now();
    const periods = weeklyPeriods(dateUtils, referenceDate);
    const currentMonthKey = dateUtils.monthKey(referenceDate);
    const previousPeriodDate = calendarDate(dateUtils, new Date(`${periods.previous.start}T12:00:00.000Z`));
    const monthKeys = [...new Set([
      currentMonthKey,
      dateUtils.monthKey(previousPeriodDate),
    ])];
    const [monthExpenses, profile, goal, alerts] = await Promise.all([
      Promise.all(monthKeys.map(async (monthKey) => {
        const snap = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${session.user}/gastos/${monthKey}`));

        return Object.entries(snap.val() || {})
          .map(([id, expense]) => ({ id, ...expense }))
          .filter((expense) => Number.isFinite(Number(expense?.value)));
      })),
      readUserChild(session, 'perfilFinanceiro'),
      readUserChild(session, `metasEconomia/${currentMonthKey}`),
      readUserChild(session, 'alertas'),
    ]);
    const expenses = monthExpenses.flat();
    const currentMonthExpenses = monthExpenses[monthKeys.indexOf(currentMonthKey)] || [];
    const reportData = buildWeeklyReportData({
      alerts,
      currentMonthExpenses,
      expenses,
      goal,
      periods,
      profile,
      question: text,
    });
    const fallback = buildDeterministicWeeklyReport(reportData);

    if (!reportData.quantidadeRegistros || !aiProviderRouter?.generateText) {
      return fallback;
    }

    return await aiProviderRouter.generateText({
      task: 'weekly_financial_report',
      messages: buildWeeklyReportPrompt(reportData),
      fallback,
    });
  }

  async function processarRelatorioSemanal(session, text) {
    if (!isWeeklyReportCommand(text)) {
      return null;
    }

    return await gerarRelatorioSemanal(session, text);
  }

  return {
    gerarRelatorioSemanal,
    processarRelatorioSemanal,
  };
}

module.exports = {
  WEEKLY_REPORT_REQUIRED_MESSAGE,
  buildDeterministicWeeklyReport,
  buildWeeklyReportData,
  buildWeeklyReportPrompt,
  createWeeklyReportService,
  expensesInPeriod,
  isWeeklyReportCommand,
  weeklyPeriods,
};
