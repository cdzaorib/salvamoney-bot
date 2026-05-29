'use strict';

const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const EXPENSE_QUERY_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';

const CATEGORY_ALIASES = [{
  category: 'Alimentação',
  terms: [
    'alimentacao',
    'comida',
    'delivery',
    'ifood',
    'jantar',
    'lanche',
    'mercado',
    'padaria',
    'restaurante',
    'supermercado',
  ],
}, {
  category: 'Transporte',
  terms: [
    '99',
    'combustivel',
    'gasolina',
    'onibus',
    'taxi',
    'transporte',
    'uber',
  ],
}, {
  category: 'Academia',
  terms: ['academia', 'gym', 'musculacao', 'pilates'],
}, {
  category: 'Roupas',
  terms: ['roupa', 'roupas', 'sapato', 'tenis', 'vestuario'],
}, {
  category: 'Lazer',
  terms: ['bar', 'cinema', 'jogo', 'lazer', 'netflix', 'show'],
}, {
  category: 'Saúde',
  terms: ['consulta', 'farmacia', 'medico', 'remedio', 'saude'],
}, {
  category: 'Moradia',
  terms: ['aluguel', 'casa', 'condominio', 'internet', 'luz', 'moradia'],
}];

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
}

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateFromParts(dateUtils, date = new Date()) {
  const parts = dateUtils.dateParts(date);

  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
}

function addDays(date, amount) {
  const next = new Date(date);

  next.setUTCDate(next.getUTCDate() + amount);

  return next;
}

function monthDateForOffset(dateUtils, offset) {
  const today = dateFromParts(dateUtils);

  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 15, 12));
}

function isoDate(dateUtils, date) {
  return dateUtils.todayIso(date);
}

function weekRange(dateUtils) {
  const today = dateFromParts(dateUtils);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const start = addDays(today, -daysSinceMonday);

  return {
    end: today,
    endIso: isoDate(dateUtils, today),
    start,
    startIso: isoDate(dateUtils, start),
  };
}

function periodDetails(type, dateUtils) {
  const today = dateFromParts(dateUtils);

  if (type === 'today') {
    const todayIso = isoDate(dateUtils, today);

    return {
      dateFilter: (expense) => expense.date === todayIso,
      datesToRead: [today],
      label: 'hoje',
    };
  }

  if (type === 'yesterday') {
    const yesterday = addDays(today, -1);
    const yesterdayIso = isoDate(dateUtils, yesterday);

    return {
      dateFilter: (expense) => expense.date === yesterdayIso,
      datesToRead: [yesterday],
      label: 'ontem',
    };
  }

  if (type === 'week') {
    const range = weekRange(dateUtils);
    const datesToRead = [range.start];

    if (dateUtils.monthKey(range.start) !== dateUtils.monthKey(range.end)) {
      datesToRead.push(range.end);
    }

    return {
      dateFilter: (expense) => {
        const date = String(expense.date || '');

        return date >= range.startIso && date <= range.endIso;
      },
      datesToRead,
      label: 'nesta semana',
    };
  }

  if (type === 'previous_month') {
    return {
      dateFilter: () => true,
      datesToRead: [monthDateForOffset(dateUtils, -1)],
      label: 'no mês passado',
    };
  }

  return {
    dateFilter: () => true,
    datesToRead: [today],
    label: 'neste mês',
  };
}

function detectPeriod(command) {
  const periods = [{
    pattern: /\bmes passado\b/g,
    type: 'previous_month',
  }, {
    pattern: /\b(essa|esta)\s+semana\b/g,
    type: 'week',
  }, {
    pattern: /\bontem\b/g,
    type: 'yesterday',
  }, {
    pattern: /\bhoje\b/g,
    type: 'today',
  }, {
    pattern: /\b(esse|este)\s+mes\b/g,
    type: 'current_month',
  }];

  for (const period of periods) {
    if (period.pattern.test(command)) {
      return {
        commandWithoutPeriod: command.replace(period.pattern, ' ').replace(/\s+/g, ' ').trim(),
        explicit: true,
        type: period.type,
      };
    }
  }

  return {
    commandWithoutPeriod: command,
    explicit: false,
    type: 'current_month',
  };
}

function cleanQuery(value) {
  let query = String(value || '')
    .replace(/^quanto\s+(eu\s+)?gastei\b/, ' ')
    .replace(/^gastos?\b/, ' ')
    .replace(/^total\b/, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (let index = 0; index < 4; index++) {
    query = query
      .replace(/^(com|de|do|da|dos|das|em|no|na|o|a)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return query;
}

function looksLikeExpenseQuery(command) {
  return /^quanto\s+(eu\s+)?gastei\b/.test(command) ||
    /^gastos\s+(com|de|do|da)\b/.test(command) ||
    /^total\s+(de|do|da)\b/.test(command);
}

function resolveCategory(query) {
  const normalized = normalizeText(query);

  return CATEGORY_ALIASES.find(({ terms }) =>
    terms.some((term) => new RegExp(`(^|\\W)${term}(\\W|$)`).test(normalized))
  )?.category || null;
}

function displayFilter(query, category) {
  if (!query) {
    return '';
  }

  const normalizedQuery = normalizeText(query);

  if (!category || normalizedQuery === normalizeText(category)) {
    return category || query;
  }

  return `${query}/${String(category).toLowerCase()}`;
}

function parseExpenseQueryCommand(text) {
  const command = normalizedCommand(text);

  if (!looksLikeExpenseQuery(command)) {
    return null;
  }

  const period = detectPeriod(command);
  const query = cleanQuery(period.commandWithoutPeriod);

  if (!query && !period.explicit) {
    return null;
  }

  const category = query ? resolveCategory(query) : null;

  return {
    category,
    periodType: period.type,
    query,
  };
}

function descriptionMatches(expense, query) {
  if (!query) {
    return true;
  }

  const description = normalizeText(expense.desc || '');
  const words = normalizeText(query)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);

  return words.length > 0 && words.every((word) => description.includes(word));
}

function categoryMatches(expense, category) {
  if (!category) {
    return false;
  }

  return normalizeText(expense.cat || 'Outros') === normalizeText(category);
}

function filterExpenses(expenses, query) {
  if (!query.query && !query.category) {
    return expenses;
  }

  return expenses.filter((expense) =>
    categoryMatches(expense, query.category) || descriptionMatches(expense, query.query)
  );
}

function formatExpenseDate(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

  return match ? `${match[3]}/${match[2]}` : '--/--';
}

function expenseLine(expense, index) {
  return `${index + 1}. ${expense.desc || 'Gasto'} - ${formatMoney(expense.value)} - ${formatExpenseDate(expense.date)}`;
}

function querySuccessMessage({ expenses, filterLabel, periodLabel, total }) {
  const target = filterLabel ? ` com ${filterLabel}` : '';
  const biggest = [...expenses]
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 5);

  return [
    `Você gastou ${formatMoney(total)}${target} ${periodLabel}.`,
    '',
    `Registros encontrados: ${expenses.length}`,
    '',
    'Maiores gastos:',
    ...biggest.map(expenseLine),
  ].join('\n');
}

function queryEmptyMessage({ filterLabel, periodLabel }) {
  const target = filterLabel ? ` com ${filterLabel}` : '';

  return `Não encontrei gastos${target} ${periodLabel}.`;
}

function createExpenseQueryService({
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

  async function listExpensesForPeriod(session, period) {
    const details = periodDetails(period, dateUtils);
    const seenMonths = new Set();
    const expenses = [];

    for (const date of details.datesToRead) {
      const key = dateUtils.monthKey(date);

      if (seenMonths.has(key)) {
        continue;
      }

      seenMonths.add(key);
      expenses.push(...await transactionStore.listMonthlyExpensesWithIds({
        date,
        group: DEFAULT_GROUP,
        user: session.user,
      }));
    }

    return {
      expenses: expenses.filter(details.dateFilter),
      label: details.label,
    };
  }

  async function processarConsultaGastos(session, text) {
    const query = parseExpenseQueryCommand(text);

    if (!query) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return EXPENSE_QUERY_REQUIRED_MESSAGE;
    }

    const { expenses, label: periodLabel } = await listExpensesForPeriod(session, query.periodType);
    const filtered = filterExpenses(expenses, query);
    const total = Math.round(
      filtered.reduce((amount, expense) => amount + Number(expense.value || 0), 0) * 100
    ) / 100;
    const filterLabel = displayFilter(query.query, query.category);

    if (!filtered.length) {
      return queryEmptyMessage({ filterLabel, periodLabel });
    }

    return querySuccessMessage({
      expenses: filtered,
      filterLabel,
      periodLabel,
      total,
    });
  }

  return {
    processarConsultaGastos,
  };
}

module.exports = {
  EXPENSE_QUERY_REQUIRED_MESSAGE,
  createExpenseQueryService,
  parseExpenseQueryCommand,
};
