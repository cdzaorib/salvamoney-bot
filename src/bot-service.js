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
const { parsearGasto, parsearParcelamento } = require('./expense-parser');

function defaultFirebaseOps() {
  const { ref, get, push, set, remove } = require('firebase/database');

  return { ref, get, push, set, remove };
}

function createBotService({
  config,
  db,
  firebaseOps,
  groq,
  safeLog,
  sessionStore,
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
    firebaseOps: { get, push, ref, remove },
    siteUrl: SITE_URL,
  });
  const {
    apagarGastoPorId,
    apagarGastoPorTexto,
    getGastosMesComIds,
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
  const aiMediaService = createAiMediaService({
    config,
    expenseService,
    groq,
    safeLog,
    todayIso,
  });

  // ─── MENSAGEM PRINCIPAL ───────────────────────────────────
  async function processarMensagem(phone, texto, mediaInfo = null) {
    const msg = String(texto || '').trim();
    const msgMin = msg.toLowerCase();
    const sessao = await getSession(phone);

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
        sessao
          ? `✅ Conta atual: *${sessao.user}* | Grupo: *${sessao.group}*`
          : '⚠️ Você ainda não vinculou uma conta.',
      ].join('\n');
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
    if (!sessao) {
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

    // ── ÁUDIO ──
    if (mediaInfo?.type === 'audio') {
      return await aiMediaService.processarAudio(phone, mediaInfo, processarMensagem);
    }

    // ── IMAGEM ──
    if (mediaInfo?.type === 'image') {
      return await aiMediaService.processarImagemComFallback(mediaInfo, sessao);
    }

    // ── HOJE ──
    if (isTodayCommand(msgMin)) {
      return await montarResumoHoje(sessao);
    }

    // ── RESUMO ──
    if (isSummaryCommand(msgMin)) {
      return await montarResumoFormatado(sessao);
    }

    // ── LISTAR ──
    if (isListCommand(msgMin)) {
      return await montarListaGastos(sessao);
    }

    // ── APAGAR ──
    if (isDeleteCommand(msgMin)) {
      return await apagarGastoPorTexto(sessao, msg);
    }

    // ── PARCELAMENTO ──
    if (isParcelamento(msg)) {
      const parcela = parsearParcelamento(msg);

      if (parcela) {
        return await registrarParcelamento(sessao, parcela);
      }
    }

    // ── PARSER SIMPLES ──
    const gasto = parsearGasto(msg);

    if (gasto) {
      return await registrarGasto(sessao, {
        desc: gasto.desc,
        valor: gasto.valor,
        cat: detectarCategoria(gasto.desc),
        data: todayIso(),
      }, 'texto');
    }

    // ── IA ──
    const respostaIA = await aiMediaService.processarTextoComIA(msg, sessao);

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
