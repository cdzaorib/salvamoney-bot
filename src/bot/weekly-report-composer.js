'use strict';

const { formatCents, formatMoney, formatPercent } = require('./finance-utils');
const { frame } = require('./personality-service');
const { sessionTag } = require('./user-data');

// Uma prioridade e no máximo três ações práticas, calculadas localmente.
function priorityAndActions(data, balances) {
  const actions = [];
  const top = data.topCategorias?.[0];
  let priority = 'Manter a constância: registrar os gastos no dia a dia.';

  if (balances && balances.aPagarCents > 0) {
    priority = `Acertar pendências com amigos (${formatCents(balances.aPagarCents)} a pagar).`;
    actions.push('Enviar os pagamentos pendentes e informar com: paguei cobrança N');
  } else if (data.statusMeta === 'abaixo_da_meta' && data.quantoFaltaMeta > 0) {
    priority = `Recuperar a meta do mês: faltam ${formatMoney(data.quantoFaltaMeta)}.`;
  } else if (data.orcamentoMensal && data.percentualOrcamentoSemana !== null && data.percentualOrcamentoSemana > 25) {
    priority = `Segurar o ritmo: a semana usou ${formatPercent(data.percentualOrcamentoSemana)} do orçamento mensal.`;
  } else if (top && data.variacaoPercentual !== null && data.variacaoPercentual > 15) {
    priority = `Conter ${top.categoria}, que puxou a alta de ${formatPercent(data.variacaoPercentual)} na semana.`;
  }

  if (top) {
    actions.push(`Definir um teto de ${formatMoney(Math.round(top.total * 0.9 * 100) / 100)} para ${top.categoria} na próxima semana.`);
  }

  if (balances && balances.aguardandoConfirmacaoQtd > 0) {
    actions.push(`Confirmar ${balances.aguardandoConfirmacaoQtd} pagamento(s) informado(s): recebi cobrança N`);
  } else if (balances && balances.aReceberCents > 0) {
    actions.push(`Lembrar quem te deve (${formatCents(balances.aReceberCents)}): cobrar novamente NOME`);
  }

  if (!data.orcamentoMensal) {
    actions.push('Definir um orçamento mensal: definir orçamento 2000');
  }

  actions.push('Registrar cada gasto no mesmo dia.');

  return {
    actions: [...new Set(actions)].slice(0, 3),
    priority,
  };
}

function createWeeklyReportComposer({
  balanceService,
  features = {},
  personalityService,
  weeklyReportService,
}) {
  async function compose(session, text = 'relatório da semana') {
    if (!features.personalities && !features.splits) {
      return await weeklyReportService.gerarRelatorioSemanal(session, text);
    }

    const data = await weeklyReportService.carregarDadosRelatorioSemanal(session, text);

    if (!data) {
      return await weeklyReportService.gerarRelatorioSemanal(session, text);
    }

    const tag = sessionTag(session);
    const personality = features.personalities && personalityService
      ? await personalityService.getPersonality(tag)
      : 'equilibrado';
    const balances = features.splits && balanceService ? await balanceService.computeBalances(tag) : null;
    const lines = [];

    if (!data.quantidadeRegistros) {
      lines.push('Nenhum gasto registrado nos últimos 7 dias.');
    } else {
      lines.push(`Gastos dos últimos 7 dias: ${formatMoney(data.totalSemanaAtual)} (${data.quantidadeRegistros} registros)`);
      lines.push(data.variacaoPercentual === null
        ? 'Sem histórico suficiente para comparar com a semana anterior.'
        : `Comparado à semana anterior: ${data.variacaoPercentual >= 0 ? '+' : ''}${data.variacaoPercentual}%`);

      if (data.topCategorias?.[0]) {
        lines.push(`Maior categoria: ${data.topCategorias[0].categoria} — ${formatMoney(data.topCategorias[0].total)}`);
      }
    }

    if (balances) {
      lines.push(`A receber: ${formatCents(balances.aReceberCents)} · A pagar: ${formatCents(balances.aPagarCents)}`);
    }

    const { actions, priority } = priorityAndActions(data, balances);

    lines.push('', `🎯 Prioridade: ${priority}`, 'Ações:', ...actions.map((action, index) => `${index + 1}. ${action}`));

    return frame(personality, 'report', lines.join('\n'), { closing: true });
  }

  return {
    compose,
  };
}

module.exports = {
  createWeeklyReportComposer,
  priorityAndActions,
};
