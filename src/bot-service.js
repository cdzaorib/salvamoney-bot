'use strict';

const {
  isDeleteCommand,
  isHelpCommand,
  isListCommand,
  isParcelamento,
  isSummaryCommand,
  isTodayCommand,
} = require('./bot/commands');
const { createAccountService } = require('./bot/account-service');
const { createAlertService } = require('./bot/alert-service');
const { createAiMediaService } = require('./bot/ai-media-service');
const { detectarCategoria } = require('./bot/categories');
const { createChargeService } = require('./bot/charge-service');
const { MESES, createDateUtils } = require('./bot/date-utils');
const { createExpenseService } = require('./bot/expense-service');
const { createExpenseQueryService } = require('./bot/expense-query-service');
const { createFinancialAdvisorService } = require('./bot/financial-advisor-service');
const { createFinancialProfileService } = require('./bot/financial-profile-service');
const { createFixedExpenseService } = require('./bot/fixed-expense-service');
const { createMonthlySummaryService } = require('./bot/monthly-summary-service');
const { createSavingsGoalService } = require('./bot/savings-goal-service');
const { normalizeText } = require('./bot/text-utils');
const { parsearGasto, parsearParcelamento } = require('./expense-parser');
const {
  DEFAULT_GROUP,
  createUserService,
  isValidEmail,
  normalizeEmail,
  normalizeAccessTag,
} = require('./services/user-service');

const SIGNUP_ASK_NAME = 'signup_ask_name';
const SIGNUP_ASK_EMAIL = 'signup_ask_email';
const SIGNUP_CONFIRM = 'signup_confirm';
const SIGNUP_STEPS = new Set([
  SIGNUP_ASK_NAME,
  SIGNUP_ASK_EMAIL,
  SIGNUP_CONFIRM,
]);
const SIGNUP_START_COMMANDS = new Set([
  'cadastro',
  'comecar cadastro',
  'criar conta',
]);
const SIGNUP_CANCEL_COMMANDS = new Set([
  'cancelar',
  'cancelar cadastro',
]);
const ACCOUNT_LOGOUT_COMMANDS = new Set([
  'sair da conta',
]);
const MY_TAG_COMMANDS = new Set([
  'minha tag',
  'mostrar minha tag',
  'qual e a minha tag',
  'qual e minha tag',
  'qual minha tag',
  'ver minha tag',
]);
const MY_PROFILE_COMMANDS = new Set([
  'meu perfil',
]);
const FIND_TAG_COMMAND_PATTERN = /^(buscar|procurar|encontrar) tag(?: (.+))?$/;
const TAG_ACCOUNT_REQUIRED_MESSAGE = 'Para usar o SalvaMoney, crie sua conta pelo WhatsApp usando: criar conta SeuNome ou entre com sua tag: entrar 123456.';

function defaultFirebaseOps() {
  const { getFirebaseOps } = require('./firebase-db');

  return getFirebaseOps();
}

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/\s+/g, ' ');
}

function normalizedQuestionCommand(value) {
  return normalizedCommand(value).replace(/[?!.]+$/g, '').trim();
}

function isSignupStartCommand(value) {
  return SIGNUP_START_COMMANDS.has(normalizedCommand(value));
}

function parseSignupStartCommand(value) {
  const match = String(value || '').trim().match(/^(criar conta|cadastro)(?:\s+(.+))?$/i);

  if (!match) {
    return null;
  }

  return {
    name: String(match[2] || '').trim(),
  };
}

function isSignupCancelCommand(value) {
  return SIGNUP_CANCEL_COMMANDS.has(normalizedCommand(value));
}

function isAccountLogoutCommand(value) {
  return ACCOUNT_LOGOUT_COMMANDS.has(normalizedCommand(value));
}

function isMyTagCommand(value) {
  return MY_TAG_COMMANDS.has(normalizedQuestionCommand(value));
}

function isMyProfileCommand(value) {
  return MY_PROFILE_COMMANDS.has(normalizedCommand(value));
}

function parseFindTagCommand(value) {
  const match = normalizedCommand(value).match(FIND_TAG_COMMAND_PATTERN);

  if (!match) {
    return null;
  }

  return {
    shareTag: String(match[2] || '').trim().toUpperCase(),
  };
}

function isSignupActive(sessao) {
  return SIGNUP_STEPS.has(sessao?.signupStep);
}

function hasLinkedAccountSession(sessao) {
  return Boolean(sessao?.user && sessao?.group);
}

function hasValidAccessSession(sessao) {
  const tag = normalizeAccessTag(sessao?.tag || sessao?.user);

  return Boolean(tag && sessao?.group === DEFAULT_GROUP && sessao?.user === tag);
}

function hasPendingDelete(sessao) {
  return Boolean(sessao?.pendingDelete?.type);
}

function isDeleteStartCommand(value) {
  return /^(apagar|excluir|remover)\b/.test(normalizedCommand(value));
}

function sessionWithPhone(sessao, phone) {
  return {
    ...sessao,
    phone,
  };
}

function clearSignupFields(sessao) {
  const cleaned = { ...(sessao || {}) };

  delete cleaned.signupStep;
  delete cleaned.pendingName;
  delete cleaned.pendingEmail;

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function clearAccountSessionFields(sessao) {
  const cleaned = clearSignupFields(sessao) || {};

  delete cleaned.user;
  delete cleaned.group;
  delete cleaned.pendingDelete;

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function clearPendingDeleteFields(sessao) {
  const cleaned = { ...(sessao || {}) };

  delete cleaned.pendingDelete;

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function signupConfirmMessage(name, email) {
  return [
    'Confirma seus dados?',
    '',
    `Nome: ${name}`,
    `E-mail: ${email}`,
    '',
    'Responda:',
    '1 - Confirmar',
    '2 - Corrigir',
  ].join('\n');
}

function existingAccountMessage(user) {
  return [
    'Você já possui uma conta no SalvaMoney.',
    '',
    `Nome: ${user.name || '-'}`,
    `Sua tag de acesso é: ${user.tag || user.shareTag || '-'}`,
  ].join('\n');
}

function welcomeSignupMessage(user, fallbackName) {
  const name = user.name || fallbackName;

  return [
    `Conta criada, ${name}!`,
    '',
    `Sua tag de acesso é: ${user.tag || user.shareTag}`,
    '',
    'Use essa tag para entrar no site e no WhatsApp.',
  ].join('\n');
}

function missingUserAccountMessage() {
  return [
    'Você ainda não criou sua conta no SalvaMoney.',
    '',
    'Para criar, envie:',
    'criar conta',
  ].join('\n');
}

function myTagMessage(user) {
  return [
    `Sua tag de acesso é: ${user.tag || user.shareTag}`,
  ].join('\n');
}

function myProfileMessage(user) {
  return [
    'Seu perfil no SalvaMoney:',
    '',
    `Nome: ${user.name || '-'}`,
    `E-mail: ${user.email || '-'}`,
    `Tag: ${user.tag || user.shareTag || '-'}`,
  ].join('\n');
}

function missingSearchTagMessage() {
  return [
    'Envie a tag que deseja buscar.',
    '',
    'Exemplo:',
    'buscar tag 123456',
  ].join('\n');
}

function foundShareTagMessage(user, shareTag) {
  return [
    'Encontrei:',
    '',
    `Nome: ${user.name || '-'}`,
    `Tag: ${user.tag || user.shareTag || shareTag}`,
  ].join('\n');
}

function notFoundShareTagMessage() {
  return [
    'Não encontrei ninguém com essa tag.',
    '',
    'Confira se digitou corretamente.',
  ].join('\n');
}

function createBotService({
  config,
  db,
  firebaseOps,
  groq,
  notificationSender,
  safeLog,
  sessionStore,
  userService: providedUserService,
}) {
  const SITE_URL = config.siteUrl;
  const TIME_ZONE = config.timeZone;
  const { getSession, saveSession } = sessionStore;
  const { ref, get, push, set, update, remove } = firebaseOps || defaultFirebaseOps();
  const dateUtils = createDateUtils({
    monthIndexMode: config.monthIndexMode,
    timeZone: TIME_ZONE,
  });
  const { dateParts, todayIso } = dateUtils;
  const expenseService = createExpenseService({
    dateUtils,
    db,
    firebaseOps: { get, push, ref, remove, set },
    siteUrl: SITE_URL,
  });
  const {
    apagarGastoPorId,
    apagarGastoSelecionado,
    apagarGastoPorTexto,
    apagarParcelamentoSelecionado,
    buscarParcelamentosParaApagar,
    getGastosMesComIds,
    installmentConfirmationMessage,
    montarListaGastos,
    montarResumoFormatado,
    montarResumoHoje,
    registrarGasto,
    registrarParcelamento,
  } = expenseService;
  const fixedExpenseService = createFixedExpenseService({
    dateUtils,
    db,
    firebaseOps: { get, push, ref, remove, set },
  });
  const expenseQueryService = createExpenseQueryService({
    dateUtils,
    db,
    firebaseOps: { get, ref },
  });
  const financialProfileService = createFinancialProfileService({
    db,
    firebaseOps: { get, ref, update },
  });
  const monthlySummaryService = createMonthlySummaryService({
    config,
    dateUtils,
    db,
    firebaseOps: { get, ref },
    groq,
  });
  const financialAdvisorService = createFinancialAdvisorService({
    config,
    dateUtils,
    db,
    firebaseOps: { get, ref },
    groq,
  });
  const savingsGoalService = createSavingsGoalService({
    config,
    dateUtils,
    db,
    firebaseOps: { get, ref, update },
    groq,
  });
  const alertService = createAlertService({
    dateUtils,
    db,
    firebaseOps: { get, push, ref, update },
  });
  const chargeService = createChargeService({
    dateUtils,
    db,
    firebaseOps: { get, push, ref, set, update },
    notificationSender,
  });
  const userService = providedUserService || createUserService({
    db,
    firebaseOps: { get, ref, set, update },
  });
  const accountService = createAccountService({
    db,
    firebaseOps: { get, ref, set },
    saveSession,
    siteUrl: SITE_URL,
    todayIso,
    userService,
  });
  const expenseServiceWithAlerts = {
    ...expenseService,
    registrarGasto: registrarGastoComAlertas,
    registrarParcelamento: registrarParcelamentoComAlertas,
  };
  const aiMediaService = createAiMediaService({
    config,
    expenseService: expenseServiceWithAlerts,
    groq,
    safeLog,
    todayIso,
  });

  function shouldCheckAlerts(response) {
    return typeof response === 'string' && /\b(registrado|parcelado)\b/i.test(response);
  }

  async function appendAlertMessages(response, session) {
    try {
      const alertMessages = await alertService.verificarAlertas(session);

      return alertMessages.length
        ? [response, ...alertMessages].join('\n\n')
        : response;
    } catch (err) {
      console.error('Erro ao verificar alertas financeiros:', err.response?.data || err.message || err);

      return response;
    }
  }

  async function registrarGastoComAlertas(session, expense, source = 'texto') {
    const response = await registrarGasto(session, expense, source);

    return shouldCheckAlerts(response)
      ? await appendAlertMessages(response, session)
      : response;
  }

  async function registrarParcelamentoComAlertas(session, installment) {
    const response = await registrarParcelamento(session, installment);

    return shouldCheckAlerts(response)
      ? await appendAlertMessages(response, session)
      : response;
  }

  async function saveSignupSession(phone, sessao, data) {
    await saveSession(phone, {
      ...(sessao || {}),
      ...data,
    });
  }

  async function clearSignupSession(phone, sessao) {
    await saveSession(phone, clearSignupFields(sessao));
  }

  async function logoutAccountSession(phone, sessao) {
    await saveSession(phone, clearAccountSessionFields(sessao));

    return [
      'Você saiu da sua conta atual.',
      '',
      'Seu cadastro, sua tag e seus gastos foram preservados.',
      '',
      'Para entrar novamente, envie:',
      'entrar 123456',
    ].join('\n');
  }

  async function savePendingDeleteSession(phone, sessao, pendingDelete) {
    await saveSession(phone, {
      ...(sessao || {}),
      pendingDelete,
    });
  }

  async function clearPendingDeleteSession(phone, sessao) {
    await saveSession(phone, clearPendingDeleteFields(sessao));
  }

  function pendingDeleteInvalidChoiceMessage(pendingDelete) {
    const count = pendingDelete?.candidates?.length || 0;

    return count > 0
      ? `Responda com um número de 1 a ${count} ou "cancelar".`
      : 'Responda com o número do gasto que deseja apagar ou "cancelar".';
  }

  function isPendingDeleteCancelCommand(value) {
    return ['cancela', 'cancelar'].includes(normalizedCommand(value));
  }

  async function processarPendingDelete(phone, msg, sessao) {
    if (!hasPendingDelete(sessao)) {
      return null;
    }

    if (isPendingDeleteCancelCommand(msg)) {
      await clearPendingDeleteSession(phone, sessao);

      return 'Exclusão cancelada. Nenhum gasto foi apagado.';
    }

    const command = normalizedCommand(msg);
    const option = /^\d+$/.test(command) ? Number(command) : NaN;
    const { pendingDelete } = sessao;
    const candidates = pendingDelete.candidates || [];

    if (pendingDelete.type === 'expense_selection') {
      if (!Number.isInteger(option) || option < 1 || option > candidates.length) {
        return pendingDeleteInvalidChoiceMessage(pendingDelete);
      }

      const resposta = await apagarGastoSelecionado(sessionWithPhone(sessao, phone), candidates[option - 1]);

      await clearPendingDeleteSession(phone, sessao);

      return resposta;
    }

    if (pendingDelete.type === 'fixed_expense_selection') {
      if (!Number.isInteger(option) || option < 1 || option > candidates.length) {
        return pendingDeleteInvalidChoiceMessage(pendingDelete);
      }

      const resposta = await fixedExpenseService.removerFixoSelecionado(
        sessionWithPhone(sessao, phone),
        candidates[option - 1]
      );

      await clearPendingDeleteSession(phone, sessao);

      return resposta;
    }

    if (pendingDelete.type === 'installment_selection') {
      if (!Number.isInteger(option) || option < 1 || option > candidates.length) {
        return pendingDeleteInvalidChoiceMessage(pendingDelete);
      }

      const installment = candidates[option - 1];

      await savePendingDeleteSession(phone, sessao, {
        type: 'installment_confirmation',
        installment,
      });

      return installmentConfirmationMessage(installment);
    }

    if (pendingDelete.type === 'installment_confirmation') {
      if (command !== 'sim') {
        return 'Responda SIM para confirmar ou CANCELAR.';
      }

      const resposta = await apagarParcelamentoSelecionado(
        sessionWithPhone(sessao, phone),
        pendingDelete.installment
      );

      await clearPendingDeleteSession(phone, sessao);

      return resposta;
    }

    return null;
  }

  async function processarConsultaUsuario(phone, msg) {
    const findTagCommand = parseFindTagCommand(msg);

    if (!isMyTagCommand(msg) && !isMyProfileCommand(msg) && !findTagCommand) {
      return null;
    }

    if (findTagCommand) {
      if (!findTagCommand.shareTag) {
        return missingSearchTagMessage();
      }

      const foundUser = await userService.getUserByShareTag(findTagCommand.shareTag);

      return foundUser
        ? foundShareTagMessage(foundUser, findTagCommand.shareTag)
        : notFoundShareTagMessage();
    }

    const existingUser = await userService.getUserByPhone(phone);

    if (!existingUser) {
      return missingUserAccountMessage();
    }

    const user = await userService.getOrCreateUserByPhone(phone, {
      email: existingUser.email,
      name: existingUser.name,
    });

    await accountService.saveAccessSession(phone, user);

    return isMyTagCommand(msg)
      ? myTagMessage(user)
      : myProfileMessage(user);
  }

  async function createAccountAndSession(phone, sessao, name) {
    const user = await userService.getOrCreateUserByPhone(phone, { name });
    const tag = user.tag || user.shareTag;

    await saveSession(phone, {
      group: DEFAULT_GROUP,
      user: tag,
      name: user.name || name,
      tag,
      updatedAt: todayIso(),
    });

    return welcomeSignupMessage(user, name);
  }

  async function startSignup(phone, sessao, name = '') {
    const existingUser = await userService.getUserByPhone(phone);

    if (existingUser) {
      const user = await userService.getOrCreateUserByPhone(phone, {
        email: existingUser.email,
        name: existingUser.name,
      });

      await accountService.saveAccessSession(phone, user);

      return existingAccountMessage(user);
    }

    if (name) {
      return await createAccountAndSession(phone, sessao, name);
    }

    await saveSignupSession(phone, sessao, {
      signupStep: SIGNUP_ASK_NAME,
      pendingName: null,
      pendingEmail: null,
    });

    return [
      'Vamos criar sua conta no SalvaMoney.',
      'Qual é o seu nome?',
    ].join('\n');
  }

  async function processarCadastro(phone, msg, sessao) {
    const signupActive = isSignupActive(sessao);
    const signupStart = parseSignupStartCommand(msg);

    if (!signupActive && signupStart) {
      return await startSignup(phone, sessao, signupStart.name);
    }

    if (!signupActive) {
      return null;
    }

    if (isSignupCancelCommand(msg)) {
      await clearSignupSession(phone, sessao);

      return 'Cadastro cancelado. Quando quiser, envie "criar conta" novamente.';
    }

    if (sessao.signupStep === SIGNUP_ASK_NAME) {
      const name = msg.trim();

      if (!name) {
        return 'Qual é o seu nome?';
      }

      return await createAccountAndSession(phone, sessao, name);
    }

    if (sessao.signupStep === SIGNUP_ASK_EMAIL) {
      const email = normalizeEmail(msg);

      if (!isValidEmail(email)) {
        return [
          'Esse e-mail parece inválido.',
          'Envie novamente um e-mail válido.',
        ].join('\n');
      }

      await saveSignupSession(phone, sessao, {
        signupStep: SIGNUP_CONFIRM,
        pendingEmail: email,
      });

      return signupConfirmMessage(sessao.pendingName, email);
    }

    if (sessao.signupStep === SIGNUP_CONFIRM) {
      if (msg === '2') {
        await saveSignupSession(phone, sessao, {
          signupStep: SIGNUP_ASK_NAME,
          pendingName: null,
          pendingEmail: null,
        });

        return [
          'Tudo bem. Vamos começar de novo.',
          'Qual é o seu nome?',
        ].join('\n');
      }

      if (msg !== '1') {
        return [
          'Responda:',
          '1 - Confirmar',
          '2 - Corrigir',
        ].join('\n');
      }

      const user = await userService.getOrCreateUserByPhone(phone, {
        name: sessao.pendingName,
        email: sessao.pendingEmail,
      });

      await clearSignupSession(phone, sessao);

      return welcomeSignupMessage(user, sessao.pendingName);
    }

    return null;
  }

  // ─── MENSAGEM PRINCIPAL ───────────────────────────────────
  async function processarMensagem(phone, texto, mediaInfo = null) {
    const msg = String(texto || '').trim();
    const msgMin = msg.toLowerCase();
    let sessao = await getSession(phone);

    // ── AJUDA ──
    if (isHelpCommand(msgMin)) {
      return [
        'Olá, eu sou o SalvaMoney 💰',
        '',
        'Comandos principais:',
        '',
        'Conta:',
        '- criar conta Carlos',
        '- minha tag',
        '- entrar 123456',
        '',
        'Gastos:',
        '- gastei 30 no mercado',
        '- gastei 120 em 3x no cartão',
        '- apagar mercado',
        '- quanto gastei com delivery esse mês?',
        '',
        'Fixos:',
        '- gasto fixo internet 99 dia 10',
        '- listar fixos',
        '',
        'Perfil:',
        '- recebo 3000 todo dia 5',
        '- meu cartão vence dia 12',
        '- definir orçamento 2000',
        '',
        'Inteligência:',
        '- resumo do mês',
        '- onde posso economizar?',
        '- estou gastando muito com delivery?',
        '',
        'Alertas:',
        '- me avise quando eu gastar mais de 300 com mercado',
        '- meus alertas',
        '',
        'Cobranças:',
        '- cobrar 80 da tag 123456 pelo almoço',
        '- cobranças recebidas',
        '- aceitar cobrança 1',
        '- recebi cobrança 1',
        '',
        'Site:',
        SITE_URL,
      ].join('\n');
    }

    if (isAccountLogoutCommand(msg)) {
      return await logoutAccountSession(phone, sessao);
    }

    if (hasPendingDelete(sessao) && isDeleteStartCommand(msg)) {
      await clearPendingDeleteSession(phone, sessao);
      sessao = clearPendingDeleteFields(sessao);
    }

    const respostaPendingDelete = await processarPendingDelete(phone, msg, sessao);

    if (respostaPendingDelete) {
      return respostaPendingDelete;
    }

    const respostaConsultaUsuario = await processarConsultaUsuario(phone, msg);

    if (respostaConsultaUsuario) {
      return respostaConsultaUsuario;
    }

    const respostaCadastro = await processarCadastro(phone, msg, sessao);

    if (respostaCadastro) {
      return respostaCadastro;
    }

    const respostaConta = await accountService.processarComandoConta({
      phone,
      sessao,
      texto: msg,
    });

    if (respostaConta) {
      return respostaConta;
    }

    // ── SEM SESSÃO VÁLIDA ──
    if (!hasValidAccessSession(sessao)) {
      const respostaCobranca = await chargeService.processarCobranca(sessao, msg);

      if (respostaCobranca) {
        return respostaCobranca;
      }

      const respostaAlerta = await alertService.processarComandoAlerta(sessao, msg);

      if (respostaAlerta) {
        return respostaAlerta;
      }

      const respostaConsultaGastos = await expenseQueryService.processarConsultaGastos(sessao, msg);

      if (respostaConsultaGastos) {
        return respostaConsultaGastos;
      }

      const respostaResumoMensal = await monthlySummaryService.processarResumoMensal(sessao, msg);

      if (respostaResumoMensal) {
        return respostaResumoMensal;
      }

      const respostaPerfilFinanceiro = await financialProfileService.processarPerfilFinanceiro(sessao, msg);

      if (respostaPerfilFinanceiro) {
        return respostaPerfilFinanceiro;
      }

      const respostaMetaEconomia = await savingsGoalService.processarMetaEconomia(sessao, msg);

      if (respostaMetaEconomia) {
        return respostaMetaEconomia;
      }

      const respostaAdvisorFinanceiro = await financialAdvisorService.processarAdvisorFinanceiro(sessao, msg);

      if (respostaAdvisorFinanceiro) {
        return respostaAdvisorFinanceiro;
      }

      return `${TAG_ACCOUNT_REQUIRED_MESSAGE}

🌐 Site:
${SITE_URL}`;
    }

    const sessaoComPhone = sessionWithPhone(sessao, phone);

    const respostaCobranca = await chargeService.processarCobranca(sessaoComPhone, msg);

    if (respostaCobranca) {
      return respostaCobranca;
    }

    const respostaAlerta = await alertService.processarComandoAlerta(sessaoComPhone, msg);

    if (respostaAlerta) {
      return respostaAlerta;
    }

    const respostaResumoMensal = await monthlySummaryService.processarResumoMensal(sessaoComPhone, msg);

    if (respostaResumoMensal) {
      return respostaResumoMensal;
    }

    const respostaConsultaGastos = await expenseQueryService.processarConsultaGastos(sessaoComPhone, msg);

    if (respostaConsultaGastos) {
      return respostaConsultaGastos;
    }

    const respostaPerfilFinanceiro = await financialProfileService.processarPerfilFinanceiro(sessaoComPhone, msg);

    if (respostaPerfilFinanceiro) {
      return respostaPerfilFinanceiro;
    }

    const respostaMetaEconomia = await savingsGoalService.processarMetaEconomia(sessaoComPhone, msg);

    if (respostaMetaEconomia) {
      return respostaMetaEconomia;
    }

    const respostaAdvisorFinanceiro = await financialAdvisorService.processarAdvisorFinanceiro(sessaoComPhone, msg);

    if (respostaAdvisorFinanceiro) {
      return respostaAdvisorFinanceiro;
    }

    // ── ÁUDIO ──
    if (mediaInfo?.type === 'audio') {
      return await aiMediaService.processarAudio(phone, mediaInfo, processarMensagem);
    }

    // ── IMAGEM ──
    if (mediaInfo?.type === 'image') {
      return await aiMediaService.processarImagemComFallback(mediaInfo, sessaoComPhone);
    }

    const respostaFixo = await fixedExpenseService.processarComandoFixo(sessaoComPhone, msg, {
      createPendingSelection: true,
    });

    if (respostaFixo) {
      if (respostaFixo?.pendingDelete) {
        await savePendingDeleteSession(phone, sessao, respostaFixo.pendingDelete);

        return respostaFixo.message;
      }

      return respostaFixo;
    }

    // ── HOJE ──
    if (isTodayCommand(msgMin)) {
      return await montarResumoHoje(sessaoComPhone);
    }

    // ── RESUMO ──
    if (isSummaryCommand(msgMin)) {
      return await montarResumoFormatado(sessaoComPhone);
    }

    // ── LISTAR ──
    if (isListCommand(msgMin)) {
      return await montarListaGastos(sessaoComPhone);
    }

    // ── APAGAR ──
    if (isDeleteCommand(msgMin)) {
      const respostaParcelamento = await buscarParcelamentosParaApagar(sessaoComPhone, msg, {
        createPendingSelection: true,
      });

      if (respostaParcelamento) {
        if (respostaParcelamento?.pendingDelete) {
          await savePendingDeleteSession(phone, sessao, respostaParcelamento.pendingDelete);

          return respostaParcelamento.message;
        }

        return respostaParcelamento;
      }

      const respostaApagar = await apagarGastoPorTexto(sessaoComPhone, msg, {
        createPendingSelection: true,
      });

      if (respostaApagar?.pendingDelete) {
        await savePendingDeleteSession(phone, sessao, respostaApagar.pendingDelete);

        return respostaApagar.message;
      }

      return respostaApagar;
    }

    // ── PARCELAMENTO ──
    if (isParcelamento(msg)) {
      const parcela = parsearParcelamento(msg);

      if (parcela) {
        return await registrarParcelamentoComAlertas(sessaoComPhone, parcela);
      }
    }

    // ── PARSER SIMPLES ──
    const gasto = parsearGasto(msg);

    if (gasto) {
      return await registrarGastoComAlertas(sessaoComPhone, {
        desc: gasto.desc,
        valor: gasto.valor,
        cat: detectarCategoria(gasto.desc),
        data: todayIso(),
      }, 'texto');
    }

    // ── IA ──
    const respostaIA = await aiMediaService.processarTextoComIA(msg, sessaoComPhone);

    if (respostaIA !== undefined) {
      return respostaIA;
    }

    return `🤔 Não entendi. Tente:
_gastei 50 almoço_
_35 uber_
_apagar último_

Ou *ajuda* para ver os comandos.`;
  }

  return {
    MESES,
    apagarGastoPorId,
    dateParts,
    getGastosMesComIds,
    processarMensagem,
  };
}

module.exports = {
  createBotService,
};
