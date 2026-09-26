'use strict';

// Camada de desidentificação aplicada antes de qualquer envio a provedores externos.
// Mantém números agregados, percentuais, categorias e prazos; remove nomes, contatos,
// tags, apelidos, identificadores internos e descrições pessoais.

const FORBIDDEN_KEYS = new Set([
  'apelido',
  'apelidos',
  'cartaoid',
  'cobrancaid',
  'createdby',
  'desc',
  'descricao',
  'description',
  'displayname',
  'divisaoid',
  'email',
  'group',
  'grupo',
  'id',
  'key',
  'legacyexpenseid',
  'legacygroup',
  'legacyuser',
  'messageid',
  'name',
  'nickname',
  'nome',
  'nomedestino',
  'nomeorigem',
  'parcelaid',
  'phone',
  'phonedestino',
  'phoneorigem',
  'primeironome',
  'remotejid',
  'session',
  'sessao',
  'sharetag',
  'sourcepath',
  'tag',
  'tagdestino',
  'tagorigem',
  'telefone',
  'uid',
  'user',
  'userid',
  'usuario',
  'whatsapp',
]);

// Campos de texto livre digitados pelo usuário: seguem, mas sempre redigidos.
const FREE_TEXT_KEYS = new Set([
  'perguntausuario',
  'pergunta',
  'mensagem',
]);

const MAX_DEPTH = 8;

function foldChar(char) {
  const folded = char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  return folded.length === 1 ? folded : char.toLowerCase().slice(0, 1) || char;
}

function foldText(text) {
  return Array.from(String(text || '')).map(foldChar).join('');
}

function normalizeKey(key) {
  return foldText(key).replace(/[^a-z0-9]/g, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function digitCount(value) {
  return (String(value).match(/\d/g) || []).length;
}

// Substitui ocorrências (sem acento, sem caixa) preservando o restante do texto original.
function replaceFolded(text, term, replacement) {
  const original = Array.from(String(text || ''));
  const folded = original.map(foldChar).join('');
  const needle = foldText(term).trim();

  if (!needle) {
    return String(text || '');
  }

  const pattern = new RegExp(`(^|[^a-z0-9])(${escapeRegExp(needle).replace(/\s+/g, '\\s+')})(?=$|[^a-z0-9])`, 'g');
  const ranges = [];
  let match;

  while ((match = pattern.exec(folded)) !== null) {
    const start = match.index + match[1].length;

    ranges.push([start, start + match[2].length]);
    pattern.lastIndex = start + match[2].length;
  }

  if (!ranges.length) {
    return String(text || '');
  }

  let result = '';
  let cursor = 0;

  ranges.forEach(([start, end]) => {
    result += original.slice(cursor, start).join('') + replacement;
    cursor = end;
  });

  return result + original.slice(cursor).join('');
}

function redactText(value, {
  knownTags = [],
  names = [],
  nicknames = [],
} = {}) {
  let text = String(value || '');

  text = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]');
  text = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]');
  text = text.replace(/\+?\d[\d\s().-]{8,}\d/g, (match) => (digitCount(match) >= 10 ? '[numero]' : match));
  text = text.replace(/\b(tag|codigo|código)\s*:?\s*#?\d{6}\b/gi, '$1 [tag]');

  knownTags
    .map((tag) => String(tag || '').replace(/\D/g, ''))
    .filter((tag) => /^\d{6}$/.test(tag))
    .forEach((tag) => {
      text = text.replace(new RegExp(`\\b${tag}\\b`, 'g'), '[tag]');
    });

  const placeholders = {};
  const sortedNicknames = [...new Set(nicknames.map((item) => String(item || '').trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  sortedNicknames.forEach((nickname, index) => {
    const placeholder = `PESSOA_${index + 1}`;
    const replaced = replaceFolded(text, nickname, placeholder);

    if (replaced !== text) {
      placeholders[placeholder] = nickname;
      text = replaced;
    }
  });

  names
    .map((name) => String(name || '').trim())
    .filter((name) => name.length >= 2)
    .forEach((name) => {
      text = replaceFolded(text, name, '[usuario]');
    });

  return {
    placeholders,
    text,
  };
}

function redactPlainText(value, options = {}) {
  return redactText(value, options).text;
}

function sanitizeForExternal(value, options = {}, depth = 0) {
  if (depth > MAX_DEPTH) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForExternal(item, options, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const result = {};

    Object.entries(value).forEach(([key, item]) => {
      const normalized = normalizeKey(key);

      if (FORBIDDEN_KEYS.has(normalized)) {
        return;
      }

      const sanitized = FREE_TEXT_KEYS.has(normalized)
        ? redactPlainText(item, options)
        : sanitizeForExternal(item, options, depth + 1);

      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    });

    return result;
  }

  if (typeof value === 'string') {
    return redactPlainText(value, options);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  return undefined;
}

function sanitizeMessageContent(content, options = {}) {
  const text = String(content || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      const prefix = redactPlainText(text.slice(0, start), options);
      const suffix = redactPlainText(text.slice(end + 1), options);

      return `${prefix}${JSON.stringify(sanitizeForExternal(parsed, options), null, 2)}${suffix}`;
    } catch (_) {
      // Conteúdo não é JSON: segue como texto redigido.
    }
  }

  return redactPlainText(text, options);
}

function sanitizeMessages(messages = [], options = {}) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: ['system', 'user', 'assistant'].includes(message.role) ? message.role : 'user',
      content: typeof message.content === 'string'
        ? sanitizeMessageContent(message.content, options)
        : sanitizeMessageContent(JSON.stringify(message.content || ''), options),
    }));
}

// Verificação usada em testes e como trava final: nenhum dado identificável pode sair.
function findSensitiveData(text, {
  knownTags = [],
  names = [],
  nicknames = [],
  phones = [],
} = {}) {
  const content = String(text || '');
  const folded = foldText(content);
  const findings = [];

  if (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(content)) {
    findings.push('email');
  }

  phones
    .map((phone) => String(phone || '').replace(/\D/g, ''))
    .filter(Boolean)
    .forEach((phone) => {
      if (content.replace(/\D/g, '').includes(phone.slice(-8))) {
        findings.push('phone');
      }
    });

  knownTags.filter(Boolean).forEach((tag) => {
    if (new RegExp(`\\b${escapeRegExp(tag)}\\b`).test(content)) {
      findings.push('tag');
    }
  });

  [...names, ...nicknames].filter((item) => String(item || '').trim().length >= 2).forEach((item) => {
    const needle = foldText(item).trim();

    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`).test(folded)) {
      findings.push('name');
    }
  });

  return [...new Set(findings)];
}

module.exports = {
  FORBIDDEN_KEYS,
  findSensitiveData,
  foldText,
  redactPlainText,
  redactText,
  replaceFolded,
  sanitizeForExternal,
  sanitizeMessages,
};
