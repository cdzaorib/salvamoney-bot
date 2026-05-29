'use strict';

const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { MESES } = require('./date-utils');
const { normalizeText } = require('./text-utils');

const MONTHLY_SUMMARY_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const MONTHLY_SUMMARY_COMMANDS = new Set([
  'resumo do mes',
  'resumo mensal',
  'meu resumo',
  'como estou indo esse mes',
  'analise do mes',
  'relatorio do mes',
]);

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
}

function isMonthlySummaryCommand(value) {
  return MONTHLY_SUMMARY_COMMANDS.has(normalizedCommand(value));
}

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function validPositiveNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

function categoryName(expense) {
  const category = String(expense?.cat || '').trim();

  return category || 'Outros';
}

function summarizeExpenses(expenses) {
  const byCategory = {};
  let total = 0;

  expenses.forEach((expense) => {
    const value = Number(expense?.value || 0);

    if (!Number.isFinite(value)) {
      return;
    }

    const category = categoryName(expense);

    total += value;
    byCategory[category] = (byCategory[category] || 0) + value;
  });

  const categories = Object.entries(byCategory)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  return {
    byCategory,
    categories,
    count: expenses.length,
    topCategory: categories[0] || null,
    total: Math.round(total * 100) / 100,
  };
}

function monthName(dateUtils, date = new Date()) {
  const parts = dateUtils.dateParts(date);

  return MESES[Number(parts.month) - 1].toLowerCase();
}

function previousMonthDate(dateUtils, date = new Date()) {
  const parts = dateUtils.dateParts(date);

  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 2, 15, 12));
}

function comparisonLine(currentTotal, previousTotal) {
  if (!previousTotal || previousTotal <= 0) {
    return 'Ainda não tenho histórico suficiente para comparar com o mês passado.';
  }

  const diff = currentTotal - previousTotal;
  const percent = Math.round(Math.abs(diff / previousTotal) * 100);

  if (percent === 0) {
    return 'Comparado ao mês passado, seus gastos ficaram praticamente iguais.';
  }

  return diff > 0
    ? `Comparado ao mês passado, seus gastos subiram ${percent}%.`
    : `Comparado ao mês passado, seus gastos caíram ${percent}%.`;
}

function categoryTrendLine(currentByCategory, previousByCategory) {
  const categoryNames = new Set([
    ...Object.keys(currentByCategory || {}),
    ...Object.keys(previousByCategory || {}),
  ]);
  const trends = [];

  categoryNames.forEach((name) => {
    const current = Number(currentByCategory[name] || 0);
    const previous = Number(previousByCategory[name] || 0);

    if (previous <= 0 || current === previous) {
      return;
    }

    trends.push({
      diff: current - previous,
      name,
      percent: Math.round(Math.abs((current - previous) / previous) * 100),
    });
  });

  if (!trends.length) {
    return '';
  }

  const rising = trends
    .filter((trend) => trend.diff > 0)
    .sort((a, b) => b.diff - a.diff)[0];

  if (rising) {
    return `${rising.name} foi a categoria que mais cresceu: subiu ${rising.percent}% em relação ao mês passado.`;
  }

  const falling = trends
    .filter((trend) => trend.diff < 0)
    .sort((a, b) => a.diff - b.diff)[0];

  return falling
    ? `${falling.name} foi a categoria que mais caiu: caiu ${falling.percent}% em relação ao mês passado.`
    : '';
}

function profileUsageLine(summary, profile) {
  const rendaMensal = validPositiveNumber(profile?.rendaMensal);
  const orcamentoMensal = validPositiveNumber(profile?.orcamentoMensal);
  const parts = [];

  if (rendaMensal) {
    parts.push(`${formatPercent((summary.total / rendaMensal) * 100)} da sua renda mensal`);
  }

  if (orcamentoMensal) {
    parts.push(`${formatPercent((summary.total / orcamentoMensal) * 100)} do seu orçamento`);
  }

  if (!parts.length) {
    return '';
  }

  if (parts.length === 1) {
    return `Você usou ${parts[0]}.`;
  }

  return `Você usou ${parts[0]} e ${parts[1]}.`;
}

function cardLines(profile, dateUtils) {
  const dueDay = Number(profile?.vencimentoCartao);

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return [];
  }

  const today = Number(dateUtils.dateParts().day);
  const daysUntilDue = dueDay - today;
  const lines = [`Seu cartão vence dia ${dueDay}.`];

  if (daysUntilDue >= 0 && daysUntilDue <= 5) {
    lines.push('Atenção: seu cartão está próximo do vencimento.');
  }

  return lines;
}

function practicalTip(summary, profile) {
  const budget = validPositiveNumber(profile?.orcamentoMensal);
  const topCategory = summary.topCategory?.name;

  if (budget && summary.total > budget) {
    return 'Dica: seu orçamento já foi ultrapassado. Revise os gastos variáveis antes de assumir novos compromissos.';
  }

  if (topCategory) {
    return `Dica: acompanhe ${topCategory}, que é sua maior categoria neste mês.`;
  }

  return 'Dica: registre os gastos no dia a dia para o resumo ficar mais preciso.';
}

function buildMonthlySummaryMessage({
  currentSummary,
  dateUtils,
  fixedTotal,
  hasPreviousHistory,
  previousSummary,
  profile,
}) {
  if (!currentSummary.count) {
    return 'Você ainda não tem gastos registrados neste mês.';
  }

  const lines = [
    `Resumo de ${monthName(dateUtils)} 📊`,
    '',
    `Total gasto: ${formatMoney(currentSummary.total)}`,
    `Registros: ${currentSummary.count}`,
    `Maior categoria: ${currentSummary.topCategory.name} - ${formatMoney(currentSummary.topCategory.value)}`,
    `Gastos fixos cadastrados: ${formatMoney(fixedTotal)}`,
    'Top categorias:',
    ...currentSummary.categories
      .slice(0, 3)
      .map((category, index) => `${index + 1}. ${category.name} - ${formatMoney(category.value)}`),
  ];

  const usageLine = profileUsageLine(currentSummary, profile);

  if (usageLine) {
    lines.push('', usageLine);
  } else {
    lines.push('', 'Para análises melhores, me diga sua renda com: recebo 3000 todo dia 5');
  }

  lines.push('');

  if (hasPreviousHistory) {
    lines.push(comparisonLine(currentSummary.total, previousSummary.total));

    const trend = categoryTrendLine(currentSummary.byCategory, previousSummary.byCategory);

    if (trend) {
      lines.push(trend);
    }
  } else {
    lines.push('Ainda não tenho histórico suficiente para comparar com o mês passado.');
  }

  const dueLines = cardLines(profile, dateUtils);

  if (dueLines.length) {
    lines.push('', ...dueLines);
  }

  lines.push('', practicalTip(currentSummary, profile));

  return lines.join('\n');
}

function createMonthlySummaryService({
  dateUtils,
  db,
  firebaseOps,
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

  async function getProfile(session) {
    const snap = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${session.user}/perfilFinanceiro`));

    return snap.val() || {};
  }

  async function processarResumoMensal(session, text) {
    if (!isMonthlySummaryCommand(text)) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return MONTHLY_SUMMARY_REQUIRED_MESSAGE;
    }

    const previousDate = previousMonthDate(dateUtils);
    const [currentExpenses, previousExpenses, fixedExpenses, profile] = await Promise.all([
      transactionStore.listMonthlyExpensesWithIds({ group: DEFAULT_GROUP, user: session.user }),
      transactionStore.listMonthlyExpensesWithIds({ date: previousDate, group: DEFAULT_GROUP, user: session.user }),
      transactionStore.listFixedExpensesWithIds({ group: DEFAULT_GROUP, user: session.user }),
      getProfile(session),
    ]);

    const currentSummary = summarizeExpenses(currentExpenses);
    const previousSummary = summarizeExpenses(previousExpenses);
    const fixedTotal = fixedExpenses.reduce((total, item) => total + Number(item.value || 0), 0);

    return buildMonthlySummaryMessage({
      currentSummary,
      dateUtils,
      fixedTotal,
      hasPreviousHistory: previousSummary.count > 0,
      previousSummary,
      profile,
    });
  }

  return {
    processarResumoMensal,
  };
}

module.exports = {
  MONTHLY_SUMMARY_REQUIRED_MESSAGE,
  buildMonthlySummaryMessage,
  createMonthlySummaryService,
  isMonthlySummaryCommand,
  summarizeExpenses,
};
