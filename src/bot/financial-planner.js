'use strict';

const { formatMoney, formatPercent, roundMoney } = require('./finance-utils');

const EXPENSIVE_DEBT_MONTHLY_RATE = 2;
const ALWAYS_EXPENSIVE_DEBTS = new Set(['cartao', 'rotativo', 'cheque especial', 'cheque_especial']);
const DEFAULT_RESERVE_MONTHS = 6;
const VARIABLE_INCOME_SAFETY = 0.8;
const PROFILE_REVIEW_MS = 182 * 24 * 60 * 60 * 1000;

function positive(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegative(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : null;
}

function reserveMonths(profile) {
  const months = Number(profile?.reservaMeses);

  return Number.isInteger(months) && months >= 3 && months <= 12 ? months : DEFAULT_RESERVE_MONTHS;
}

// Renda variável usa a faixa conservadora (mínimo informado ou 80% da média).
function incomeInfo(profile) {
  const variable = profile?.tipoRenda === 'variavel';
  const fixed = positive(profile?.rendaMensal);
  const average = positive(profile?.rendaMedia);
  const minimum = positive(profile?.rendaMinima);

  if (variable) {
    const base = average || fixed;

    return {
      conservadora: minimum || (base ? roundMoney(base * VARIABLE_INCOME_SAFETY) : null),
      estimada: !minimum && Boolean(base),
      media: base,
      variavel: true,
    };
  }

  return {
    conservadora: fixed || average,
    estimada: false,
    media: fixed || average,
    variavel: false,
  };
}

function normalizeDebts(profile) {
  return Object.entries(profile?.dividas || {})
    .filter(([, debt]) => debt && positive(debt.saldo) && debt.quitada !== true)
    .map(([id, debt]) => {
      const rate = nonNegative(debt.jurosMensal);
      const type = String(debt.tipo || 'outra');

      return {
        cara: ALWAYS_EXPENSIVE_DEBTS.has(type) || (rate !== null && rate >= EXPENSIVE_DEBT_MONTHLY_RATE),
        id,
        jurosMensal: rate,
        parcela: positive(debt.parcela) || 0,
        saldo: positive(debt.saldo),
        tipo: type,
      };
    })
    .sort((a, b) => Number(b.cara) - Number(a.cara) || (b.jurosMensal || 0) - (a.jurosMensal || 0));
}

function shortTermGoals(profile) {
  return Object.values(profile?.objetivos || {})
    .filter((goal) => goal && positive(goal.valor) && Number(goal.prazoMeses) > 0 && Number(goal.prazoMeses) <= 24)
    .map((goal) => ({
      mensal: roundMoney(Number(goal.valor) / Number(goal.prazoMeses)),
      prazoMeses: Number(goal.prazoMeses),
      tipo: goal.tipo || 'objetivo',
      valor: Number(goal.valor),
    }));
}

// Campo que falta para montar o plano, na ordem de necessidade.
function missingForPlan(profile) {
  const income = incomeInfo(profile);

  if (!income.conservadora) {
    return 'renda';
  }

  if (positive(profile?.despesasEssenciais) === null) {
    return 'despesasEssenciais';
  }

  if (profile?.dividasInformadas !== true && !Object.keys(profile?.dividas || {}).length) {
    return 'dividas';
  }

  if (nonNegative(profile?.reservaAtual) === null) {
    return 'reservaAtual';
  }

  return null;
}

// Distribuição determinística da sobra mensal conforme a situação real.
function allocation({ expensiveDebt, reserveComplete, reserveMinimumMet, goals }) {
  if (expensiveDebt) {
    return reserveMinimumMet
      ? { dividas: 80, livre: 10, reserva: 10 }
      : { dividas: 60, livre: 10, reserva: 30 };
  }

  if (!reserveComplete) {
    return goals ? { livre: 10, metas: 20, reserva: 70 } : { livre: 10, reserva: 90 };
  }

  return goals ? { investimentos: 30, livre: 10, metas: 60 } : { investimentos: 70, livre: 30 };
}

function buildPlan(profile, { now = new Date() } = {}) {
  const income = incomeInfo(profile);
  const essentials = positive(profile?.despesasEssenciais) || 0;
  const debts = normalizeDebts(profile);
  const expensiveDebts = debts.filter((debt) => debt.cara);
  const debtPayments = debts.reduce((total, debt) => total + debt.parcela, 0);
  const months = reserveMonths(profile);
  const reserveTarget = roundMoney(essentials * months);
  const reserveMinimum = roundMoney(essentials);
  const reserveCurrent = nonNegative(profile?.reservaAtual) || 0;
  const goals = shortTermGoals(profile);
  const incomeValue = income.conservadora || 0;
  const surplus = roundMoney(incomeValue - essentials - debtPayments);
  const split = allocation({
    expensiveDebt: expensiveDebts.length > 0,
    goals: goals.length > 0,
    reserveComplete: reserveCurrent >= reserveTarget && reserveTarget > 0,
    reserveMinimumMet: reserveCurrent >= reserveMinimum && reserveMinimum > 0,
  });
  const reservePerMonth = surplus > 0 && split.reserva ? roundMoney(surplus * split.reserva / 100) : 0;
  const reserveGap = roundMoney(Math.max(reserveTarget - reserveCurrent, 0));
  const reviewAt = profile?.perfilInvestidorAtualizadoEm ? new Date(profile.perfilInvestidorAtualizadoEm).getTime() : null;

  return {
    alocacao: surplus > 0
      ? Object.fromEntries(Object.entries(split).map(([key, pct]) => [key, { percentual: pct, valor: roundMoney(surplus * pct / 100) }]))
      : {},
    dividasCaras: expensiveDebts,
    dividasCarasTotal: roundMoney(expensiveDebts.reduce((total, debt) => total + debt.saldo, 0)),
    essenciais: essentials,
    essenciaisPct: incomeValue > 0 ? Math.round((essentials / incomeValue) * 100) : null,
    metasCurtoPrazo: goals,
    parcelasDividas: roundMoney(debtPayments),
    renda: income,
    reservaAtual: reserveCurrent,
    reservaFalta: reserveGap,
    reservaMeses: months,
    reservaMesesParaCompletar: reservePerMonth > 0 && reserveGap > 0 ? Math.ceil(reserveGap / reservePerMonth) : null,
    reservaMeta: reserveTarget,
    reservaMinima: reserveMinimum,
    revisaoPerfilPendente: profile?.revisaoPendente === true ||
      (reviewAt !== null && Number.isFinite(reviewAt) && now.getTime() - reviewAt > PROFILE_REVIEW_MS),
    sobraMensal: surplus,
    sobraPct: incomeValue > 0 ? Math.round((surplus / incomeValue) * 100) : null,
  };
}

function priorityLines(plan) {
  const lines = [];
  const essentialsOk = plan.essenciaisPct !== null && plan.sobraMensal > 0;

  lines.push(`1) Essenciais: ${formatMoney(plan.essenciais)}${plan.essenciaisPct !== null ? ` (${formatPercent(plan.essenciaisPct)} da renda considerada)` : ''} ${essentialsOk ? '✅' : '⚠️'}`);

  if (plan.dividasCaras.length) {
    lines.push(`2) Dívidas caras: ${formatMoney(plan.dividasCarasTotal)} — prioridade antes de investir ⚠️`);
  } else {
    lines.push('2) Dívidas caras: nenhuma informada ✅');
  }

  lines.push(`3) Reserva de emergência (${plan.reservaMeses} meses de essenciais): ${formatMoney(plan.reservaAtual)} de ${formatMoney(plan.reservaMeta)}${plan.reservaFalta > 0 ? ` — faltam ${formatMoney(plan.reservaFalta)}` : ' ✅'}`);

  if (plan.metasCurtoPrazo.length) {
    const monthly = plan.metasCurtoPrazo.reduce((total, goal) => total + goal.mensal, 0);

    lines.push(`4) Metas de curto prazo: ${plan.metasCurtoPrazo.length} — cerca de ${formatMoney(monthly)}/mês`);
  } else {
    lines.push('4) Metas de curto prazo: nenhuma cadastrada');
  }

  const investReady = !plan.dividasCaras.length && plan.reservaFalta <= 0;

  lines.push(`5) Investimentos: ${investReady ? 'liberado para planejar ✅' : 'depois das etapas anteriores'}`);

  return lines;
}

function allocationLines(plan) {
  if (plan.sobraMensal <= 0) {
    return [`Sobra mensal: ${formatMoney(plan.sobraMensal)}. Antes de poupar, o foco é reduzir custos essenciais ou parcelas.`];
  }

  const labels = {
    dividas: 'quitar dívidas caras',
    investimentos: 'investimentos',
    livre: 'uso livre',
    metas: 'metas de curto prazo',
    reserva: 'reserva',
  };

  return [
    `Sobra mensal estimada: ${formatMoney(plan.sobraMensal)} (${formatPercent(plan.sobraPct)} da renda considerada)`,
    `Sugestão para a sobra: ${Object.entries(plan.alocacao).map(([key, item]) => `${item.percentual}% ${labels[key]} (${formatMoney(item.valor)})`).join(' · ')}`,
  ];
}

function planMessage(plan) {
  const lines = [];

  if (plan.renda.variavel) {
    lines.push(`Renda variável: uso ${formatMoney(plan.renda.conservadora)}/mês como base conservadora${plan.renda.estimada ? ' (80% da média)' : ''}.`);
  }

  lines.push(...priorityLines(plan), '', ...allocationLines(plan));

  if (plan.reservaMesesParaCompletar) {
    lines.push(`Nesse ritmo, a reserva fica completa em ~${plan.reservaMesesParaCompletar} meses.`);
  }

  if (plan.essenciaisPct !== null) {
    lines.push(`Referência 50/30/20 (só referência): seus essenciais estão em ${formatPercent(plan.essenciaisPct)} contra 50% de referência.`);
  }

  if (plan.revisaoPerfilPendente) {
    lines.push('🔁 Seu perfil de investidor tem mais de 6 meses ou houve mudança importante. Revise: meu perfil de risco é moderado');
  }

  lines.push('', 'Orientação educativa, não é recomendação personalizada de investimento.');

  return lines.join('\n');
}

module.exports = {
  ALWAYS_EXPENSIVE_DEBTS,
  DEFAULT_RESERVE_MONTHS,
  EXPENSIVE_DEBT_MONTHLY_RATE,
  PROFILE_REVIEW_MS,
  allocation,
  buildPlan,
  incomeInfo,
  missingForPlan,
  normalizeDebts,
  planMessage,
  reserveMonths,
};
