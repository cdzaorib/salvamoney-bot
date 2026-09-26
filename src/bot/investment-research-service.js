'use strict';

const { compatibilityLine, isProhibitedRequest, selectOptions } = require('../research/investment-catalog');
const { vetResults } = require('../research/source-policy');
const { researchNotice } = require('./consent-service');
const { formatDateBr, formatMoney, normalizedCommand } = require('./finance-utils');
const { buildPlan } = require('./financial-planner');
const { frame } = require('./personality-service');
const { sessionTag } = require('./user-data');

const RESEARCH_FIELDS = ['idade', 'perfilRisco', 'objetivo', 'prazo', 'liquidez', 'reservaAtual', 'dividas'];
const DIVERGENCE_THRESHOLD = 0.25;
const INVEST_TERMS = /\b(invest\w*|aplicac\w*|aplicar|tesouro|cdb|lci|lca|fundos?|etfs?|acoes|acao|cripto\w*|bitcoin|renda fixa|renda variavel)\b/;

function isExplicitResearchRequest(text) {
  const command = normalizedCommand(text);

  return /\b(pesquis\w*|busque|buscar|procure|procurar|compare|comparar)\b/.test(command) && INVEST_TERMS.test(command);
}

function isInvestmentQuestion(text) {
  const command = normalizedCommand(text);

  return /^(onde|em que|no que|como)\s+(eu\s+)?(devo\s+|posso\s+|comecar a\s+)?investir\b/.test(command) ||
    /^(quais|qual)\s+(os\s+|o\s+)?(melhores?\s+)?investimentos?\b/.test(command);
}

function missingResearchField(profile) {
  const values = {
    dividas: profile?.dividasInformadas === true || Object.keys(profile?.dividas || {}).length > 0,
    idade: Boolean(profile?.idadeConfirmada),
    liquidez: Boolean(profile?.liquidezNecessaria),
    objetivo: Boolean(profile?.objetivoInvestimento),
    perfilRisco: Boolean(profile?.perfilRisco),
    prazo: Number(profile?.prazoMeses) > 0,
    reservaAtual: Number.isFinite(Number(profile?.reservaAtual)) && profile?.reservaAtual !== null && profile?.reservaAtual !== undefined,
  };

  return RESEARCH_FIELDS.find((field) => !values[field]) || null;
}

function educationMessage() {
  return [
    '📚 Educação financeira (conteúdo geral):',
    '• Guardar um pouco todo mês cria o hábito — constância vale mais que valor.',
    '• Juros compostos: o rendimento de hoje também rende amanhã.',
    '• Antes de investir: evitar dívidas caras e montar uma reserva.',
    '• Risco e retorno andam juntos; desconfie de promessas de ganho garantido.',
    'Para produtos específicos, é preciso ter 18 anos ou mais e o apoio de um responsável.',
  ].join('\n');
}

function prohibitedMessage() {
  return [
    'Não recomendo operações alavancadas nem derivativos (futuros, opções, day trade alavancado).',
    'Elas podem gerar perdas maiores que o valor investido.',
    'Se quiser, comparo alternativas compatíveis com seu perfil: pesquisar investimentos',
  ].join('\n');
}

// Agrupa fontes por organização e detecta divergência entre indicadores citados.
function analyzeSources(accepted) {
  const byOrg = new Map();

  accepted.forEach((source) => {
    if (!byOrg.has(source.organization)) {
      byOrg.set(source.organization, source);
    }
  });

  const sources = [...byOrg.values()].sort((a, b) => a.tier - b.tier).slice(0, 3);
  const withValues = sources.filter((source) => source.percentages.length);
  const unitCounts = withValues.reduce((counts, source) => {
    counts[source.percentages[0].unit] = (counts[source.percentages[0].unit] || 0) + 1;
    return counts;
  }, {});
  const unit = Object.entries(unitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  // Só compara valores na mesma unidade (ex.: % ao ano com % ao ano).
  const values = withValues
    .filter((source) => source.percentages[0].unit === unit)
    .map((source) => ({ org: source.organization, unit, value: source.percentages[0].value }));
  let indicator = null;
  let divergence = null;

  if (values.length >= 2) {
    const min = Math.min(...values.map((item) => item.value));
    const max = Math.max(...values.map((item) => item.value));

    if (max - min > DIVERGENCE_THRESHOLD) {
      divergence = values;
    } else {
      indicator = { confirmed: true, orgs: values.map((item) => item.org), unit, value: values[0].value };
    }
  } else if (values.length === 1) {
    indicator = { confirmed: false, orgs: [values[0].org], unit, value: values[0].value };
  }

  return {
    divergence,
    independent: sources.length >= 2,
    indicator,
    sources,
  };
}

function formatPercentValue(value, unit = 'simples') {
  const suffix = unit === 'aa' ? ' ao ano' : unit === 'cdi' ? ' do CDI' : '';

  return `${String(Math.round(value * 100) / 100).replace('.', ',')}%${suffix}`;
}

function optionBlock(product, index, profile, analysis) {
  const lines = [
    `${index + 1}) ${product.nome}`,
    `• Compatibilidade: ${compatibilityLine(product, profile)}`,
    `• Risco: ${product.risco}`,
    `• Liquidez: ${product.liquidez}`,
    `• Prazo mínimo sugerido: ${product.prazoMinMeses ? `${product.prazoMinMeses} meses` : 'nenhum'}`,
    `• Custos e impostos: ${product.custos}`,
  ];

  if (!analysis) {
    lines.push(`• Indicador aplicável: ${product.indicador} (sem valor atual — não houve verificação ao vivo)`);

    return lines.join('\n');
  }

  if (!analysis.sources.length) {
    lines.push(`• Indicador aplicável: ${product.indicador} (sem valor: a pesquisa desta opção não trouxe fontes confiáveis)`);
    lines.push('• ⚠️ Sem fontes verificadas para esta opção agora');

    return lines.join('\n');
  }

  if (analysis.divergence) {
    lines.push(`• ⚖️ Fontes divergem: ${analysis.divergence.map((item) => `${item.org} cita ${formatPercentValue(item.value, item.unit)}`).join('; ')}`);
  } else if (analysis.indicator?.confirmed) {
    lines.push(`• Indicador (${product.indicador}): ${formatPercentValue(analysis.indicator.value, analysis.indicator.unit)} — confirmado por ${analysis.indicator.orgs.join(' e ')}`);
  } else if (analysis.indicator) {
    lines.push(`• Indicador (${product.indicador}): ${formatPercentValue(analysis.indicator.value, analysis.indicator.unit)} citado só por ${analysis.indicator.orgs[0]} — não confirmado`);
  } else {
    lines.push(`• Indicador aplicável: ${product.indicador} (as fontes não trouxeram valor)`);
  }

  lines.push(analysis.independent
    ? `• ✔️ ${analysis.sources.length} fontes independentes`
    : '• ⚠️ Fonte única — sem confirmação independente');
  lines.push(...analysis.sources.map((source) => `  ↳ ${source.organization}${source.tier === 3 ? ' (veículo identificado)' : ''}: ${source.url}`));

  return lines.join('\n');
}

function createInvestmentResearchService({
  advisorService,
  braveClient,
  config,
  consentService,
  costTracker,
  dateUtils,
  logger = console,
  now = () => new Date(),
  personalityService,
  userData,
}) {
  const features = config?.features || {};
  const deadlineMs = Number(config?.ai?.researchDeadlineMs || 12000);
  const perQueryTimeout = Number(config?.brave?.timeoutMs || 5000);

  function withDeadline(promise, ms) {
    let timer;

    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  async function searchOption(product, deadline) {
    const remaining = deadline - now().getTime();

    if (remaining < 500) {
      return { error: 'deadline', product };
    }

    let reservation = null;

    // Reserva atômica do custo antes da busca.
    if (costTracker) {
      const budget = await costTracker.reserve('brave', { requests: 1 })
        .catch(() => ({ allowed: false, reason: 'controle_indisponivel' }));

      if (!budget.allowed) {
        return { error: budget.reason, product };
      }

      reservation = budget.reservation;
    }

    const startedAt = now().getTime();

    try {
      const timeout = Math.min(perQueryTimeout, remaining);
      const results = await withDeadline(braveClient.search(product.query, { timeoutMs: timeout }), timeout);
      const costBrl = reservation ? await costTracker.settle(reservation, { requests: 1 }).catch(() => 0) : 0;

      logger.info?.('[research]', { costBrl, durationMs: now().getTime() - startedAt, provider: 'brave', status: 'ok', task: 'investment_research' });

      return { product, results };
    } catch (err) {
      // Busca não enviada (sem chave) ou recusada pela API (4xx) devolve a reserva;
      // timeout e falha de rede mantêm a estimativa, pois a requisição pode ter sido cobrada.
      const billable = err?.code !== 'not_configured' && !/^http_4\d\d$/.test(String(err?.message || ''));
      const costBrl = reservation
        ? await costTracker.settle(reservation, billable ? { requests: 1 } : null).catch(() => 0)
        : 0;

      logger.info?.('[research]', { costBrl, durationMs: now().getTime() - startedAt, provider: 'brave', status: err?.code || 'error', task: 'investment_research' });

      return { error: err?.code || 'error', product };
    }
  }

  async function saveResearch(tag, record) {
    const id = `p${now().getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    await userData.updateChild(tag, `pesquisas/${id}`, record);
  }

  async function run(session, text = '') {
    const tag = sessionTag(session);
    const command = normalizedCommand(text);

    if (isProhibitedRequest(command)) {
      return prohibitedMessage();
    }

    const profile = await advisorService.getProfile(tag);

    if (profile.idadeConfirmada === 'menor') {
      return educationMessage();
    }

    const missing = missingResearchField(profile);

    if (missing) {
      return {
        message: advisorService.QUESTIONS[missing],
        pendingAction: { campo: missing, origem: 'research', tipo: 'advisor_question' },
      };
    }

    if (profile.idadeConfirmada === 'menor') {
      return educationMessage();
    }

    const plan = buildPlan(profile, { now: now() });
    const options = selectOptions(profile, plan);
    const personality = personalityService ? await personalityService.getPersonality(tag) : 'equilibrado';
    const header = [];

    if (plan.dividasCaras.length) {
      header.push(`⚠️ Prioridade antes de investir: quitar dívidas caras (${formatMoney(plan.dividasCarasTotal)}) e manter uma reserva mínima de ${formatMoney(plan.reservaMinima)}. As opções abaixo são para entender e planejar.`);
    } else if (plan.reservaFalta > 0) {
      header.push(`Prioridade: completar a reserva de emergência (faltam ${formatMoney(plan.reservaFalta)}). Por isso, só opções de baixo risco.`);
    }

    if (!options.length) {
      return 'Não encontrei opções compatíveis com esse perfil e prazo. Ajuste o prazo ou a liquidez e tente de novo.';
    }

    const researchAllowed = features.investmentResearch && braveClient?.isConfigured?.() &&
      await consentService.researchEnabled(tag);
    let analyses = null;
    let mode = 'sem_verificacao';
    const today = dateUtils.todayIso(now());

    if (features.investmentResearch && !(await consentService.researchEnabled(tag))) {
      return researchNotice();
    }

    if (researchAllowed) {
      const deadline = now().getTime() + deadlineMs;
      const settled = await Promise.all(options.map((product) => searchOption(product, deadline)));
      const successful = settled.filter((item) => !item.error);

      if (successful.length) {
        mode = 'ao_vivo';
        analyses = new Map(settled.map((item) => [
          item.product.id,
          item.error ? null : analyzeSources(vetResults(item.results).accepted),
        ]));
      }
    }

    const lines = [...header];

    if (mode === 'sem_verificacao') {
      lines.push('⚠️ *SEM VERIFICAÇÃO AO VIVO* — a pesquisa externa não pôde ser feita agora.',
        'Abaixo, só características gerais: sem preços, taxas ou rankings atuais.');
    } else {
      lines.push(`Pesquisa feita em ${formatDateBr(today)} com fontes públicas (oficiais primeiro).`);
    }

    options.forEach((product, index) => {
      const analysis = analyses ? analyses.get(product.id) : null;

      lines.push('', optionBlock(product, index, profile, mode === 'ao_vivo' ? (analysis || { divergence: null, independent: false, indicator: null, sources: [] }) : null));
    });

    lines.push('', 'Nenhuma opção é a melhor para todo mundo e não há garantia de retorno. Rentabilidade passada não garante a futura.',
      'Conteúdo informativo — não é recomendação individual de investimento.');

    const urls = mode === 'ao_vivo'
      ? [...new Set([...analyses.values()].filter(Boolean).flatMap((analysis) => analysis.sources.map((source) => source.url)))]
      : [];

    await saveResearch(tag, {
      consultas: options.map((product) => product.query),
      data: today,
      modo: mode,
      opcoes: options.map((product) => product.id),
      urls,
    }).catch(() => logger.warn?.('[research] não foi possível salvar metadados da pesquisa.'));

    return frame(personality, 'research', lines.join('\n'));
  }

  async function process(session, text) {
    const command = normalizedCommand(text);

    if (isProhibitedRequest(command)) {
      return prohibitedMessage();
    }

    if (isExplicitResearchRequest(text) || /^(pesquisar|pesquisa)$/.test(command)) {
      return await run(session, text);
    }

    if (isInvestmentQuestion(text)) {
      return [
        'Posso comparar até 3 opções compatíveis com seu perfil, com fontes oficiais.',
        'Pesquiso só quando você pedir. Para começar, envie: pesquisar investimentos',
      ].join('\n');
    }

    return null;
  }

  return {
    process,
    run,
  };
}

module.exports = {
  RESEARCH_FIELDS,
  analyzeSources,
  createInvestmentResearchService,
  isExplicitResearchRequest,
  missingResearchField,
};
