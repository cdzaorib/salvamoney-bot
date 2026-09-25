'use strict';

const { foldText } = require('../ai/privacy');
const { fromCents, parseMoneyToken, toCents } = require('./finance-utils');
const { findFriendMentions, normalizeNickname } = require('./friend-matcher');

const SPLIT_VERB = /^(dividir|divide|dividi|divida|divido|dividimos|divdir|dvidir|divir|dividr|rachar|racha|rachei|rachamos|rachando)$/;
const CHARGE_VERB = /^(cobrar|cobra|cobre|cobrei)$/;
const OWE_VERB = /^(deve|devem|devendo)$/;
const TOTAL_MARKERS = new Set(['dividir', 'divide', 'dividi', 'divida', 'divido', 'dividimos', 'divdir', 'dvidir', 'divir', 'dividr',
  'rachar', 'racha', 'rachei', 'rachamos', 'rachando', 'deu', 'total', 'gastei', 'paguei', 'foi', 'custou', 'saiu', 'conta']);
const EXCLUDE_PAYER_PATTERNS = [
  /\b(somente|so|apenas|soh)\s+entre\b/,
  /\bentre\s+eles\b/,
  /\bsem\s+mim\b/,
  /\beu\s+nao\s+(participei|participo|entro|comi|bebi)\b/,
  /\bnao\s+conta\s+comigo\b/,
];
const FRACTION_WORDS = [
  { den: 2, num: 1, pattern: /^(metade|meio)$/ },
  { den: 3, num: 1, pattern: /^(terco|terca)$/ },
  { den: 4, num: 1, pattern: /^quarto$/ },
];
const STOP_WORDS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'e', 'de', 'do', 'da', 'dos', 'das', 'com', 'c', 'c/', 'entre', 'no', 'na', 'nos', 'nas',
  'pelo', 'pela', 'via', 'em', 'para', 'pra', 'pro', 'me', 'eu', 'mim', 'que', 'foi', 'deu', 'conta', 'total', 'reais', 'real',
  'r$', 'x', 'vezes', 'vez', 'parcelado', 'parcelada', 'parcelas', 'cada', 'igual', 'igualmente', 'metade', 'meio', 'terco',
  'terca', 'quarto', 'dois', 'duas', 'tres', 'parte', 'somente', 'so', 'soh', 'apenas', 'sem', 'eles', 'elas', 'deve', 'devem',
  'devendo', 'paga', 'pagam', 'pagou', 'vai', 'pagar', 'fica', 'ficou', 'cartao', 'credito', 'debito', 'pix', 'gastei',
  'paguei', 'custou', 'saiu', 'por', 'cento', 'ao', 'todo', 'valor', 'mais', 'nao', 'participei', 'participo', 'entro', ':',
  ',', ';', 'cobrar', 'cobra', 'cobre', 'ele', 'ela', 'dele', 'dela', 'hoje', 'ontem', 'comigo',
]);

function tokenizeWithOriginal(text) {
  const prepared = String(text || '')
    .replace(/(\d)\s*%/g, '$1%')
    .replace(/[,;:](?=\s|$)/g, ' $& ')
    .replace(/\br\$\s*/gi, 'R$')
    .replace(/(\d)\s*x\b/gi, '$1x');

  return prepared.split(/\s+/).filter(Boolean).map((original) => ({
    norm: foldText(original).replace(/[!?.]+$/g, ''),
    original: original.replace(/[!?.]+$/g, ''),
  }));
}

function moneyValue(token) {
  if (!/^(r\$)?\d{1,3}(\.\d{3})+(,\d{1,2})?$|^(r\$)?\d+([.,]\d{1,2})?$/.test(token)) {
    return null;
  }

  const value = parseMoneyToken(token);

  return value !== null && value > 0 ? value : null;
}

function percentValue(token, next) {
  let match = token.match(/^(\d{1,3}(?:[.,]\d{1,2})?)%$/);

  if (match) {
    return Number(match[1].replace(',', '.'));
  }

  if (next === 'por' && /^\d{1,3}$/.test(token)) {
    return null;
  }

  match = token.match(/^(\d{1,3})$/);

  return match && next === '%' ? Number(match[1]) : null;
}

function fractionAt(tokens, index) {
  const token = tokens[index]?.norm;
  const match = token?.match(/^(\d)\/(\d)$/);

  if (match && Number(match[2]) > 0 && Number(match[1]) < Number(match[2])) {
    return { den: Number(match[2]), num: Number(match[1]), width: 1 };
  }

  const prefix = tokens[index]?.norm;
  const next = tokens[index + 1]?.norm;
  const multiplier = prefix === 'dois' || prefix === 'duas' ? 2 : prefix === 'tres' ? 3 : prefix === 'um' || prefix === 'uma' ? 1 : null;

  if (multiplier && next) {
    const word = FRACTION_WORDS.find(({ pattern }) => pattern.test(next.replace(/s$/, '')));

    if (word && multiplier < word.den) {
      return { den: word.den, num: multiplier * word.num, width: 2 };
    }
  }

  const word = FRACTION_WORDS.find(({ pattern }) => pattern.test(token || ''));

  return word && word.den === 2 ? { den: 2, num: 1, width: 1 } : null;
}

function installmentsFrom(tokens) {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].norm;
    let match = token.match(/^(\d{1,2})x$/);

    if (match) {
      return { count: Number(match[1]), indexes: [index] };
    }

    match = token.match(/^(\d{1,2})$/);

    if (match && ['vezes', 'parcelas'].includes(tokens[index + 1]?.norm)) {
      return { count: Number(match[1]), indexes: [index, index + 1] };
    }
  }

  return { count: null, indexes: [] };
}

function detectPayment(tokens, cards) {
  const folded = tokens.map((token) => token.norm).join(' ');
  const sortedCards = [...(cards || [])]
    .map((card) => ({ card, parts: normalizeNickname(card.apelido).split(' ').filter(Boolean) }))
    .sort((a, b) => b.parts.length - a.parts.length);

  for (let index = 0; index < tokens.length; index++) {
    const previous = tokens[index - 1]?.norm;

    if (!['no', 'na', 'pelo', 'pela', 'cartao', 'via'].includes(previous)) {
      continue;
    }

    for (const { card, parts } of sortedCards) {
      const slice = tokens.slice(index, index + parts.length).map((token) => normalizeNickname(token.norm));

      if (parts.length && slice.join(' ') === parts.join(' ')) {
        return {
          cardId: card.id,
          cardName: card.apelido,
          indexes: Array.from({ length: parts.length }, (_, offset) => index + offset),
          tipo: 'cartao',
        };
      }
    }
  }

  if (/\bpix\b/.test(folded)) {
    return { indexes: [], tipo: 'pix' };
  }

  if (/\bdebito\b/.test(folded)) {
    return { indexes: [], tipo: 'debito' };
  }

  if (/\b(cartao|credito)\b/.test(folded)) {
    return { indexes: [], tipo: 'cartao' };
  }

  return { indexes: [], tipo: null };
}

// Nomes citados depois de "com"/"entre" que não correspondem a amigos cadastrados.
// Gramática: com NOME ((, | e) NOME)* — qualquer outra palavra encerra a lista.
function unknownNames(tokens, usedIndexes) {
  const unknown = [];

  tokens.forEach((token, index) => {
    if (!['com', 'entre', 'c/'].includes(token.norm)) {
      return;
    }

    let expectName = true;

    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const current = tokens[cursor];

      if (expectName && ['o', 'a', 'os', 'as'].includes(current.norm)) {
        continue;
      }

      if (!expectName) {
        if (['e', ','].includes(current.norm)) {
          expectName = true;
          continue;
        }

        break;
      }

      if (usedIndexes.has(cursor)) {
        expectName = false;
        continue;
      }

      if (STOP_WORDS.has(current.norm) || /\d/.test(current.norm) || !/^[\p{L}][\p{L}'-]*$/u.test(current.original)) {
        break;
      }

      unknown.push(current.original);
      expectName = false;
    }
  });

  return [...new Set(unknown)];
}

function describe(tokens, usedIndexes, fallback = 'Divisão') {
  const words = tokens
    .filter((token, index) => !usedIndexes.has(index))
    .filter((token) => !STOP_WORDS.has(token.norm))
    .filter((token) => !/\d/.test(token.norm))
    .filter((token) => /^[\p{L}][\p{L}'-]*$/u.test(token.original))
    .map((token) => token.original)
    .slice(0, 4);
  const text = words.join(' ').trim();

  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : fallback;
}

// Prioridade: 1) valor devido explícito; 2) percentual ou fração; 3) divisão igual.
// Quem pagou absorve as diferenças de arredondamento; nenhum valor passa de 2 casas.
function computeShares({ includePayer, people, totalCents }) {
  const fixed = [];
  const equal = [];

  people.forEach((person) => {
    if (Number.isInteger(person.explicitCents)) {
      fixed.push({ ...person, cents: person.explicitCents, mode: 'explicito' });
    } else if (person.percent !== undefined && person.percent !== null) {
      fixed.push({ ...person, cents: totalCents === null ? null : Math.floor(totalCents * person.percent / 100), mode: 'percentual' });
    } else if (person.fraction) {
      fixed.push({ ...person, cents: totalCents === null ? null : Math.floor(totalCents * person.fraction.num / person.fraction.den), mode: 'fracao' });
    } else {
      equal.push(person);
    }
  });

  if (totalCents === null) {
    if (equal.length || fixed.some((person) => person.cents === null)) {
      return { error: 'missing_total' };
    }

    return {
      participants: fixed,
      payerCents: null,
    };
  }

  const fixedSum = fixed.reduce((total, person) => total + person.cents, 0);

  if (fixedSum > totalCents) {
    return { error: 'over_total', fixedSum };
  }

  const remainder = totalCents - fixedSum;
  const divisor = equal.length + (includePayer ? 1 : 0);
  const each = divisor > 0 ? Math.floor(remainder / divisor) : 0;
  const participants = [
    ...fixed,
    ...equal.map((person) => ({ ...person, cents: each, mode: 'igual' })),
  ];
  const friendsSum = participants.reduce((total, person) => total + person.cents, 0);

  if (participants.some((person) => person.cents <= 0)) {
    return { error: 'zero_share' };
  }

  return {
    participants,
    payerCents: totalCents - friendsSum,
  };
}

function hasSplitIntent(tokens) {
  return tokens.some((token) => SPLIT_VERB.test(token.norm));
}

function parseSplitMessage(text, { cards = [], friends = [] } = {}) {
  const folded = foldText(text).replace(/\s+/g, ' ').trim();

  // Mensagens com tag de 6 dígitos seguem pelo fluxo de cobrança existente.
  if (/\b\d{6}\b/.test(folded)) {
    return null;
  }

  const tokens = tokenizeWithOriginal(text);
  const splitIntent = hasSplitIntent(tokens);
  const chargeIntent = tokens.some((token) => CHARGE_VERB.test(token.norm));
  const oweIntent = tokens.some((token) => OWE_VERB.test(token.norm));

  if (!splitIntent && !chargeIntent && !oweIntent) {
    return null;
  }

  const { ambiguous, matches } = findFriendMentions(text, friends);

  if (!matches.length && !ambiguous.length) {
    if (!splitIntent) {
      return null;
    }

    const unknown = unknownNames(tokens, new Set());

    if (unknown.length) {
      return {
        error: `Não encontrei ${unknown.join(', ')} entre seus amigos. Para convidar: adicionar amigo 123456`,
      };
    }

    return {
      error: 'Com quem você quer dividir? Exemplo: dividir 150 com Carlos',
    };
  }

  if (ambiguous.length) {
    const { options, word } = ambiguous[0];

    return {
      ambiguity: `Qual ${word[0].toUpperCase()}${word.slice(1)}? ${options.map((friend) => friend.apelido).join(' ou ')}. Reenvie usando o apelido completo.`,
    };
  }

  // Mapeia menções para índices de tokens (todas as ocorrências de cada apelido).
  const occurrences = new Map();
  const usedIndexes = new Set();
  const people = [];

  matches.forEach(({ friend }) => {
    const parts = normalizeNickname(friend.apelido).split(' ');
    const ranges = [];

    for (let index = 0; index < tokens.length; index++) {
      if (usedIndexes.has(index)) {
        continue;
      }

      const slice = tokens.slice(index, index + parts.length).map((token) => normalizeNickname(token.norm));

      if (slice.join(' ') === parts.join(' ')) {
        ranges.push({ end: index + parts.length - 1, start: index });
        slice.forEach((_, offset) => usedIndexes.add(index + offset));
        index += parts.length - 1;
      } else if (parts.length > 1 && normalizeNickname(tokens[index].norm) === parts[0] &&
        !matches.some((other) => other.friend.tag !== friend.tag && normalizeNickname(other.friend.apelido) === parts[0])) {
        ranges.push({ end: index, start: index });
        usedIndexes.add(index);
      }
    }

    occurrences.set(friend.tag, ranges);
  });

  // Pronome ("ele paga 30%") só é associado quando há um único amigo citado.
  if (matches.length > 1 && tokens.some((token) => ['ele', 'ela'].includes(token.norm))) {
    return {
      ambiguity: 'Não sei a quem "ele/ela" se refere. Reenvie usando o apelido. Exemplo: dividir 90 com Carlos e Ana, Ana paga 30',
    };
  }

  if (matches.length === 1) {
    tokens.forEach((token, index) => {
      if (['ele', 'ela'].includes(token.norm) && !usedIndexes.has(index)) {
        occurrences.get(matches[0].friend.tag).push({ end: index, start: index });
        usedIndexes.add(index);
      }
    });
  }

  const payment = detectPayment(tokens, cards);

  payment.indexes.forEach((index) => usedIndexes.add(index));

  const installments = installmentsFrom(tokens);

  installments.indexes.forEach((index) => usedIndexes.add(index));

  const mentionStarts = [...occurrences.values()].flat().map((range) => range.start);

  function valueAfter(range, person) {
    // Valor logo após o apelido ("Carlos me deve 150", "Carlos 50", "Carlos paga 30%").
    for (let cursor = range.end + 1; cursor <= range.end + 5 && cursor < tokens.length; cursor++) {
      if (mentionStarts.includes(cursor) || [',', ';'].includes(tokens[cursor].norm)) {
        return false;
      }

      if (usedIndexes.has(cursor)) {
        continue;
      }

      const percent = percentValue(tokens[cursor].norm, tokens[cursor + 1]?.norm);

      if (percent !== null) {
        person.percent = percent;
        usedIndexes.add(cursor);
        return true;
      }

      const fraction = fractionAt(tokens, cursor);

      if (fraction) {
        person.fraction = fraction;
        for (let offset = 0; offset < fraction.width; offset++) {
          usedIndexes.add(cursor + offset);
        }
        return true;
      }

      const value = moneyValue(tokens[cursor].norm);

      if (value !== null && !['vezes', 'parcelas'].includes(tokens[cursor + 1]?.norm)) {
        person.explicitCents = toCents(value);
        usedIndexes.add(cursor);
        return true;
      }
    }

    return false;
  }

  function valueBefore(range, person) {
    // Forma "cobrar 80 do Carlos": valor antes do apelido.
    const before = tokens[range.start - 1]?.norm;
    const valueIndex = ['do', 'da', 'pro', 'pra', 'de', 'para'].includes(before) ? range.start - 2 : null;
    const value = valueIndex !== null && !usedIndexes.has(valueIndex) ? moneyValue(tokens[valueIndex]?.norm || '') : null;

    if (value !== null && (chargeIntent || oweIntent)) {
      person.explicitCents = toCents(value);
      usedIndexes.add(valueIndex);
      return true;
    }

    return false;
  }

  matches.forEach(({ friend }) => {
    const person = { apelido: friend.apelido, tag: friend.tag };
    const ranges = occurrences.get(friend.tag) || [];

    if (!ranges.some((range) => valueAfter(range, person))) {
      ranges.some((range) => valueBefore(range, person));
    }

    people.push(person);
  });

  const unknown = unknownNames(tokens, usedIndexes);

  if (unknown.length) {
    return {
      error: `Não encontrei ${unknown.join(', ')} entre seus amigos. Confira o apelido em: meus amigos`,
    };
  }

  // Total: primeiro valor livre depois de um marcador ("dividir 150", "a conta deu 300").
  let totalCents = null;

  for (let index = 0; index < tokens.length; index++) {
    if (usedIndexes.has(index)) {
      continue;
    }

    const value = moneyValue(tokens[index].norm);

    if (value === null || percentValue(tokens[index].norm, tokens[index + 1]?.norm) !== null) {
      continue;
    }

    const window = tokens.slice(Math.max(0, index - 3), index).map((token) => token.norm);

    if (window.some((word) => TOTAL_MARKERS.has(word)) || splitIntent) {
      totalCents = toCents(value);
      usedIndexes.add(index);
      break;
    }
  }

  const includePayer = !EXCLUDE_PAYER_PATTERNS.some((pattern) => pattern.test(folded));
  const kind = totalCents === null && (chargeIntent || oweIntent) ? 'charge' : 'split';

  if (kind === 'split' && totalCents === null) {
    return {
      error: 'Qual foi o valor total? Exemplo: dividir 150 com Carlos',
    };
  }

  const shares = computeShares({ includePayer, people, totalCents });

  if (shares.error === 'missing_total') {
    return { error: 'Informe o valor. Exemplo: cobrar 80 do Carlos' };
  }

  if (shares.error === 'over_total') {
    return {
      error: `Os valores dos amigos somam R$ ${fromCents(shares.fixedSum).toFixed(2).replace('.', ',')}, mais que o total. Confira e envie de novo.`,
    };
  }

  if (shares.error === 'zero_share') {
    return {
      error: 'Com esses valores a parte de alguém ficou zerada. Confira os valores e envie de novo.',
    };
  }

  tokens.forEach((token, index) => {
    if (SPLIT_VERB.test(token.norm) || CHARGE_VERB.test(token.norm)) {
      usedIndexes.add(index);
    }
  });

  return {
    draft: {
      description: describe(tokens, usedIndexes, kind === 'charge' ? 'Cobrança' : 'Divisão'),
      includePayer,
      installments: installments.count && installments.count >= 2 ? Math.min(installments.count, 24) : null,
      kind,
      participants: shares.participants.map((person) => ({
        apelido: person.apelido,
        cents: person.cents,
        mode: person.mode,
        tag: person.tag,
      })),
      payerCents: shares.payerCents,
      payment: {
        cardId: payment.cardId || null,
        cardName: payment.cardName || null,
        tipo: payment.tipo,
      },
      totalCents,
    },
  };
}

module.exports = {
  computeShares,
  parseSplitMessage,
  tokenizeWithOriginal,
};
