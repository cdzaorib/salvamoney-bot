'use strict';

const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function localDateParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const calendarDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));

  return {
    day: Number(parts.day),
    dayOfWeek: calendarDate.getUTCDay(),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    year: Number(parts.year),
  };
}

function isoWeekKey(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekDay = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - weekDay);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function shouldSendWeeklyReport(preference, date = new Date(), defaultTimeZone = 'America/Sao_Paulo') {
  if (preference?.ativo !== true) {
    return false;
  }

  const dayOfWeek = Number.isInteger(Number(preference.diaSemana)) ? Number(preference.diaSemana) : 0;
  const hour = Number.isInteger(Number(preference.hora)) ? Number(preference.hora) : 20;
  const minute = Number.isInteger(Number(preference.minuto)) ? Number(preference.minuto) : 0;

  try {
    const parts = localDateParts(date, preference.timezone || defaultTimeZone);

    return parts.dayOfWeek === dayOfWeek && parts.hour === hour && parts.minute >= minute;
  } catch {
    return false;
  }
}

function createWeeklyReportScheduler({
  db,
  enabled = true,
  firebaseOps,
  intervalMs = DEFAULT_INTERVAL_MS,
  logger = console,
  notificationSender,
  now = () => new Date(),
  timeZone = 'America/Sao_Paulo',
  weeklyReportService,
}) {
  const { get, ref, transaction, update } = firebaseOps;
  let running = false;
  let timer = null;

  async function claimWeek(path, weekKey) {
    let previousValue = null;
    const result = await transaction(ref(db, `${path}/ultimoEnvioSemana`), (currentValue) => {
      previousValue = currentValue || null;

      return currentValue === weekKey ? undefined : weekKey;
    });

    return {
      claimed: result.committed === true,
      previousValue,
    };
  }

  async function releaseWeek(path, weekKey, previousValue) {
    await transaction(ref(db, `${path}/ultimoEnvioSemana`), (currentValue) => {
      return currentValue === weekKey ? previousValue : undefined;
    });
  }

  async function sendUserReport(tag, user, referenceDate) {
    const preference = user?.preferencias?.relatorioSemanal;

    if (!shouldSendWeeklyReport(preference, referenceDate, timeZone)) {
      return 'ignored';
    }

    const phone = String(user?.phone || '').replace(/\D/g, '');

    if (!phone) {
      logger.warn?.('Relatório semanal ignorado: usuário opt-in sem telefone.');
      return 'missing_phone';
    }

    const parts = localDateParts(referenceDate, preference.timezone || timeZone);
    const weekKey = isoWeekKey(parts);
    const path = `grupos/${DEFAULT_GROUP}/usuarios/${tag}/preferencias/relatorioSemanal`;
    const claim = await claimWeek(path, weekKey);

    if (!claim.claimed) {
      return 'duplicate';
    }

    try {
      const message = await weeklyReportService.gerarRelatorioSemanal({
        group: DEFAULT_GROUP,
        tag,
        user: tag,
      }, 'relatório da semana');
      const sent = await notificationSender(phone, message);

      if (sent === false) {
        throw new Error('sender returned false');
      }

      try {
        await update(ref(db, path), {
          updatedAt: referenceDate.toISOString(),
        });
      } catch (error) {
        logger.warn?.('Relatório semanal enviado, mas updatedAt não pôde ser atualizado.', error?.message || error);
      }

      return 'sent';
    } catch (error) {
      await releaseWeek(path, weekKey, claim.previousValue);
      logger.error?.('Falha ao enviar relatório semanal automático.', error?.message || error);

      return 'failed';
    }
  }

  async function runOnce() {
    if (!enabled || running) {
      return { skipped: true };
    }

    running = true;

    try {
      const referenceDate = now();
      const snapshot = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios`));
      const users = snapshot.val() || {};
      const results = [];

      for (const [userKey, user] of Object.entries(users)) {
        const tag = normalizeAccessTag(userKey);

        if (!tag || user?.preferencias?.relatorioSemanal?.ativo !== true) {
          continue;
        }

        try {
          results.push(await sendUserReport(tag, user, referenceDate));
        } catch (error) {
          logger.error?.('Falha ao processar usuário do relatório semanal automático.', error?.message || error);
          results.push('failed');
        }
      }

      return {
        failed: results.filter((result) => result === 'failed').length,
        sent: results.filter((result) => result === 'sent').length,
      };
    } catch (error) {
      logger.error?.('Falha na execução do relatório semanal automático.', error?.message || error);

      return { failed: 1, sent: 0 };
    } finally {
      running = false;
    }
  }

  function start() {
    if (!enabled || timer) {
      return;
    }

    void runOnce();
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
  }

  return {
    runOnce,
    start,
    stop,
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  createWeeklyReportScheduler,
  isoWeekKey,
  localDateParts,
  shouldSendWeeklyReport,
};
