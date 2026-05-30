'use strict';

const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { normalizeText } = require('./text-utils');

const DEFAULT_WEEKLY_REPORT_PREFERENCE = {
  ativo: true,
  diaSemana: 0,
  hora: 20,
  minuto: 0,
  timezone: 'America/Sao_Paulo',
};
const WEEKLY_REPORT_PREFERENCE_REQUIRED_MESSAGE = 'Entre com sua tag de 6 dígitos usando: entrar 123456';
const ACTIVATE_COMMANDS = new Set([
  'ativar relatorio semanal',
  'receber relatorio semanal',
]);
const DEACTIVATE_COMMANDS = new Set([
  'desativar relatorio semanal',
  'parar relatorio semanal',
]);
const STATUS_COMMANDS = new Set([
  'status relatorio semanal',
  'relatorio semanal automatico',
]);

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
}

function parseWeeklyReportPreferenceCommand(value) {
  const command = normalizedCommand(value);

  if (ACTIVATE_COMMANDS.has(command)) {
    return { type: 'activate' };
  }

  if (DEACTIVATE_COMMANDS.has(command)) {
    return { type: 'deactivate' };
  }

  if (STATUS_COMMANDS.has(command)) {
    return { type: 'status' };
  }

  const configureMatch = command.match(/^configurar relatorio semanal domingo (\d{1,2})(?::(\d{2}))?h?$/);

  if (!configureMatch) {
    return null;
  }

  const hour = Number(configureMatch[1]);
  const minute = Number(configureMatch[2] || 0);

  return {
    hour,
    minute,
    type: 'configure',
    valid: hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59,
  };
}

function formatSchedule(preference) {
  const hour = Number.isInteger(Number(preference?.hora)) ? Number(preference.hora) : 20;
  const minute = Number.isInteger(Number(preference?.minuto)) ? Number(preference.minuto) : 0;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function createWeeklyReportPreferencesService({
  db,
  firebaseOps,
  now = () => new Date().toISOString(),
}) {
  const { get, ref, update } = firebaseOps;

  function hasValidAccessSession(session) {
    const tag = normalizeAccessTag(session?.tag || session?.user);

    return Boolean(tag && session?.group === DEFAULT_GROUP && session?.user === tag);
  }

  function preferencePath(session) {
    return `grupos/${DEFAULT_GROUP}/usuarios/${session.user}/preferencias/relatorioSemanal`;
  }

  async function processarPreferenciaRelatorioSemanal(session, text) {
    const command = parseWeeklyReportPreferenceCommand(text);

    if (!command) {
      return null;
    }

    if (!hasValidAccessSession(session)) {
      return WEEKLY_REPORT_PREFERENCE_REQUIRED_MESSAGE;
    }

    const path = preferencePath(session);

    if (command.type === 'activate' || command.type === 'configure') {
      if (command.valid === false) {
        return 'Não consegui configurar esse horário. Use, por exemplo: configurar relatório semanal domingo 20h';
      }

      const preference = {
        ...DEFAULT_WEEKLY_REPORT_PREFERENCE,
        ...(command.type === 'configure'
          ? {
              hora: command.hour,
              minuto: command.minute,
            }
          : {}),
        updatedAt: now(),
      };

      await update(ref(db, path), preference);

      return command.type === 'configure'
        ? `Relatório semanal configurado ✅ Vou te enviar todo domingo às ${formatSchedule(preference)}.`
        : 'Relatório semanal ativado ✅ Vou te enviar todo domingo às 20h.';
    }

    if (command.type === 'deactivate') {
      await update(ref(db, path), {
        ativo: false,
        updatedAt: now(),
      });

      return 'Relatório semanal desativado.';
    }

    const snapshot = await get(ref(db, path));
    const preference = snapshot.val() || {};

    return preference.ativo === true
      ? `Relatório semanal automático está ativo: domingo às ${formatSchedule(preference)}.`
      : 'Relatório semanal automático está desativado. Para ativar, envie: ativar relatório semanal';
  }

  return {
    processarPreferenciaRelatorioSemanal,
  };
}

module.exports = {
  DEFAULT_WEEKLY_REPORT_PREFERENCE,
  WEEKLY_REPORT_PREFERENCE_REQUIRED_MESSAGE,
  createWeeklyReportPreferencesService,
  parseWeeklyReportPreferenceCommand,
};
