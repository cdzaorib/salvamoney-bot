'use strict';

const { parseMoney } = require('../expense-parser');
const { createTransactionStore } = require('../services/transaction-store');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { detectarCategoria } = require('./categories');
const { normalizeText } = require('./text-utils');

const CHARGE_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const MONEY_PATTERN_TEXT = '(?:R\\$\\s*)?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:[,.]\\d{1,2})?';
const MONEY_PATTERN = new RegExp(MONEY_PATTERN_TEXT, 'i');
const MONEY_PATTERN_GLOBAL = new RegExp(MONEY_PATTERN_TEXT, 'gi');

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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function capitalize(value) {
  const text = String(value || '').trim();

  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : '';
}

function userPath(tag) {
  return `grupos/${DEFAULT_GROUP}/usuarios/${tag}`;
}

function sentChargesPath(tag) {
  return `${userPath(tag)}/cobrancasEnviadas`;
}

function receivedChargesPath(tag) {
  return `${userPath(tag)}/cobrancasRecebidas`;
}

function sentChargePath(tag, id) {
  return `${sentChargesPath(tag)}/${id}`;
}

function receivedChargePath(tag, id) {
  return `${receivedChargesPath(tag)}/${id}`;
}

function chargeExpenseId(chargeId) {
  return `cob_${String(chargeId || '').replace(/[.#$\[\]\/]/g, '_')}`;
}

function chargeExpensePath(tag, monthKey, id) {
  return `${userPath(tag)}/gastos/${monthKey}/${id}`;
}

function getUserName(profile, fallbackTag) {
  return profile?.nome || profile?.name || profile?.displayName || fallbackTag;
}

function getUserPhone(profile) {
  return profile?.phone || profile?.telefone || profile?.whatsapp || '';
}

function extractTag(text) {
  const matches = String(text || '').match(/\b\d{6}\b/g) || [];

  return matches.length ? matches[matches.length - 1] : null;
}

function extractPercent(text) {
  const match = String(text || '').match(/\b(\d{1,3}(?:[,.]\d{1,2})?)\s*%/);

  if (!match) {
    return {
      found: false,
      value: null,
    };
  }

  const value = Number(String(match[1]).replace(',', '.'));

  return {
    found: true,
    value,
  };
}

function removeTagAndPercent(text) {
  return String(text || '')
    .replace(/\b\d{6}\b/g, ' ')
    .replace(/\b\d{1,3}(?:[,.]\d{1,2})?\s*%/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMoneyValues(text) {
  return Array.from(String(text || '').matchAll(MONEY_PATTERN_GLOBAL))
    .map((match) => normalizeMoneyValue(match[0]))
    .filter((value) => Number.isFinite(Number(value)));
}

function extractMoneyAfter(pattern, text) {
  const match = String(text || '').match(new RegExp(`${pattern}\\s*(${MONEY_PATTERN_TEXT})`, 'i'));

  if (!match) {
    return null;
  }

  const value = normalizeMoneyValue(match[1]);

  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function extractSpentTotal(text) {
  return extractMoneyAfter('\\b(?:gastei|gasto|paguei|foi)\\b', text);
}

function extractDirectChargeValue(text) {
  return extractMoneyAfter('\\b(?:cobrar|cobranca\\s+de|cobrança\\s+de)\\b', text) ||
    extractMoneyAfter('\\bcriar\\s+cobranca\\s+de\\b', text) ||
    extractMoneyAfter('\\bcriar\\s+cobrança\\s+de\\b', text);
}

function inferDescription(text) {
  const original = String(text || '').trim();
  const referenced = original.match(/\b(?:pelo|pela|por|referente\s+a)\s+([^,.;]+)/i);

  if (referenced?.[1]) {
    return capitalize(referenced[1]
      .replace(/\b(?:tag|dela|dele|da|do|de|e|eh|é)\b/gi, ' ')
      .replace(/\b\d{6}\b/g, ' ')
      .replace(MONEY_PATTERN_GLOBAL, ' ')
      .replace(/\s+/g, ' ')
      .trim());
  }

  const normalized = normalizeText(original);

  if (/\balmoc/.test(normalized)) {
    return 'Almoço';
  }

  if (/\bjantar/.test(normalized)) {
    return 'Jantar';
  }

  if (/\bmercado|supermercado/.test(normalized)) {
    return 'Mercado';
  }

  if (/\buber|transporte|gasolina|onibus/.test(normalized)) {
    return 'Transporte';
  }

  return 'Cobrança';
}

function hasChargeIntent(command) {
  return /\b(cobrar|cobranca|cobrancas|dividir)\b/.test(command) ||
    /\btag\s+(dela|dele)\b/.test(command) ||
    /\b(ela|ele)\s+(?:vai\s+)?(?:pagar|paga)\b/.test(command);
}

function shouldRegisterOriginExpense(command) {
  return /\b(gastei|gasto|paguei|almocei|jantei)\b/.test(command);
}

function parseChargeCreateCommand(text) {
  const command = normalizedCommand(text);

  if (!hasChargeIntent(command) || /^(cobrancas|minhas cobrancas|cobrancas recebidas|cobrancas enviadas)$/.test(command)) {
    return null;
  }

  const tagDestino = extractTag(command);

  if (!tagDestino) {
    return {
      action: 'create',
      error: 'Informe a tag de 6 dígitos da pessoa. Exemplo: cobrar 80 de 123456',
    };
  }

  const percent = extractPercent(command);

  if (percent.found && (percent.value <= 0 || percent.value > 100)) {
    return {
      action: 'create',
      error: 'Informe um percentual entre 1 e 100.',
    };
  }

  const textWithoutTagAndPercent = removeTagAndPercent(command);
  const values = extractMoneyValues(textWithoutTagAndPercent).filter((value) => Number(value) > 0);
  const directChargeValue = extractDirectChargeValue(textWithoutTagAndPercent);
  const spentTotal = extractSpentTotal(textWithoutTagAndPercent);
  let valorTotal = spentTotal || null;
  let valorCobrado = directChargeValue || null;

  if (percent.found) {
    valorTotal = valorTotal || values[0] || null;
    valorCobrado = valorTotal ? roundMoney(valorTotal * percent.value / 100) : null;
  } else {
    valorCobrado = valorCobrado || values[0] || null;
    valorTotal = valorTotal || null;
  }

  if (!valorCobrado || valorCobrado <= 0) {
    return {
      action: 'create',
      error: percent.found
        ? 'Informe o valor total para calcular a cobrança. Exemplo: gastei 100, ela paga 50%, tag 123456'
        : 'Informe um valor positivo para a cobrança. Exemplo: cobrar 80 de 123456',
    };
  }

  return {
    action: 'create',
    charge: {
      descricao: inferDescription(text),
      percentual: percent.found ? percent.value : null,
      registerExpense: shouldRegisterOriginExpense(command) && Boolean(valorTotal),
      tagDestino,
      valorCobrado: roundMoney(valorCobrado),
      valorTotal: valorTotal ? roundMoney(valorTotal) : roundMoney(valorCobrado),
    },
  };
}

function parseChargeListCommand(command) {
  if (command === 'cobrancas recebidas') {
    return {
      action: 'list',
      scope: 'received',
    };
  }

  if (command === 'cobrancas enviadas') {
    return {
      action: 'list',
      scope: 'sent',
    };
  }

  if (command === 'minhas cobrancas' || command === 'cobrancas') {
    return {
      action: 'list',
      scope: 'all',
    };
  }

  return null;
}

function parseChargeSyncCommand(command) {
  if ([
    'corrigir cobrancas pendentes',
    'sincronizar cobrancas',
    'atualizar cobrancas nos gastos',
  ].includes(command)) {
    return {
      action: 'sync',
    };
  }

  return null;
}

function parseChargeResponseCommand(command) {
  const match = command.match(/^(aceitar|recusar)(?:\s+cobranca)?\s+(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    action: match[1] === 'aceitar' ? 'accept' : 'decline',
    index: Number(match[2]),
  };
}

function parseChargeCancelCommand(command) {
  const match = command.match(/^(cancelar|apagar|excluir|remover)\s+cobranca(?:\s+(.+))?$/);

  if (!match) {
    return null;
  }

  const query = String(match[2] || '').trim();

  return {
    action: 'cancel',
    index: /^\d+$/.test(query) ? Number(query) : null,
    query,
  };
}

function parseChargePaidCommand(command) {
  let match = command.match(/^paguei(?:\s+a)?\s+cobranca\s+(\d+)$/);

  if (match) {
    return {
      action: 'mark_paid',
      index: Number(match[1]),
      scope: 'received',
    };
  }

  match = command.match(/^recebi(?:\s+o\s+pagamento\s+da)?\s+cobranca\s+(\d+)$/);

  if (match) {
    return {
      action: 'mark_paid',
      index: Number(match[1]),
      scope: 'sent',
    };
  }

  match = command.match(/^marcar\s+cobranca\s+(\d+)\s+como\s+paga$/) ||
    command.match(/^marcar\s+como\s+paga\s+(\d+)$/);

  if (match) {
    return {
      action: 'mark_paid',
      index: Number(match[1]),
      scope: 'auto',
    };
  }

  return null;
}

function parseChargeCommand(text) {
  const command = normalizedCommand(text);

  return parseChargeSyncCommand(command) ||
    parseChargeListCommand(command) ||
    parseChargeResponseCommand(command) ||
    parseChargePaidCommand(command) ||
    parseChargeCancelCommand(command) ||
    parseChargeCreateCommand(text);
}

function dateLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);

  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
}

function sortCharges(charges) {
  return [...charges].sort((a, b) => {
    if (a.status === 'pendente' && b.status !== 'pendente') {
      return -1;
    }

    if (a.status !== 'pendente' && b.status === 'pendente') {
      return 1;
    }

    return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function chargeLine(charge, index, type) {
  const person = type === 'received'
    ? `de ${charge.nomeOrigem || charge.tagOrigem}`
    : `para ${charge.nomeDestino || charge.tagDestino}`;

  return `${index + 1}. ${charge.descricao || 'Cobrança'} — ${formatMoney(charge.valorCobrado)} — ${person} — ${charge.status || 'pendente'} — ${dateLabel(charge.createdAt)}`;
}

function pendingChargeLine(charge, index, type) {
  const person = type === 'received'
    ? `de ${charge.nomeOrigem || charge.tagOrigem}`
    : `para ${charge.nomeDestino || charge.tagDestino}`;

  return `${index + 1}. ${charge.descricao || 'Cobrança'} — ${formatMoney(charge.valorCobrado)} — ${person} — pendente`;
}

function listSection(title, charges, type) {
  if (!charges.length) {
    return [title, '', 'Nenhuma cobrança encontrada.'];
  }

  return [
    title,
    '',
    ...sortCharges(charges).map((charge, index) => chargeLine(charge, index, type)),
  ];
}

function listReceivedMessage(charges) {
  const lines = listSection('Cobranças recebidas:', charges, 'received');
  const pending = charges.some((charge) => charge.status === 'pendente');

  if (pending) {
    lines.push('', 'Use: aceitar cobrança 1 ou recusar cobrança 1');
  }

  return lines.join('\n');
}

function listSentMessage(charges) {
  const lines = listSection('Cobranças enviadas:', charges, 'sent');
  const pending = charges.some((charge) => charge.status === 'pendente');

  if (pending) {
    lines.push('', 'Use: cancelar cobrança 1');
  }

  return lines.join('\n');
}

function listAllMessage(received, sent) {
  return [
    ...listSection('Cobranças recebidas:', received, 'received'),
    '',
    ...listSection('Cobranças enviadas:', sent, 'sent'),
  ].join('\n');
}

function createNotificationMessage(charge) {
  return [
    `${charge.nomeOrigem || charge.tagOrigem} te enviou uma cobrança:`,
    charge.descricao || 'Cobrança',
    `Valor: ${formatMoney(charge.valorCobrado)}`,
    '',
    'Responda:',
    'aceitar cobrança 1',
    'ou',
    'recusar cobrança 1',
  ].join('\n');
}

function acceptedNotificationMessage(charge) {
  return `${charge.nomeDestino || charge.tagDestino} aceitou sua cobrança de ${formatMoney(charge.valorCobrado)} referente a ${charge.descricao || 'Cobrança'}.`;
}

function declinedNotificationMessage(charge) {
  return `${charge.nomeDestino || charge.tagDestino} recusou sua cobrança de ${formatMoney(charge.valorCobrado)} referente a ${charge.descricao || 'Cobrança'}.`;
}

function canceledNotificationMessage(charge) {
  return `${charge.nomeOrigem || charge.tagOrigem} cancelou a cobrança de ${formatMoney(charge.valorCobrado)} referente a ${charge.descricao || 'Cobrança'}.`;
}

function paidNotificationMessage(charge, actorName) {
  return `${actorName} marcou como paga a cobrança de ${formatMoney(charge.valorCobrado)} referente a ${charge.descricao || 'Cobrança'}.`;
}

function createdChargeMessage(charge, registeredExpense, notified, expenseRegistrationFailed = false) {
  const lines = [
    'Cobrança criada ✅',
    `${charge.descricao || 'Cobrança'} — ${formatMoney(charge.valorCobrado)} para ${charge.nomeDestino || charge.tagDestino}.`,
  ];

  if (registeredExpense) {
    lines.push(`Também registrei o gasto total de ${formatMoney(charge.valorTotal)} para você.`);
  }

  if (expenseRegistrationFailed) {
    lines.push('A cobrança foi criada, mas não consegui registrar ou vincular o gasto automaticamente. Confira seus gastos.');
  }

  if (!notified) {
    lines.push('Cobrança criada, mas não consegui notificar a pessoa automaticamente.');
  }

  return lines.join('\n');
}

function responseMessage(charge, status) {
  const verb = status === 'aceita' ? 'aceitou' : 'recusou';

  return `Você ${verb} a cobrança de ${formatMoney(charge.valorCobrado)} referente a ${charge.descricao || 'Cobrança'}.`;
}

function cancelMessage(charge) {
  return `Cobrança cancelada: ${charge.descricao || 'Cobrança'} — ${formatMoney(charge.valorCobrado)}.`;
}

function paidMessage(charge) {
  return [
    'Cobrança marcada como paga ✅',
    `${charge.descricao || 'Cobrança'} — ${formatMoney(charge.valorCobrado)}`,
  ].join('\n');
}

function paidBlockedMessage(status) {
  if (status === 'pendente') {
    return 'Essa cobrança ainda está pendente e não pode ser marcada como paga.';
  }

  return `Essa cobrança está ${status || 'indisponível'} e não pode ser marcada como paga.`;
}

function createChargeService({
  dateUtils,
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
  notificationSender,
  transactionStore: providedTransactionStore,
  idGenerator = () => `cob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
}) {
  const { get, push, ref, set, update } = firebaseOps;
  const transactionStore = providedTransactionStore || createTransactionStore({
    db,
    firebaseOps: { get, push, ref, set },
    monthKey: dateUtils.monthKey,
  });

  function hasValidAccessSession(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
  }

  async function getUserByTag(tag) {
    const snap = await get(ref(db, userPath(tag)));

    return snap.exists() ? snap.val() : null;
  }

  async function listChargesAt(path) {
    const snap = await get(ref(db, path));

    return Object.entries(snap.val() || {})
      .map(([id, charge]) => ({ id, ...charge }))
      .filter((charge) => charge && charge.id);
  }

  async function listReceivedCharges(tag) {
    return sortCharges(await listChargesAt(receivedChargesPath(tag)));
  }

  async function listSentCharges(tag) {
    return sortCharges(await listChargesAt(sentChargesPath(tag)));
  }

  async function notify(phone, message) {
    if (!phone || typeof notificationSender !== 'function') {
      return false;
    }

    try {
      const sent = await notificationSender(phone, message);

      return sent !== false;
    } catch (err) {
      console.error('Erro ao notificar cobrança:', err.response?.data || err.message || err);

      return false;
    }
  }

  async function registerOriginExpense(session, charge) {
    const date = new Date();
    const result = await transactionStore.saveExpense({
      date,
      group: DEFAULT_GROUP,
      phone: session.phone,
      user: charge.tagOrigem,
      expense: {
        desc: charge.descricao || 'Cobrança',
        value: Number(charge.valorTotal || charge.valorCobrado),
        cat: detectarCategoria(charge.descricao || 'Cobrança'),
        date: dateUtils.todayIso(date),
        user: charge.tagOrigem,
        viaBot: true,
        origem: 'texto',
        cobranca: true,
        cobrancaId: charge.id,
        createdAt: now(),
      },
    });

    return {
      id: result?.key || null,
      monthKey: dateUtils.monthKey(date),
    };
  }

  async function writeChargeCopies(charge, extraPaths = {}) {
    await update(ref(db), {
      ...extraPaths,
      [sentChargePath(charge.tagOrigem, charge.id)]: charge,
      [receivedChargePath(charge.tagDestino, charge.id)]: charge,
    });
  }

  async function updateChargeCopies(charge, fields, extraPaths = {}) {
    const data = {
      ...fields,
      updatedAt: now(),
    };

    const multipathUpdate = {
      ...extraPaths,
    };

    Object.entries(data).forEach(([key, value]) => {
      multipathUpdate[`${sentChargePath(charge.tagOrigem, charge.id)}/${key}`] = value;
      multipathUpdate[`${receivedChargePath(charge.tagDestino, charge.id)}/${key}`] = value;
    });

    await update(ref(db), multipathUpdate);
  }

  function addChargeCopyFields(multipathUpdate, charge, fields) {
    const data = {
      ...fields,
      updatedAt: now(),
    };

    Object.entries(data).forEach(([key, value]) => {
      multipathUpdate[`${sentChargePath(charge.tagOrigem, charge.id)}/${key}`] = value;
      multipathUpdate[`${receivedChargePath(charge.tagDestino, charge.id)}/${key}`] = value;
    });
  }

  function linkedExpenseFields(charge, status, timestamp) {
    const fields = {
      cobrancaStatus: status,
      pendente: status === 'pendente' || status === 'aceita',
      cancelado: status === 'recusada' || status === 'cancelada',
      updatedAt: timestamp,
    };

    if (status === 'paga') {
      fields.desc = `Pagamento cobrança - ${charge.descricao || 'Cobrança'}`;
      fields.paidAt = charge.paidAt || timestamp;
    }

    return fields;
  }

  function newLinkedExpense(charge, status, date, timestamp) {
    return {
      desc: status === 'paga'
        ? `Pagamento cobrança - ${charge.descricao || 'Cobrança'}`
        : `Cobrança pendente - ${charge.descricao || 'Cobrança'}`,
      value: Number(charge.valorCobrado),
      cat: 'Outros',
      date: dateUtils.todayIso(date),
      user: charge.tagDestino,
      origem: 'cobranca',
      cobrancaId: charge.id,
      createdAt: charge.createdAt || timestamp,
      ...linkedExpenseFields(charge, status, timestamp),
    };
  }

  function chargeReferenceDate(charge) {
    const value = charge.createdAt || charge.date || '';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);

    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  async function prepareLinkedExpenseUpdate(charge, status) {
    const date = chargeReferenceDate(charge);
    const monthKey = charge.pendenteGastoMes || charge.pagamentoGastoMes || dateUtils.monthKey(date);
    const expenseId = charge.pendenteGastoId || charge.pagamentoGastoId || chargeExpenseId(charge.id);
    const expensePath = chargeExpensePath(charge.tagDestino, monthKey, expenseId);
    const expenseSnap = await get(ref(db, expensePath));
    const existingExpense = expenseSnap.exists() ? expenseSnap.val() : null;

    if (existingExpense && existingExpense.cobrancaId !== charge.id) {
      throw new Error('Já existe outro gasto com o identificador reservado para esta cobrança.');
    }

    const timestamp = now();
    const extraPaths = {};

    if (existingExpense) {
      Object.entries(linkedExpenseFields(charge, status, timestamp)).forEach(([key, value]) => {
        extraPaths[`${expensePath}/${key}`] = value;
      });
    } else {
      extraPaths[expensePath] = newLinkedExpense(charge, status, date, timestamp);
    }

    return {
      chargeFields: {
        pendenteGastoId: expenseId,
        pendenteGastoMes: monthKey,
        ...(status === 'paga' ? {
          pagamentoGastoId: expenseId,
          pagamentoGastoMes: monthKey,
        } : {}),
      },
      created: !existingExpense,
      extraPaths,
    };
  }

  async function updateChargeStatusAndExpense(charge, status, fields = {}) {
    const linkedExpense = await prepareLinkedExpenseUpdate(charge, status);

    await updateChargeCopies(charge, {
      ...fields,
      ...linkedExpense.chargeFields,
      status,
    }, linkedExpense.extraPaths);
  }

  async function createCharge(session, parsedCharge) {
    const tagOrigem = normalizeAccessTag(session.tag || session.user);
    const tagDestino = normalizeAccessTag(parsedCharge.tagDestino);

    if (!tagDestino) {
      return 'Informe uma tag válida de 6 dígitos.';
    }

    if (tagDestino === tagOrigem) {
      return 'Você não pode cobrar sua própria tag.';
    }

    const [originProfile, destinationProfile] = await Promise.all([
      getUserByTag(tagOrigem),
      getUserByTag(tagDestino),
    ]);

    if (!destinationProfile) {
      return 'Não encontrei essa tag. Confira a tag de 6 dígitos da pessoa.';
    }

    const timestamp = now();
    const charge = {
      id: idGenerator(),
      descricao: parsedCharge.descricao,
      valorTotal: parsedCharge.valorTotal,
      valorCobrado: parsedCharge.valorCobrado,
      percentual: parsedCharge.percentual,
      tagOrigem,
      nomeOrigem: session.name || getUserName(originProfile, tagOrigem),
      phoneOrigem: session.phone || getUserPhone(originProfile),
      tagDestino,
      nomeDestino: getUserName(destinationProfile, tagDestino),
      phoneDestino: getUserPhone(destinationProfile),
      status: 'pendente',
      origemGastoId: null,
      origemGastoMes: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      respondedAt: null,
    };
    let expenseRegistrationFailed = false;
    let registeredExpense = false;

    try {
      const linkedExpense = await prepareLinkedExpenseUpdate(charge, 'pendente');

      Object.assign(charge, linkedExpense.chargeFields);
      await writeChargeCopies(charge, linkedExpense.extraPaths);
    } catch (err) {
      console.error('Erro ao criar cópias da cobrança:', err.response?.data || err.message || err);

      return 'Não consegui criar a cobrança com segurança agora. Tente novamente.';
    }

    if (parsedCharge.registerExpense) {
      try {
        const expenseRef = await registerOriginExpense(session, charge);
        const originFields = {
          origemGastoId: expenseRef.id,
          origemGastoMes: expenseRef.monthKey,
        };

        await updateChargeCopies(charge, originFields);
        Object.assign(charge, originFields);
        registeredExpense = true;
      } catch (err) {
        console.error('Erro ao registrar ou vincular gasto da cobrança:', err.response?.data || err.message || err);
        expenseRegistrationFailed = true;
      }
    }

    const notified = await notify(charge.phoneDestino, createNotificationMessage(charge));

    return createdChargeMessage(charge, registeredExpense, notified, expenseRegistrationFailed);
  }

  async function listCharges(session, scope) {
    const tag = normalizeAccessTag(session.tag || session.user);

    if (scope === 'received') {
      return listReceivedMessage(await listReceivedCharges(tag));
    }

    if (scope === 'sent') {
      return listSentMessage(await listSentCharges(tag));
    }

    const [received, sent] = await Promise.all([
      listReceivedCharges(tag),
      listSentCharges(tag),
    ]);

    return listAllMessage(received, sent);
  }

  async function syncReceivedCharges(session) {
    const tag = normalizeAccessTag(session.tag || session.user);
    const charges = await listReceivedCharges(tag);
    const multipathUpdate = {};
    let added = 0;

    for (const charge of charges) {
      if (!['pendente', 'aceita', 'paga'].includes(charge.status)) {
        continue;
      }

      const destinationTag = normalizeAccessTag(charge.tagDestino);
      const originTag = normalizeAccessTag(charge.tagOrigem);

      if ((destinationTag && destinationTag !== tag) || !originTag) {
        continue;
      }

      const safeCharge = {
        ...charge,
        tagDestino: tag,
        tagOrigem: originTag,
      };
      const linkedExpense = await prepareLinkedExpenseUpdate(safeCharge, safeCharge.status);

      Object.assign(multipathUpdate, linkedExpense.extraPaths);
      addChargeCopyFields(multipathUpdate, safeCharge, linkedExpense.chargeFields);

      if (linkedExpense.created) {
        added++;
      }
    }

    if (Object.keys(multipathUpdate).length) {
      await update(ref(db), multipathUpdate);
    }

    return `Sincronização concluída ✅ ${added} cobrança(s) adicionada(s) aos gastos.`;
  }

  async function respondToCharge(session, index, status) {
    const tag = normalizeAccessTag(session.tag || session.user);
    const pending = (await listReceivedCharges(tag)).filter((charge) => charge.status === 'pendente');
    const selected = pending[index - 1];

    if (!selected) {
      return 'Não encontrei cobranças pendentes para responder.';
    }

    try {
      await updateChargeStatusAndExpense(selected, status, {
        respondedAt: now(),
      });
    } catch (err) {
      console.error('Erro ao responder cobrança:', err.response?.data || err.message || err);

      return 'Não consegui atualizar as duas cópias da cobrança. Tente novamente.';
    }

    await notify(
      selected.phoneOrigem,
      status === 'aceita' ? acceptedNotificationMessage(selected) : declinedNotificationMessage(selected)
    );

    return responseMessage(selected, status);
  }

  async function cancelCharge(session, command) {
    const tag = normalizeAccessTag(session.tag || session.user);
    const pending = (await listSentCharges(tag)).filter((charge) => charge.status === 'pendente');
    let selected = command.index ? pending[command.index - 1] : null;

    if (!selected && command.query) {
      const query = normalizeText(command.query);
      const candidates = pending.filter((charge) =>
        normalizeText(`${charge.descricao || ''} ${charge.nomeDestino || ''} ${charge.tagDestino || ''}`).includes(query)
      );

      if (candidates.length > 1) {
        return [
          'Encontrei mais de uma cobrança enviada:',
          ...candidates.map((charge, index) => pendingChargeLine(charge, index, 'sent')),
          '',
          'Envie o número. Exemplo: cancelar cobrança 1',
        ].join('\n');
      }

      selected = candidates[0] || null;
    }

    if (!selected) {
      return 'Não encontrei cobranças pendentes para cancelar.';
    }

    try {
      await updateChargeStatusAndExpense(selected, 'cancelada', {
        respondedAt: now(),
      });
    } catch (err) {
      console.error('Erro ao cancelar cobrança:', err.response?.data || err.message || err);

      return 'Não consegui atualizar as duas cópias da cobrança. Tente novamente.';
    }

    await notify(selected.phoneDestino, canceledNotificationMessage(selected));

    return cancelMessage(selected);
  }

  async function selectChargeForPayment(tag, command) {
    if (command.scope === 'received') {
      return {
        charge: (await listReceivedCharges(tag))[command.index - 1] || null,
        type: 'received',
      };
    }

    if (command.scope === 'sent') {
      return {
        charge: (await listSentCharges(tag))[command.index - 1] || null,
        type: 'sent',
      };
    }

    const [received, sent] = await Promise.all([
      listReceivedCharges(tag),
      listSentCharges(tag),
    ]);
    const receivedCharge = received[command.index - 1] || null;
    const sentCharge = sent[command.index - 1] || null;

    if (receivedCharge && sentCharge) {
      return {
        ambiguous: true,
      };
    }

    return {
      charge: receivedCharge || sentCharge,
      type: receivedCharge ? 'received' : 'sent',
    };
  }

  async function markChargeAsPaid(session, command) {
    const tag = normalizeAccessTag(session.tag || session.user);
    const selected = await selectChargeForPayment(tag, command);

    if (selected.ambiguous) {
      return 'Essa cobrança pode estar nas recebidas ou enviadas. Liste primeiro com: cobranças recebidas ou cobranças enviadas.';
    }

    if (!selected.charge) {
      return 'Não encontrei essa cobrança. Liste primeiro com: cobranças recebidas ou cobranças enviadas.';
    }

    if (selected.charge.status !== 'aceita') {
      return paidBlockedMessage(selected.charge.status);
    }

    try {
      await updateChargeStatusAndExpense(selected.charge, 'paga', {
        paidAt: now(),
      });
    } catch (err) {
      console.error('Erro ao marcar cobrança como paga:', err.response?.data || err.message || err);

      return 'Não consegui marcar a cobrança como paga nem atualizar o gasto com segurança. Tente novamente.';
    }

    if (selected.type === 'received') {
      await notify(
        selected.charge.phoneOrigem,
        paidNotificationMessage(selected.charge, selected.charge.nomeDestino || selected.charge.tagDestino)
      );
    } else {
      await notify(
        selected.charge.phoneDestino,
        paidNotificationMessage(selected.charge, selected.charge.nomeOrigem || selected.charge.tagOrigem)
      );
    }

    return paidMessage(selected.charge);
  }

  async function processarCobranca(session, text) {
    const command = parseChargeCommand(text);

    if (!command) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return CHARGE_REQUIRED_MESSAGE;
    }

    if (command.error) {
      return command.error;
    }

    if (command.action === 'create') {
      return await createCharge(session, command.charge);
    }

    if (command.action === 'list') {
      return await listCharges(session, command.scope);
    }

    if (command.action === 'sync') {
      try {
        return await syncReceivedCharges(session);
      } catch (err) {
        console.error('Erro ao sincronizar cobranças:', err.response?.data || err.message || err);

        return 'Não consegui sincronizar as cobranças com segurança agora. Tente novamente.';
      }
    }

    if (command.action === 'accept') {
      return await respondToCharge(session, command.index, 'aceita');
    }

    if (command.action === 'decline') {
      return await respondToCharge(session, command.index, 'recusada');
    }

    if (command.action === 'cancel') {
      return await cancelCharge(session, command);
    }

    if (command.action === 'mark_paid') {
      return await markChargeAsPaid(session, command);
    }

    return null;
  }

  return {
    processarCobranca,
  };
}

module.exports = {
  CHARGE_REQUIRED_MESSAGE,
  createChargeService,
  parseChargeCommand,
};
