'use strict';

const { parseMoney } = require('../expense-parser');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const FINANCIAL_PROFILE_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const PROFILE_VIEW_COMMANDS = new Set([
  'meu perfil financeiro',
  'ver perfil financeiro',
]);
const MONEY_PATTERN = /(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?/i;

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/\s+/g, ' ');
}

function formatMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatProfileMoney(value) {
  return Number.isFinite(Number(value)) ? formatMoney(value) : '-';
}

function formatProfileDay(value, prefix = '') {
  const day = Number(value);

  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return '-';
  }

  return prefix ? `${prefix} ${day}` : String(day);
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

function extractMoney(text) {
  const withoutDay = String(text || '').replace(/\b(?:todo\s+)?dia\s+\d{1,3}\b/gi, ' ');
  const match = withoutDay.match(MONEY_PATTERN);

  if (!match) {
    return {
      found: false,
      value: null,
    };
  }

  const before = withoutDay.slice(Math.max(0, match.index - 2), match.index);

  if (before.includes('-')) {
    return {
      found: true,
      value: null,
    };
  }

  return {
    found: true,
    value: normalizeMoneyValue(match[0]),
  };
}

function extractDay(text) {
  const match = normalizedCommand(text).match(/\bdia\s+(\d{1,3})\b/);

  if (!match) {
    return {
      found: false,
      value: null,
    };
  }

  return {
    found: true,
    value: Number(match[1]),
  };
}

function isValidDay(value) {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function isPositiveMoney(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isIncomeCommand(command) {
  return /^(recebo|ganho)\b/.test(command) ||
    /^meu salario\b/.test(command) ||
    /^minha renda\b/.test(command) ||
    /^renda mensal\b/.test(command);
}

function isCardDueCommand(command) {
  return /\b(cartao|cartao de credito)\b/.test(command) &&
    /\b(vence|vencimento)\b/.test(command);
}

function isBudgetCommand(command) {
  return /^definir orcamento\b/.test(command) ||
    /^meu orcamento mensal\b/.test(command) ||
    /^orcamento mensal\b/.test(command);
}

function parseFinancialProfileCommand(text) {
  const command = normalizedCommand(text);

  if (PROFILE_VIEW_COMMANDS.has(command)) {
    return {
      action: 'view',
    };
  }

  if (isIncomeCommand(command)) {
    const money = extractMoney(text);
    const day = extractDay(text);
    const fields = {};

    if (money.found) {
      if (!isPositiveMoney(money.value)) {
        return {
          error: 'Informe uma renda mensal positiva. Exemplo: recebo 3000 por mês',
        };
      }

      fields.rendaMensal = Number(money.value);
    }

    if (day.found) {
      if (!isValidDay(day.value)) {
        return {
          error: 'Informe um dia de recebimento entre 1 e 31.',
        };
      }

      fields.diaRecebimento = day.value;
    }

    if (!Object.keys(fields).length) {
      return {
        error: 'Não consegui identificar a renda ou o dia de recebimento. Exemplo: recebo 3000 todo dia 5',
      };
    }

    return {
      action: 'update',
      fields,
    };
  }

  if (isCardDueCommand(command)) {
    const day = extractDay(text);

    if (!day.found) {
      return {
        error: 'Informe o dia de vencimento do cartão. Exemplo: meu cartão vence dia 12',
      };
    }

    if (!isValidDay(day.value)) {
      return {
        error: 'Informe um vencimento do cartão entre 1 e 31.',
      };
    }

    return {
      action: 'update',
      fields: {
        vencimentoCartao: day.value,
      },
    };
  }

  if (isBudgetCommand(command)) {
    const money = extractMoney(text);

    if (!money.found || !isPositiveMoney(money.value)) {
      return {
        error: 'Informe um orçamento mensal positivo. Exemplo: definir orçamento 2000',
      };
    }

    return {
      action: 'update',
      fields: {
        orcamentoMensal: Number(money.value),
      },
    };
  }

  return null;
}

function profilePath(session) {
  const tag = normalizeAccessTag(session?.tag || session?.user);

  return `grupos/${DEFAULT_GROUP}/usuarios/${tag}/perfilFinanceiro`;
}

function updatedProfileMessage(fields) {
  const lines = [
    'Perfil atualizado ✅',
  ];

  if (Object.hasOwn(fields, 'rendaMensal')) {
    lines.push(`Renda mensal: ${formatMoney(fields.rendaMensal)}`);
  }

  if (Object.hasOwn(fields, 'diaRecebimento')) {
    lines.push(`Dia de recebimento: ${fields.diaRecebimento}`);
  }

  if (Object.hasOwn(fields, 'vencimentoCartao')) {
    lines.push(`Vencimento do cartão: dia ${fields.vencimentoCartao}`);
  }

  if (Object.hasOwn(fields, 'orcamentoMensal')) {
    lines.push(`Orçamento mensal: ${formatMoney(fields.orcamentoMensal)}`);
  }

  return lines.join('\n');
}

function profileMessage(profile) {
  return [
    'Seu perfil financeiro:',
    `Renda mensal: ${formatProfileMoney(profile?.rendaMensal)}`,
    `Dia de recebimento: ${formatProfileDay(profile?.diaRecebimento)}`,
    `Vencimento do cartão: ${formatProfileDay(profile?.vencimentoCartao, 'dia')}`,
    `Orçamento mensal: ${formatProfileMoney(profile?.orcamentoMensal)}`,
  ].join('\n');
}

function createFinancialProfileService({
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
}) {
  const { get, ref, update } = firebaseOps;

  function hasValidAccessSession(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
  }

  async function getFinancialProfile(session) {
    const snap = await get(ref(db, profilePath(session)));

    return snap.val() || {};
  }

  async function updateFinancialProfile(session, fields) {
    await update(ref(db, profilePath(session)), {
      ...fields,
      updatedAt: now(),
    });
  }

  async function processarPerfilFinanceiro(session, text) {
    const parsed = parseFinancialProfileCommand(text);

    if (!parsed) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return FINANCIAL_PROFILE_REQUIRED_MESSAGE;
    }

    if (parsed.error) {
      return parsed.error;
    }

    if (parsed.action === 'view') {
      return profileMessage(await getFinancialProfile(session));
    }

    await updateFinancialProfile(session, parsed.fields);

    return updatedProfileMessage(parsed.fields);
  }

  return {
    processarPerfilFinanceiro,
  };
}

module.exports = {
  FINANCIAL_PROFILE_REQUIRED_MESSAGE,
  createFinancialProfileService,
  parseFinancialProfileCommand,
};
