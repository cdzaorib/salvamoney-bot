'use strict';

const { DEFAULT_GROUP, normalizeAccessTag } = require('./user-service');
const { storedEstado } = require('../bot/charge-state');

// Migrações aditivas e idempotentes, executadas por usuário na primeira mensagem.
// Nunca apagam dados: só adicionam campos derivados ou registros novos.

function userPath(tag) {
  return `grupos/${DEFAULT_GROUP}/usuarios/${tag}`;
}

function validDay(value) {
  const day = Number(value);

  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

const MIGRATIONS = [
  {
    id: '2026_09_cartao_legado',
    // O vencimento único do perfil antigo vira um cartão "Cartão principal".
    async run({ read, tag, timestamp }) {
      const [profile, cards] = await Promise.all([
        read(`${userPath(tag)}/perfilFinanceiro`),
        read(`${userPath(tag)}/cartoes`),
      ]);
      const dueDay = validDay(profile?.vencimentoCartao);

      if (!dueDay || (cards && Object.keys(cards).length)) {
        return {};
      }

      return {
        [`${userPath(tag)}/cartoes/legado`]: {
          apelido: 'Cartão principal',
          atualizadoEm: timestamp,
          diaFechamento: ((dueDay - 7 - 1 + 31) % 31) + 1,
          diaVencimento: dueDay,
          padrao: true,
        },
      };
    },
  },
  {
    id: '2026_09_cobrancas_estado',
    // Cobranças antigas ganham "estado" e totais de pagamento derivados do status.
    async run({ read, tag }) {
      const multipath = {};
      const [sent, received] = await Promise.all([
        read(`${userPath(tag)}/cobrancasEnviadas`),
        read(`${userPath(tag)}/cobrancasRecebidas`),
      ]);
      const entries = [
        ...Object.entries(sent || {}).map(([id, charge]) => ({ charge, id, side: 'sent' })),
        ...Object.entries(received || {}).map(([id, charge]) => ({ charge, id, side: 'received' })),
      ];

      for (const { charge, id, side } of entries) {
        if (!charge || typeof charge !== 'object' || charge.estado) {
          continue;
        }

        const origin = normalizeAccessTag(charge.tagOrigem);
        const destination = normalizeAccessTag(charge.tagDestino);

        if (!origin || !destination) {
          continue;
        }

        const fields = { estado: storedEstado(charge) };
        const value = Number(charge.valorCobrado);

        if (Number.isFinite(value) && value > 0) {
          if (charge.valorOriginal === undefined) {
            fields.valorOriginal = value;
          }

          if (charge.valorPago === undefined) {
            fields.valorPago = fields.estado === 'paga' ? value : 0;
          }
        }

        const ownPath = side === 'sent'
          ? `${userPath(tag)}/cobrancasEnviadas/${id}`
          : `${userPath(tag)}/cobrancasRecebidas/${id}`;
        const otherPath = side === 'sent'
          ? `${userPath(destination)}/cobrancasRecebidas/${id}`
          : `${userPath(origin)}/cobrancasEnviadas/${id}`;
        const other = await read(otherPath);

        Object.entries(fields).forEach(([key, fieldValue]) => {
          multipath[`${ownPath}/${key}`] = fieldValue;

          // Só atualiza a outra cópia se ela existir e ainda não tiver o campo.
          if (other && typeof other === 'object' && other[key] === undefined) {
            multipath[`${otherPath}/${key}`] = fieldValue;
          }
        });
      }

      return multipath;
    },
  },
];

function createMigrationService({
  db,
  firebaseOps,
  logger = console,
  now = () => new Date(),
}) {
  const { get, ref, update } = firebaseOps;
  const done = new Set();

  async function read(path) {
    const snap = await get(ref(db, path));

    return snap.val();
  }

  async function ensureUser(tagValue) {
    const tag = normalizeAccessTag(tagValue);

    if (!tag || done.has(tag)) {
      return { applied: [] };
    }

    const applied = [];
    const markers = (await read(`${userPath(tag)}/migracoes`)) || {};

    for (const migration of MIGRATIONS) {
      if (markers[migration.id]) {
        continue;
      }

      try {
        const timestamp = now().toISOString();
        const multipath = await migration.run({ read, tag, timestamp });

        multipath[`${userPath(tag)}/migracoes/${migration.id}`] = { aplicadaEm: timestamp };
        await update(ref(db), multipath);
        applied.push(migration.id);
      } catch (_) {
        logger.warn?.(`[migracao] falha em ${migration.id}; será tentada novamente.`);
        return { applied, failed: migration.id };
      }
    }

    done.add(tag);

    return { applied };
  }

  return {
    ensureUser,
  };
}

module.exports = {
  MIGRATIONS,
  createMigrationService,
};
