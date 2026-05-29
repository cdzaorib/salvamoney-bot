'use strict';

const { parseMoney } = require('../expense-parser');
const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const SAVINGS_GOAL_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const MONEY_PATTERN_TEXT = '(?:R\\$\\s*)?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:[,.]\\d{1,2})?';
const MONEY_PATTERN = new RegExp(MONEY_PATTERN_TEXT, 'i');

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

function extractMoney(text) {
  const match = String(text || '').match(MONEY_PATTERN);

  if (!match) {
    return null;
  }

  const value = normalizeMoneyValue(match[0]);

  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function validPositiveNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

function categoryName(expense) {
  const category = String(expense?.cat || '').trim();

  return category || 'Outros';
}

function topCategory(expenses) {
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
    .map(([categoria, total]) => ({ categoria, total: roundMoney(total) }))
    .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria))[0] || null;
}

function parseSavingsGoalCommand(text) {
  const command = normalizedCommand(text);

  if (/^(cancelar|remover)\s+(minha\s+)?meta(?:\s+de\s+economia)?$/.test(command)) {
    return {
      action: 'cancel',
    };
  }

  if (/^(quanto\s+falta\s+para\s+minha\s+meta|como\s+esta\s+minha\s+meta|minha\s+meta)$/.test(command)) {
    return {
      action: 'view',
    };
  }

  if (/^(criar\s+meta\s+de\s+economizar|quero\s+economizar|minha\s+meta\s+e\s+economizar|meta\s+de\s+economia)\b/.test(command)) {
    const value = extractMoney(command);

    if (!validPositiveNumber(value)) {
      return {
        action: 'create',
        error: 'Informe um valor positivo para a meta. Exemplo: criar meta de economizar 500 esse mês',
      };
    }

    return {
      action: 'create',
      goal: {
        descricao: 'Economia mensal',
        valorMeta: roundMoney(value),
      },
    };
  }

  return null;
}

function goalCreatedMessage(goal) {
  return [
    'Meta criada ✅',
    `Você quer economizar ${formatMoney(goal.valorMeta)} este mês.`,
    '',
    'Para acompanhar, envie: minha meta',
  ].join('\n');
}

function noActiveGoalMessage() {
  return [
    'Você ainda não tem uma meta de economia ativa neste mês.',
    '',
    'Para criar, envie: criar meta de economizar 500 esse mês',
  ].join('\n');
}

function cancelGoalMessage(goal) {
  return `Meta cancelada: ${formatMoney(goal.valorMeta)} este mês.`;
}

function deterministicTip({ rendaMensal, topCategoryInfo }) {
  if (topCategoryInfo) {
    return `mantenha atenção em ${topCategoryInfo.categoria}, que é sua maior categoria.`;
  }

  if (!rendaMensal) {
    return 'me diga sua renda para eu calcular o progresso com mais precisão.';
  }

  return 'acompanhe os gastos variáveis antes de assumir novas compras.';
}

function buildGoalAnalysis({ expenses, goal, profile }) {
  const totalGasto = roundMoney(expenses.reduce((total, expense) => total + Number(expense.value || 0), 0));
  const rendaMensal = validPositiveNumber(profile?.rendaMensal);
  const economiaProjetada = rendaMensal ? roundMoney(rendaMensal - totalGasto) : null;
  const diferencaMeta = rendaMensal ? roundMoney(economiaProjetada - Number(goal.valorMeta || 0)) : null;

  return {
    economiaProjetada,
    diferencaMeta,
    rendaMensal,
    status: rendaMensal && diferencaMeta >= 0 ? 'acima' : 'abaixo',
    topCategoryInfo: topCategory(expenses),
    totalGasto,
    valorMeta: Number(goal.valorMeta || 0),
  };
}

function buildGoalPrompt(data) {
  return [
    {
      role: 'system',
      content: [
        'Você escreve apenas uma dica curta para acompanhar uma meta de economia do SalvaMoney.',
        'Responda em português brasileiro.',
        'Use somente os números e categorias recebidos.',
        'Não invente números, datas ou categorias.',
        'Não recomende investimentos específicos.',
        'Não dê aconselhamento financeiro profissional.',
        'Não prometa resultado.',
        'Não diga que acessa banco ou JSON.',
        'Não execute nem prometa executar alterações.',
        'Seja direto, amigável e sem tom alarmista.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Dados calculados da meta:\n${JSON.stringify(data, null, 2)}`,
    },
  ];
}

async function buildGoalTip({ aiProviderRouter, fallbackTip, tipData }) {
  if (!aiProviderRouter?.generateText) {
    return fallbackTip;
  }

  return await aiProviderRouter.generateText({
    task: 'savings_goal_tip',
    messages: buildGoalPrompt(tipData),
    fallback: fallbackTip,
  });
}

function goalStatusLine(analysis) {
  if (!analysis.rendaMensal) {
    return 'Para calcular melhor, me diga sua renda com: recebo 3000 todo dia 5';
  }

  if (analysis.diferencaMeta >= 0) {
    return `Você está acima da meta por enquanto ✅${analysis.diferencaMeta > 0 ? ` Sobra prevista: ${formatMoney(analysis.diferencaMeta)}.` : ''}`;
  }

  return `Ainda faltam ${formatMoney(Math.abs(analysis.diferencaMeta))} para bater a meta.`;
}

function goalProgressMessage({ analysis, goal, tip }) {
  const lines = [
    `Sua meta de economia este mês é ${formatMoney(goal.valorMeta)}.`,
    '',
  ];

  if (analysis.rendaMensal) {
    lines.push(`Renda mensal: ${formatMoney(analysis.rendaMensal)}`);
  }

  lines.push(`Gasto até agora: ${formatMoney(analysis.totalGasto)}`);

  if (analysis.economiaProjetada !== null) {
    lines.push(`Economia projetada: ${formatMoney(analysis.economiaProjetada)}`);
  }

  lines.push('', goalStatusLine(analysis), '', `Dica: ${tip}`);

  return lines.join('\n');
}

function createSavingsGoalService({
  aiProviderRouter,
  dateUtils,
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
  transactionStore: providedTransactionStore,
}) {
  const { get, ref, update } = firebaseOps;
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps: { get, ref },
    monthKey: dateUtils.monthKey,
  });

  function hasValidAccessSession(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
  }

  function currentGoalPath(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return `grupos/${DEFAULT_GROUP}/usuarios/${tag}/metasEconomia/${dateUtils.monthKey()}`;
  }

  async function readCurrentGoal(session) {
    const snap = await get(ref(db, currentGoalPath(session)));

    return snap.val() || null;
  }

  async function readProfile(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);
    const snap = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${tag}/perfilFinanceiro`));

    return snap.val() || {};
  }

  async function createGoal(session, parsedGoal) {
    const existingGoal = await readCurrentGoal(session);
    const timestamp = now();
    const data = {
      valorMeta: parsedGoal.valorMeta,
      descricao: parsedGoal.descricao,
      ativo: true,
      createdAt: existingGoal?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    await update(ref(db, currentGoalPath(session)), data);

    return goalCreatedMessage(data);
  }

  async function viewGoal(session) {
    const goal = await readCurrentGoal(session);

    if (!goal || goal.ativo === false) {
      return noActiveGoalMessage();
    }

    const [expenses, profile] = await Promise.all([
      transactionStore.listMonthlyExpensesWithIds({ group: DEFAULT_GROUP, user: session.user }),
      readProfile(session),
    ]);
    const analysis = buildGoalAnalysis({ expenses, goal, profile });
    const fallbackTip = deterministicTip(analysis);
    const tip = await buildGoalTip({
      aiProviderRouter,
      fallbackTip,
      tipData: {
        valorMeta: analysis.valorMeta,
        totalGasto: analysis.totalGasto,
        rendaMensal: analysis.rendaMensal,
        economiaProjetada: analysis.economiaProjetada,
        diferencaMeta: analysis.diferencaMeta,
        maiorCategoria: analysis.topCategoryInfo,
      },
    });

    return goalProgressMessage({ analysis, goal, tip });
  }

  async function cancelGoal(session) {
    const goal = await readCurrentGoal(session);

    if (!goal || goal.ativo === false) {
      return noActiveGoalMessage();
    }

    await update(ref(db, currentGoalPath(session)), {
      ativo: false,
      updatedAt: now(),
    });

    return cancelGoalMessage(goal);
  }

  async function processarMetaEconomia(session, text) {
    const command = parseSavingsGoalCommand(text);

    if (!command) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return SAVINGS_GOAL_REQUIRED_MESSAGE;
    }

    if (command.error) {
      return command.error;
    }

    if (command.action === 'create') {
      return await createGoal(session, command.goal);
    }

    if (command.action === 'view') {
      return await viewGoal(session);
    }

    if (command.action === 'cancel') {
      return await cancelGoal(session);
    }

    return null;
  }

  return {
    processarMetaEconomia,
  };
}

module.exports = {
  SAVINGS_GOAL_REQUIRED_MESSAGE,
  buildGoalAnalysis,
  createSavingsGoalService,
  parseSavingsGoalCommand,
};
