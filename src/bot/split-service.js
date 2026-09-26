'use strict';

const { addMonthsIso, computeCycle } = require('./card-cycle');
const { detectarCategoria } = require('./categories');
const { ESTADOS } = require('./charge-state');
const { formatCents, formatDateBr, fromCents, normalizedCommand } = require('./finance-utils');
const { normalizeNickname } = require('./friend-matcher');
const { relativeDateIso } = require('./relative-date');
const { parseSplitMessage } = require('./split-parser');
const { sessionTag, userPath } = require('./user-data');

const METHOD_LABELS = {
  cartao: 'Cartão',
  debito: 'Débito',
  pix: 'Pix',
};

// Distribui centavos entre parcelas sem perder valor (parcelas iniciais recebem o resto).
function splitAcrossInstallments(cents, count) {
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;

  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function paymentLabel(payment, cycle) {
  if (!payment?.tipo) {
    return 'não informado';
  }

  if (payment.tipo !== 'cartao') {
    return METHOD_LABELS[payment.tipo];
  }

  const name = payment.cardName ? `Cartão ${payment.cardName}` : 'Cartão (sem ciclo cadastrado)';

  return cycle
    ? `${name} · fecha ~${formatDateBr(cycle.fechamento)} · vence ${formatDateBr(cycle.vencimento)}`
    : name;
}

function createSplitService({
  cardService,
  dateUtils,
  db,
  features = {},
  firebaseOps,
  friendService,
  notify,
  now = () => new Date(),
  obligationService,
  userData,
}) {
  const { ref, update } = firebaseOps;

  function today() {
    return dateUtils.todayIso(now());
  }

  async function cardsFor(tag) {
    return features.cards && cardService ? await cardService.listCards(tag) : [];
  }

  async function start(session, text) {
    const tag = sessionTag(session);
    const friends = await friendService.activeFriends(tag);
    const cards = await cardsFor(tag);
    const parsed = parseSplitMessage(text, { cards, friends });

    if (!parsed) {
      return null;
    }

    if (parsed.error || parsed.ambiguity) {
      return parsed.error || parsed.ambiguity;
    }

    const draft = {
      ...parsed.draft,
      date: relativeDateIso(text, today()),
      installmentMode: parsed.draft.installments ? null : 'unica',
    };

    if (draft.installments && draft.payment.tipo && draft.payment.tipo !== 'cartao') {
      draft.installments = null;
      draft.installmentMode = 'unica';
    }

    if (draft.kind === 'charge') {
      draft.payment = { cardId: null, cardName: null, tipo: null };
      draft.installments = null;
      draft.installmentMode = 'unica';
    }

    return await nextStep(session, draft);
  }

  async function nextStep(session, draft) {
    const tag = sessionTag(session);

    if (draft.kind === 'split' && !draft.payment.tipo) {
      const cards = await cardsFor(tag);
      const defaultCard = cards.find((card) => card.padrao);

      return {
        message: [
          `Como você pagou ${formatCents(draft.totalCents)}?`,
          '1. Pix',
          '2. Débito',
          `3. Cartão${defaultCard ? ` (padrão: ${defaultCard.apelido})` : ''}`,
          ...cards.filter((card) => !card.padrao).map((card, index) => `${index + 4}. Cartão ${card.apelido}`),
        ].join('\n'),
        pendingAction: { draft, step: 'metodo', tipo: 'split' },
      };
    }

    if (draft.kind === 'split' && draft.payment.tipo === 'cartao' && !draft.payment.cardId && !draft.payment.cardless) {
      const cards = await cardsFor(tag);

      if (!cards.length) {
        draft.payment.cardless = true;
      } else if (cards.length === 1) {
        draft.payment.cardId = cards[0].id;
        draft.payment.cardName = cards[0].apelido;
      } else {
        const defaultCard = cards.find((card) => card.padrao) || cards[0];

        return {
          message: [
            'Qual cartão?',
            ...cards.map((card, index) => `${index + 1}. ${card.apelido}${card.padrao ? ' (padrão)' : ''}`),
            '',
            `Atalho: responda "padrão" para usar o ${defaultCard.apelido}.`,
          ].join('\n'),
          pendingAction: { draft, step: 'cartao', tipo: 'split' },
        };
      }
    }

    if (draft.installments && !draft.installmentMode) {
      return {
        message: [
          `Compra parcelada em ${draft.installments}x. Como será o acerto com os amigos?`,
          '1. Por parcela (padrão) — cada fatura gera a cobrança da parcela',
          '2. Pelo total — uma cobrança única no primeiro fechamento',
        ].join('\n'),
        pendingAction: { draft, step: 'parcelamento', tipo: 'split' },
      };
    }

    return {
      message: await preview(session, draft),
      pendingAction: { draft, step: 'confirmar', tipo: 'split' },
    };
  }

  async function cardFor(tag, draft) {
    if (draft.payment?.tipo !== 'cartao' || !draft.payment.cardId) {
      return null;
    }

    return (await cardsFor(tag)).find((card) => card.id === draft.payment.cardId) || null;
  }

  async function preview(session, draft) {
    const tag = sessionTag(session);
    const card = await cardFor(tag, draft);
    const cycle = card ? computeCycle(card, draft.date, 0) : null;
    const installments = draft.installments && draft.installmentMode !== 'unica' ? draft.installments : 1;
    const lines = [];

    if (draft.kind === 'charge') {
      lines.push(
        `🧾 ${draft.description} — cobrança direta`,
        ...draft.participants.map((person) => `• ${person.apelido}: ${formatCents(person.cents)} a cobrar`),
        'Sem lançamento de gasto para você (é só a cobrança).',
      );
    } else {
      const names = [draft.includePayer ? 'você' : null, ...draft.participants.map((person) => person.apelido)].filter(Boolean);

      lines.push(
        `🧾 ${draft.description} — total ${formatCents(draft.totalCents)}`,
        `👥 Participantes: ${names.join(', ')}${draft.includePayer ? '' : ' (você só pagou)'}`,
        `• Você: ${formatCents(draft.payerCents)}${draft.includePayer ? ' (sua parte)' : draft.payerCents > 0 ? ' (arredondamento)' : ''}`,
        ...draft.participants.map((person) => `• ${person.apelido}: ${formatCents(person.cents)} a cobrar${person.mode === 'igual' ? '' : ` (${person.mode})`}`),
        `💳 Pagamento: ${paymentLabel(draft.payment, cycle)}`,
      );

      if (installments > 1) {
        lines.push(`📆 ${installments}x — acerto ${draft.installmentMode === 'total' ? 'pelo total' : 'por parcela'}`);
        draft.participants.forEach((person) => {
          const parts = draft.installmentMode === 'total' ? [person.cents] : splitAcrossInstallments(person.cents, installments);

          lines.push(draft.installmentMode === 'total'
            ? `  ${person.apelido}: ${formatCents(person.cents)} de uma vez`
            : `  ${person.apelido}: ${parts.length}x a partir de ${formatCents(parts[0])}`);
        });
      }

      lines.push(`📌 Seu lançamento líquido: ${formatCents(draft.payerCents)}${installments > 1 ? ` (${installments}x no seu cartão)` : ''}`);

      if (draft.payment.cardless) {
        lines.push('Obs.: sem cartão cadastrado, a cobrança não acompanha fechamento. Cadastre com: adicionar cartão Nome fecha dia X vence dia Y');
      }
    }

    lines.push('', 'Responda SIM para gravar ou CANCELAR.');

    return lines.join('\n');
  }

  async function handleReply(session, pending, text) {
    const command = normalizedCommand(text);
    const draft = { ...pending.draft, payment: { ...(pending.draft.payment || {}) } };
    const tag = sessionTag(session);

    if (['cancelar', 'cancela', 'nao', 'não'].includes(command)) {
      return { clearPending: true, message: 'Divisão cancelada. Nada foi gravado.' };
    }

    // "sim" numa etapa de escolha: pede a opção em vez de seguir outro fluxo.
    if (pending.step !== 'confirmar' && ['sim', 's', 'ok', 'confirmar', 'confirmo'].includes(command)) {
      return {
        message: pending.step === 'parcelamento'
          ? 'Responda 1 (por parcela) ou 2 (pelo total), ou CANCELAR.'
          : 'Responda com o número da opção (ex.: 1 para Pix) ou CANCELAR.',
      };
    }

    if (pending.step === 'metodo') {
      const cards = await cardsFor(tag);
      const others = cards.filter((card) => !card.padrao);
      const byName = cards.find((card) => normalizeNickname(card.apelido) === normalizeNickname(command.replace(/^cartao\s+/, '')));
      const option = /^\d+$/.test(command) ? Number(command) : null;

      if (option === 1 || command === 'pix') {
        draft.payment = { tipo: 'pix' };
      } else if (option === 2 || /^debito$/.test(command)) {
        draft.payment = { tipo: 'debito' };
      } else if (option === 3 || /^(cartao|credito|cartao de credito)$/.test(command)) {
        draft.payment = { tipo: 'cartao' };
      } else if (option && option >= 4 && others[option - 4]) {
        draft.payment = { cardId: others[option - 4].id, cardName: others[option - 4].apelido, tipo: 'cartao' };
      } else if (byName) {
        draft.payment = { cardId: byName.id, cardName: byName.apelido, tipo: 'cartao' };
      } else if (command === 'padrao' && cards.find((card) => card.padrao)) {
        const defaultCard = cards.find((card) => card.padrao);

        draft.payment = { cardId: defaultCard.id, cardName: defaultCard.apelido, tipo: 'cartao' };
      } else {
        return null;
      }

      if (draft.payment.tipo !== 'cartao') {
        draft.installments = null;
        draft.installmentMode = 'unica';
      }

      return await nextStep(session, draft);
    }

    if (pending.step === 'cartao') {
      const cards = await cardsFor(tag);
      const option = /^\d+$/.test(command) ? Number(command) : null;
      const selected = command === 'padrao'
        ? cards.find((card) => card.padrao) || cards[0]
        : option ? cards[option - 1] : cards.find((card) => normalizeNickname(card.apelido) === normalizeNickname(command));

      if (!selected) {
        return null;
      }

      draft.payment = { cardId: selected.id, cardName: selected.apelido, tipo: 'cartao' };

      return await nextStep(session, draft);
    }

    if (pending.step === 'parcelamento') {
      if (['1', 'por parcela', 'parcela', 'padrao'].includes(command)) {
        draft.installmentMode = 'parcela';
      } else if (['2', 'pelo total', 'total', 'no total'].includes(command)) {
        draft.installmentMode = 'total';
      } else {
        return null;
      }

      return await nextStep(session, draft);
    }

    if (pending.step === 'confirmar') {
      if (!['sim', 's', 'confirmar', 'confirmo', 'ok', 'pode gravar', 'pode salvar'].includes(command)) {
        return null;
      }

      return { execute: true };
    }

    return null;
  }

  // Grava tudo em uma única atualização multipath: gastos de quem pagou,
  // cópias das cobranças nos dois usuários, gastos vinculados e o registro da divisão.
  async function execute(session, pending) {
    const tag = sessionTag(session);
    const { draft } = pending;
    const splitId = String(pending.id || `div_${now().getTime().toString(36)}`).replace(/[.#$[\]/]/g, '_');
    const friends = await friendService.activeFriends(tag);
    const inactive = draft.participants.filter((person) => !friends.some((friend) => friend.tag === person.tag));

    if (inactive.length) {
      return `A amizade com ${inactive.map((person) => person.apelido).join(', ')} não está mais ativa. Nada foi gravado.`;
    }

    const card = await cardFor(tag, draft);
    const count = draft.installments && draft.installmentMode !== 'unica' ? draft.installments : 1;
    const creditor = await userData.getContact(tag);
    const multipath = {};
    const chargeIds = [];
    const expenseIds = [];
    const timestamp = now().toISOString();
    const phone = String(session.phone || creditor?.phone || '').replace(/\D/g, '');

    if (draft.kind === 'split' && draft.payerCents > 0) {
      const payerParts = splitAcrossInstallments(draft.payerCents, count);
      const grossParts = splitAcrossInstallments(draft.totalCents, count);

      payerParts.forEach((cents, index) => {
        const date = addMonthsIso(draft.date, index);
        const monthKey = dateUtils.monthKey(new Date(`${date}T12:00:00.000Z`));
        const expenseId = `${splitId}_p${index + 1}`;
        const expense = {
          cat: detectarCategoria(draft.description) || 'Outros',
          compartilhado: true,
          createdAt: timestamp,
          date,
          desc: count > 1 ? `${draft.description} (${index + 1}/${count}x)` : draft.description,
          divisaoId: splitId,
          meioPagamento: draft.payment.tipo,
          origem: 'divisao',
          user: tag,
          value: fromCents(cents),
          valorBruto: fromCents(grossParts[index]),
          viaBot: true,
          ...(draft.payment.cardId ? { cartaoId: draft.payment.cardId } : {}),
          ...(count > 1 ? { parcelaId: splitId, parcelaNum: index + 1, parcelaTotal: count } : {}),
        };

        multipath[`${userPath(tag)}/gastos/${monthKey}/${expenseId}`] = expense;

        if (phone) {
          multipath[`transactionsByUser/${phone}/${monthKey}/${expenseId}`] = {
            ...expense,
            legacyExpenseId: expenseId,
            legacyGroup: 'SALVAMONEY',
            legacyUser: tag,
            migrated: false,
            sourcePath: `${userPath(tag)}/gastos/${monthKey}/${expenseId}`,
          };
        }

        expenseIds.push(expenseId);
      });
    }

    for (const person of draft.participants) {
      const debtor = await userData.getContact(person.tag);
      const perCharge = draft.installmentMode === 'parcela' && count > 1
        ? splitAcrossInstallments(person.cents, count)
        : [person.cents];

      perCharge.forEach((cents, index) => {
        const cycle = card ? computeCycle(card, draft.date, index) : null;
        const id = `${splitId}_${person.tag}_${index + 1}`;
        const charge = obligationService.buildCharge({
          cardId: card?.id || null,
          cents,
          creditor: { firstName: creditor?.firstName || 'Alguém', tag },
          data: draft.date,
          debtor: { firstName: debtor?.firstName || person.apelido, tag: person.tag },
          descricao: draft.description,
          divisaoId: draft.kind === 'split' ? splitId : null,
          estado: cycle ? ESTADOS.AGUARDANDO_FECHAMENTO : ESTADOS.AGUARDANDO_ACEITE,
          fechamentoPrevisto: cycle?.fechamento || null,
          grupoParcelasId: perCharge.length > 1 ? splitId : null,
          id,
          meioPagamento: draft.payment?.tipo || null,
          parcelaNum: perCharge.length > 1 ? index + 1 : null,
          parcelaTotal: perCharge.length > 1 ? perCharge.length : null,
          valorTotal: draft.totalCents !== null ? fromCents(draft.totalCents) : null,
          vencimento: cycle?.vencimento || null,
        });

        obligationService.addChargeCreation(multipath, charge);
        chargeIds.push(id);
      });
    }

    if (draft.kind === 'split') {
      multipath[`${userPath(tag)}/divisoes/${splitId}`] = {
        cartaoId: card?.id || null,
        cobrancaIds: chargeIds,
        criadoEm: timestamp,
        data: draft.date,
        descricao: draft.description,
        gastoIds: expenseIds,
        meioPagamento: draft.payment.tipo,
        modoParcelamento: count > 1 ? draft.installmentMode : null,
        parcelas: count,
        participantes: Object.fromEntries(draft.participants.map((person) => [person.tag, fromCents(person.cents)])),
        pagadorParticipa: draft.includePayer,
        valorLiquidoPagador: fromCents(draft.payerCents),
        valorTotal: fromCents(draft.totalCents),
      };
    }

    await update(ref(db), multipath);

    for (const person of draft.participants) {
      const first = chargeIds.find((id) => id.startsWith(`${splitId}_${person.tag}_`));
      const charge = first ? {
        cartaoId: card?.id || null,
        descricao: draft.description,
        id: first,
        nomeOrigem: creditor?.firstName,
        tagDestino: person.tag,
        tagOrigem: tag,
        valorCobrado: fromCents(draft.installmentMode === 'parcela' && count > 1
          ? splitAcrossInstallments(person.cents, count)[0]
          : person.cents),
        valorPago: 0,
        ...(draft.installmentMode === 'parcela' && count > 1 ? { parcelaNum: 1, parcelaTotal: count } : {}),
      } : null;

      if (charge) {
        const cycle = card ? computeCycle(card, draft.date, 0) : null;
        const index = cycle ? null : await obligationService.indexFor(person.tag, first);

        await obligationService.debtorNotice(charge, `🧾 ${creditor?.firstName || 'Um amigo'} registrou uma divisão com você.`, [
          draft.totalCents !== null ? `Total da conta: ${formatCents(draft.totalCents)}` : '',
          count > 1 && draft.installmentMode === 'parcela' ? `Parcelado em ${count}x (uma cobrança por fatura).` : '',
          cycle ? `Aguardando o fechamento da fatura (~${formatDateBr(cycle.fechamento)}). Vencimento: ${formatDateBr(cycle.vencimento)}.` : '',
          index ? `Para aceitar: aceitar cobrança ${index} · para recusar: recusar cobrança ${index} motivo ...` : '',
        ]).catch(() => false);
      }
    }

    return draft.kind === 'charge'
      ? `Cobrança criada ✅ ${draft.participants.map((person) => `${person.apelido}: ${formatCents(person.cents)}`).join(' · ')}. Avisei por aqui.`
      : [
        `Divisão registrada ✅ ${draft.description} — ${formatCents(draft.totalCents)}`,
        `Seu gasto líquido: ${formatCents(draft.payerCents)} · A receber: ${formatCents(draft.participants.reduce((sum, person) => sum + person.cents, 0))}`,
        'Veja em: cobranças',
      ].join('\n');
  }

  return {
    execute,
    handleReply,
    preview,
    start,
  };
}

module.exports = {
  createSplitService,
  splitAcrossInstallments,
};
