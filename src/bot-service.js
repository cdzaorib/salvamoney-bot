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
const { createAiMediaService } = require('./bot/ai-media-service');
const { detectarCategoria } = require('./bot/categories');
const { MESES, createDateUtils } = require('./bot/date-utils');
const { createExpenseService } = require('./bot/expense-service');
const { normalizeText } = require('./bot/text-utils');
const { parsearGasto, parsearParcelamento } = require('./expense-parser');
const {
  createUserService,
  isValidEmail,
  normalizeEmail,
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

function hasExpenseSelectionPendingDelete(sessao) {
  return sessao?.pendingDelete?.type === 'expense_selection';
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
    `E-mail: ${user.email || '-'}`,
    `Sua tag: ${user.shareTag || '-'}`,
  ].join('\n');
}

function welcomeSignupMessage(user, fallbackName) {
  const name = user.name || fallbackName;

  return [
    `Seja bem-vinda, ${name}!`,
    '',
    `Sua tag no SalvaMoney é: ${user.shareTag}`,
    '',
    'Compartilhe essa tag com outras pessoas para dividir gastos e organizar contas.',
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
    `Sua tag no SalvaMoney é: ${user.shareTag}`,
    '',
    'Compartilhe essa tag com outras pessoas para dividir gastos e organizar contas.',
  ].join('\n');
}

function myProfileMessage(user) {
  return [
    'Seu perfil no SalvaMoney:',
    '',
    `Nome: ${user.name || '-'}`,
    `E-mail: ${user.email || '-'}`,
    `Tag: ${user.shareTag || '-'}`,
  ].join('\n');
}

function missingSearchTagMessage() {
  return [
    'Envie a tag que deseja buscar.',
    '',
    'Exemplo:',
    'buscar tag ANNA-8K2P7Q',
  ].join('\n');
}

function foundShareTagMessage(user, shareTag) {
  return [
    'Encontrei:',
    '',
    `Nome: ${user.name || '-'}`,
    `Tag: ${user.shareTag || shareTag}`,
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
  safeLog,
  sessionStore,
  userService: providedUserService,
}) {
  const SITE_URL = config.siteUrl;
  const TIME_ZONE = config.timeZone;
  const { getSession, saveSession } = sessionStore;
  const { ref, get, push, set, remove } = firebaseOps || defaultFirebaseOps();
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
  const accountService = createAccountService({
    db,
    firebaseOps: { get, ref, set },
    saveSession,
    siteUrl: SITE_URL,
    todayIso,
  });
  const userService = providedUserService || createUserService({
    db,
    firebaseOps: { get, ref, set },
  });
  const aiMediaService = createAiMediaService({
    config,
    expenseService,
    groq,
    safeLog,
    todayIso,
  });

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
      'entrar SEU_NOME SEU_GRUPO',
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

    const user = await userService.getUserByPhone(phone);

    if (!user) {
      return missingUserAccountMessage();
    }

    return isMyTagCommand(msg)
      ? myTagMessage(user)
      : myProfileMessage(user);
  }

  async function startSignup(phone, sessao) {
    const existingUser = await userService.getUserByPhone(phone);

    if (existingUser) {
      return existingAccountMessage(existingUser);
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

    if (!signupActive && isSignupStartCommand(msg)) {
      return await startSignup(phone, sessao);
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

      await saveSignupSession(phone, sessao, {
        signupStep: SIGNUP_ASK_EMAIL,
        pendingName: name,
        pendingEmail: null,
      });

      return 'Agora me envie seu e-mail.';
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
        '💰 *SalvaMoney Bot*',
        '',
        'Para começar, você precisa vincular sua conta.',
        '',
        '👤 *Entrar em um grupo existente:*',
        '_entrar SEU NOME CODIGODOGRUPO_',
        '',
        'Exemplo:',
        '_entrar Carlos CASA2024_',
        '',
        '🔁 *Trocar de conta:*',
        '_trocar conta SEU NOME CODIGODOGRUPO_',
        '',
        '🆕 *Não tem código?*',
        'Digite:',
        '_criar código SEU NOME_',
        '',
        'Exemplo:',
        '_criar código Carlos_',
        '',
        '🔑 *Para que serve o código?*',
        'O código conecta sua conta do WhatsApp com o site.',
        'Ele também serve para dividir contas com outras pessoas.',
        'Se outra pessoa entrar no mesmo código que você, as contas divididas desse grupo ficarão visíveis para ela.',
        '',
        '📌 *Registrar gasto:*',
        '_almocei e gastei 35_',
        '_paguei 150 mercado_',
        '_netflix 37_',
        '',
        '💳 *Parcelamento:*',
        '_parcelei TV 1200 em 12x_',
        '',
        '🎙️ *Áudio:*',
        'Mande um áudio falando o gasto.',
        '',
        '🧾 *Foto:*',
        'Mande foto de comprovante ou nota fiscal.',
        '',
        '🗑️ *Apagar gasto:*',
        '_apagar último_',
        '_apagar 35_',
        '_lancei errado_',
        '',
        '📊 *Resumo:*',
        '_resumo_ ou _quanto gastei?_',
        '',
        '📅 *Hoje:*',
        '_quanto gastei hoje?_',
        '',
        '🧾 *Últimos gastos:*',
        '_listar gastos_',
        '',
        '🌐 *Ver no site:*',
        SITE_URL,
        '',
        hasLinkedAccountSession(sessao)
          ? `✅ Conta atual: *${sessao.user}* | Grupo: *${sessao.group}*`
          : '⚠️ Você ainda não vinculou uma conta.',
      ].join('\n');
    }

    if (isAccountLogoutCommand(msg)) {
      return await logoutAccountSession(phone, sessao);
    }

    if (hasExpenseSelectionPendingDelete(sessao) && isDeleteStartCommand(msg)) {
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

    // ── SEM SESSÃO ──
    if (!hasLinkedAccountSession(sessao)) {
      return `⚠️ Para usar o SalvaMoney, primeiro vincule sua conta.

Se você já tem um código, digite:
_entrar SEU NOME CODIGODOGRUPO_

Exemplo:
_entrar João CASA2024_

Se você ainda não tem código, digite:
_criar código SEU NOME_

Exemplo:
_criar código João_

🔑 O código serve para conectar sua conta ao site e também para dividir contas com outras pessoas.

Se outra pessoa entrar no mesmo código que você, as contas divididas do grupo ficarão visíveis para ela.

🌐 Site:
${SITE_URL}`;
    }

    const sessaoComPhone = sessionWithPhone(sessao, phone);

    // ── ÁUDIO ──
    if (mediaInfo?.type === 'audio') {
      return await aiMediaService.processarAudio(phone, mediaInfo, processarMensagem);
    }

    // ── IMAGEM ──
    if (mediaInfo?.type === 'image') {
      return await aiMediaService.processarImagemComFallback(mediaInfo, sessaoComPhone);
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
        return await registrarParcelamento(sessaoComPhone, parcela);
      }
    }

    // ── PARSER SIMPLES ──
    const gasto = parsearGasto(msg);

    if (gasto) {
      return await registrarGasto(sessaoComPhone, {
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
