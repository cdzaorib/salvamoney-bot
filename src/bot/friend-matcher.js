'use strict';

const { foldText } = require('../ai/privacy');

// Amigos só são reconhecidos perto de verbos financeiros. "Almocei com Carlos"
// não gera cobrança; "dividir 50 com Carlos" sim.
const FINANCIAL_VERB_PATTERN = /\b(divid\w*|divd\w*|dvid\w*|dividi|rach\w*|cobr\w*|dev\w*|pag\w*|receb\w*|reembols\w*|acert\w*|transfer\w*|pix)\b/;
const PROXIMITY_WORDS = 10;

function normalizeNickname(value) {
  return foldText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeNickname(text).split(' ').filter(Boolean);
}

function hasFinancialVerb(text) {
  return FINANCIAL_VERB_PATTERN.test(normalizeNickname(text));
}

function verbPositions(tokens) {
  return tokens
    .map((token, index) => (FINANCIAL_VERB_PATTERN.test(token) ? index : -1))
    .filter((index) => index >= 0);
}

// Retorna { matches: [{friend, start, end}], ambiguous: [{word, options}] }.
function findFriendMentions(text, friends = [], { requireVerb = true } = {}) {
  const tokens = tokenize(text);
  const verbs = verbPositions(tokens);

  if (requireVerb && !verbs.length) {
    return { ambiguous: [], matches: [] };
  }

  const candidates = friends
    .filter((friend) => friend?.apelido)
    .map((friend) => ({ friend, parts: tokenize(friend.apelido) }))
    .filter((item) => item.parts.length)
    .sort((a, b) => b.parts.length - a.parts.length);
  const used = new Array(tokens.length).fill(false);
  const matches = [];

  function nearVerb(start, end) {
    return !requireVerb || verbs.some((verb) => verb >= start - PROXIMITY_WORDS && verb <= end + PROXIMITY_WORDS);
  }

  candidates.forEach(({ friend, parts }) => {
    for (let index = 0; index + parts.length <= tokens.length; index++) {
      const slice = tokens.slice(index, index + parts.length);

      if (slice.join(' ') !== parts.join(' ') || used.slice(index, index + parts.length).some(Boolean)) {
        continue;
      }

      if (!nearVerb(index, index + parts.length - 1)) {
        continue;
      }

      for (let offset = index; offset < index + parts.length; offset++) {
        used[offset] = true;
      }

      if (!matches.some((match) => match.friend.tag === friend.tag)) {
        matches.push({ end: index + parts.length - 1, friend, start: index });
      }
    }
  });

  // Palavra solta que é o início de mais de um apelido ("Carlos" com
  // "Carlos trabalho" e "Carlos faculdade"): pede esclarecimento.
  const ambiguous = [];

  tokens.forEach((token, index) => {
    if (used[index] || token.length < 3 || !nearVerb(index, index)) {
      return;
    }

    const options = candidates
      .filter(({ parts }) => parts.length > 1 && parts[0] === token)
      .map(({ friend }) => friend);

    if (options.length > 1 && !ambiguous.some((item) => item.word === token)) {
      ambiguous.push({ options, word: token });
    } else if (options.length === 1 && !matches.some((match) => match.friend.tag === options[0].tag)) {
      used[index] = true;
      matches.push({ end: index, friend: options[0], partial: true, start: index });
    }
  });

  return {
    ambiguous,
    matches: matches.sort((a, b) => a.start - b.start),
  };
}

module.exports = {
  FINANCIAL_VERB_PATTERN,
  findFriendMentions,
  hasFinancialVerb,
  normalizeNickname,
  tokenize,
};
