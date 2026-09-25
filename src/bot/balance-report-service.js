'use strict';

const { createTransactionStore, splitExpensesByPaymentStatus } = require('../services/transaction-store');
const { DEFAULT_GROUP } = require('../services/user-service');
const { ESTADOS, legacyStatusFor, saldoCents, storedEstado, valorCobradoCents, valorPagoCents } = require('./charge-state');
const { MESES } = require('./date-utils');
const { formatCents, normalizedCommand, toCents } = require('./finance-utils');
const { sessionTag } = require('./user-data');

function isBalanceCommand(text) {
  return /^(relatorio financeiro|balanco|meu balanco|balanco do mes|resumo completo|saldo com amigos|meu saldo|visao geral|minha situacao)$/.test(normalizedCommand(text));
}

// Separa gasto pessoal líquido de valores de amigos: reembolsos nunca inflam o gasto.
function createBalanceReportService({
  dateUtils,
  db,
  firebaseOps,
  now = () => new Date(),
  obligationService,
  transactionStore: providedTransactionStore,
}) {
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps,
    monthKey: dateUtils.monthKey,
  });

  async function computeBalances(tag) {
    const expenses = await transactionStore.listMonthlyExpensesWithIds({ date: now(), group: DEFAULT_GROUP, user: tag });
    const { paidExpenses, pendingCommitments } = splitExpensesByPaymentStatus(expenses);
    const { sent } = await obligationService.listCharges(tag);
    const sentById = new Map(sent.map((charge) => [charge.id, charge]));
    let paidCents = 0;
    let reimbursableCents = 0;
    let sharedGrossCents = 0;
    let sharedMineCents = 0;

    paidExpenses.forEach((expense) => {
      const value = toCents(expense.value);

      paidCents += value;

      if (expense.origem === 'divisao' || expense.compartilhado === true) {
        sharedGrossCents += toCents(expense.valorBruto ?? expense.value);
        sharedMineCents += value;
      }

      // Cobranças antigas registravam o total da conta como gasto de quem pagou.
      if (expense.cobranca === true && expense.cobrancaId && sentById.has(expense.cobrancaId)) {
        const charge = sentById.get(expense.cobrancaId);
        const legacy = legacyStatusFor(storedEstado(charge));

        if (legacy !== 'recusada' && legacy !== 'cancelada') {
          const charged = Math.min(valorCobradoCents(charge), value);

          reimbursableCents += charged;
          sharedGrossCents += value;
          sharedMineCents += value - charged;
        }
      }
    });

    const entries = await obligationService.numberedOpen(tag);
    const sum = (items) => items.reduce((total, entry) => total + saldoCents(entry.charge), 0);
    const payable = (entry) => ![ESTADOS.AGUARDANDO_FECHAMENTO, ESTADOS.INFORMADO].includes(entry.estado);
    const toReceive = entries.filter((entry) => entry.role === 'credor' && payable(entry));
    const toPay = entries.filter((entry) => entry.role === 'devedor' && payable(entry));
    const awaitingConfirmation = entries.filter((entry) => entry.estado === ESTADOS.INFORMADO);
    const partial = entries.filter((entry) => entry.estado === ESTADOS.PARCIAL);
    const awaitingClosing = entries.filter((entry) => entry.estado === ESTADOS.AGUARDANDO_FECHAMENTO);

    return {
      aPagarCents: sum(toPay),
      aPagarQtd: toPay.length,
      aReceberCents: sum(toReceive),
      aReceberQtd: toReceive.length,
      aguardandoConfirmacaoCents: awaitingConfirmation.reduce((total, entry) =>
        total + toCents(entry.charge.pagamentoInformado?.valor || 0), 0),
      aguardandoConfirmacaoQtd: awaitingConfirmation.length,
      aguardandoFechamentoCents: sum(awaitingClosing),
      compromissosPendentesCents: pendingCommitments.reduce((total, expense) => total + toCents(expense.value), 0),
      compartilhadoBrutoCents: sharedGrossCents,
      compartilhadoMinhaParteCents: sharedMineCents,
      gastoPessoalLiquidoCents: paidCents - reimbursableCents,
      parciais: partial.map((entry) => ({
        original: valorCobradoCents(entry.charge),
        pago: valorPagoCents(entry.charge),
        role: entry.role,
        saldo: saldoCents(entry.charge),
      })),
    };
  }

  async function report(session) {
    const tag = sessionTag(session);

    await obligationService.processClosingsFor(tag, { notifyParties: false });

    const data = await computeBalances(tag);
    const month = MESES[Number(dateUtils.dateParts(now()).month) - 1];
    const lines = [
      `📊 Balanço de ${month}`,
      `💸 Gastos pessoais líquidos: ${formatCents(data.gastoPessoalLiquidoCents)}`,
      '   (partes de amigos e reembolsos não entram aqui)',
      `🟢 Valores a receber: ${formatCents(data.aReceberCents)} (${data.aReceberQtd})`,
      `🔴 Valores a pagar: ${formatCents(data.aPagarCents)} (${data.aPagarQtd})`,
      `⏳ Pagamentos aguardando confirmação: ${formatCents(data.aguardandoConfirmacaoCents)} (${data.aguardandoConfirmacaoQtd})`,
    ];

    if (data.parciais.length) {
      const paid = data.parciais.reduce((total, item) => total + item.pago, 0);
      const original = data.parciais.reduce((total, item) => total + item.original, 0);

      lines.push(`🧩 Pagamentos parciais: ${data.parciais.length} — pago ${formatCents(paid)} de ${formatCents(original)}`);
    } else {
      lines.push('🧩 Pagamentos parciais: nenhum');
    }

    lines.push(`🤝 Gastos compartilhados no mês: total ${formatCents(data.compartilhadoBrutoCents)} · sua parte ${formatCents(data.compartilhadoMinhaParteCents)}`);

    if (data.aguardandoFechamentoCents > 0) {
      lines.push(`🧾 Aguardando fechamento de fatura: ${formatCents(data.aguardandoFechamentoCents)}`);
    }

    lines.push('', 'Detalhes: cobranças');

    return lines.join('\n');
  }

  async function process(session, text) {
    return isBalanceCommand(text) ? await report(session) : null;
  }

  return {
    computeBalances,
    process,
    report,
  };
}

module.exports = {
  createBalanceReportService,
  isBalanceCommand,
};
