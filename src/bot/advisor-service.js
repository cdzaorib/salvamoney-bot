'use strict';

const { MONEY_TEXT, formatMoney, normalizedCommand, parsePositiveMoney } = require('./finance-utils');
const { buildPlan, incomeInfo, missingForPlan, planMessage, reserveMonths } = require('./financial-planner');
const { frame } = require('./personality-service');
const { sessionTag } = require('./user-data');

const MONEY = new RegExp(MONEY_TEXT, 'i');
const RISK_PROFILES = {
  agressivo: 'arrojado',
  arrojado: 'arrojado',
  conservador: 'conservador',
  moderado: 'moderado',
};
const DEBT_TYPES = [
  { pattern: /\b(cartao|rotativo|fatura)\b/, tipo: 'cartao' },
  { pattern: /\bcheque especial\b/, tipo: 'cheque especial' },
  { pattern: /\b(emprestimo|consignado)\b/, tipo: 'emprestimo' },
  { pattern: /\b(financiamento|carro|imovel|casa)\b/, tipo: 'financiamento' },
];
const GOAL_TYPES = ['viagem', 'carro', 'casa', 'imovel', 'estudos', 'faculdade', 'aposentadoria', 'casamento', 'reforma', 'emergencia', 'intercambio'];

const QUESTIONS = {
  despesasEssenciais: 'Quanto você gasta por mês com o essencial (moradia, contas, mercado, transporte, saúde)? Ex.: 2200',
  dividas: 'Você tem dívidas? Responda "não tenho dívidas" ou, por exemplo: "dívida cartão 2000 juros 12% ao mês".',
  idade: 'Para falar de produtos específicos preciso confirmar: você tem 18 anos ou mais? (sim / não)',
  liquidez: 'Você pode precisar desse dinheiro a qualquer momento? Responda: liquidez alta, média ou baixa.',
  objetivo: 'Qual o objetivo desse dinheiro? Ex.: reserva de emergência, viagem, aposentadoria, comprar carro.',
  perfilRisco: 'Qual seu perfil de risco? conservador, moderado ou arrojado.',
  prazo: 'Por quanto tempo pretende deixar o dinheiro aplicado? Ex.: 6 meses, 2 anos, 10 anos.',
  renda: 'Qual sua renda mensal? Se for variável, diga a média e o mínimo. Ex.: "renda variável média 4000 mínimo 2500" ou só "3000".',
  reservaAtual: 'Quanto você já tem guardado como reserva de emergência? Ex.: 5000 ou "não tenho reserva".',
};

function money(text) {
  const match = String(text || '').match(MONEY);

  return match ? parsePositiveMoney(match[0]) : null;
}

function monthsFrom(command) {
  const match = command.match(/(\d{1,3})\s*(anos?|meses|mes)\b/);

  if (!match) {
    if (/\b(curto prazo)\b/.test(command)) {
      return 12;
    }

    if (/\b(medio prazo)\b/.test(command)) {
      return 36;
    }

    if (/\b(longo prazo)\b/.test(command)) {
      return 84;
    }

    return null;
  }

  const value = Number(match[1]);

  return /^ano/.test(match[2]) ? value * 12 : value;
}

function liquidityFrom(command) {
  if (/\bliquidez\s+(alta|diaria)\b|\bqualquer momento\b|\bsacar a qualquer\b/.test(command)) {
    return 'alta';
  }

  if (/\bliquidez\s+media\b/.test(command)) {
    return 'media';
  }

  if (/\bliquidez\s+baixa\b|\bdeixar (o dinheiro )?parado\b|\bnao vou precisar\b/.test(command)) {
    return 'baixa';
  }

  return null;
}

function goalTypeFrom(command) {
  if (/\breserva de emergencia\b|\bemergencia\b/.test(command)) {
    return 'reserva de emergência';
  }

  return GOAL_TYPES.find((type) => new RegExp(`\\b${type}\\b`).test(command)) || null;
}

// Interpreta frases de perfil. Retorna { fields, dividas, message } ou null.
function parseProfileUpdate(text) {
  const command = normalizedCommand(text);
  let match;

  if (/^(minha\s+)?renda\s+(e\s+)?variavel\b|^(minha renda e|ganho)\s+variavel\b|^renda variavel\b/.test(command) ||
    /^ganho\s+entre\b/.test(command)) {
    const range = command.match(new RegExp(`entre\\s+(${MONEY_TEXT})\\s+e\\s+(${MONEY_TEXT})`, 'i'));
    const average = command.match(new RegExp(`media\\s+(?:de\\s+)?(${MONEY_TEXT})`, 'i'));
    const minimum = command.match(new RegExp(`(?:minimo|minima|pelo menos)\\s+(?:de\\s+)?(${MONEY_TEXT})`, 'i'));
    const fields = { tipoRenda: 'variavel' };

    if (range) {
      fields.rendaMinima = parsePositiveMoney(range[1]);
      fields.rendaMedia = Math.round(((parsePositiveMoney(range[1]) + parsePositiveMoney(range[2])) / 2) * 100) / 100;
    }

    if (average) {
      fields.rendaMedia = parsePositiveMoney(average[1]);
    }

    if (minimum) {
      fields.rendaMinima = parsePositiveMoney(minimum[1]);
    }

    return { fields };
  }

  if (/^(minha\s+)?renda\s+(e\s+)?fixa\b/.test(command)) {
    const value = money(command);

    return { fields: { tipoRenda: 'fixa', ...(value ? { rendaMensal: value } : {}) } };
  }

  if (/^(minhas\s+|meus\s+)?(despesas|gastos|custos)\s+essenciais\b|^(gasto|despesa)\s+essencial\b/.test(command)) {
    const value = money(command);

    return value
      ? { fields: { despesasEssenciais: value } }
      : { message: QUESTIONS.despesasEssenciais };
  }

  if (/^(nao tenho|zero de)\s+reserva\b|^sem reserva$/.test(command)) {
    return { fields: { reservaAtual: 0 } };
  }

  match = command.match(/^(?:quero\s+)?(?:uma\s+)?reserva\s+(?:de\s+)?(\d{1,2})\s+meses$/);

  if (match) {
    const months = Number(match[1]);

    return months >= 3 && months <= 12
      ? { fields: { reservaMeses: months } }
      : { message: 'A reserva pode ser ajustada entre 3 e 12 meses de despesas essenciais.' };
  }

  if (/^(tenho|minha)\s+reserva\b|^reserva atual\b|^tenho\s+.*\bguardad[oa]s?\b/.test(command)) {
    const value = money(command);

    if (value !== null) {
      return { fields: { reservaAtual: value } };
    }
  }

  if (/^nao tenho dependentes$|^sem dependentes$/.test(command)) {
    return { fields: { dependentes: 0 } };
  }

  match = command.match(/^tenho\s+(\d{1,2})\s+(dependentes?|filhos?|filhas?)$/);

  if (match) {
    return { fields: { dependentes: Number(match[1]) }, importantChange: true };
  }

  if (/^(nao tenho|nao possuo|sem)\s+dividas?$/.test(command)) {
    return { fields: { dividasInformadas: true } };
  }

  match = command.match(/^quitei\s+(?:a\s+)?divida\s+(?:do\s+|da\s+|de\s+)?(.+)$/);

  if (match) {
    const type = DEBT_TYPES.find(({ pattern }) => pattern.test(match[1]))?.tipo || match[1].trim();

    return { payOffDebt: type };
  }

  if (/^(tenho\s+(uma\s+)?)?divida\b/.test(command)) {
    const balance = money(command.replace(/\d{1,3}(?:[,.]\d{1,2})?\s*%/g, ' '));
    const rate = command.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*%\s*(ao ano|a\.?a\.?|anual)?/);
    const installment = command.match(new RegExp(`parcela\\s+(?:de\\s+)?(${MONEY_TEXT})`, 'i'));
    const tipo = DEBT_TYPES.find(({ pattern }) => pattern.test(command))?.tipo || 'outra';

    if (!balance) {
      return { message: 'Informe o saldo da dívida. Ex.: dívida cartão 2000 juros 12% ao mês' };
    }

    let monthlyRate = rate ? Number(rate[1].replace(',', '.')) : null;

    if (monthlyRate !== null && rate[2]) {
      monthlyRate = Math.round(((1 + monthlyRate / 100) ** (1 / 12) - 1) * 10000) / 100;
    }

    return {
      divida: {
        jurosMensal: monthlyRate,
        parcela: installment ? parsePositiveMoney(installment[1]) : null,
        saldo: balance,
        tipo,
      },
    };
  }

  match = command.match(/^(?:meu\s+)?perfil\s+(?:de\s+risco\s+|de\s+investidor\s+)?(?:e\s+)?(conservador|moderado|arrojado|agressivo)$/) ||
    command.match(/^sou\s+(?:investidor\s+)?(conservador|moderado|arrojado|agressivo)$/);

  if (match) {
    return { fields: { perfilRisco: RISK_PROFILES[match[1]] }, investorReview: true };
  }

  match = command.match(/^tenho\s+(\d{1,3})\s+anos$/);

  if (match) {
    return { fields: { idadeConfirmada: Number(match[1]) >= 18 ? 'maior' : 'menor' } };
  }

  if (/^sou\s+maior\s+de\s+idade$|^tenho\s+mais\s+de\s+18(\s+anos)?$/.test(command)) {
    return { fields: { idadeConfirmada: 'maior' } };
  }

  if (/^sou\s+menor\s+de\s+idade$|^tenho\s+menos\s+de\s+18(\s+anos)?$/.test(command)) {
    return { fields: { idadeConfirmada: 'menor' } };
  }

  match = command.match(/^(?:meu\s+)?objetivo\s+(?:e\s+)?(.+)$/);

  if (match) {
    const tipo = goalTypeFrom(match[1]);
    const value = money(match[1].replace(/(\d{1,3})\s*(anos?|meses|mes)\b/g, ' '));
    const months = monthsFrom(match[1]);

    return {
      fields: {
        objetivoInvestimento: tipo || 'outro',
        ...(months ? { prazoMeses: months } : {}),
      },
      objetivo: value && months ? { prazoMeses: months, tipo: tipo || 'outro', valor: value } : null,
    };
  }

  match = command.match(/^(?:minha\s+)?prioridade\s*(?:e|:)?\s+(.+)$/);

  if (match) {
    return { prioridade: match[1].slice(0, 60) };
  }

  const liquidity = liquidityFrom(command);

  if (liquidity && /^(liquidez|preciso|posso|nao vou)/.test(command)) {
    return { fields: { liquidezNecessaria: liquidity } };
  }

  match = command.match(/^prazo\s+(?:de\s+)?(.+)$/);

  if (match && monthsFrom(match[1])) {
    return { fields: { prazoMeses: monthsFrom(match[1]) } };
  }

  return null;
}

// Interpreta a resposta curta a uma pergunta do onboarding.
function parseAnswer(field, text) {
  const command = normalizedCommand(text);

  if (field === 'renda') {
    const profile = parseProfileUpdate(text);

    if (profile?.fields?.tipoRenda) {
      return profile.fields;
    }

    const value = money(command);

    return value ? { rendaMensal: value, tipoRenda: 'fixa' } : null;
  }

  if (field === 'despesasEssenciais') {
    const value = money(command);

    return value ? { despesasEssenciais: value } : null;
  }

  if (field === 'reservaAtual') {
    if (/\b(nao tenho|nada|zero|nenhuma?)\b/.test(command)) {
      return { reservaAtual: 0 };
    }

    const value = money(command);

    return value !== null ? { reservaAtual: value } : null;
  }

  if (field === 'dividas') {
    if (/^(nao|nao tenho|nenhuma|nao tenho dividas?|zero)$/.test(command)) {
      return { dividasInformadas: true };
    }

    const parsed = parseProfileUpdate(/divida/.test(command) ? text : `dívida ${text}`);

    return parsed?.divida ? { divida: parsed.divida } : null;
  }

  if (field === 'idade') {
    if (/^(sim|s|tenho|sou maior|maior)/.test(command) || /mais de 18/.test(command)) {
      return { idadeConfirmada: 'maior' };
    }

    if (/^(nao|n|sou menor|menor)/.test(command) || /menos de 18/.test(command)) {
      return { idadeConfirmada: 'menor' };
    }

    const age = command.match(/(\d{1,3})/);

    return age ? { idadeConfirmada: Number(age[1]) >= 18 ? 'maior' : 'menor' } : null;
  }

  if (field === 'perfilRisco') {
    const match = command.match(/\b(conservador|moderado|arrojado|agressivo)\b/);

    return match ? { perfilRisco: RISK_PROFILES[match[1]] } : null;
  }

  if (field === 'objetivo') {
    const tipo = goalTypeFrom(command);

    return tipo || command.length >= 3 ? { objetivoInvestimento: tipo || 'outro' } : null;
  }

  if (field === 'prazo') {
    const months = monthsFrom(command);

    return months ? { prazoMeses: months } : null;
  }

  if (field === 'liquidez') {
    const liquidity = liquidityFrom(command.startsWith('liquidez') ? command : `liquidez ${command}`) ||
      (/^(sim|preciso)/.test(command) ? 'alta' : /^(nao|n)$/.test(command) ? 'baixa' : null);

    return liquidity ? { liquidezNecessaria: liquidity } : null;
  }

  return null;
}

function isPlanCommand(text) {
  return /^(orientacao financeira|me orienta|me oriente|plano financeiro|meu plano financeiro|meu plano|consultoria|consultoria financeira|como organizar meu dinheiro|como devo organizar (meu dinheiro|minhas financas)|organizar minhas financas|por onde comeco|o que faco com meu dinheiro|me ajuda a organizar meu dinheiro)$/.test(normalizedCommand(text));
}

function isProfileViewCommand(text) {
  return /^(meu perfil financeiro|ver perfil financeiro|perfil financeiro completo|meu perfil de investidor)$/.test(normalizedCommand(text));
}

function isReviewCommand(text) {
  return /^(revisar|atualizar)\s+(meu\s+)?perfil\s+de\s+investidor$/.test(normalizedCommand(text));
}

function profileView(profile) {
  const income = incomeInfo(profile);
  const debts = Object.values(profile?.dividas || {}).filter((debt) => debt && !debt.quitada);

  return [
    'Seu perfil financeiro:',
    `Renda: ${income.variavel ? `variável — média ${formatMoney(income.media || 0)}, base conservadora ${formatMoney(income.conservadora || 0)}` : formatMoney(income.conservadora || 0)}`,
    `Essenciais: ${profile?.despesasEssenciais ? formatMoney(profile.despesasEssenciais) : '-'} · Orçamento: ${profile?.orcamentoMensal ? formatMoney(profile.orcamentoMensal) : '-'}`,
    `Reserva: ${profile?.reservaAtual !== undefined ? formatMoney(profile.reservaAtual) : '-'} (meta de ${reserveMonths(profile)} meses)`,
    `Dívidas: ${debts.length ? debts.map((debt) => `${debt.tipo} ${formatMoney(debt.saldo)}`).join(', ') : profile?.dividasInformadas ? 'nenhuma' : '-'}`,
    `Dependentes: ${profile?.dependentes ?? '-'} · Perfil de risco: ${profile?.perfilRisco || '-'}`,
    `Objetivo: ${profile?.objetivoInvestimento || '-'} · Prazo: ${profile?.prazoMeses ? `${profile.prazoMeses} meses` : '-'} · Liquidez: ${profile?.liquidezNecessaria || '-'}`,
    `Prioridades: ${(profile?.prioridades || []).join(', ') || '-'}`,
  ].join('\n');
}

function createAdvisorService({
  now = () => new Date(),
  personalityService,
  userData,
}) {
  async function getProfile(tag) {
    return (await userData.readChild(tag, 'perfilFinanceiro')) || {};
  }

  async function saveFields(tag, fields) {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));

    if (Object.keys(clean).length) {
      await userData.updateChild(tag, 'perfilFinanceiro', { ...clean, updatedAt: now().toISOString() });
    }
  }

  async function applyUpdate(tag, update) {
    const profile = await getProfile(tag);
    const fields = { ...(update.fields || {}) };

    if (update.investorReview) {
      fields.perfilInvestidorAtualizadoEm = now().toISOString();
      fields.revisaoPendente = false;
    }

    if (update.importantChange || (fields.rendaMensal && profile.rendaMensal &&
      Math.abs(fields.rendaMensal - profile.rendaMensal) / profile.rendaMensal > 0.2)) {
      fields.revisaoPendente = true;
    }

    if (update.divida) {
      // Id determinístico: repetir a mesma mensagem não duplica a dívida.
      const id = `d_${String(update.divida.tipo).replace(/\W+/g, '_')}_${Math.round(update.divida.saldo * 100)}`;

      await userData.updateChild(tag, `perfilFinanceiro/dividas/${id}`, update.divida);
      fields.dividasInformadas = true;
    }

    if (update.objetivo) {
      await userData.updateChild(
        tag,
        `perfilFinanceiro/objetivos/o_${String(update.objetivo.tipo).replace(/\W+/g, '_')}_${Math.round(update.objetivo.valor * 100)}_${update.objetivo.prazoMeses}`,
        update.objetivo
      );
    }

    if (update.prioridade) {
      fields.prioridades = [...new Set([...(profile.prioridades || []), update.prioridade])].slice(-5);
    }

    if (update.payOffDebt) {
      const match = Object.entries(profile.dividas || {}).find(([, debt]) => debt && !debt.quitada && debt.tipo === update.payOffDebt);

      if (!match) {
        return `Não encontrei dívida "${update.payOffDebt}" em aberto. Veja: meu perfil financeiro`;
      }

      await userData.updateChild(tag, `perfilFinanceiro/dividas/${match[0]}`, { quitada: true, quitadaEm: now().toISOString() });
    }

    await saveFields(tag, fields);

    return null;
  }

  function confirmation(update) {
    if (update.divida) {
      return `Dívida registrada ✅ ${update.divida.tipo} — ${formatMoney(update.divida.saldo)}${update.divida.jurosMensal !== null ? ` · ${String(update.divida.jurosMensal).replace('.', ',')}% ao mês` : ''}`;
    }

    if (update.payOffDebt) {
      return 'Dívida marcada como quitada ✅ Parabéns pelo passo!';
    }

    if (update.prioridade) {
      return `Prioridade registrada ✅ ${update.prioridade}`;
    }

    return 'Perfil atualizado ✅ Para ver o plano: orientação financeira';
  }

  // Monta o plano ou pergunta apenas o próximo dado necessário.
  async function planOrAsk(session) {
    const tag = sessionTag(session);
    const profile = await getProfile(tag);
    const missing = missingForPlan(profile);

    if (missing) {
      return {
        message: QUESTIONS[missing],
        pendingAction: { campo: missing, origem: 'plan', tipo: 'advisor_question' },
      };
    }

    const personality = personalityService ? await personalityService.getPersonality(tag) : 'equilibrado';

    return frame(personality, 'advice', planMessage(buildPlan(profile, { now: now() })), { closing: true });
  }

  async function answer(session, pending, text) {
    const tag = sessionTag(session);

    if (['cancelar', 'cancela', 'depois', 'agora nao'].includes(normalizedCommand(text))) {
      return { clearPending: true, message: 'Tudo bem, seguimos depois.' };
    }

    const parsed = parseAnswer(pending.campo, text);

    if (!parsed) {
      return null;
    }

    const { divida, ...fields } = parsed;

    await applyUpdate(tag, { divida, fields });

    return { answered: true, clearPending: true };
  }

  async function process(session, text) {
    const tag = sessionTag(session);

    if (isPlanCommand(text)) {
      return await planOrAsk(session);
    }

    if (isProfileViewCommand(text)) {
      return profileView(await getProfile(tag));
    }

    if (isReviewCommand(text)) {
      await saveFields(tag, { revisaoPendente: true });

      return {
        message: QUESTIONS.perfilRisco,
        pendingAction: { campo: 'perfilRisco', origem: 'review', tipo: 'advisor_question' },
      };
    }

    const update = parseProfileUpdate(text);

    if (!update) {
      return null;
    }

    if (update.message) {
      return update.message;
    }

    const error = await applyUpdate(tag, update);

    return error || confirmation(update);
  }

  return {
    QUESTIONS,
    answer,
    getProfile,
    planOrAsk,
    process,
    saveFields,
  };
}

module.exports = {
  QUESTIONS,
  createAdvisorService,
  isPlanCommand,
  parseAnswer,
  parseProfileUpdate,
};
