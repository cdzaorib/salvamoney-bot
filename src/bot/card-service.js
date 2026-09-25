'use strict';

const { computeCycle, validDay } = require('./card-cycle');
const { formatDateBr, normalizedCommand } = require('./finance-utils');
const { normalizeNickname } = require('./friend-matcher');
const { sessionTag, userPath } = require('./user-data');

const MAX_CARDS = 10;
const SENSITIVE_CARD_PATTERN = /\b(cvv|cvc|codigo de seguranca|validade|vencimento do plastico)\b/;

// Só guardamos apelido, dia estimado de fechamento, dia de vencimento e o
// indicador de cartão padrão. Número, validade e CVV nunca são armazenados.
function hasSensitiveCardData(text) {
  const digits = String(text || '').replace(/[\s.-]/g, '');

  return /\d{12,}/.test(digits) || SENSITIVE_CARD_PATTERN.test(normalizedCommand(text)) ||
    /\b\d{2}\/\d{2,4}\b/.test(String(text || ''));
}

function extractDay(command, words) {
  const match = command.match(new RegExp(`\\b(?:${words})(?:\\s+(?:no\\s+)?(?:dia|em))?\\s+(\\d{1,2})\\b`));

  return match ? validDay(Number(match[1])) : null;
}

function cleanCardName(raw) {
  return String(raw || '')
    .replace(/\b(fecha|fechamento|vence|vencimento|dia|no|em|e|com|todo|mes)\b.*$/i, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

function titleCase(value) {
  return String(value || '').split(' ').filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ');
}

function parseCardCommand(text) {
  const original = String(text || '').trim();
  const command = normalizedCommand(original);
  let match = command.match(/^(?:adicionar|cadastrar|novo|nova|criar|registrar)\s+cartao(?:\s+de\s+credito)?\s+(.+)$/);

  if (match) {
    return {
      action: 'add',
      closingDay: extractDay(match[1], 'fecha|fechamento|fecha a fatura'),
      dueDay: extractDay(match[1], 'vence|vencimento'),
      name: titleCase(cleanCardName(match[1])),
      sensitive: hasSensitiveCardData(original),
    };
  }

  if (/^(meus cartoes|cartoes|listar cartoes|ver cartoes|meus cartoes de credito)$/.test(command)) {
    return { action: 'list' };
  }

  match = command.match(/^(?:definir\s+)?cartao\s+padrao\s+(?:o\s+)?(.+)$/) ||
    command.match(/^(?:definir|usar)\s+(?:o\s+)?(?:cartao\s+)?(.+?)\s+como\s+(?:cartao\s+)?padrao$/);

  if (match) {
    return { action: 'default', name: match[1] };
  }

  match = command.match(/^(?:remover|excluir|apagar)\s+cartao\s+(.+)$/);

  if (match) {
    return { action: 'remove', name: match[1] };
  }

  match = command.match(/^(?:a\s+|minha\s+)?fatura\s+(?:do\s+|da\s+|de\s+)?(?:cartao\s+)?(.+?)\s+fechou\s+(hoje|ontem|dia\s+\d{1,2})$/) ||
    command.match(/^(?:o\s+)?(?:cartao\s+)?(.+?)\s+fechou\s+(hoje|ontem|dia\s+\d{1,2})$/);

  if (match) {
    return { action: 'closed', name: match[1], when: match[2] };
  }

  match = command.match(/^(?:a\s+fatura\s+(?:do\s+|da\s+)?)?(?:cartao\s+)?(.+?)\s+(vence|fecha)\s+(?:todo\s+)?(?:dia\s+)?(\d{1,2})$/);

  if (match && !/^(meu|minha|o meu)$/.test(match[1]) && !/^meu\s+cartao/.test(command)) {
    return {
      action: 'update_day',
      day: validDay(Number(match[3])),
      field: match[2] === 'vence' ? 'diaVencimento' : 'diaFechamento',
      name: match[1],
    };
  }

  return null;
}

function cardLine(card, index) {
  return `${index + 1}. ${card.apelido}${card.padrao ? ' (padrão)' : ''} — fecha ~dia ${card.diaFechamento}, vence dia ${card.diaVencimento}`;
}

function createCardService({
  dateUtils,
  db,
  firebaseOps,
  idGenerator = () => `card_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  now = () => new Date(),
  onCardClosed = async () => ({ closed: 0 }),
  userData,
}) {
  const { ref, update } = firebaseOps;

  async function listCards(tag) {
    const cards = (await userData.readChild(tag, 'cartoes')) || {};

    return Object.entries(cards)
      .filter(([, card]) => card && card.apelido)
      .map(([id, card]) => ({ id, ...card }))
      .sort((a, b) => Number(Boolean(b.padrao)) - Number(Boolean(a.padrao)) || a.apelido.localeCompare(b.apelido));
  }

  async function findCard(tag, name) {
    const normalized = normalizeNickname(name).replace(/^cartao\s+/, '');

    return (await listCards(tag)).find((card) => normalizeNickname(card.apelido) === normalized) || null;
  }

  function cardPath(tag, id) {
    return `${userPath(tag)}/cartoes/${id}`;
  }

  async function addCard(session, command) {
    const tag = sessionTag(session);

    if (command.sensitive) {
      return '🔒 Não guardo número do cartão, validade ou CVV. Envie só um apelido e os dias. Exemplo: adicionar cartão Nubank fecha dia 3 vence dia 10';
    }

    if (!command.name || command.name.length < 2) {
      return 'Informe um apelido para o cartão. Exemplo: adicionar cartão Nubank fecha dia 3 vence dia 10';
    }

    if (!command.dueDay) {
      return `Qual o dia de vencimento do ${command.name}? Exemplo: adicionar cartão ${command.name} fecha dia 3 vence dia 10`;
    }

    const cards = await listCards(tag);

    if (cards.some((card) => normalizeNickname(card.apelido) === normalizeNickname(command.name))) {
      return `Você já tem um cartão chamado ${command.name}. Use outro apelido ou corrija os dias com: ${command.name} vence dia 10`;
    }

    if (cards.length >= MAX_CARDS) {
      return `Você já tem ${MAX_CARDS} cartões cadastrados. Remova um antes de adicionar outro.`;
    }

    const estimatedClosing = !command.closingDay;
    const closingDay = command.closingDay || (((command.dueDay - 7 - 1 + 31) % 31) + 1);
    const id = idGenerator();
    const isDefault = cards.length === 0;

    await update(ref(db), {
      [cardPath(tag, id)]: {
        apelido: command.name,
        atualizadoEm: now().toISOString(),
        diaFechamento: closingDay,
        diaVencimento: command.dueDay,
        padrao: isDefault,
      },
    });

    return [
      `Cartão ${command.name} cadastrado ✅${isDefault ? ' (padrão)' : ''}`,
      `Fechamento estimado: dia ${closingDay}${estimatedClosing ? ' (estimei 7 dias antes do vencimento)' : ''} · Vencimento: dia ${command.dueDay}`,
      `Quando a fatura fechar, você pode corrigir: minha fatura ${command.name} fechou hoje`,
    ].join('\n');
  }

  async function setDefault(session, name) {
    const tag = sessionTag(session);
    const card = await findCard(tag, name);

    if (!card) {
      return `Não encontrei o cartão "${name}". Veja seus cartões: meus cartões`;
    }

    const multipath = {};

    (await listCards(tag)).forEach((item) => {
      multipath[`${cardPath(tag, item.id)}/padrao`] = item.id === card.id;
    });
    multipath[`${cardPath(tag, card.id)}/atualizadoEm`] = now().toISOString();
    await update(ref(db), multipath);

    return `${card.apelido} agora é seu cartão padrão ✅`;
  }

  async function removeCard(session, name) {
    const tag = sessionTag(session);
    const card = await findCard(tag, name);

    if (!card) {
      return `Não encontrei o cartão "${name}".`;
    }

    const remaining = (await listCards(tag)).filter((item) => item.id !== card.id);
    const multipath = { [cardPath(tag, card.id)]: null };

    if (card.padrao && remaining.length) {
      multipath[`${cardPath(tag, remaining[0].id)}/padrao`] = true;
    }

    await update(ref(db), multipath);

    return `Cartão ${card.apelido} removido. Divisões e cobranças já registradas continuam com as datas calculadas.`;
  }

  async function closed(session, command) {
    const tag = sessionTag(session);
    const card = await findCard(tag, command.name);

    if (!card) {
      return null;
    }

    const today = dateUtils.todayIso(now());
    let closingIso = today;

    if (command.when === 'ontem') {
      closingIso = dateUtils.todayIso(new Date(now().getTime() - 24 * 60 * 60 * 1000));
    } else if (/^dia/.test(command.when)) {
      const day = validDay(Number(command.when.replace(/\D/g, '')));

      if (!day) {
        return 'Informe um dia entre 1 e 31.';
      }

      closingIso = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;

      if (closingIso > today) {
        return 'Esse dia ainda não chegou neste mês. Informe quando a fatura realmente fechou.';
      }
    }

    const day = Number(closingIso.slice(8, 10));

    await update(ref(db), {
      [`${cardPath(tag, card.id)}/diaFechamento`]: day,
      [`${cardPath(tag, card.id)}/atualizadoEm`]: now().toISOString(),
    });

    const result = await onCardClosed(session, { ...card, diaFechamento: day }, closingIso);
    const dayBefore = new Date(`${closingIso}T12:00:00Z`);

    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    const cycle = computeCycle({ ...card, diaFechamento: day }, dayBefore.toISOString().slice(0, 10));

    return [
      `Fechamento do ${card.apelido} corrigido para dia ${day} ✅`,
      cycle ? `Vencimento desta fatura: ${formatDateBr(cycle.vencimento)}` : '',
      result?.closed
        ? `${result.closed} cobrança(s) ligada(s) a esse cartão agora estão disponíveis para pagamento.`
        : 'Nenhuma cobrança aguardava esse fechamento.',
    ].filter(Boolean).join('\n');
  }

  async function updateDay(session, command) {
    const tag = sessionTag(session);
    const card = await findCard(tag, command.name);

    if (!card) {
      return null;
    }

    if (!command.day) {
      return 'Informe um dia entre 1 e 31.';
    }

    await update(ref(db), {
      [`${cardPath(tag, card.id)}/${command.field}`]: command.day,
      [`${cardPath(tag, card.id)}/atualizadoEm`]: now().toISOString(),
    });

    return `${card.apelido}: ${command.field === 'diaVencimento' ? 'vencimento' : 'fechamento estimado'} agora é dia ${command.day} ✅`;
  }

  async function process(session, text) {
    const command = parseCardCommand(text);

    if (!command) {
      return null;
    }

    if (command.action === 'add') {
      return await addCard(session, command);
    }

    if (command.action === 'list') {
      const cards = await listCards(sessionTag(session));

      return cards.length
        ? ['💳 Seus cartões:', ...cards.map(cardLine), '', 'Fechamento é estimado; corrija com: minha fatura NOME fechou hoje'].join('\n')
        : 'Você ainda não tem cartões. Exemplo: adicionar cartão Nubank fecha dia 3 vence dia 10';
    }

    if (command.action === 'default') {
      return await setDefault(session, command.name);
    }

    if (command.action === 'remove') {
      return await removeCard(session, command.name);
    }

    if (command.action === 'closed') {
      return await closed(session, command);
    }

    if (command.action === 'update_day') {
      return await updateDay(session, command);
    }

    return null;
  }

  return {
    findCard,
    listCards,
    process,
  };
}

module.exports = {
  createCardService,
  hasSensitiveCardData,
  parseCardCommand,
};
