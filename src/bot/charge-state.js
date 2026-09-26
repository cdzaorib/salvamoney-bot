'use strict';

const { fromCents, toCents } = require('./finance-utils');

// Máquina de estados das cobranças, compatível com o campo legado "status".
const ESTADOS = Object.freeze({
  ACEITA: 'aceita',
  AGUARDANDO_ACEITE: 'aguardando_aceite',
  AGUARDANDO_FECHAMENTO: 'aguardando_fechamento',
  CANCELADA: 'cancelada',
  CONTESTADA: 'contestada',
  DISPONIVEL: 'disponivel_pagamento',
  INFORMADO: 'pagamento_informado',
  PAGA: 'paga',
  PARCIAL: 'pagamento_parcial',
  RECUSADA: 'recusada',
});

const LABELS = {
  aceita: 'aceita',
  aguardando_aceite: 'aguardando aceite',
  aguardando_fechamento: 'aguardando fechamento',
  cancelada: 'cancelada',
  contestada: 'contestada',
  disponivel_pagamento: 'disponível para pagamento',
  pagamento_informado: 'pagamento informado',
  pagamento_parcial: 'pagamento parcial',
  paga: 'paga',
  recusada: 'recusada',
};

const LEGACY_TO_ESTADO = {
  aceita: ESTADOS.ACEITA,
  cancelada: ESTADOS.CANCELADA,
  paga: ESTADOS.PAGA,
  pendente: ESTADOS.AGUARDANDO_ACEITE,
  recusada: ESTADOS.RECUSADA,
};

const ESTADO_TO_LEGACY = {
  aceita: 'aceita',
  aguardando_aceite: 'pendente',
  aguardando_fechamento: 'aceita',
  cancelada: 'cancelada',
  contestada: 'pendente',
  disponivel_pagamento: 'aceita',
  pagamento_informado: 'aceita',
  pagamento_parcial: 'aceita',
  paga: 'paga',
  recusada: 'recusada',
};

const TRANSITIONS = {
  aceita: ['pagamento_informado', 'pagamento_parcial', 'paga', 'contestada', 'cancelada'],
  aguardando_aceite: ['aceita', 'recusada', 'contestada', 'cancelada', 'pagamento_informado', 'pagamento_parcial', 'paga'],
  aguardando_fechamento: ['disponivel_pagamento', 'pagamento_informado', 'pagamento_parcial', 'paga', 'contestada', 'recusada', 'cancelada'],
  cancelada: [],
  contestada: ['aguardando_aceite', 'aguardando_fechamento', 'disponivel_pagamento', 'aceita', 'cancelada', 'recusada'],
  disponivel_pagamento: ['pagamento_informado', 'pagamento_parcial', 'paga', 'contestada', 'cancelada'],
  pagamento_informado: ['paga', 'pagamento_parcial', 'aceita', 'aguardando_aceite', 'aguardando_fechamento', 'disponivel_pagamento', 'cancelada'],
  pagamento_parcial: ['pagamento_informado', 'pagamento_parcial', 'paga', 'contestada', 'cancelada'],
  paga: [],
  recusada: [],
};

const FINAL_STATES = new Set([ESTADOS.PAGA, ESTADOS.RECUSADA, ESTADOS.CANCELADA]);
const PAYABLE_STATES = new Set([
  ESTADOS.AGUARDANDO_ACEITE,
  ESTADOS.ACEITA,
  ESTADOS.AGUARDANDO_FECHAMENTO,
  ESTADOS.DISPONIVEL,
  ESTADOS.PARCIAL,
]);

function storedEstado(charge) {
  if (charge?.estado && LABELS[charge.estado]) {
    return charge.estado;
  }

  return LEGACY_TO_ESTADO[charge?.status] || ESTADOS.AGUARDANDO_ACEITE;
}

// Estado efetivo: "aguardando fechamento" vira "disponível" quando a data estimada chega.
function estadoDe(charge, todayIso = null) {
  const estado = storedEstado(charge);

  if (estado === ESTADOS.AGUARDANDO_FECHAMENTO && todayIso && charge?.fechamentoPrevisto &&
    String(charge.fechamentoPrevisto) <= String(todayIso)) {
    return ESTADOS.DISPONIVEL;
  }

  return estado;
}

function legacyStatusFor(estado) {
  return ESTADO_TO_LEGACY[estado] || 'pendente';
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function valorCobradoCents(charge) {
  return toCents(charge?.valorCobrado);
}

function valorPagoCents(charge) {
  if (storedEstado(charge) === ESTADOS.PAGA && (charge?.valorPago === undefined || charge?.valorPago === null)) {
    return valorCobradoCents(charge);
  }

  return toCents(charge?.valorPago || 0);
}

function saldoCents(charge) {
  return Math.max(0, valorCobradoCents(charge) - valorPagoCents(charge));
}

function saldo(charge) {
  return fromCents(saldoCents(charge));
}

function isOpen(charge, todayIso = null) {
  return !FINAL_STATES.has(estadoDe(charge, todayIso));
}

function isPayable(charge, todayIso = null) {
  return PAYABLE_STATES.has(estadoDe(charge, todayIso)) && saldoCents(charge) > 0;
}

function label(estado) {
  return LABELS[estado] || estado;
}

// Estado de retorno após contestação ou pagamento não confirmado.
function baseEstado(charge, todayIso = null) {
  if (charge?.cartaoId && charge?.fechamentoPrevisto) {
    return todayIso && String(charge.fechamentoPrevisto) <= String(todayIso)
      ? ESTADOS.DISPONIVEL
      : ESTADOS.AGUARDANDO_FECHAMENTO;
  }

  return charge?.aceitaEm || charge?.respondedAt ? ESTADOS.ACEITA : ESTADOS.AGUARDANDO_ACEITE;
}

module.exports = {
  ESTADOS,
  FINAL_STATES,
  baseEstado,
  canTransition,
  estadoDe,
  isOpen,
  isPayable,
  label,
  legacyStatusFor,
  saldo,
  saldoCents,
  storedEstado,
  valorCobradoCents,
  valorPagoCents,
};
