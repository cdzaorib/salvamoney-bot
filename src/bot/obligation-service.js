'use strict';

const { detectarCategoria } = require('./categories');
const { computeCycle, isoFrom, parseIso } = require('./card-cycle');
const {
  ESTADOS,
  FINAL_STATES,
  baseEstado,
  canTransition,
  estadoDe,
  isOpen,
  isPayable,
  label,
  legacyStatusFor,
  saldoCents,
  storedEstado,
  valorCobradoCents,
  valorPagoCents,
} = require('./charge-state');
const {
  firstName,
  formatCents,
  formatDateBr,
  fromCents,
  normalizedCommand,
  parsePositiveMoney,
  toCents,
} = require('./finance-utils');
const { normalizeNickname } = require('./friend-matcher');
const { sessionTag, userPath } = require('./user-data');

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MONEY = '(?:r\\$\\s*)?\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|(?:r\\$\\s*)?\\d+(?:[.,]\\d{1,2})?';

function sentPath(tag, id) {
  return `${userPath(tag)}/cobrancasEnviadas/${id}`;
}

function receivedPath(tag, id) {
  return `${userPath(tag)}/cobrancasRecebidas/${id}`;
}

function chargeExpenseId(chargeId) {
  return `cob_${String(chargeId || '').replace(/[.#$[\]/]/g, '_')}`;
}

function sortByCreation(a, b) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''));
}

function chargeTitle(charge) {
  const suffix = Number(charge.parcelaTotal) > 1 ? ` (${charge.parcelaNum}/${charge.parcelaTotal})` : '';

  return `${charge.descricao || 'Cobrança'}${suffix}`;
}

// ─── PARSER ───────────────────────────────────────────────
function parseIndex(command) {
  const match = command.match(/\b(?:cobranca|#)\s*(\d{1,3})\b/) || command.match(/#(\d{1,3})\b/);

  return match ? Number(match[1]) : null;
}

function parseAmount(command) {
  const cleaned = command.replace(/\b(?:cobranca|#)\s*\d{1,3}\b/g, ' ');
  const match = cleaned.match(new RegExp(`(?:^|\\s)(r\\$\\s*\\d[\\d.,]*|\\d[\\d.,]*\\s*(?:reais|real)|\\d+,\\d{1,2}|\\d+\\.\\d{1,2})(?=\\s|$)`));

  if (!match) {
    return null;
  }

  return parsePositiveMoney(match[1].replace(/\s*(reais|real)$/, ''));
}

function parseReason(original) {
  const match = String(original || '').match(/\b(?:motivo|porque|pois)\s*:?\s*(.+)$/i);

  return match ? match[1].trim().slice(0, 140) : '';
}

function parsePaymentForms(command, { bareVerbs, connectors, friendVerbs }) {
  let match = command.match(new RegExp(`^${bareVerbs}(?:\\s+(?:a\\s+)?cobranca)?$`));

  if (match) {
    return { amount: null, index: null, name: null };
  }

  match = command.match(new RegExp(`^${bareVerbs}\\s+(?:a\\s+)?(cobranca\\s+|#)?(\\d{1,3})$`));

  if (match) {
    // "recebi 2" (legado) indica o número da cobrança; se não existir, vira valor.
    return { ambiguousNumber: !match[1], amount: null, index: Number(match[2]), name: null };
  }

  match = command.match(new RegExp(`^${bareVerbs}\\s+(${MONEY})(?:\\s+reais)?(?:\\s+(?:da|na|de)\\s+cobranca\\s+(\\d{1,3}))?$`));

  if (match && /r\$|[.,]\d{1,2}$|reais/.test(match[0]) || (match && match[2])) {
    return { amount: parsePositiveMoney(match[1]), index: match[2] ? Number(match[2]) : null, name: null };
  }

  match = command.match(new RegExp(`^${friendVerbs}(?:\\s+(${MONEY})(?:\\s+reais)?)?\\s+${connectors}\\s+(.+)$`));

  if (match && !/\d/.test(match[2])) {
    return { amount: match[1] ? parsePositiveMoney(match[1]) : null, index: null, name: match[2] };
  }

  return null;
}

function parseObligationCommand(text) {
  const original = String(text || '').trim();
  const command = normalizedCommand(original);
  let match;

  if (/^(cobrancas|minhas cobrancas|pendencias|minhas pendencias|a receber|a pagar|valores a receber|valores a pagar|o que tenho a receber|o que tenho a pagar|quem me deve|quanto me devem|quanto eu devo)$/.test(command)) {
    return { action: 'list' };
  }

  if (/^cobrancas recebidas$/.test(command)) {
    return { action: 'list', role: 'devedor' };
  }

  if (/^cobrancas enviadas$/.test(command)) {
    return { action: 'list', role: 'credor' };
  }

  // Comando antigo "marcar cobrança N como paga": segue o fluxo de confirmação.
  match = command.match(/^marcar\s+(?:a\s+)?cobranca\s+(\d{1,3})\s+como\s+paga$/) ||
    command.match(/^marcar\s+como\s+paga\s+(\d{1,3})$/);

  if (match) {
    return { action: 'mark_paid_auto', index: Number(match[1]) };
  }

  match = command.match(/^(?:cobrancas|extrato|pendencias|historico)\s+com\s+(?:o\s+|a\s+)?(.+)$/);

  if (match) {
    return { action: 'list_with', name: match[1] };
  }

  match = command.match(/^(?:cobrar novamente|lembrar|cobrar de novo|reenviar lembrete)\s+(?:o\s+|a\s+|para\s+)?(.+)$/);

  if (match) {
    return { action: 'remind', index: parseIndex(match[1]), name: parseIndex(match[1]) ? null : match[1] };
  }

  if (/^silenciar\s+lembretes?\b/.test(command)) {
    return { action: 'silence', index: parseIndex(command), value: true };
  }

  if (/^(reativar|ativar)\s+lembretes?\b/.test(command)) {
    return { action: 'silence', index: parseIndex(command), value: false };
  }

  if (/^(nao recebi|ainda nao recebi)\b/.test(command)) {
    return { action: 'deny_receipt', index: parseIndex(command) };
  }

  match = command.match(/^(aprovar|aceitar)\s+(?:a\s+)?sugestao(?:\s+(?:da\s+)?(?:cobranca\s+)?(\d{1,3}))?$/);

  if (match) {
    return { action: 'approve_suggestion', index: match[2] ? Number(match[2]) : null };
  }

  match = command.match(/^manter\s+(?:a\s+)?cobranca\s+(\d{1,3})$/);

  if (match) {
    return { action: 'keep', index: Number(match[1]) };
  }

  match = command.match(/^aceitar\s+(?:a\s+)?cobranca\s+(\d{1,3})$/);

  if (match) {
    return { action: 'accept', index: Number(match[1]) };
  }

  match = command.match(/^recusar\s+(?:a\s+)?cobranca\s+(\d{1,3})\b/);

  if (match) {
    return { action: 'refuse', index: Number(match[1]), reason: parseReason(original) };
  }

  match = command.match(/^contestar(?:\s+(?:a\s+)?cobranca\s+(\d{1,3}))?\b/);

  if (match) {
    const suggested = command.match(new RegExp(`\\b(?:valor|sugiro|sugestao|seria|era)\\s*(?:de\\s*)?(${MONEY})`));

    return {
      action: 'contest',
      index: match[1] ? Number(match[1]) : null,
      reason: parseReason(original),
      suggested: suggested ? parsePositiveMoney(suggested[1]) : null,
    };
  }

  match = command.match(/^cancelar\s+(?:a\s+)?cobranca\s+(\d{1,3})$/);

  if (match) {
    return { action: 'cancel', index: Number(match[1]) };
  }

  // Devedor informa pagamento (formas explícitas para não confundir com gastos).
  const payment = parsePaymentForms(command, {
    friendVerbs: '(?:ja\\s+)?(?:paguei|fiz o pix|mandei o pix|mandei|transferi)',
    bareVerbs: '(?:ja\\s+)?(?:paguei|fiz o pix|mandei o pix|transferi)',
    connectors: '(?:pro|pra|para o|para a|para|ao|a|o)',
  });

  if (payment) {
    return { action: 'inform_payment', ...payment, raw: original };
  }

  // Credor confirma recebimento.
  const receipt = parsePaymentForms(command, {
    friendVerbs: '(?:ja\\s+)?recebi',
    bareVerbs: '(?:ja\\s+)?recebi',
    connectors: '(?:do|da|de)',
  });

  if (receipt) {
    return { action: 'confirm_receipt', ...receipt, raw: original };
  }

  match = command.match(new RegExp(`^(.+?)\\s+(?:ja\\s+)?me\\s+(?:pagou|pagaram|transferiu|mandou|fez o pix)(?:\\s+(${MONEY})(?:\\s+reais)?)?$`));

  if (match) {
    return {
      action: 'confirm_receipt',
      amount: match[2] ? parsePositiveMoney(match[2]) : null,
      index: null,
      name: match[1].replace(/^(o|a)\s+/, ''),
      raw: original,
    };
  }

  return null;
}

// ─── SERVIÇO ──────────────────────────────────────────────
function createObligationService({
  dateUtils,
  db,
  firebaseOps,
  friendService,
  idGenerator = () => `ob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
  notify,
  now = () => new Date(),
  userData,
}) {
  const { get, ref, transaction, update } = firebaseOps;

  function today() {
    return dateUtils.todayIso(now());
  }

  async function readCharges(path) {
    const snap = await get(ref(db, path));

    return Object.entries(snap.val() || {})
      .filter(([, charge]) => charge && typeof charge === 'object')
      .map(([id, charge]) => ({ ...charge, id: charge.id || id }));
  }

  async function listCharges(tag) {
    const [sent, received] = await Promise.all([
      readCharges(`${userPath(tag)}/cobrancasEnviadas`),
      readCharges(`${userPath(tag)}/cobrancasRecebidas`),
    ]);

    return {
      received: received.filter((charge) => charge.tagDestino === undefined || charge.tagDestino === tag).sort(sortByCreation),
      sent: sent.filter((charge) => charge.tagOrigem === undefined || charge.tagOrigem === tag).sort(sortByCreation),
    };
  }

  async function nicknameMap(tag) {
    const friends = friendService ? await friendService.listFriends(tag) : [];

    return new Map(friends.filter((friend) => friend.apelido).map((friend) => [friend.tag, friend.apelido]));
  }

  function counterpartName(charge, role, nicknames) {
    const tag = role === 'devedor' ? charge.tagOrigem : charge.tagDestino;
    const name = role === 'devedor' ? charge.nomeOrigem : charge.nomeDestino;

    return nicknames.get(tag) || firstName(name) || `tag ${tag}`;
  }

  // Lista numerada única: a pagar, a receber e aguardando fechamento.
  async function numberedOpen(tag) {
    const { received, sent } = await listCharges(tag);
    const day = today();
    const entries = [
      ...received.filter((charge) => isOpen(charge, day)).map((charge) => ({ charge, role: 'devedor' })),
      ...sent.filter((charge) => isOpen(charge, day)).map((charge) => ({ charge, role: 'credor' })),
    ];
    const waiting = entries.filter(({ charge }) => estadoDe(charge, day) === ESTADOS.AGUARDANDO_FECHAMENTO);
    const payable = entries.filter(({ charge }) => estadoDe(charge, day) !== ESTADOS.AGUARDANDO_FECHAMENTO);
    const ordered = [
      ...payable.filter((entry) => entry.role === 'devedor'),
      ...payable.filter((entry) => entry.role === 'credor'),
      ...waiting,
    ];

    return ordered.map((entry, index) => ({ ...entry, estado: estadoDe(entry.charge, day), index: index + 1 }));
  }

  async function indexFor(tag, chargeId) {
    return (await numberedOpen(tag)).find((entry) => entry.charge.id === chargeId)?.index || null;
  }

  // ─── ESCRITA ATÔMICA NAS DUAS CÓPIAS ───────────────────
  function copyFields(multipath, charge, fields) {
    Object.entries(fields).forEach(([key, value]) => {
      multipath[`${sentPath(charge.tagOrigem, charge.id)}/${key}`] = value;
      multipath[`${receivedPath(charge.tagDestino, charge.id)}/${key}`] = value;
    });
  }

  function linkedDate(charge) {
    return Number(charge.parcelaTotal) > 1 && charge.vencimento ? charge.vencimento : (charge.data || today());
  }

  function monthKeyForIso(iso) {
    return dateUtils.monthKey(new Date(`${iso}T12:00:00.000Z`));
  }

  function newLinkedExpense(charge, estado, timestamp) {
    const legacy = legacyStatusFor(estado);
    const date = linkedDate(charge);

    return {
      cancelado: legacy === 'recusada' || legacy === 'cancelada',
      cat: detectarCategoria(charge.descricao || '') || 'Outros',
      cobrancaId: charge.id,
      cobrancaStatus: legacy,
      createdAt: charge.createdAt || timestamp,
      date,
      desc: legacy === 'paga'
        ? `Pagamento cobrança - ${chargeTitle(charge)}`
        : `Cobrança ${legacy === 'aceita' ? 'aceita' : 'pendente'} - ${chargeTitle(charge)}`,
      origem: 'cobranca',
      pendente: legacy === 'pendente' || legacy === 'aceita',
      updatedAt: timestamp,
      user: charge.tagDestino,
      value: fromCents(valorCobradoCents(charge)),
    };
  }

  // Mantém o gasto vinculado do devedor (mesma convenção das cobranças antigas).
  async function linkedExpenseUpdate(multipath, charge, estado, { value } = {}) {
    const timestamp = now().toISOString();
    const monthKey = charge.pendenteGastoMes || monthKeyForIso(linkedDate(charge));
    const expenseId = charge.pendenteGastoId || chargeExpenseId(charge.id);
    const path = `${userPath(charge.tagDestino)}/gastos/${monthKey}/${expenseId}`;
    const snap = await get(ref(db, path));
    const existing = snap.exists() ? snap.val() : null;
    const legacy = legacyStatusFor(estado);

    if (existing && existing.cobrancaId && existing.cobrancaId !== charge.id) {
      throw new Error('gasto vinculado pertence a outra cobrança');
    }

    if (!existing) {
      multipath[path] = newLinkedExpense({ ...charge, ...(value !== undefined ? { valorCobrado: value } : {}) }, estado, timestamp);
    } else {
      multipath[`${path}/cobrancaStatus`] = legacy;
      multipath[`${path}/pendente`] = legacy === 'pendente' || legacy === 'aceita';
      multipath[`${path}/cancelado`] = legacy === 'recusada' || legacy === 'cancelada';
      multipath[`${path}/updatedAt`] = timestamp;

      if (legacy === 'paga') {
        multipath[`${path}/desc`] = `Pagamento cobrança - ${chargeTitle(charge)}`;
        multipath[`${path}/paidAt`] = timestamp;
      }

      if (value !== undefined) {
        multipath[`${path}/value`] = value;
      }
    }

    copyFields(multipath, charge, {
      pendenteGastoId: expenseId,
      pendenteGastoMes: monthKey,
    });
  }

  async function applyState(charge, estado, fields = {}, options = {}) {
    const multipath = {};
    const timestamp = now().toISOString();

    copyFields(multipath, charge, {
      ...fields,
      estado,
      status: legacyStatusFor(estado),
      updatedAt: timestamp,
    });

    if (legacyStatusFor(estado) !== legacyStatusFor(storedEstado(charge)) || options.value !== undefined ||
      !charge.pendenteGastoId) {
      await linkedExpenseUpdate(multipath, { ...charge, ...fields }, estado, options);
    }

    await update(ref(db), multipath);
  }

  // ─── CRIAÇÃO (usada pelas divisões) ─────────────────────
  function buildCharge({
    cardId = null,
    cents,
    creditor,
    data,
    debtor,
    descricao,
    divisaoId = null,
    estado,
    fechamentoPrevisto = null,
    grupoParcelasId = null,
    id,
    meioPagamento = null,
    parcelaNum = null,
    parcelaTotal = null,
    valorTotal = null,
    vencimento = null,
  }) {
    const timestamp = now().toISOString();
    const value = fromCents(cents);

    return {
      cartaoId: cardId,
      createdAt: timestamp,
      data,
      descricao,
      divisaoId,
      estado,
      fechamentoPrevisto,
      grupoParcelasId,
      id,
      meioPagamento,
      modelo: 2,
      nomeDestino: debtor.firstName,
      nomeOrigem: creditor.firstName,
      origem: divisaoId ? 'divisao' : 'cobranca_amigo',
      parcelaNum,
      parcelaTotal,
      percentual: null,
      respondedAt: null,
      status: legacyStatusFor(estado),
      tagDestino: debtor.tag,
      tagOrigem: creditor.tag,
      updatedAt: timestamp,
      valorCobrado: value,
      valorOriginal: value,
      valorPago: 0,
      valorTotal: valorTotal === null ? value : valorTotal,
      vencimento,
    };
  }

  function addChargeCreation(multipath, charge) {
    const expenseId = chargeExpenseId(charge.id);
    const monthKey = monthKeyForIso(linkedDate(charge));
    const record = { ...charge, pendenteGastoId: expenseId, pendenteGastoMes: monthKey };

    multipath[sentPath(charge.tagOrigem, charge.id)] = record;
    multipath[receivedPath(charge.tagDestino, charge.id)] = record;
    multipath[`${userPath(charge.tagDestino)}/gastos/${monthKey}/${expenseId}`] =
      newLinkedExpense(record, charge.estado, charge.createdAt);

    return record;
  }

  // ─── MENSAGENS ─────────────────────────────────────────
  function actionsLine(index) {
    return index
      ? `Responda: paguei cobrança ${index} · contestar cobrança ${index} · silenciar lembretes cobrança ${index}`
      : 'Responda: paguei · contestar · silenciar lembretes';
  }

  async function debtorNotice(charge, title, extraLines = []) {
    const contact = await userData.getContact(charge.tagDestino);
    const index = await indexFor(charge.tagDestino, charge.id);
    const creditorName = (await nicknameMap(charge.tagDestino)).get(charge.tagOrigem) || firstName(charge.nomeOrigem) || 'Seu amigo';
    const settled = saldoCents(charge) === 0 || FINAL_STATES.has(storedEstado(charge));
    const lines = [
      title,
      settled
        ? `${chargeTitle(charge)} — ${formatCents(valorCobradoCents(charge))} com ${creditorName}`
        : `${chargeTitle(charge)} — saldo ${formatCents(saldoCents(charge))} para ${creditorName}`,
      ...extraLines,
      settled ? '' : actionsLine(index),
    ];

    return await notify(contact?.phone, lines.filter(Boolean).join('\n'));
  }

  async function creditorNotice(charge, lines) {
    const contact = await userData.getContact(charge.tagOrigem);

    return await notify(contact?.phone, lines.filter(Boolean).join('\n'));
  }

  function listLine(entry, nicknames) {
    const { charge, estado, index, role } = entry;
    const person = counterpartName(charge, role, nicknames);
    const total = valorCobradoCents(charge);
    const balance = saldoCents(charge);
    const amount = balance !== total
      ? `saldo ${formatCents(balance)} de ${formatCents(total)}`
      : formatCents(total);
    const direction = role === 'devedor' ? `para ${person}` : `de ${person}`;
    const extras = [];

    if (estado === ESTADOS.AGUARDANDO_FECHAMENTO && charge.fechamentoPrevisto) {
      extras.push(`fecha ~${formatDateBr(charge.fechamentoPrevisto)}`);
    }

    if (charge.vencimento && estado !== ESTADOS.AGUARDANDO_FECHAMENTO) {
      extras.push(`vence ${formatDateBr(charge.vencimento)}`);
    }

    if (estado === ESTADOS.INFORMADO && charge.pagamentoInformado?.valor) {
      extras.push(`informado ${formatCents(toCents(charge.pagamentoInformado.valor))}`);
    }

    if (estado === ESTADOS.CONTESTADA && charge.contestacao?.valorSugerido) {
      extras.push(`sugestão ${formatCents(toCents(charge.contestacao.valorSugerido))}`);
    }

    return `${index}. ${chargeTitle(charge)} — ${amount} ${direction} — ${label(estado)}${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
  }

  async function listMessage(session, { onlyRole = null, withTag = null } = {}) {
    const tag = sessionTag(session);

    await processClosingsFor(tag, { notifyParties: false });

    const nicknames = await nicknameMap(tag);
    const entries = (await numberedOpen(tag)).filter(({ charge, role }) =>
      (!withTag || (role === 'devedor' ? charge.tagOrigem : charge.tagDestino) === withTag) &&
      (!onlyRole || role === onlyRole));

    if (!entries.length) {
      return withTag
        ? 'Não há cobranças em aberto entre vocês.'
        : 'Você não tem cobranças em aberto ✅';
    }

    const toPay = entries.filter((entry) => entry.role === 'devedor' && entry.estado !== ESTADOS.AGUARDANDO_FECHAMENTO);
    const toReceive = entries.filter((entry) => entry.role === 'credor' && entry.estado !== ESTADOS.AGUARDANDO_FECHAMENTO);
    const waiting = entries.filter((entry) => entry.estado === ESTADOS.AGUARDANDO_FECHAMENTO);
    const lines = ['📋 Cobranças em aberto'];

    if (toPay.length) {
      lines.push('', `A pagar (${formatCents(toPay.reduce((sum, entry) => sum + saldoCents(entry.charge), 0))}):`, ...toPay.map((entry) => listLine(entry, nicknames)));
    }

    if (toReceive.length) {
      lines.push('', `A receber (${formatCents(toReceive.reduce((sum, entry) => sum + saldoCents(entry.charge), 0))}):`, ...toReceive.map((entry) => listLine(entry, nicknames)));
    }

    if (waiting.length) {
      lines.push('', 'Aguardando fechamento da fatura:', ...waiting.map((entry) => `${listLine(entry, nicknames)} (${entry.role === 'devedor' ? 'você paga' : 'você recebe'})`));
    }

    lines.push('', 'Ex.: paguei cobrança 1 · recebi cobrança 2 · contestar cobrança 1 valor 50 · cobrar novamente cobrança 2');

    return lines.join('\n');
  }

  // ─── SELEÇÃO ───────────────────────────────────────────
  async function resolveAmbiguousNumber(tag, command) {
    if (!command.ambiguousNumber) {
      return command;
    }

    const all = await numberedOpen(tag);

    return all.some((entry) => entry.index === command.index)
      ? command
      : { ...command, amount: command.index, ambiguousNumber: false, index: null };
  }

  async function selectEntry(tag, command, role, filter = () => true) {
    const entries = (await numberedOpen(tag)).filter((entry) => entry.role === role && filter(entry));

    if (command.index) {
      const all = await numberedOpen(tag);
      const selected = all.find((entry) => entry.index === command.index);

      if (!selected) {
        return { error: 'Não encontrei essa cobrança. Veja a lista: cobranças' };
      }

      if (selected.role !== role) {
        return {
          error: role === 'devedor'
            ? 'Essa cobrança é um valor a receber, não a pagar. Veja: cobranças'
            : 'Essa cobrança é um valor a pagar, não a receber. Veja: cobranças',
        };
      }

      return { entry: selected };
    }

    let candidates = entries;

    if (command.name) {
      const friends = friendService ? await friendService.listFriends(tag) : [];
      const normalized = normalizeNickname(command.name);
      const withoutArticle = normalized.replace(/^(o|a)\s+/, '');
      const friend = friends.find((item) => item.apelido &&
        [normalized, withoutArticle].includes(normalizeNickname(item.apelido)));

      if (!friend) {
        return { none: true, unknownName: true };
      }

      candidates = entries.filter(({ charge }) => (role === 'devedor' ? charge.tagOrigem : charge.tagDestino) === friend.tag);
    }

    if (candidates.length === 1) {
      return { entry: candidates[0] };
    }

    if (!candidates.length) {
      return { error: null, none: true };
    }

    const nicknames = await nicknameMap(tag);

    return {
      error: [
        'Encontrei mais de uma cobrança. Qual delas?',
        ...candidates.slice(0, 8).map((entry) => listLine(entry, nicknames)),
        '',
        'Responda usando o número. Ex.: cobrança 1',
      ].join('\n').replace('Ex.: cobrança 1', role === 'devedor' ? 'Ex.: paguei cobrança 1' : 'Ex.: recebi cobrança 1'),
    };
  }

  // ─── AÇÕES DO DEVEDOR ──────────────────────────────────
  async function informPayment(session, rawCommand) {
    const tag = sessionTag(session);
    const command = await resolveAmbiguousNumber(tag, rawCommand);
    const selection = await selectEntry(tag, command, 'devedor',
      ({ charge, estado }) => isPayable(charge, today()) || estado === ESTADOS.INFORMADO);

    if (selection.unknownName) {
      return null;
    }

    if (selection.none) {
      return command.index || command.amount || command.name
        ? 'Não encontrei cobrança em aberto para informar pagamento. Veja: cobranças'
        : null;
    }

    if (selection.error) {
      return selection.error;
    }

    const { charge, estado } = selection.entry;

    if (estado === ESTADOS.INFORMADO) {
      return 'Você já informou esse pagamento. Aguardando a confirmação de quem recebeu.';
    }

    if (!isPayable(charge, today())) {
      return `Essa cobrança está ${label(estado)} e não aceita pagamento agora.`;
    }

    const balance = saldoCents(charge);
    const amount = command.amount ? toCents(command.amount) : balance;

    if (amount > balance) {
      return `O saldo dessa cobrança é ${formatCents(balance)}. Informe um valor até esse limite.`;
    }

    // Valor digitado sem cobrança explícita é confirmado antes de avisar o credor.
    if (command.amount && !command.index && !command.confirmed) {
      return {
        message: [
          `Informar pagamento de ${formatCents(amount)} em "${chargeTitle(charge)}" (saldo ${formatCents(balance)})?`,
          'Responda SIM para avisar quem recebe ou CANCELAR.',
        ].join('\n'),
        pendingAction: {
          amount: fromCents(amount),
          chargeId: charge.id,
          tipo: 'inform_payment',
        },
      };
    }

    return await registerInformedPayment(tag, charge, amount);
  }

  async function registerInformedPayment(tag, charge, amount) {
    const current = estadoDe(charge, today());

    if (!canTransition(current, ESTADOS.INFORMADO) && current !== ESTADOS.INFORMADO) {
      return `Essa cobrança está ${label(current)} e não aceita pagamento agora.`;
    }

    const timestamp = now().toISOString();

    await applyState(charge, ESTADOS.INFORMADO, {
      estadoAnterior: current,
      pagamentoInformado: {
        em: timestamp,
        valor: fromCents(amount),
      },
    });

    const creditorIndex = await indexFor(charge.tagOrigem, charge.id);
    const debtorName = (await nicknameMap(charge.tagOrigem)).get(charge.tagDestino) || firstName(charge.nomeDestino) || 'Seu amigo';

    await creditorNotice(charge, [
      `💸 ${debtorName} informou pagamento de ${formatCents(amount)}.`,
      `${chargeTitle(charge)} — saldo atual ${formatCents(saldoCents(charge))}`,
      `Confirme quando o dinheiro chegar: recebi cobrança ${creditorIndex || ''}`.trim(),
      `Se não chegou: não recebi cobrança ${creditorIndex || ''}`.trim(),
    ]);

    return [
      `Pagamento de ${formatCents(amount)} informado ✅`,
      'Avisei quem recebe. A cobrança só encerra depois da confirmação.',
    ].join('\n');
  }

  async function withSelectedReceived(session, command, allowedStates, handler) {
    const tag = sessionTag(session);
    const selection = await selectEntry(tag, command, 'devedor', ({ estado }) => allowedStates.includes(estado));

    if (selection.none) {
      return 'Não encontrei essa cobrança entre as que você deve. Veja: cobranças';
    }

    if (selection.error) {
      return selection.error;
    }

    if (!allowedStates.includes(selection.entry.estado)) {
      return `Essa cobrança está ${label(selection.entry.estado)} e não permite essa ação.`;
    }

    return await handler(selection.entry.charge, selection.entry.estado);
  }

  async function acceptCharge(session, command) {
    return await withSelectedReceived(session, command, [ESTADOS.AGUARDANDO_ACEITE, ESTADOS.CONTESTADA], async (charge) => {
      const timestamp = now().toISOString();
      const next = charge.cartaoId && charge.fechamentoPrevisto
        ? baseEstado(charge, today())
        : ESTADOS.ACEITA;

      await applyState(charge, next, { aceitaEm: timestamp, respondedAt: timestamp });
      await creditorNotice(charge, [
        `${firstName(charge.nomeDestino) || 'Seu amigo'} aceitou a cobrança de ${formatCents(saldoCents(charge))} — ${chargeTitle(charge)} ✅`,
      ]);

      return `Cobrança aceita ✅ ${chargeTitle(charge)} — ${formatCents(saldoCents(charge))}.`;
    });
  }

  async function refuseCharge(session, command) {
    return await withSelectedReceived(session, command,
      [ESTADOS.AGUARDANDO_ACEITE, ESTADOS.AGUARDANDO_FECHAMENTO, ESTADOS.CONTESTADA],
      async (charge) => {
        const timestamp = now().toISOString();

        await applyState(charge, ESTADOS.RECUSADA, {
          motivoRecusa: command.reason || null,
          respondedAt: timestamp,
        });

        const creditorIndexName = (await nicknameMap(charge.tagOrigem)).get(charge.tagDestino) || firstName(charge.nomeDestino) || 'Seu amigo';

        await creditorNotice(charge, [
          `${creditorIndexName} recusou a cobrança de ${formatCents(valorCobradoCents(charge))} — ${chargeTitle(charge)}.`,
          command.reason ? `Motivo: ${command.reason}` : '',
          'Nada foi apagado. Se for o caso, crie uma nova cobrança com outro valor.',
        ]);

        return `Cobrança recusada.${command.reason ? ' Motivo registrado.' : ''} Avisei quem enviou.`;
      });
  }

  async function contestCharge(session, command) {
    return await withSelectedReceived(session, command,
      [ESTADOS.AGUARDANDO_ACEITE, ESTADOS.ACEITA, ESTADOS.AGUARDANDO_FECHAMENTO, ESTADOS.DISPONIVEL, ESTADOS.PARCIAL],
      async (charge, estado) => {
        if (command.suggested !== null && toCents(command.suggested) >= valorCobradoCents(charge)) {
          return 'A sugestão precisa ser menor que o valor cobrado. Para recusar tudo: recusar cobrança N motivo ...';
        }

        await applyState(charge, ESTADOS.CONTESTADA, {
          contestacao: {
            em: now().toISOString(),
            motivo: command.reason || null,
            valorSugerido: command.suggested,
          },
          estadoAnterior: estado,
        });

        const creditorIndex = await indexFor(charge.tagOrigem, charge.id);
        const debtorName = (await nicknameMap(charge.tagOrigem)).get(charge.tagDestino) || firstName(charge.nomeDestino) || 'Seu amigo';

        await creditorNotice(charge, [
          `⚖️ ${debtorName} contestou a cobrança ${chargeTitle(charge)} (${formatCents(valorCobradoCents(charge))}).`,
          command.suggested !== null ? `Sugestão: ${formatCents(toCents(command.suggested))}` : '',
          command.reason ? `Motivo: ${command.reason}` : '',
          command.suggested !== null
            ? `Responda: aprovar sugestão ${creditorIndex} · manter cobrança ${creditorIndex} · cancelar cobrança ${creditorIndex}`
            : `Responda: manter cobrança ${creditorIndex} · cancelar cobrança ${creditorIndex}`,
        ]);

        return 'Contestação enviada. Nada muda até quem cobrou aprovar e reenviar.';
      });
  }

  async function setSilenced(session, command) {
    const tag = sessionTag(session);
    const entries = (await numberedOpen(tag)).filter((entry) => entry.role === 'devedor');
    const targets = command.index
      ? entries.filter((entry) => entry.index === command.index)
      : entries;

    if (!targets.length) {
      return command.index ? 'Não encontrei essa cobrança entre as que você deve.' : 'Você não tem cobranças em aberto.';
    }

    const multipath = {};

    targets.forEach(({ charge }) => copyFields(multipath, charge, {
      lembretesSilenciados: command.value,
      updatedAt: now().toISOString(),
    }));

    if (!command.index) {
      multipath[`${userPath(tag)}/preferencias/lembretes/silenciados`] = command.value;
    }

    await update(ref(db), multipath);

    return command.value
      ? `Lembretes silenciados 🔕 ${command.index ? 'para essa cobrança' : 'para suas cobranças'}. A pendência continua visível em: cobranças`
      : 'Lembretes reativados 🔔';
  }

  // ─── AÇÕES DO CREDOR ───────────────────────────────────
  async function confirmReceipt(session, rawCommand) {
    const tag = sessionTag(session);
    const command = await resolveAmbiguousNumber(tag, rawCommand);
    const selection = await selectEntry(tag, command, 'credor',
      ({ charge, estado }) => estado === ESTADOS.INFORMADO || isPayable(charge, today()));

    if (selection.unknownName) {
      return null;
    }

    if (selection.none) {
      return command.index || command.amount || command.name
        ? 'Não encontrei cobrança em aberto para confirmar recebimento. Veja: cobranças'
        : null;
    }

    if (selection.error) {
      return selection.error;
    }

    const { charge, estado } = selection.entry;
    const informed = estado === ESTADOS.INFORMADO ? toCents(charge.pagamentoInformado?.valor || 0) : 0;
    const balance = saldoCents(charge);
    const amount = command.amount ? toCents(command.amount) : (informed || balance);

    if (amount > balance) {
      return `O saldo dessa cobrança é ${formatCents(balance)}. Informe um valor até esse limite.`;
    }

    if (estado !== ESTADOS.INFORMADO && !isPayable(charge, today())) {
      return `Essa cobrança está ${label(estado)} e não aceita confirmação de pagamento.`;
    }

    // Recebimento espontâneo (sem aviso do devedor) mostra confirmação antes de encerrar.
    if (estado !== ESTADOS.INFORMADO && !command.confirmed) {
      const debtorName = (await nicknameMap(tag)).get(charge.tagDestino) || firstName(charge.nomeDestino) || 'seu amigo';

      return {
        message: [
          `Confirmar recebimento de ${formatCents(amount)} de ${debtorName}?`,
          `${chargeTitle(charge)} — saldo ${formatCents(balance)} → ${formatCents(balance - amount)}${balance - amount === 0 ? ' (quitada)' : ''}`,
          'Responda SIM para confirmar ou CANCELAR.',
        ].join('\n'),
        pendingAction: {
          amount: fromCents(amount),
          chargeId: charge.id,
          tipo: 'confirm_receipt',
        },
      };
    }

    return await registerReceipt(charge, amount);
  }

  async function registerReceipt(charge, amount) {
    const balance = saldoCents(charge);

    if (amount <= 0 || amount > balance) {
      return 'Valor inválido para essa cobrança.';
    }

    const paid = valorPagoCents(charge) + amount;
    const total = valorCobradoCents(charge);
    const estado = paid >= total ? ESTADOS.PAGA : ESTADOS.PARCIAL;
    const timestamp = now().toISOString();
    const paymentId = `pg${String(Object.keys(charge.pagamentos || {}).length + 1).padStart(2, '0')}_${now().getTime().toString(36)}`;
    const fields = {
      estadoAnterior: null,
      pagamentoInformado: null,
      [`pagamentos/${paymentId}`]: {
        confirmadoEm: timestamp,
        informadoEm: charge.pagamentoInformado?.em || null,
        valor: fromCents(amount),
      },
      valorPago: fromCents(paid),
    };

    if (estado === ESTADOS.PAGA) {
      fields.paidAt = timestamp;
    }

    await applyState(charge, estado, fields);

    const updated = { ...charge, valorPago: fromCents(paid) };
    const remaining = saldoCents(updated);

    await debtorNotice(updated, estado === ESTADOS.PAGA
      ? '✅ Pagamento confirmado. Cobrança quitada!'
      : `✅ Recebimento de ${formatCents(amount)} confirmado (pagamento parcial).`,
    estado === ESTADOS.PAGA ? [] : [`Valor original ${formatCents(total)} · pago ${formatCents(paid)}`]).catch(() => false);

    return estado === ESTADOS.PAGA
      ? `Recebimento confirmado ✅ ${chargeTitle(charge)} está quitada (${formatCents(total)}).`
      : [
        `Pagamento parcial registrado ✅ ${chargeTitle(charge)}`,
        `Original ${formatCents(total)} · pago ${formatCents(paid)} · saldo ${formatCents(remaining)}`,
      ].join('\n');
  }

  async function denyReceipt(session, command) {
    const tag = sessionTag(session);
    const selection = await selectEntry(tag, command, 'credor', ({ estado }) => estado === ESTADOS.INFORMADO);

    if (selection.none) {
      return 'Não há pagamento informado aguardando sua confirmação.';
    }

    if (selection.error) {
      return selection.error;
    }

    const { charge, estado } = selection.entry;

    if (estado !== ESTADOS.INFORMADO) {
      return 'Essa cobrança não tem pagamento informado.';
    }

    const previous = charge.estadoAnterior && !FINAL_STATES.has(charge.estadoAnterior)
      ? charge.estadoAnterior
      : baseEstado(charge, today());

    await applyState(charge, previous, { estadoAnterior: null, pagamentoInformado: null });
    await debtorNotice(charge, '⚠️ Quem recebe ainda não identificou seu pagamento.', ['Confira o comprovante e informe de novo quando puder.']);

    return 'Ok, marquei que o pagamento ainda não chegou. Avisei a pessoa.';
  }

  async function withSelectedSent(session, command, allowedStates, handler) {
    const tag = sessionTag(session);
    const selection = await selectEntry(tag, command, 'credor', ({ estado }) => allowedStates.includes(estado));

    if (selection.none) {
      return 'Não encontrei essa cobrança entre as que você enviou. Veja: cobranças';
    }

    if (selection.error) {
      return selection.error;
    }

    if (!allowedStates.includes(selection.entry.estado)) {
      return `Essa cobrança está ${label(selection.entry.estado)} e não permite essa ação.`;
    }

    return await handler(selection.entry.charge, selection.entry.estado);
  }

  async function approveSuggestion(session, command) {
    return await withSelectedSent(session, command, [ESTADOS.CONTESTADA], async (charge) => {
      const suggested = charge.contestacao?.valorSugerido;

      if (!suggested) {
        return 'Essa contestação não tem valor sugerido. Use: manter cobrança N ou cancelar cobrança N';
      }

      return {
        message: [
          `Reenviar ${chargeTitle(charge)} com o valor sugerido?`,
          `${formatCents(valorCobradoCents(charge))} → ${formatCents(toCents(suggested))} (o valor original fica no histórico)`,
          'Responda SIM para aprovar e reenviar ou CANCELAR.',
        ].join('\n'),
        pendingAction: {
          chargeId: charge.id,
          tipo: 'approve_suggestion',
        },
      };
    });
  }

  async function resendWithValue(charge, cents) {
    const paid = valorPagoCents(charge);

    if (cents <= paid) {
      return 'O valor sugerido é menor ou igual ao que já foi pago. Cancele a cobrança ou mantenha o valor.';
    }

    let next = charge.cartaoId && charge.fechamentoPrevisto ? baseEstado(charge, today()) : ESTADOS.AGUARDANDO_ACEITE;

    // Pagamentos já confirmados continuam valendo sobre o novo valor.
    if (paid > 0) {
      next = ESTADOS.PARCIAL;
    }

    const timestamp = now().toISOString();

    await applyState(charge, next, {
      [`historicoValores/h${String(Object.keys(charge.historicoValores || {}).length + 1).padStart(2, '0')}_${now().getTime().toString(36)}`]: {
        de: fromCents(valorCobradoCents(charge)),
        em: timestamp,
        para: fromCents(cents),
      },
      contestacao: { ...(charge.contestacao || {}), resolvidaEm: timestamp, resultado: 'aprovada' },
      estadoAnterior: null,
      valorCobrado: fromCents(cents),
      valorOriginal: charge.valorOriginal ?? charge.valorCobrado,
    }, { value: fromCents(cents) });

    const updated = { ...charge, valorCobrado: fromCents(cents) };

    await debtorNotice(updated, `🔁 Cobrança reenviada com o valor sugerido: ${formatCents(cents)}.`);

    return `Sugestão aprovada e cobrança reenviada com ${formatCents(cents)} ✅`;
  }

  async function keepCharge(session, command) {
    return await withSelectedSent(session, command, [ESTADOS.CONTESTADA], async (charge) => {
      const previous = charge.estadoAnterior && !FINAL_STATES.has(charge.estadoAnterior) && charge.estadoAnterior !== ESTADOS.CONTESTADA
        ? charge.estadoAnterior
        : baseEstado(charge, today());

      await applyState(charge, previous, {
        contestacao: { ...(charge.contestacao || {}), resolvidaEm: now().toISOString(), resultado: 'mantida' },
        estadoAnterior: null,
      });
      await debtorNotice(charge, `Quem cobrou manteve o valor de ${formatCents(valorCobradoCents(charge))}.`);

      return 'Valor mantido e cobrança reenviada ✅';
    });
  }

  async function cancelCharge(session, command) {
    return await withSelectedSent(session, command,
      [ESTADOS.AGUARDANDO_ACEITE, ESTADOS.ACEITA, ESTADOS.AGUARDANDO_FECHAMENTO, ESTADOS.DISPONIVEL, ESTADOS.CONTESTADA, ESTADOS.PARCIAL, ESTADOS.INFORMADO],
      async (charge) => ({
        message: [
          `Cancelar a cobrança ${chargeTitle(charge)} (saldo ${formatCents(saldoCents(charge))})?`,
          'Pagamentos já confirmados continuam no histórico.',
          'Responda SIM para cancelar ou NÃO para manter.',
        ].join('\n'),
        pendingAction: {
          chargeId: charge.id,
          tipo: 'cancel_charge',
        },
      }));
  }

  async function executeCancel(charge) {
    await applyState(charge, ESTADOS.CANCELADA, { canceladaEm: now().toISOString() });
    await debtorNotice(charge, `A cobrança ${chargeTitle(charge)} foi cancelada por quem cobrou.`).catch(() => false);

    return `Cobrança cancelada: ${chargeTitle(charge)}.`;
  }

  function remindersSilenced(charge, debtorPreferences) {
    return charge.lembretesSilenciados === true || debtorPreferences?.silenciados === true;
  }

  async function claimReminder(charge, field, { minIntervalMs = null } = {}) {
    const path = `${sentPath(charge.tagOrigem, charge.id)}/lembretes/${field}`;
    const nowMs = now().getTime();
    let blockedUntil = null;
    const result = await transaction(ref(db, path), (current) => {
      if (current) {
        const last = new Date(current).getTime();

        if (minIntervalMs === null || (Number.isFinite(last) && nowMs - last < minIntervalMs)) {
          blockedUntil = Number.isFinite(last) && minIntervalMs !== null ? new Date(last + minIntervalMs) : null;
          return undefined;
        }
      }

      return now().toISOString();
    });

    if (result?.committed === true) {
      await update(ref(db), {
        [`${receivedPath(charge.tagDestino, charge.id)}/lembretes/${field}`]: now().toISOString(),
      });
    }

    return { blockedUntil, claimed: result?.committed === true };
  }

  async function remindAgain(session, command) {
    const tag = sessionTag(session);
    const selection = await selectEntry(tag, command, 'credor', () => true);

    if (selection.none) {
      return 'Não encontrei cobrança em aberto com essa pessoa. Veja: cobranças';
    }

    if (selection.error) {
      return selection.error;
    }

    const { charge, estado } = selection.entry;

    if (estado === ESTADOS.INFORMADO) {
      return 'Essa pessoa já informou o pagamento. Confirme com: recebi cobrança N (ou não recebi).';
    }

    if (estado === ESTADOS.CONTESTADA) {
      return 'Essa cobrança está contestada. Responda à contestação antes de lembrar.';
    }

    const debtorPreferences = await userData.readChild(charge.tagDestino, 'preferencias/lembretes');

    if (remindersSilenced(charge, debtorPreferences)) {
      return '🔕 A pessoa silenciou os lembretes dessa cobrança. Ela continua vendo a pendência em "cobranças".';
    }

    const claim = await claimReminder(charge, 'ultimoManualEm', { minIntervalMs: REMINDER_INTERVAL_MS });

    if (!claim.claimed) {
      return `Você já lembrou essa pessoa nas últimas 24 horas.${claim.blockedUntil ? ` Próximo lembrete a partir de ${formatDateBr(dateUtils.todayIso(claim.blockedUntil))}.` : ''}`;
    }

    await debtorNotice(charge, '🔔 Lembrete de cobrança', [
      charge.vencimento ? `Vencimento: ${formatDateBr(charge.vencimento)}` : '',
    ]);

    return 'Lembrete enviado ✅ (máximo de um por cobrança a cada 24 horas).';
  }

  // ─── FECHAMENTO E LEMBRETES AUTOMÁTICOS ────────────────
  // Transição (aguardando fechamento → disponível) e aviso ficam separados: uma
  // consulta do usuário pode transicionar antes do scheduler, sem perder o aviso.
  async function processClosingsFor(creditorTag, { notifyParties = true, force = null } = {}) {
    const { sent } = await listCharges(creditorTag);
    const day = today();
    const due = sent.filter((charge) =>
      storedEstado(charge) === ESTADOS.AGUARDANDO_FECHAMENTO &&
      charge.fechamentoPrevisto &&
      (force ? force.has(charge.id) : String(charge.fechamentoPrevisto) <= day));
    let closed = 0;

    if (due.length) {
      const multipath = {};

      due.forEach((charge) => copyFields(multipath, charge, {
        estado: ESTADOS.DISPONIVEL,
        status: legacyStatusFor(ESTADOS.DISPONIVEL),
        updatedAt: now().toISOString(),
      }));
      await update(ref(db), multipath);
      closed = due.length;
    }

    if (!notifyParties) {
      return { closed };
    }

    const dueIds = new Set(due.map((charge) => charge.id));
    const recentLimit = new Date(`${day}T12:00:00Z`).getTime() - 3 * 86400000;
    const toNotify = sent
      .map((charge) => (dueIds.has(charge.id) ? { ...charge, estado: ESTADOS.DISPONIVEL } : charge))
      .filter((charge) =>
        storedEstado(charge) === ESTADOS.DISPONIVEL &&
        charge.fechamentoPrevisto &&
        String(charge.fechamentoPrevisto) <= day &&
        new Date(`${charge.fechamentoPrevisto}T12:00:00Z`).getTime() >= recentLimit &&
        !charge.lembretes?.fechamentoEnviadoEm);

    for (const charge of toNotify) {
      const claim = await claimReminder(charge, 'fechamentoEnviadoEm');

      if (!claim.claimed) {
        continue;
      }

      const debtorPreferences = await userData.readChild(charge.tagDestino, 'preferencias/lembretes');

      if (!remindersSilenced(charge, debtorPreferences)) {
        await debtorNotice(charge, '🧾 A fatura fechou: cobrança disponível para pagamento.', [
          charge.vencimento ? `Vencimento (cartão de quem pagou): ${formatDateBr(charge.vencimento)}` : '',
        ]);
      }

      const debtorName = (await nicknameMap(creditorTag)).get(charge.tagDestino) || firstName(charge.nomeDestino) || 'seu amigo';

      await creditorNotice(charge, [
        `🧾 Fatura fechada: ${chargeTitle(charge)} agora está em valores a receber.`,
        `${debtorName} — ${formatCents(saldoCents(charge))}${charge.vencimento ? ` · vence ${formatDateBr(charge.vencimento)}` : ''}`,
      ]);
    }

    return { closed };
  }

  async function processDueRemindersFor(creditorTag) {
    const { sent } = await listCharges(creditorTag);
    const day = today();
    let sentCount = 0;

    for (const charge of sent) {
      const estado = estadoDe(charge, day);

      if (!charge.vencimento || !isPayable(charge, day) || estado === ESTADOS.AGUARDANDO_FECHAMENTO) {
        continue;
      }

      // Lembrete automático somente no dia do vencimento (ou no dia seguinte, se o
      // processo estava parado). Depois disso, só lembretes manuais.
      const dueMs = new Date(`${charge.vencimento}T12:00:00Z`).getTime();
      const todayMs = new Date(`${day}T12:00:00Z`).getTime();
      const daysLate = Math.round((todayMs - dueMs) / 86400000);

      if (daysLate < 0 || daysLate > 1 || charge.lembretes?.vencimentoEnviadoEm) {
        continue;
      }

      const debtorPreferences = await userData.readChild(charge.tagDestino, 'preferencias/lembretes');

      if (remindersSilenced(charge, debtorPreferences)) {
        continue;
      }

      const claim = await claimReminder(charge, 'vencimentoEnviadoEm');

      if (claim.claimed) {
        await debtorNotice(charge, '📅 Hoje é o vencimento desta cobrança.');
        sentCount += 1;
      }
    }

    return { sent: sentCount };
  }

  // "minha fatura Nubank fechou hoje": antecipa as cobranças do ciclo pendente.
  async function closeCardCycle(session, card, closingIso) {
    const tag = sessionTag(session);
    const { sent } = await listCharges(tag);
    const pending = sent
      .filter((charge) => charge.cartaoId === card.id && storedEstado(charge) === ESTADOS.AGUARDANDO_FECHAMENTO && charge.fechamentoPrevisto)
      .sort((a, b) => String(a.fechamentoPrevisto).localeCompare(String(b.fechamentoPrevisto)));

    if (!pending.length) {
      return { closed: 0 };
    }

    const firstClosing = pending[0].fechamentoPrevisto;
    const limitMs = new Date(`${closingIso}T12:00:00Z`).getTime() + 40 * 86400000;
    const current = pending.filter((charge) =>
      charge.fechamentoPrevisto === firstClosing && new Date(`${firstClosing}T12:00:00Z`).getTime() <= limitMs);
    const dayBefore = new Date(`${closingIso}T12:00:00Z`);

    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    const newCycle = computeCycle(card, dayBefore.toISOString().slice(0, 10));
    const multipath = {};

    current.forEach((charge) => copyFields(multipath, charge, {
      fechamentoPrevisto: closingIso,
      vencimento: newCycle?.vencimento || charge.vencimento,
    }));

    // Parcelas futuras passam a usar o novo dia de fechamento.
    pending.filter((charge) => !current.includes(charge)).forEach((charge) => {
      const parsed = parseIso(charge.fechamentoPrevisto);

      if (parsed) {
        copyFields(multipath, charge, {
          fechamentoPrevisto: isoFrom(parsed.year, parsed.monthIndex, Number(card.diaFechamento)),
        });
      }
    });

    if (Object.keys(multipath).length) {
      await update(ref(db), multipath);
    }

    const refreshed = new Set(current.map((charge) => charge.id));

    return await processClosingsFor(tag, { force: refreshed, notifyParties: true });
  }

  async function findCharge(tag, chargeId) {
    const { received, sent } = await listCharges(tag);

    return sent.find((charge) => charge.id === chargeId) || received.find((charge) => charge.id === chargeId) || null;
  }

  // Executa ações que exigiram confirmação ("sim").
  async function executePending(session, pending) {
    const tag = sessionTag(session);
    const charge = await findCharge(tag, pending.chargeId);

    if (!charge) {
      return 'Essa cobrança não está mais disponível.';
    }

    if (pending.tipo === 'inform_payment') {
      if (charge.tagDestino !== tag) {
        return 'Só quem deve pode informar pagamento.';
      }

      return await registerInformedPayment(tag, charge, Math.min(toCents(pending.amount), saldoCents(charge)));
    }

    if (charge.tagOrigem !== tag) {
      return 'Só quem criou a cobrança pode fazer isso.';
    }

    if (pending.tipo === 'confirm_receipt') {
      if (!isPayable(charge, today()) && estadoDe(charge, today()) !== ESTADOS.INFORMADO) {
        return `Essa cobrança está ${label(estadoDe(charge, today()))}.`;
      }

      return await registerReceipt(charge, Math.min(toCents(pending.amount), saldoCents(charge)));
    }

    if (pending.tipo === 'approve_suggestion') {
      if (estadoDe(charge, today()) !== ESTADOS.CONTESTADA || !charge.contestacao?.valorSugerido) {
        return 'Essa contestação já foi resolvida.';
      }

      return await resendWithValue(charge, toCents(charge.contestacao.valorSugerido));
    }

    if (pending.tipo === 'cancel_charge') {
      if (!isOpen(charge, today())) {
        return `Essa cobrança já está ${label(estadoDe(charge, today()))}.`;
      }

      return await executeCancel(charge);
    }

    return null;
  }

  async function process(session, text) {
    const command = parseObligationCommand(text);

    if (!command) {
      return null;
    }

    const tag = sessionTag(session);

    await processClosingsFor(tag, { notifyParties: false });

    switch (command.action) {
      case 'list':
        return await listMessage(session, { onlyRole: command.role || null });
      case 'mark_paid_auto': {
        const entry = (await numberedOpen(tag)).find((item) => item.index === command.index);

        if (!entry) {
          return 'Não encontrei essa cobrança. Veja a lista: cobranças';
        }

        return entry.role === 'devedor'
          ? await informPayment(session, { amount: null, index: command.index, name: null, raw: text })
          : await confirmReceipt(session, { amount: null, index: command.index, name: null, raw: text });
      }
      case 'list_with': {
        const friends = friendService ? await friendService.listFriends(tag) : [];
        const friend = friends.find((item) => item.apelido && normalizeNickname(item.apelido) === normalizeNickname(command.name));

        return friend
          ? await listMessage(session, { withTag: friend.tag })
          : `Não encontrei o amigo "${command.name}".`;
      }
      case 'inform_payment':
        return await informPayment(session, command);
      case 'confirm_receipt':
        return await confirmReceipt(session, command);
      case 'deny_receipt':
        return await denyReceipt(session, command);
      case 'accept':
        return await acceptCharge(session, command);
      case 'refuse':
        return await refuseCharge(session, command);
      case 'contest':
        return await contestCharge(session, command);
      case 'approve_suggestion':
        return await approveSuggestion(session, command);
      case 'keep':
        return await keepCharge(session, command);
      case 'cancel':
        return await cancelCharge(session, command);
      case 'remind':
        return await remindAgain(session, command);
      case 'silence':
        return await setSilenced(session, command);
      default:
        return null;
    }
  }

  return {
    addChargeCreation,
    buildCharge,
    closeCardCycle,
    executePending,
    idGenerator,
    indexFor,
    listCharges,
    numberedOpen,
    process,
    processClosingsFor,
    processDueRemindersFor,
    debtorNotice,
  };
}

module.exports = {
  chargeExpenseId,
  createObligationService,
  parseObligationCommand,
};
