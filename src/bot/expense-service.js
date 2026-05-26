'use strict';

const { parseMoney } = require('../expense-parser');
const { createTransactionStore } = require('../services/transaction-store');
const { categoriaFinal, detectarCategoria } = require('./categories');
const { MESES } = require('./date-utils');
const { normalizeText } = require('./text-utils');

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function createExpenseService({
  dateUtils,
  db,
  firebaseOps,
  siteUrl,
  transactionStore: providedTransactionStore,
}) {
  const { dateParts, monthKey, todayIso } = dateUtils;
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps,
    monthKey,
  });

  async function getGastosMesComIds(group, user, date) {
    return await transactionStore.listMonthlyExpensesWithIds({ date, group, user });
  }

  async function getResumoTexto(group, user) {
    const items = await getGastosMesComIds(group, user);

    if (!items.length) {
      return 'Nenhum gasto registrado este mês ainda.';
    }

    const total = items.reduce((amount, expense) => amount + Number(expense.value || 0), 0);
    const byCategory = {};

    items.forEach((expense) => {
      byCategory[expense.cat || 'Outros'] =
        (byCategory[expense.cat || 'Outros'] || 0) + Number(expense.value || 0);
    });

    const categories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, value]) => `${category}: ${formatMoney(value)}`)
      .join(', ');

    return `Mês: ${MESES[Number(dateParts().month) - 1]}. Total: ${formatMoney(total)}. Por categoria: ${categories}.`;
  }

  async function montarResumoFormatado(session) {
    const items = await getGastosMesComIds(session.group, session.user);
    const month = MESES[Number(dateParts().month) - 1];

    if (!items.length) {
      return `📭 Nenhum gasto registrado em ${month} ainda.

🌐 Ver no site:
${siteUrl}`;
    }

    const total = items.reduce((amount, expense) => amount + Number(expense.value || 0), 0);
    const byCategory = {};

    items.forEach((expense) => {
      byCategory[expense.cat || 'Outros'] =
        (byCategory[expense.cat || 'Outros'] || 0) + Number(expense.value || 0);
    });

    const categories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, value]) => `  • ${category}: ${formatMoney(value)}`)
      .join('\n');

    const recentExpenses = items
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 5)
      .map((expense, index) =>
        `  ${index + 1}. ${expense.desc || 'Gasto'} — ${formatMoney(expense.value)} (${expense.cat || 'Outros'})`
      )
      .join('\n');

    return [
      `📊 *Resumo de ${month}*`,
      `👤 ${session.user} | Grupo: ${session.group}`,
      '',
      categories,
      '',
      `💸 *Total: ${formatMoney(total)}*`,
      '',
      '🧾 *Últimos gastos:*',
      recentExpenses,
      '',
      '🌐 Ver no site:',
      siteUrl,
      '',
      'Para apagar: _apagar último_ ou _apagar [valor]_',
    ].join('\n');
  }

  async function montarListaGastos(session) {
    const items = await getGastosMesComIds(session.group, session.user);
    const month = MESES[Number(dateParts().month) - 1];

    if (!items.length) {
      return `📭 Nenhum gasto registrado em ${month} ainda.`;
    }

    const lines = items
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 10)
      .map((expense, index) =>
        `${index + 1}. ${expense.date || todayIso()} · ${expense.desc || 'Gasto'} · ${formatMoney(expense.value)} · ${expense.cat || 'Outros'}`
      );

    return [
      `🧾 *Últimos gastos de ${month}*`,
      `👤 ${session.user} | Grupo: ${session.group}`,
      '',
      ...lines,
      '',
      'Para apagar um deles: _apagar último_, _apagar [valor]_ ou _apagar [descricao]_.',
    ].join('\n');
  }

  async function montarResumoHoje(session) {
    const today = todayIso();
    const items = (await getGastosMesComIds(session.group, session.user))
      .filter((item) => item.date === today);

    if (!items.length) {
      return '📭 Nenhum gasto registrado hoje ainda.';
    }

    const total = items.reduce((amount, item) => amount + Number(item.value || 0), 0);
    const lines = items
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 5)
      .map((item) => `  • ${item.desc || 'Gasto'}: ${formatMoney(item.value)} (${item.cat || 'Outros'})`);

    return [
      '📅 *Gastos de hoje*',
      `💸 *Total: ${formatMoney(total)}*`,
      '',
      ...lines,
      '',
      'Para ver o mês inteiro: _resumo_.',
    ].join('\n');
  }

  async function registrarParcelamento(session, { valor, desc, parcelas }) {
    if (!valor || valor <= 0) {
      return 'Qual foi o valor total? 💸';
    }

    if (parcelas < 2 || parcelas > 60) {
      return 'Parcelas devem ser entre 2 e 60.';
    }

    const category = detectarCategoria(desc);
    const installmentValue = Math.round((valor / parcelas) * 100) / 100;
    const today = new Date();

    for (let index = 0; index < parcelas; index++) {
      const date = new Date(today.getFullYear(), today.getMonth() + index, today.getDate());

      await transactionStore.saveExpense({
        date,
        group: session.group,
        user: session.user,
        expense: {
          desc: `${desc} (${index + 1}/${parcelas})`,
          value: installmentValue,
          cat: category,
          date: todayIso(date),
          user: session.user,
          viaBot: true,
          origem: 'parcelamento',
          parcela: {
            numero: index + 1,
            total: parcelas,
            valorTotal: valor,
          },
          createdAt: new Date().toISOString(),
        },
      });
    }

    return `💳 *${desc}* parcelado!
💸 Total: ${formatMoney(valor)}
📅 ${parcelas}x de ${formatMoney(installmentValue)}
📂 Categoria: ${category}

As parcelas foram lançadas nos próximos ${parcelas} meses.

🌐 Ver no site:
${siteUrl}`;
  }

  async function registrarGasto(session, expense, source = 'texto') {
    const value = Number(expense.valor || expense.value || 0);
    const description = String(expense.desc || expense.descricao || 'Gasto').trim();

    if (!value || value <= 0) {
      return 'Qual foi o valor? 💸';
    }

    const category = categoriaFinal(description, expense.cat);

    await transactionStore.saveExpense({
      group: session.group,
      user: session.user,
      expense: {
        desc: description,
        value,
        cat: category,
        date: expense.data || todayIso(),
        user: session.user,
        viaBot: true,
        origem: source,
        createdAt: new Date().toISOString(),
      },
    });

    return `✅ *${description}* registrado!
💸 Valor: ${formatMoney(value)}
📂 Categoria: ${category}

🌐 Ver no site:
${siteUrl}

Se foi errado: _apagar último_`;
  }

  async function apagarGastoPorId(session, id) {
    await transactionStore.removeExpenseById({
      group: session.group,
      id,
      user: session.user,
    });
  }

  async function apagarGastoPorTexto(session, text) {
    const items = await getGastosMesComIds(session.group, session.user);

    if (!items.length) {
      return '📭 Não encontrei nenhum gasto para apagar neste mês.';
    }

    const message = normalizeText(text);
    const informedValue = parseMoney((text.match(/(?:R\$\s*)?\d+(?:[,.]\d{1,2})?/) || [])[0]);
    const isLatest = /ultimo|último|desfazer|cancelar|errado|duplicado|repetido|ja tinha|já tinha/.test(message);

    if (isLatest && !informedValue) {
      const latest = items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];

      await apagarGastoPorId(session, latest.id);

      return `🗑️ Apaguei:
*${latest.desc || 'Gasto'}* — ${formatMoney(latest.value)} (${latest.cat || 'Outros'})`;
    }

    let candidates = [...items];

    if (informedValue) {
      candidates = candidates.filter((item) => Math.abs(Number(item.value) - informedValue) < 0.01);
    }

    const words = message
      .replace(/apagar|deletar|excluir|remover|desfazer|cancelar|errado|lancei|valor|ja|já|tinha|pago|duplicado|repetido|ultimo|último/g, '')
      .replace(/\d+[,.]?\d*/g, '')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3);

    if (words.length) {
      candidates = candidates.filter((item) => {
        const description = normalizeText(`${item.desc || ''} ${item.cat || ''}`);

        return words.some((word) => description.includes(word));
      });
    }

    if (!candidates.length) {
      return `Não achei esse gasto.
Tente:
_apagar último_
_apagar 35_
_apagar mercado_`;
    }

    const chosen = candidates.sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    )[0];

    await apagarGastoPorId(session, chosen.id);

    return `🗑️ Apaguei:
*${chosen.desc || 'Gasto'}* — ${formatMoney(chosen.value)} (${chosen.cat || 'Outros'})`;
  }

  return {
    apagarGastoPorId,
    apagarGastoPorTexto,
    getGastosMesComIds,
    getResumoTexto,
    montarListaGastos,
    montarResumoFormatado,
    montarResumoHoje,
    registrarGasto,
    registrarParcelamento,
  };
}

module.exports = {
  createExpenseService,
};
