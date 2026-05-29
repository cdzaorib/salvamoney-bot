'use strict';

const { parseMoney } = require('../expense-parser');
const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const ALERT_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const MONEY_PATTERN = /(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?/i;

const CATEGORY_ALIASES = [{
  category: 'Alimentação',
  terms: ['alimentacao', 'comida', 'delivery', 'ifood', 'mercado', 'restaurante', 'supermercado'],
}, {
  category: 'Transporte',
  terms: ['99', 'combustivel', 'gasolina', 'onibus', 'taxi', 'transporte', 'uber'],
}, {
  category: 'Academia',
  terms: ['academia', 'gym', 'musculacao', 'pilates'],
}, {
  category: 'Roupas',
  terms: ['roupa', 'roupas', 'sapato', 'tenis', 'vestuario'],
}, {
  category: 'Lazer',
  terms: ['cinema', 'jogo', 'lazer', 'netflix', 'show'],
}, {
  category: 'Saúde',
  terms: ['farmacia', 'medico', 'remedio', 'saude'],
}, {
  category: 'Moradia',
  terms: ['aluguel', 'casa', 'condominio', 'moradia'],
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

function normalizeMoneyValue(raw) {
  const clean = String(raw || '')
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .trim();

  if (/^\d{1,3}(?:\.\d{3})+$/.test(clean)) {
    return Number(clean.replace(/\./g, ''));
  }

  return parseMoney(clean);
}

function extractLimit(text) {
  const match = String(text || '').match(MONEY_PATTERN);

  if (!match) {
    return null;
  }

  const value = normalizeMoneyValue(match[0]);

  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function removeLimitText(command) {
  return command.replace(MONEY_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

function resolveCategory(value) {
  const normalized = normalizeText(value);

  return CATEGORY_ALIASES.find(({ terms }) =>
    terms.some((term) => new RegExp(`(^|\\W)${term}(\\W|$)`).test(normalized))
  )?.category || null;
}

function isAlertListCommand(command) {
  return ['alertas', 'listar alertas', 'meus alertas'].includes(command);
}

function parseAlertRemoveCommand(command) {
  const match = command.match(/^(remover|apagar|excluir)\s+alerta(?:\s+(.+))?$/);

  if (!match) {
    return null;
  }

  const query = String(match[2] || '').trim();

  return {
    action: 'remove',
    index: /^\d+$/.test(query) ? Number(query) : null,
    query,
  };
}

function looksLikeAlertCreateCommand(command) {
  return /^me avise\b/.test(command) ||
    /^(criar\s+)?alerta\b/.test(command) ||
    /^limite\b/.test(command);
}

function isMonthlyAlertCommand(commandWithoutLimit, category) {
  if (category) {
    return false;
  }

  return !category ||
    /\b(orcamento|mensal|mes|gastos passarem|meus gastos|gastos do mes)\b/.test(commandWithoutLimit);
}

function parseAlertCreateCommand(command) {
  if (!looksLikeAlertCreateCommand(command)) {
    return null;
  }

  const limit = extractLimit(command);

  if (!limit) {
    return {
      action: 'create',
      error: 'Informe um limite positivo. Exemplo: alerta de 300 para alimentação',
    };
  }

  const commandWithoutLimit = removeLimitText(command);
  const category = resolveCategory(commandWithoutLimit);
  const monthly = isMonthlyAlertCommand(commandWithoutLimit, category);

  return {
    action: 'create',
    alerta: monthly
      ? {
          tipo: 'orcamento_mensal',
          limite: limit,
        }
      : {
          tipo: 'categoria',
          categoria: category,
          limite: limit,
        },
  };
}

function parseAlertCommand(text) {
  const command = normalizedCommand(text);

  if (isAlertListCommand(command)) {
    return {
      action: 'list',
    };
  }

  return parseAlertRemoveCommand(command) || parseAlertCreateCommand(command);
}

function alertasPath(session) {
  const tag = normalizeAccessTag(session?.tag || session?.user);

  return `grupos/${DEFAULT_GROUP}/usuarios/${tag}/alertas`;
}

function alertaPath(session, id) {
  return `${alertasPath(session)}/${id}`;
}

function isActiveAlert(alerta) {
  return alerta && alerta.ativo !== false;
}

function alertLine(alerta, index) {
  if (alerta.tipo === 'categoria') {
    return `${index + 1}. ${alerta.categoria || 'Categoria'} acima de ${formatMoney(alerta.limite)}`;
  }

  return `${index + 1}. Orçamento mensal acima de ${formatMoney(alerta.limite)}`;
}

function createdAlertMessage(alerta) {
  if (alerta.tipo === 'categoria') {
    return [
      'Alerta criado ✅',
      `Vou te avisar quando ${alerta.categoria} passar de ${formatMoney(alerta.limite)} no mês.`,
    ].join('\n');
  }

  return [
    'Alerta criado ✅',
    `Vou te avisar quando seus gastos do mês passarem de ${formatMoney(alerta.limite)}.`,
  ].join('\n');
}

function listAlertsMessage(alertas) {
  if (!alertas.length) {
    return 'Você ainda não tem alertas ativos.';
  }

  return [
    'Seus alertas ativos:',
    ...alertas.map(alertLine),
  ].join('\n');
}

function removedAlertMessage(alerta) {
  if (alerta.tipo === 'categoria') {
    return `Alerta de ${alerta.categoria || 'categoria'} removido.`;
  }

  return 'Alerta de orçamento mensal removido.';
}

function ambiguousAlertMessage(alertas) {
  return [
    'Encontrei mais de um alerta:',
    ...alertas.map(alertLine),
    '',
    'Envie o número. Exemplo: remover alerta 1',
  ].join('\n');
}

function categoryTotal(expenses, category) {
  const normalizedCategory = normalizeText(category);

  return expenses
    .filter((expense) => normalizeText(expense.cat || 'Outros') === normalizedCategory)
    .reduce((total, expense) => total + Number(expense.value || 0), 0);
}

function monthlyTotal(expenses) {
  return expenses.reduce((total, expense) => total + Number(expense.value || 0), 0);
}

function triggerMessage(alerta, total) {
  if (alerta.tipo === 'categoria') {
    return [
      'Alerta financeiro ⚠️',
      `Você passou de ${formatMoney(alerta.limite)} em ${alerta.categoria} neste mês.`,
      `Total atual: ${formatMoney(total)}.`,
    ].join('\n');
  }

  return [
    'Alerta financeiro ⚠️',
    `Seus gastos do mês passaram de ${formatMoney(alerta.limite)}.`,
    `Total atual: ${formatMoney(total)}.`,
  ].join('\n');
}

function sortAlerts(alertas) {
  return [...alertas].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
}

function createAlertService({
  dateUtils,
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
  transactionStore: providedTransactionStore,
}) {
  const { get, push, ref, update } = firebaseOps;
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps: { get, push, ref },
    monthKey: dateUtils.monthKey,
  });

  function hasValidAccessSession(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
  }

  async function listAlerts(session) {
    const snap = await get(ref(db, alertasPath(session)));

    return sortAlerts(
      Object.entries(snap.val() || {})
        .map(([id, alerta]) => ({ id, ...alerta }))
        .filter(isActiveAlert)
    );
  }

  async function createAlert(session, alerta) {
    const timestamp = now();
    const data = {
      ...alerta,
      ativo: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await push(ref(db, alertasPath(session)), data);

    return createdAlertMessage(data);
  }

  async function deactivateAlert(session, alerta) {
    await update(ref(db, alertaPath(session, alerta.id)), {
      ativo: false,
      updatedAt: now(),
    });

    return removedAlertMessage(alerta);
  }

  async function removeAlert(session, command) {
    const alertas = await listAlerts(session);

    if (!alertas.length) {
      return 'Você ainda não tem alertas ativos.';
    }

    if (command.index) {
      const selected = alertas[command.index - 1];

      return selected
        ? await deactivateAlert(session, selected)
        : 'Não encontrei esse alerta ativo.';
    }

    const category = resolveCategory(command.query);
    const monthly = /\b(orcamento|mensal|mes)\b/.test(normalizeText(command.query));
    const candidates = alertas.filter((alerta) => {
      if (category) {
        return alerta.tipo === 'categoria' && normalizeText(alerta.categoria) === normalizeText(category);
      }

      return monthly && alerta.tipo === 'orcamento_mensal';
    });

    if (!candidates.length) {
      return 'Não encontrei esse alerta ativo.';
    }

    if (candidates.length > 1) {
      return ambiguousAlertMessage(candidates);
    }

    return await deactivateAlert(session, candidates[0]);
  }

  async function processarComandoAlerta(session, text) {
    const command = parseAlertCommand(text);

    if (!command) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return ALERT_REQUIRED_MESSAGE;
    }

    if (command.error) {
      return command.error;
    }

    if (command.action === 'list') {
      return listAlertsMessage(await listAlerts(session));
    }

    if (command.action === 'remove') {
      return await removeAlert(session, command);
    }

    if (command.action === 'create') {
      return await createAlert(session, command.alerta);
    }

    return null;
  }

  async function verificarAlertas(session) {
    if (!hasValidAccessSession(session)) {
      return [];
    }

    const alertas = await listAlerts(session);
    const currentMonthKey = dateUtils.monthKey();
    const pendingAlerts = alertas.filter((alerta) => alerta.ultimoDisparoMes !== currentMonthKey);

    if (!pendingAlerts.length) {
      return [];
    }

    const expenses = await transactionStore.listMonthlyExpensesWithIds({
      date: new Date(),
      group: DEFAULT_GROUP,
      user: normalizeAccessTag(session.tag || session.user),
    });
    const messages = [];

    for (const alerta of pendingAlerts) {
      const total = alerta.tipo === 'categoria'
        ? categoryTotal(expenses, alerta.categoria)
        : monthlyTotal(expenses);

      if (total <= Number(alerta.limite || 0)) {
        continue;
      }

      await update(ref(db, alertaPath(session, alerta.id)), {
        ultimoDisparoMes: currentMonthKey,
        updatedAt: now(),
      });
      messages.push(triggerMessage(alerta, Math.round(total * 100) / 100));
    }

    return messages;
  }

  return {
    processarComandoAlerta,
    verificarAlertas,
  };
}

module.exports = {
  ALERT_REQUIRED_MESSAGE,
  createAlertService,
  parseAlertCommand,
};
