'use strict';

const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const FINANCIAL_ADVISOR_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const AI_TIMEOUT_MS = 8000;

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function previousMonthDate(dateUtils, date = new Date()) {
  const parts = dateUtils.dateParts(date);

  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 2, 15, 12));
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
    .map(([categoria, totalCategory]) => ({
      categoria,
      percentualDoMes: total > 0 ? Math.round((totalCategory / total) * 100) : 0,
      total: roundMoney(totalCategory),
    }))
    .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria));

  return {
    byCategory,
    categories,
    count: expenses.length,
    topCategory: categories[0] || null,
    total: roundMoney(total),
  };
}

function percentChange(currentTotal, previousTotal) {
  if (!previousTotal || previousTotal <= 0) {
    return null;
  }

  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
}

function normalizeExpenseForAi(expense) {
  return {
    categoria: categoryName(expense),
    data: expense?.date || null,
    descricao: String(expense?.desc || 'Gasto').slice(0, 80),
    valor: roundMoney(expense?.value),
  };
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

function isActionCommand(command) {
  return /^(gastei|gasto|paguei|comprei|almocei|jantei|lancei|registrar|registre)\b/.test(command) ||
    /^(apagar|excluir|remover)\b/.test(command) ||
    /^(cobrar|aceitar|recusar|cancelar|paguei cobranca|recebi cobranca)\b/.test(command) ||
    /^cobrancas?\b/.test(command) ||
    /^(me avise|alerta|criar alerta|limite|listar alertas|meus alertas)\b/.test(command) ||
    /\b(gasto fixo|fixo)\b/.test(command) ||
    /^(entrar|criar conta|cadastro|sair da conta|minha tag|qual .*tag|buscar tag|procurar tag|encontrar tag)\b/.test(command) ||
    /^(recebo|ganho|meu salario|salario|meu cartao|cartao vence|definir orcamento|meu orcamento|meu perfil financeiro|ver perfil financeiro)\b/.test(command) ||
    /^quanto\s+(eu\s+)?gastei\b/.test(command) ||
    /^gastos?\s+(com|de|do|da)\b/.test(command) ||
    /^total\s+(de|do|da)\b/.test(command) ||
    /\b(parcelei|parcelar|em\s+\d+\s*x)\b/.test(command);
}

function isFinancialAdvisorCommand(value) {
  const command = normalizedCommand(value);

  if (!command || isActionCommand(command)) {
    return false;
  }

  return /\bonde\s+posso\s+economizar\b/.test(command) ||
    /\bestou\s+gastando\s+muito\b/.test(command) ||
    /\bo\s+que\s+mais\s+pesou\b/.test(command) ||
    /\bme\s+ajude\s+a\s+economizar\b/.test(command) ||
    /\bme\s+de\s+uma\s+analise\s+financeira\b/.test(command) ||
    /\banalis[ea]\s+(meus\s+)?gastos\b/.test(command) ||
    /\bcomo\s+estou\s+financeiramente\b/.test(command) ||
    /\bcomo\s+posso\s+melhorar\s+(meus\s+)?gastos\b/.test(command) ||
    /\b(posso|vale\s+a\s+pena)\s+(comprar|gastar)\b/.test(command);
}

function buildFinancialAdvisorData({
  activeAlerts,
  currentExpenses,
  fixedExpenses,
  previousExpenses,
  profile,
  question,
}) {
  const currentSummary = summarizeExpenses(currentExpenses);
  const previousSummary = summarizeExpenses(previousExpenses);
  const rendaMensal = validPositiveNumber(profile?.rendaMensal);
  const orcamentoMensal = validPositiveNumber(profile?.orcamentoMensal);
  const vencimentoCartao = Number(profile?.vencimentoCartao);
  const gastosFixosTotal = fixedExpenses.reduce((total, item) => total + Number(item.value || 0), 0);
  const maioresGastos = [...currentExpenses]
    .filter((expense) => Number.isFinite(Number(expense?.value)))
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, 5)
    .map(normalizeExpenseForAi);

  return {
    totalMesAtual: currentSummary.total,
    totalMesAnterior: previousSummary.count ? previousSummary.total : null,
    variacaoPercentual: previousSummary.count
      ? percentChange(currentSummary.total, previousSummary.total)
      : null,
    categoriasMesAtual: currentSummary.categories,
    categoriasMesAnterior: previousSummary.categories,
    maioresGastos,
    gastosFixosTotal: roundMoney(gastosFixosTotal),
    rendaMensal,
    orcamentoMensal,
    percentualRendaUsado: rendaMensal
      ? Math.round((currentSummary.total / rendaMensal) * 100)
      : null,
    percentualOrcamentoUsado: orcamentoMensal
      ? Math.round((currentSummary.total / orcamentoMensal) * 100)
      : null,
    vencimentoCartao: Number.isInteger(vencimentoCartao) && vencimentoCartao >= 1 && vencimentoCartao <= 31
      ? vencimentoCartao
      : null,
    quantidadeRegistros: currentSummary.count,
    alertasAtivos: normalizeActiveAlerts(activeAlerts),
    perguntaUsuario: String(question || '').trim(),
  };
}

function buildAdvisorPrompt(advisorData) {
  return [
    {
      role: 'system',
      content: [
        'Você é uma camada segura de análise financeira do SalvaMoney.',
        'Responda em português brasileiro, de forma direta, prática e amigável.',
        'Use somente os números recebidos nos dados calculados.',
        'Não invente valores, categorias, percentuais ou datas.',
        'Se faltarem dados, diga que a análise é limitada.',
        'Dê no máximo 3 recomendações práticas.',
        'Não recomende investimentos específicos.',
        'Não dê aconselhamento financeiro profissional.',
        'Não mande comprar ou vender ativos.',
        'Não prometa resultado.',
        'Não diga que acessa banco, JSON ou dados estruturados.',
        'Não execute nem prometa executar alterações.',
        'Não use tom alarmista.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Dados calculados para orientar a resposta:\n${JSON.stringify(advisorData, null, 2)}`,
    },
  ];
}

function usageLine(data) {
  const parts = [];

  if (data.percentualRendaUsado !== null) {
    parts.push(`${data.percentualRendaUsado}% da sua renda mensal`);
  }

  if (data.percentualOrcamentoUsado !== null) {
    parts.push(`${data.percentualOrcamentoUsado}% do seu orçamento`);
  }

  return parts.length ? `Você já usou ${parts.join(' e ')}.` : '';
}

function comparisonLine(data) {
  if (data.totalMesAnterior === null || data.variacaoPercentual === null) {
    return 'Ainda não tenho histórico suficiente para comparar com o mês passado.';
  }

  if (data.variacaoPercentual === 0) {
    return 'Seus gastos estão praticamente iguais aos do mês passado.';
  }

  return data.variacaoPercentual > 0
    ? `Seus gastos estão ${Math.abs(data.variacaoPercentual)}% acima do mês passado.`
    : `Seus gastos estão ${Math.abs(data.variacaoPercentual)}% abaixo do mês passado.`;
}

function buildDeterministicAdvice(data) {
  if (!data.quantidadeRegistros) {
    return [
      'Ainda não consegui gerar uma análise avançada agora, mas pelo seu resumo atual você ainda não tem gastos registrados neste mês.',
      'Registre alguns gastos para eu te orientar melhor.',
    ].join('\n');
  }

  const topCategory = data.categoriasMesAtual[0];
  const lines = [
    'Ainda não consegui gerar uma análise avançada agora, mas pelo seu resumo atual:',
    `Total do mês: ${formatMoney(data.totalMesAtual)}`,
    `Registros: ${data.quantidadeRegistros}`,
  ];

  if (topCategory) {
    lines.push(`Maior categoria: ${topCategory.categoria} - ${formatMoney(topCategory.total)} (${topCategory.percentualDoMes}% do mês).`);
  }

  const usage = usageLine(data);

  if (usage) {
    lines.push(usage);
  }

  lines.push(comparisonLine(data));

  if (data.vencimentoCartao) {
    lines.push(`Seu cartão vence dia ${data.vencimentoCartao}.`);
  }

  lines.push('');
  lines.push(topCategory
    ? `Sugestão: acompanhe ${topCategory.categoria} de perto e defina um teto simples até o fim do mês.`
    : 'Sugestão: registre os gastos por categoria para a análise ficar mais precisa.');

  return lines.join('\n');
}

async function withTimeout(promise, timeoutMs = AI_TIMEOUT_MS) {
  let timeout;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function buildAiAdvice({ config, deterministicMessage, groq, advisorData }) {
  if (!config?.groqApiKey || !groq?.chamarIA) {
    return deterministicMessage;
  }

  try {
    const response = await withTimeout(groq.chamarIA(buildAdvisorPrompt(advisorData)));
    const cleanResponse = String(response || '').trim();

    return cleanResponse || deterministicMessage;
  } catch (_) {
    return deterministicMessage;
  }
}

function createFinancialAdvisorService({
  config,
  dateUtils,
  db,
  firebaseOps,
  groq,
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

  async function processarAdvisorFinanceiro(session, text) {
    if (!isFinancialAdvisorCommand(text)) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return FINANCIAL_ADVISOR_REQUIRED_MESSAGE;
    }

    const previousDate = previousMonthDate(dateUtils);
    const [currentExpenses, previousExpenses, fixedExpenses, profile, activeAlerts] = await Promise.all([
      transactionStore.listMonthlyExpensesWithIds({ group: DEFAULT_GROUP, user: session.user }),
      transactionStore.listMonthlyExpensesWithIds({ date: previousDate, group: DEFAULT_GROUP, user: session.user }),
      transactionStore.listFixedExpensesWithIds({ group: DEFAULT_GROUP, user: session.user }),
      readUserChild(session, 'perfilFinanceiro'),
      readUserChild(session, 'alertas'),
    ]);
    const advisorData = buildFinancialAdvisorData({
      activeAlerts,
      currentExpenses,
      fixedExpenses,
      previousExpenses,
      profile,
      question: text,
    });
    const deterministicMessage = buildDeterministicAdvice(advisorData);

    return await buildAiAdvice({
      config,
      deterministicMessage,
      groq,
      advisorData,
    });
  }

  return {
    processarAdvisorFinanceiro,
  };
}

module.exports = {
  FINANCIAL_ADVISOR_REQUIRED_MESSAGE,
  buildAdvisorPrompt,
  buildDeterministicAdvice,
  buildFinancialAdvisorData,
  createFinancialAdvisorService,
  isFinancialAdvisorCommand,
};
