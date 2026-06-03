'use strict';

const { parseMoney } = require('../expense-parser');
const { createTransactionStore, splitExpensesByPaymentStatus } = require('../services/transaction-store');
const {
  categoriaFinal,
  detectarCategoria,
  normalizeCategoryName,
  normalizeCustomCategories,
} = require('./categories');
const { MESES } = require('./date-utils');
const { normalizeText } = require('./text-utils');

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sumExpenses(expenses) {
  return expenses.reduce((total, expense) => total + Number(expense.value || 0), 0);
}

function categoryLines(expenses, prefix = '') {
  const byCategory = {};

  expenses.forEach((expense) => {
    byCategory[expense.cat || 'Outros'] =
      (byCategory[expense.cat || 'Outros'] || 0) + Number(expense.value || 0);
  });

  return Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, value]) => `${prefix}${category}: ${formatMoney(value)}`);
}

function candidateLine(expense, index) {
  return `${index + 1}. ${expense.desc || 'Gasto'} — ${formatMoney(expense.value)} — ${expense.cat || 'Outros'} — ${expense.date || ''}`;
}

function selectionMessage(candidates) {
  return [
    'Encontrei estes gastos parecidos:',
    '',
    ...candidates.map(candidateLine),
    '',
    "Responda com o número do gasto que deseja apagar ou 'cancelar'.",
  ].join('\n');
}

function pendingCandidate(expense, expenseMonthKey) {
  return {
    id: expense.id,
    monthKey: expenseMonthKey,
    desc: expense.desc || 'Gasto',
    value: Number(expense.value || 0),
    cat: expense.cat || 'Outros',
    date: expense.date || '',
    ...(expense.parcelaId ? { parcelaId: expense.parcelaId } : {}),
  };
}

function deletedMessage(expense) {
  if (expense.parcelaId) {
    return [
      '🗑️ Apaguei somente esta parcela:',
      `*${expense.desc || 'Gasto'}* — ${formatMoney(expense.value)} (${expense.cat || 'Outros'})`,
      '',
      'Para apagar as parcelas restantes, envie: apagar parcelas [nome da compra].',
    ].join('\n');
  }

  return `🗑️ Apaguei:
*${expense.desc || 'Gasto'}* — ${formatMoney(expense.value)} (${expense.cat || 'Outros'})`;
}

function parseInstallmentDeleteCommand(text) {
  const normalized = normalizeText(text);

  if (!/^(apagar|excluir|remover)\b/.test(normalized)) {
    return null;
  }

  if (!/\b(parcelas?|parcelamento)\b/.test(normalized)) {
    return null;
  }

  const query = normalized
    .replace(/^(apagar|excluir|remover)\b/, '')
    .replace(/\b(todas?|todos?|as|os|da|do|de|das|dos|parcelas?|parcelamento)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { query };
}

function installmentBaseDescription(desc) {
  return String(desc || 'Gasto parcelado')
    .replace(/\s+\(\d+\/\d+x\)$/i, '')
    .trim();
}

function installmentMatchesQuery(installment, query) {
  const words = String(query || '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);

  if (!words.length) {
    return false;
  }

  const searchable = normalizeText(`${installment.desc} ${installment.cat || ''}`);

  return words.every((word) => searchable.includes(word));
}

function groupInstallmentsByParcelaId(expenses) {
  const grouped = new Map();

  expenses.forEach((expense) => {
    if (!expense.parcelaId) {
      return;
    }

    const group = grouped.get(expense.parcelaId) || {
      parcelaId: expense.parcelaId,
      desc: installmentBaseDescription(expense.desc),
      cat: expense.cat || 'Outros',
      total: 0,
      parcelaTotal: Number(expense.parcelaTotal || 0),
      installments: [],
    };

    group.installments.push(expense);
    group.total += Number(expense.value || 0);
    group.parcelaTotal = Math.max(group.parcelaTotal, Number(expense.parcelaTotal || 0));
    grouped.set(expense.parcelaId, group);
  });

  return Array.from(grouped.values()).map((installment) => ({
    ...installment,
    parcelasEncontradas: installment.installments.length,
    parcelaTotal: installment.parcelaTotal || installment.installments.length,
  }));
}

function installmentSelectionLine(installment, index) {
  return `${index + 1}. ${installment.desc} — ${installment.parcelaTotal} parcelas — ${formatMoney(installment.total)} total`;
}

function installmentSelectionMessage(candidates) {
  const title = candidates.length === 1
    ? 'Encontrei este parcelamento:'
    : 'Encontrei estes parcelamentos:';

  return [
    title,
    '',
    ...candidates.map(installmentSelectionLine),
    '',
    "Responda o número para selecionar ou 'cancelar'.",
  ].join('\n');
}

function installmentConfirmationMessage(installment) {
  return [
    `Tem certeza que deseja apagar as parcelas restantes de ${installment.desc}?`,
    'As parcelas com data anterior a hoje serão preservadas.',
    'Responda SIM para confirmar ou CANCELAR.',
  ].join('\n');
}

function customCategoryId(name) {
  return normalizeText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function customCategoriesPath(group, user) {
  return `grupos/${group}/usuarios/${user}/categorias`;
}

function customCategoryPath(group, user, id) {
  return `${customCategoriesPath(group, user)}/${id}`;
}

function parseCustomCategoryCommand(text) {
  const original = String(text || '').trim();
  const normalized = normalizeText(original);

  if (['categorias', 'minhas categorias', 'listar categorias', 'ver categorias'].includes(normalized)) {
    return { action: 'list' };
  }

  let match = original.match(/^(?:adicionar|criar|nova|novo)\s+(?:nova\s+)?categoria\s+(.+)$/i) ||
    original.match(/^categoria\s+nova\s+(.+)$/i);

  if (match) {
    const raw = String(match[1] || '').trim();
    const [namePart, wordsPart = ''] = raw.split(/\s+(?:com|para|palavras?|keywords?)\s+/i);
    const name = normalizeCategoryName(namePart);
    const words = wordsPart
      .split(/[,;]/)
      .flatMap((part) => part.split(/\s+e\s+/i))
      .map((word) => word.trim())
      .filter(Boolean);

    return {
      action: 'add',
      name,
      words,
    };
  }

  match = original.match(/^(?:apagar|excluir|remover)\s+categoria\s+(.+)$/i);

  if (match) {
    return {
      action: 'remove',
      name: normalizeCategoryName(match[1]),
    };
  }

  return null;
}

function formatCategoryList(categories) {
  const custom = normalizeCustomCategories(categories);

  if (!custom.length) {
    return [
      'Você ainda não tem categorias personalizadas.',
      '',
      'Exemplo:',
      'adicionar categoria Pets com ração, veterinário, petshop',
    ].join('\n');
  }

  return [
    'Suas categorias personalizadas:',
    '',
    ...custom.map((category, index) => {
      const words = category.palavras
        .filter((word) => normalizeText(word) !== normalizeText(category.nome))
        .join(', ');

      return `${index + 1}. ${category.nome}${words ? ` — ${words}` : ''}`;
    }),
  ].join('\n');
}

function compareExpenseDate(expense, today, currentMonthKey) {
  const date = String(expense?.date || '').slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date.localeCompare(today);
  }

  const [expenseYear, expenseMonth] = String(expense?.monthKey || '').split('_').map(Number);
  const [currentYear, currentMonth] = String(currentMonthKey || '').split('_').map(Number);

  if ([expenseYear, expenseMonth, currentYear, currentMonth].some((value) => !Number.isFinite(value))) {
    return 0;
  }

  return (expenseYear * 12 + expenseMonth) - (currentYear * 12 + currentMonth);
}

function createExpenseService({
  dateUtils,
  db,
  firebaseOps,
  siteUrl,
  transactionStore: providedTransactionStore,
}) {
  const { dateParts, monthKey, todayIso } = dateUtils;
  const { get, ref, remove, set } = firebaseOps;
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps,
    monthKey,
  });

  async function getCategoriasPersonalizadas(session) {
    const snap = await get(ref(db, customCategoriesPath(session.group, session.user)));

    return normalizeCustomCategories(snap.val() || {});
  }

  async function processarCategoriaPersonalizada(session, text) {
    const command = parseCustomCategoryCommand(text);

    if (!command) {
      return null;
    }

    if (command.action === 'list') {
      return formatCategoryList(await getCategoriasPersonalizadas(session));
    }

    if (!command.name) {
      return 'Informe o nome da categoria. Exemplo: adicionar categoria Pets com ração, veterinário, petshop';
    }

    const id = customCategoryId(command.name);

    if (!id) {
      return 'Informe um nome válido para a categoria.';
    }

    if (command.action === 'remove') {
      await remove(ref(db, customCategoryPath(session.group, session.user, id)));

      return `Categoria ${command.name} removida.`;
    }

    const category = {
      nome: command.name,
      palavras: normalizeCustomCategories([{
        nome: command.name,
        palavras: command.words,
      }])[0]?.palavras || [normalizeText(command.name)],
      createdAt: new Date().toISOString(),
    };

    await set(ref(db, customCategoryPath(session.group, session.user, id)), category);

    return [
      `Categoria ${command.name} adicionada ✅`,
      '',
      `Vou usar essa categoria quando aparecer: ${category.palavras.join(', ')}`,
    ].join('\n');
  }

  async function getGastosMesComIds(group, user, date) {
    return await transactionStore.listMonthlyExpensesWithIds({ date, group, user });
  }

  async function getResumoTexto(group, user) {
    const items = await getGastosMesComIds(group, user);

    if (!items.length) {
      return 'Nenhum gasto registrado este mês ainda.';
    }

    const { paidExpenses, pendingCommitments } = splitExpensesByPaymentStatus(items);
    const paidTotal = sumExpenses(paidExpenses);
    const pendingTotal = sumExpenses(pendingCommitments);
    const categories = categoryLines(paidExpenses).join(', ') || 'nenhum gasto pago';

    return [
      `Mês: ${MESES[Number(dateParts().month) - 1]}.`,
      `Gastos pagos: ${formatMoney(paidTotal)}.`,
      `Cobranças pendentes: ${formatMoney(pendingTotal)}.`,
      `Total comprometido: ${formatMoney(paidTotal + pendingTotal)}.`,
      `Gastos pagos por categoria: ${categories}.`,
    ].join(' ');
  }

  async function montarResumoFormatado(session) {
    const items = await getGastosMesComIds(session.group, session.user);
    const month = MESES[Number(dateParts().month) - 1];

    if (!items.length) {
      return `📭 Nenhum gasto registrado em ${month} ainda.

🌐 Ver no site:
${siteUrl}`;
    }

    const { paidExpenses, pendingCommitments } = splitExpensesByPaymentStatus(items);
    const paidTotal = sumExpenses(paidExpenses);
    const pendingTotal = sumExpenses(pendingCommitments);
    const totalCommitted = paidTotal + pendingTotal;
    const categories = categoryLines(paidExpenses, '  • ').join('\n');
    const recentExpenses = paidExpenses
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 5)
      .map((expense, index) =>
        `  ${index + 1}. ${expense.desc || 'Gasto'} — ${formatMoney(expense.value)} (${expense.cat || 'Outros'})`
      )
      .join('\n');
    const pendingLines = pendingCommitments
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 5)
      .map((expense, index) => `  ${index + 1}. ${expense.desc || 'Cobrança'} — ${formatMoney(expense.value)}`)
      .join('\n');
    const lines = [
      `📊 *Resumo de ${month}*`,
      `👤 ${session.user} | Grupo: ${session.group}`,
      '',
      `💸 *Gastos pagos: ${formatMoney(paidTotal)}*`,
      `⏳ *Cobranças pendentes: ${formatMoney(pendingTotal)}*`,
      `📌 *Total comprometido: ${formatMoney(totalCommitted)}*`,
    ];

    if (categories) {
      lines.push('', '📂 *Gastos pagos por categoria:*', categories);
    }

    if (recentExpenses) {
      lines.push('', '🧾 *Últimos gastos pagos:*', recentExpenses);
    }

    if (pendingLines) {
      lines.push('', '⏳ *Pendências:*', pendingLines);
    }

    lines.push(
      '',
      '🌐 Ver no site:',
      siteUrl,
      '',
      'Para apagar: _apagar último_ ou _apagar [valor]_'
    );

    return lines.join('\n');
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

    const customCategories = await getCategoriasPersonalizadas(session);
    const category = detectarCategoria(desc, customCategories);
    const installmentValue = Math.round((valor / parcelas) * 100) / 100;
    const parcelaId = String(Date.now());
    const today = new Date();

    for (let index = 0; index < parcelas; index++) {
      const date = new Date(today.getFullYear(), today.getMonth() + index, today.getDate());

      await transactionStore.saveExpense({
        date,
        group: session.group,
        phone: session.phone,
        user: session.user,
        expense: {
          desc: `${desc} (${index + 1}/${parcelas}x)`,
          value: installmentValue,
          cat: category,
          date: todayIso(date),
          user: session.user,
          viaBot: true,
          parcelaId,
          parcelaNum: index + 1,
          parcelaTotal: parcelas,
          origem: 'bot',
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

    const customCategories = await getCategoriasPersonalizadas(session);
    const category = categoriaFinal(description, expense.cat, customCategories);

    await transactionStore.saveExpense({
      group: session.group,
      phone: session.phone,
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

  async function apagarGastoSelecionado(session, expense) {
    await transactionStore.removeExpenseById({
      group: session.group,
      user: session.user,
      phone: session.phone,
      expenseMonthKey: expense.monthKey,
      id: expense.id,
      removePhoneCopy: true,
    });

    return deletedMessage(expense);
  }

  async function apagarGastoPorTexto(session, text, options = {}) {
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

      return deletedMessage(latest);
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
      return 'Não encontrei nenhum gasto parecido. Nenhum gasto foi apagado.';
    }

    const currentMonthKey = monthKey();
    const selectedCandidates = candidates
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 5)
      .map((expense) => pendingCandidate(expense, currentMonthKey));

    if (!options.createPendingSelection) {
      return selectionMessage(selectedCandidates);
    }

    return {
      message: selectionMessage(selectedCandidates),
      pendingDelete: {
        type: 'expense_selection',
        candidates: selectedCandidates,
      },
    };
  }

  async function buscarParcelamentosParaApagar(session, text, options = {}) {
    const command = parseInstallmentDeleteCommand(text);

    if (!command) {
      return null;
    }

    const installments = groupInstallmentsByParcelaId(
      await transactionStore.listAllExpensesWithIds({
        group: session.group,
        user: session.user,
      })
    )
      .filter((installment) => installmentMatchesQuery(installment, command.query))
      .sort((a, b) => String(a.desc).localeCompare(String(b.desc)))
      .slice(0, 5)
      .map((installment) => ({
        parcelaId: installment.parcelaId,
        desc: installment.desc,
        cat: installment.cat,
        parcelaTotal: installment.parcelaTotal,
        parcelasEncontradas: installment.parcelasEncontradas,
        total: Math.round(installment.total * 100) / 100,
      }));

    if (!installments.length) {
      return 'Não encontrei nenhum parcelamento parecido. Nenhum gasto foi apagado.';
    }

    if (!options.createPendingSelection) {
      return installmentSelectionMessage(installments);
    }

    return {
      message: installmentSelectionMessage(installments),
      pendingDelete: {
        type: 'installment_selection',
        candidates: installments,
      },
    };
  }

  async function apagarParcelamentoSelecionado(session, installment) {
    const removed = await transactionStore.removeExpensesByParcelaId({
      group: session.group,
      user: session.user,
      phone: session.phone,
      parcelaId: installment.parcelaId,
      removePhoneCopy: true,
      shouldRemoveExpense: (expense) => compareExpenseDate(expense, todayIso(), monthKey()) >= 0,
    });

    if (!removed.length) {
      return [
        'Não encontrei parcelas restantes para apagar.',
        `As parcelas anteriores de *${installment.desc || 'Gasto parcelado'}* foram preservadas.`,
      ].join('\n');
    }

    return [
      `🗑️ Apaguei ${removed.length} parcela(s) restante(s) do parcelamento:`,
      `*${installment.desc || 'Gasto parcelado'}*`,
      '',
      'As parcelas anteriores foram preservadas.',
    ].join('\n');
  }

  return {
    apagarGastoPorId,
    apagarGastoSelecionado,
    apagarGastoPorTexto,
    apagarParcelamentoSelecionado,
    buscarParcelamentosParaApagar,
    installmentConfirmationMessage,
    getGastosMesComIds,
    getCategoriasPersonalizadas,
    getResumoTexto,
    montarListaGastos,
    montarResumoFormatado,
    montarResumoHoje,
    processarCategoriaPersonalizada,
    registrarGasto,
    registrarParcelamento,
  };
}

module.exports = {
  createExpenseService,
};
