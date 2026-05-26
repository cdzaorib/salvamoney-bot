'use strict';

const { parseMoney } = require('../expense-parser');
const { createTransactionStore } = require('../services/transaction-store');
const { detectarCategoria } = require('./categories');
const { normalizeText } = require('./text-utils');

const MONEY_PATTERN = '(?:R\\$\\s*)?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:[,.]\\d{1,2})?';
const FIXED_LIST_COMMANDS = new Set([
  'fixos',
  'gastos fixos',
  'listar fixos',
  'meus gastos fixos',
]);

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function compact(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isFixedExpenseListCommand(text) {
  return FIXED_LIST_COMMANDS.has(normalizeText(text).trim().replace(/\s+/g, ' '));
}

function isFixedExpenseDeleteCommand(text) {
  const normalized = normalizeText(text).trim().replace(/\s+/g, ' ');

  return /^(apagar|remover|excluir)\b/.test(normalized) &&
    /\b(gasto fixo|fixos?|gastos fixos)\b/.test(normalized);
}

function isFixedExpenseCreateCommand(text) {
  const normalized = normalizeText(text).trim().replace(/\s+/g, ' ');

  return /^(adicionar\s+)?gasto fixo\b/.test(normalized) ||
    /^adicionar\s+fixo\b/.test(normalized) ||
    /^cadastrar\s+(gasto\s+)?fixo\b/.test(normalized) ||
    /^fixo\b/.test(normalized) ||
    /^todo mes pago\b/.test(normalized);
}

function isFixedExpenseCommand(text) {
  return isFixedExpenseListCommand(text) ||
    isFixedExpenseDeleteCommand(text) ||
    isFixedExpenseCreateCommand(text);
}

function extractFixedDay(text) {
  const match = String(text || '').match(/\b(?:todo\s+)?dia\s+(\d{1,2})\b/i);
  const day = match ? Number(match[1]) : null;

  return day >= 1 && day <= 31 ? day : null;
}

function stripFixedCommand(text) {
  return compact(String(text || '')
    .replace(/\b(?:todo\s+)?dia\s+\d{1,2}\b/gi, ' ')
    .replace(/^adicionar\s+gasto\s+fixo\s+(?:de\s+)?/i, '')
    .replace(/^adicionar\s+fixo\s+(?:de\s+)?/i, '')
    .replace(/^cadastrar\s+gasto\s+fixo\s+(?:de\s+)?/i, '')
    .replace(/^cadastrar\s+fixo\s+(?:de\s+)?/i, '')
    .replace(/^gasto\s+fixo\s+(?:de\s+)?/i, '')
    .replace(/^fixo\s+/i, '')
    .replace(/^todo\s+m[eê]s\s+pago\s+/i, ''));
}

function cleanDescription(value) {
  return compact(compact(value)
    .replace(/^(com|de|do|da|dos|das|no|na|em|para)\s+/i, '')
    .replace(/\b(todo\s+m[eê]s|por\s+m[eê]s)\b/gi, ' '));
}

function parseFixedExpense(text) {
  const day = extractFixedDay(text);
  const cleanText = stripFixedCommand(text);
  const amountMatch = cleanText.match(new RegExp(MONEY_PATTERN, 'i'));

  if (!amountMatch) {
    return null;
  }

  const value = parseMoney(amountMatch[0]);

  if (!value || value <= 0) {
    return null;
  }

  const beforeAmount = cleanText.slice(0, amountMatch.index);
  const afterAmount = cleanText.slice(amountMatch.index + amountMatch[0].length);
  const desc = cleanDescription(afterAmount) || cleanDescription(beforeAmount);

  if (!desc) {
    return null;
  }

  return {
    desc,
    value,
    cat: detectarCategoria(desc),
    dia: day,
  };
}

function missingDayMessage() {
  return [
    'Informe o dia do mês para esse gasto fixo.',
    '',
    'Exemplo:',
    'fixo internet 99,90 dia 10',
  ].join('\n');
}

function invalidFixedExpenseMessage() {
  return [
    'Não consegui identificar o gasto fixo.',
    '',
    'Exemplo:',
    'fixo internet 99,90 dia 10',
  ].join('\n');
}

function fixedExpenseLine(item, index) {
  return `${index + 1}. ${item.desc || 'Gasto fixo'} — ${formatMoney(item.value)} — ${item.cat || 'Outros'} — dia ${item.dia || '-'}`;
}

function savedFixedExpenseMessage(fixedExpense) {
  return [
    '📌 Gasto fixo cadastrado!',
    `*${fixedExpense.desc}* — ${formatMoney(fixedExpense.value)}`,
    `Categoria: ${fixedExpense.cat}`,
    `Dia: ${fixedExpense.dia}`,
    '',
    'Ele foi salvo como gasto fixo e não gerou gasto mensal agora.',
  ].join('\n');
}

function fixedExpenseListMessage(items) {
  if (!items.length) {
    return 'Você ainda não tem gastos fixos cadastrados.';
  }

  return [
    '📌 *Gastos fixos*',
    '',
    ...items.slice(0, 20).map(fixedExpenseLine),
  ].join('\n');
}

function deletedFixedExpenseMessage(item) {
  return `🗑️ Gasto fixo removido:
*${item.desc || 'Gasto fixo'}* — ${formatMoney(item.value)} — dia ${item.dia || '-'}`;
}

function fixedExpenseSelectionMessage(candidates) {
  return [
    'Encontrei estes gastos fixos:',
    '',
    ...candidates.map(fixedExpenseLine),
    '',
    "Responda com o número do fixo que deseja apagar ou 'cancelar'.",
  ].join('\n');
}

function parseFixedDeleteQuery(text) {
  return normalizeText(text)
    .replace(/^(apagar|remover|excluir)\b/, ' ')
    .replace(/\b(gastos?|fixos?|fixo)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fixedExpenseMatchesQuery(item, query) {
  const words = String(query || '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);

  if (!words.length) {
    return false;
  }

  const searchable = normalizeText(`${item.desc || ''} ${item.cat || ''}`);

  return words.every((word) => searchable.includes(word));
}

function pendingFixedExpense(item) {
  return {
    id: item.id,
    desc: item.desc || 'Gasto fixo',
    value: Number(item.value || 0),
    cat: item.cat || 'Outros',
    dia: item.dia || null,
  };
}

function createFixedExpenseService({
  dateUtils,
  db,
  firebaseOps,
  transactionStore: providedTransactionStore,
}) {
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps,
    monthKey: dateUtils.monthKey,
  });

  async function cadastrarFixo(session, text) {
    const fixedExpense = parseFixedExpense(text);

    if (!fixedExpense) {
      return invalidFixedExpenseMessage();
    }

    if (!fixedExpense.dia) {
      return missingDayMessage();
    }

    await transactionStore.saveFixedExpense({
      group: session.group,
      user: session.user,
      fixedExpense,
    });

    return savedFixedExpenseMessage(fixedExpense);
  }

  async function listarFixos(session) {
    const items = await transactionStore.listFixedExpensesWithIds({
      group: session.group,
      user: session.user,
    });

    return fixedExpenseListMessage(
      items.sort((a, b) => Number(a.dia || 99) - Number(b.dia || 99))
    );
  }

  async function removerFixoSelecionado(session, fixedExpense) {
    await transactionStore.removeFixedExpenseById({
      group: session.group,
      id: fixedExpense.id,
      user: session.user,
    });

    return deletedFixedExpenseMessage(fixedExpense);
  }

  async function removerFixoPorTexto(session, text, options = {}) {
    const query = parseFixedDeleteQuery(text);

    if (!query) {
      return 'Informe qual gasto fixo deseja apagar.';
    }

    const candidates = (await transactionStore.listFixedExpensesWithIds({
      group: session.group,
      user: session.user,
    }))
      .filter((item) => fixedExpenseMatchesQuery(item, query))
      .sort((a, b) => String(a.desc || '').localeCompare(String(b.desc || '')))
      .slice(0, 5)
      .map(pendingFixedExpense);

    if (!candidates.length) {
      return 'Não encontrei nenhum gasto fixo parecido. Nenhum gasto foi apagado.';
    }

    if (candidates.length === 1) {
      return await removerFixoSelecionado(session, candidates[0]);
    }

    if (!options.createPendingSelection) {
      return fixedExpenseSelectionMessage(candidates);
    }

    return {
      message: fixedExpenseSelectionMessage(candidates),
      pendingDelete: {
        type: 'fixed_expense_selection',
        candidates,
      },
    };
  }

  async function processarComandoFixo(session, text, options = {}) {
    if (isFixedExpenseListCommand(text)) {
      return await listarFixos(session);
    }

    if (isFixedExpenseDeleteCommand(text)) {
      return await removerFixoPorTexto(session, text, options);
    }

    if (isFixedExpenseCreateCommand(text)) {
      return await cadastrarFixo(session, text);
    }

    return null;
  }

  return {
    cadastrarFixo,
    isFixedExpenseCommand,
    listarFixos,
    processarComandoFixo,
    removerFixoPorTexto,
    removerFixoSelecionado,
  };
}

module.exports = {
  createFixedExpenseService,
  isFixedExpenseCommand,
  parseFixedExpense,
};
