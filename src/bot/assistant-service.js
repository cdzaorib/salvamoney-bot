'use strict';

const { getContext } = require('../ai/request-context');
const { createMigrationService } = require('../services/migration-service');
const { splitExpensesByPaymentStatus } = require('../services/transaction-store');
const { createAdvisorService } = require('./advisor-service');
const { createBalanceReportService } = require('./balance-report-service');
const { createCardService } = require('./card-service');
const { createConsentService } = require('./consent-service');
const { createConversationService } = require('./conversation-service');
const { normalizedCommand } = require('./finance-utils');
const { createFriendService } = require('./friend-service');
const { createInvestmentResearchService } = require('./investment-research-service');
const { createObligationService } = require('./obligation-service');
const { createPersonalityService, economicoComment, frame } = require('./personality-service');
const { createPrivacyDataService } = require('./privacy-data-service');
const { createSplitService } = require('./split-service');
const { createUserDataStore, hasValidAccessSession, sessionTag } = require('./user-data');
const { createWeeklyReportComposer } = require('./weekly-report-composer');

const PENDING_TTL_MS = 15 * 60 * 1000;
const YES = /^(sim|s|confirmar|confirmo|ok|pode|pode sim|isso|certo|claro|yes|pode gravar|pode salvar)$/;
const NO = /^(nao|n|cancelar|cancela|desistir|deixa|deixa pra la)$/;
const DUPLICATE_MESSAGE = 'Essa ação já foi registrada ✅ Nada foi duplicado.';

// Orquestra os recursos novos. Cada subsistema respeita a própria feature flag
// e devolve null quando a mensagem não é dele, preservando o fluxo existente.
function createAssistantService({
  aiGateway,
  braveClient,
  config,
  conversationContext,
  costTracker,
  dateUtils,
  db,
  expenseService,
  firebaseOps,
  idempotencyStore,
  logger = console,
  notificationSender,
  now = () => new Date(),
  registrarGasto,
  saveSession,
  summaryHandler,
  transactionStore,
  weeklyReportService,
}) {
  const features = config?.features || {};
  const anyEnabled = Object.values(features).some(Boolean);
  const userData = createUserDataStore({ db, firebaseOps });

  async function notify(phone, message) {
    if (!phone || !message || typeof notificationSender !== 'function') {
      return false;
    }

    try {
      return (await notificationSender(phone, message)) !== false;
    } catch (_) {
      logger.warn?.('[notificacao] falha ao enviar notificação.');
      return false;
    }
  }

  const consentService = createConsentService({ config, conversationContext, now, userData });
  const personalityService = createPersonalityService({ now, userData });
  const privacyDataService = createPrivacyDataService({ conversationContext, db, firebaseOps, now, saveSession, userData });
  const friendService = createFriendService({ db, firebaseOps, notify, now, userData });
  const obligationService = createObligationService({ dateUtils, db, firebaseOps, friendService, notify, now, userData });
  const cardService = createCardService({
    dateUtils,
    db,
    firebaseOps,
    now,
    onCardClosed: async (session, card, closingIso) => (features.splits
      ? await obligationService.closeCardCycle(session, card, closingIso)
      : { closed: 0 }),
    userData,
  });
  const splitService = createSplitService({
    cardService,
    dateUtils,
    db,
    features,
    firebaseOps,
    friendService,
    notify,
    now,
    obligationService,
    userData,
  });
  const balanceService = createBalanceReportService({ dateUtils, db, firebaseOps, now, obligationService, transactionStore });
  const advisorService = createAdvisorService({ now, personalityService: features.personalities ? personalityService : null, userData });
  const researchService = createInvestmentResearchService({
    advisorService,
    braveClient,
    config,
    consentService,
    costTracker,
    dateUtils,
    logger,
    now,
    personalityService: features.personalities ? personalityService : null,
    userData,
  });
  const conversationService = createConversationService({
    aiGateway,
    balanceService,
    config,
    consentService,
    conversationContext,
    expenseService,
    friendService,
    logger,
    personalityService: features.personalities ? personalityService : null,
    splitService,
    summaryHandler,
    todayIso: () => dateUtils.todayIso(now()),
    transactionStore,
    userData,
  });
  const migrationService = createMigrationService({ db, firebaseOps, logger, now });
  const weeklyComposer = createWeeklyReportComposer({ balanceService, features, personalityService, weeklyReportService });

  function stripSession(session) {
    const { phone: _phone, ...clean } = session || {};

    return clean;
  }

  async function savePending(phone, session, pendingAction) {
    const { pendingDelete: _pendingDelete, ...clean } = stripSession(session);

    await saveSession(phone, {
      ...clean,
      pendingAction: {
        ...pendingAction,
        expiresAt: new Date(now().getTime() + PENDING_TTL_MS).toISOString(),
        // O id acompanha as etapas da mesma ação e vira a chave idempotente.
        id: pendingAction.id || `a${now().getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      },
    });
  }

  async function clearPending(phone, session) {
    const { pendingAction: _pending, ...clean } = stripSession(session);

    await saveSession(phone, Object.keys(clean).length ? clean : null);
  }

  async function respond(phone, session, result) {
    if (result === null || result === undefined) {
      return null;
    }

    if (typeof result === 'string') {
      return result;
    }

    if (result.pendingAction) {
      await savePending(phone, session, result.pendingAction);
    } else if (result.clearPending) {
      await clearPending(phone, session);
    }

    return result.message ?? null;
  }

  async function once(session, key, tipo, execute) {
    if (!idempotencyStore || !key) {
      return await execute();
    }

    const { duplicate, result } = await idempotencyStore.run({
      execute,
      key,
      scope: sessionTag(session),
      tipo,
    });

    return duplicate ? DUPLICATE_MESSAGE : result;
  }

  async function handlePending(phone, session, text) {
    const pending = session?.pendingAction;

    if (!pending?.tipo) {
      return null;
    }

    const command = normalizedCommand(text);
    const expired = !pending.expiresAt || new Date(pending.expiresAt).getTime() < now().getTime();

    if (pending.tipo === 'data_deletion') {
      if (/^apagar meus dados\s+\d{6}$/.test(command) || NO.test(command)) {
        return await privacyDataService.confirmDeletion(phone, session, text);
      }

      await clearPending(phone, session);
      return null;
    }

    if (expired) {
      await clearPending(phone, session);
      return null;
    }

    if (pending.tipo === 'split') {
      const reply = await splitService.handleReply(session, pending, text);

      if (!reply) {
        return null;
      }

      if (reply.execute) {
        const message = await once(session, `pending:${pending.id}`, 'divisao', () => splitService.execute(session, pending));

        await clearPending(phone, session);

        return message;
      }

      if (reply.pendingAction) {
        return await respond(phone, session, { ...reply, pendingAction: { ...reply.pendingAction, id: pending.id } });
      }

      return await respond(phone, session, reply);
    }

    if (pending.tipo === 'advisor_question') {
      const answer = await advisorService.answer(session, pending, text);

      if (!answer) {
        return null;
      }

      if (!answer.answered) {
        return await respond(phone, session, answer);
      }

      await clearPending(phone, session);

      const cleanSession = { ...session, pendingAction: null };

      if (pending.origem === 'research') {
        return await respond(phone, cleanSession, await researchService.run(cleanSession, 'pesquisar investimentos'));
      }

      if (pending.origem === 'review') {
        return 'Perfil de investidor revisado ✅';
      }

      return await respond(phone, cleanSession, await advisorService.planOrAsk(cleanSession));
    }

    if (!YES.test(command) && !NO.test(command)) {
      return null;
    }

    if (NO.test(command)) {
      await clearPending(phone, session);

      return 'Tudo bem, cancelado. Nada foi alterado.';
    }

    let message = null;

    if (pending.tipo === 'friend_remove') {
      message = await once(session, `pending:${pending.id}`, 'amizade', () => friendService.confirmRemoval(session, pending.friendTag));
    } else if (['inform_payment', 'confirm_receipt', 'approve_suggestion', 'cancel_charge'].includes(pending.tipo)) {
      message = await once(session, `pending:${pending.id}`, pending.tipo, () => obligationService.executePending(session, pending));
    } else if (pending.tipo === 'ai_expense') {
      message = await once(session, `pending:${pending.id}`, 'gasto_ia', () => registrarGasto(session, pending.expense, 'ia'));
    }

    await clearPending(phone, session);

    return message;
  }

  async function processConsent(phone, session, text) {
    if (!features.conversationalAi && !features.investmentResearch) {
      return null;
    }

    const result = await consentService.process(session, text);

    if (!result) {
      return null;
    }

    const command = normalizedCommand(text);

    // Comandos de IA exigem a flag de IA; pesquisa externa exige a flag de pesquisa.
    if (!features.conversationalAi && /\b(ia|inteligencia artificial|consentimento|aceito|concordo|recuso)\b/.test(command)) {
      return null;
    }

    if (result.resumeText) {
      const context = getContext();

      if (context) {
        context.aiConsent = true;
      }

      const resumed = await respond(phone, session, await conversationService.process(session, result.resumeText));

      return resumed ? `${result.message}\n\n${resumed}` : result.message;
    }

    return result.message;
  }

  async function process(phone, session, text) {
    if (!anyEnabled || !hasValidAccessSession(session)) {
      return null;
    }

    const tag = sessionTag(session);

    if (features.cards || features.splits) {
      await migrationService.ensureUser(tag).catch(() => null);
    }

    const pendingReply = await handlePending(phone, session, text);

    if (pendingReply) {
      return pendingReply;
    }

    const consentReply = await processConsent(phone, session, text);

    if (consentReply) {
      return consentReply;
    }

    const handlers = [
      () => privacyDataService.process(phone, session, text),
      () => (features.personalities ? personalityService.process(session, text) : null),
      () => (features.friends ? friendService.process(session, text) : null),
      () => (features.cards ? cardService.process(session, text) : null),
      () => (features.investmentResearch ? researchService.process(session, text) : null),
      () => (features.advisor ? advisorService.process(session, text) : null),
      () => (features.splits && features.friends ? obligationService.process(session, text) : null),
      () => (features.splits ? balanceService.process(session, text) : null),
      () => (features.splits && features.friends ? splitService.start(session, text) : null),
    ];

    for (const handler of handlers) {
      const result = await handler();

      if (result !== null && result !== undefined) {
        return await respond(phone, session, result);
      }
    }

    return null;
  }

  async function processFallback(phone, session, text) {
    if (!features.conversationalAi || !hasValidAccessSession(session)) {
      return null;
    }

    return await respond(phone, session, await conversationService.process(session, text));
  }

  // Contexto usado pelos provedores de IA durante a mensagem.
  async function requestContext(session, options = {}) {
    const context = {
      aiConsent: false,
      aiDisabled: false,
      messageId: options.messageId || null,
      tag: hasValidAccessSession(session) ? sessionTag(session) : null,
    };

    if (features.conversationalAi && context.tag) {
      try {
        const state = await consentService.aiState(context.tag);

        context.aiConsent = state === 'aceito';
        context.aiDisabled = state === 'recusado' || state === 'revogado';
      } catch (_) {
        context.aiDisabled = true;
      }
    }

    return context;
  }

  async function personalityFor(session) {
    return features.personalities && hasValidAccessSession(session)
      ? await personalityService.getPersonality(session)
      : null;
  }

  async function frameAlert(session, message) {
    const personality = await personalityFor(session);

    return personality ? frame(personality, 'alert', message) : message;
  }

  // Comentário objetivo do Econômico após registrar um gasto.
  async function expenseComment(session) {
    const personality = await personalityFor(session);

    if (personality !== 'economico' || !transactionStore) {
      return '';
    }

    const tag = sessionTag(session);
    const [profile, expenses, goal] = await Promise.all([
      userData.readChild(tag, 'perfilFinanceiro'),
      transactionStore.listMonthlyExpensesWithIds({ date: now(), group: 'SALVAMONEY', user: tag }),
      userData.readChild(tag, `metasEconomia/${dateUtils.monthKey(now())}`),
    ]);
    const { paidExpenses } = splitExpensesByPaymentStatus(expenses);
    const total = paidExpenses.reduce((sum, expense) => sum + Number(expense.value || 0), 0);
    const renda = Number(profile?.rendaMensal) || null;

    return economicoComment(personality, {
      economiaProjetada: renda ? renda - total : null,
      orcamentoMensal: profile?.orcamentoMensal,
      prioridades: profile?.prioridades,
      totalMes: total,
      valorMeta: goal && goal.ativo !== false ? goal.valorMeta : null,
    });
  }

  function helpLines() {
    const lines = [];

    if (features.friends) {
      lines.push('Amigos:', '- adicionar amigo 123456', '- aceitar amigo 123456', '- apelido Carlos', '- meus amigos', '');
    }

    if (features.splits) {
      lines.push('Divisões e cobranças:', '- dividir 150 com Carlos', '- a conta deu 300 e Carlos deve metade', '- cobranças · balanço', '- paguei cobrança 1 · recebi cobrança 2', '- cobrar novamente Carlos', '');
    }

    if (features.cards) {
      lines.push('Cartões:', '- adicionar cartão Nubank fecha dia 3 vence dia 10', '- meus cartões', '- minha fatura Nubank fechou hoje', '');
    }

    if (features.personalities) {
      lines.push('Personalidade:', '- personalidades', '- mudar personalidade para professor', '');
    }

    if (features.advisor) {
      lines.push('Consultoria:', '- orientação financeira', '- despesas essenciais 2200', '- dívida cartão 2000 juros 12% ao mês', '');
    }

    if (features.investmentResearch) {
      lines.push('Investimentos:', '- pesquisar investimentos', '- ativar pesquisa externa', '');
    }

    if (anyEnabled) {
      lines.push('Privacidade:', '- meus dados · exportar meus dados · apagar meus dados');

      if (features.conversationalAi) {
        lines.push('- ativar IA · desativar IA');
      }
    }

    return lines;
  }

  return {
    anyEnabled,
    composeWeeklyReport: (session, text) => weeklyComposer.compose(session, text),
    consentService,
    expenseComment,
    frameAlert,
    helpLines,
    obligationService,
    personalityService,
    process,
    processFallback,
    requestContext,
  };
}

module.exports = {
  createAssistantService,
};
