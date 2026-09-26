'use strict';

const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');
const { localDateParts } = require('./weekly-report-scheduler');

// Mensagens proativas: fechamento estimado de fatura e lembrete no vencimento.
// Só envia em horário comercial local e nunca em loop de retry.
function createProactiveScheduler({
  db,
  enabled = false,
  firebaseOps,
  intervalMs = 15 * 60 * 1000,
  logger = console,
  now = () => new Date(),
  obligationService,
  quietHourStart = 21,
  reminderHour = 9,
  timeZone = 'America/Sao_Paulo',
}) {
  const { get, ref } = firebaseOps;
  let running = false;
  let timer = null;

  function withinSendingWindow(date) {
    const { hour } = localDateParts(date, timeZone);

    return hour >= reminderHour && hour < quietHourStart;
  }

  async function runOnce() {
    if (!enabled || running) {
      return { skipped: true };
    }

    const referenceDate = now();

    if (!withinSendingWindow(referenceDate)) {
      return { skipped: true, reason: 'fora_do_horario' };
    }

    running = true;

    try {
      const snapshot = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios`));
      const users = snapshot.val() || {};
      let closed = 0;
      let reminders = 0;
      let failed = 0;

      for (const [key, user] of Object.entries(users)) {
        const tag = normalizeAccessTag(key);

        if (!tag || !user?.cobrancasEnviadas) {
          continue;
        }

        try {
          closed += (await obligationService.processClosingsFor(tag, { notifyParties: true })).closed;
          reminders += (await obligationService.processDueRemindersFor(tag)).sent;
        } catch (_) {
          failed += 1;
          logger.error?.('[proactive] falha ao processar um usuário.');
        }
      }

      return { closed, failed, reminders };
    } catch (_) {
      logger.error?.('[proactive] falha na execução.');

      return { closed: 0, failed: 1, reminders: 0 };
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
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    runOnce,
    start,
    stop,
  };
}

module.exports = {
  createProactiveScheduler,
};
