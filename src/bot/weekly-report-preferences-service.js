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

const WEEK_DAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const WEEK_DAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

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

  const configureMatch = command.match(/^configurar relatorio semanal (domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[- ]feira)? (\d{1,2})(?::(\d{2}))?h?$/);

  if (!configureMatch) {
    return null;
  }

  const hour = Number(configureMatch[2]);
  const minute = Number(configureMatch[3] || 0);
  const result = {
    hour,
    minute,
    type: 'configure',
    valid: hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59,
  };

  // Domingo continua sendo o padrão; outros dias ficam explícitos.
  if (configureMatch[1] !== 'domingo') {
    result.dayOfWeek = WEEK_DAYS.indexOf(configureMatch[1]);
  }

  return result;
}

function dayLabel(preference) {
  const day = Number(preference?.diaSemana);

  return WEEK_DAY_LABELS[Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0];
}

function everyDayLabel(preference) {
  const label = dayLabel(preference);

  return `${['domingo', 'sábado'].includes(label) ? 'todo' : 'toda'} ${label}`;
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
              diaSemana: command.dayOfWeek ?? 0,
              hora: command.hour,
              minuto: command.minute,
            }
          : {}),
        updatedAt: now(),
      };

      await update(ref(db, path), preference);

      return command.type === 'configure'
        ? `Relatório semanal configurado ✅ Vou te enviar ${everyDayLabel(preference)} às ${formatSchedule(preference)}.`
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
      ? `Relatório semanal automático está ativo: ${dayLabel(preference)} às ${formatSchedule(preference)}.`
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
