'use strict';

const {
  extrairNomeDoCriarCodigo,
  isCreateCodeCommand,
  isDeleteCommand,
  isHelpCommand,
  isListCommand,
  isParcelamento,
  isSummaryCommand,
  isSwitchAccountCommand,
  isTodayCommand,
} = require('./bot/commands');
const { detectarCategoria } = require('./bot/categories');
const { MESES, createDateUtils } = require('./bot/date-utils');
const { createExpenseService } = require('./bot/expense-service');
const { normalizeText, sanitizeKey } = require('./bot/text-utils');
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
  const GROQ_API_KEY = config.groqApiKey;
  const SITE_URL = config.siteUrl;
  const TIME_ZONE = config.timeZone;
  const { getSession, saveSession } = sessionStore;
  const { analisarImagem, baixarMediaComoBase64, chamarIA, transcreverAudio } = groq;
  const { logMediaUrl, logText, maskPhone } = safeLog;
  const { ref, get, push, set, remove } = firebaseOps || defaultFirebaseOps();
  const dateUtils = createDateUtils({
    monthIndexMode: config.monthIndexMode,
    timeZone: TIME_ZONE,
  });
  const { dateParts, todayIso } = dateUtils;
  const {
    apagarGastoPorId,
    apagarGastoPorTexto,
    getGastosMesComIds,
    getResumoTexto,
    montarListaGastos,
    montarResumoFormatado,
    montarResumoHoje,
    registrarGasto,
    registrarParcelamento,
  } = createExpenseService({
    dateUtils,
    db,
    firebaseOps: { get, push, ref, remove },
    siteUrl: SITE_URL,
  });

  // ─── CRIAR CÓDIGO DE GRUPO ────────────────────────────────
  function gerarCodigoGrupo(nome = '') {
    const base = normalizeText(nome)
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase();

    const prefix = base || 'GRUPO';
    const numero = Math.floor(1000 + Math.random() * 9000);

    return `${prefix}${numero}`;
  }

  async function criarCodigoGrupo(phone, nomeInformado) {
    const nome = sanitizeKey(nomeInformado);

    if (!nome) {
      return `💰 *Criar código do SalvaMoney*

Para criar seu código, digite assim:

_criar código SEU NOME_

Exemplo:
_criar código Carlos_

Esse código serve para conectar você ao site e também para dividir contas com outras pessoas.

Se alguém entrar no mesmo código que você, essa pessoa conseguirá ver as contas divididas do grupo.

🌐 Site:
${SITE_URL}`;
    }

    for (let i = 0; i < 8; i++) {
      const codigo = sanitizeKey(gerarCodigoGrupo(nome));
      const snap = await get(ref(db, `grupos/${codigo}`));

      if (!snap.exists()) {
        await set(ref(db, `grupos/${codigo}/info`), {
          criador: nome,
          criadoVia: 'whatsapp',
          criadoEm: new Date().toISOString(),
        });

        await saveSession(phone, {
          user: nome,
          group: codigo,
          updatedAt: todayIso(),
        });

        return `✅ Código criado com sucesso!

👤 Nome: *${nome}*
🔑 Código do grupo: *${codigo}*

Para outra pessoa entrar no mesmo grupo, ela deve mandar:
_entrar NOME ${codigo}_

Esse código serve para vincular sua conta ao site e também para dividir contas com outras pessoas.

Se uma pessoa estiver no mesmo código que você, as contas divididas desse grupo ficarão visíveis para ela.

🌐 Ver no site:
${SITE_URL}`;
      }
    }

    return 'Não consegui gerar um código agora. Tente novamente em alguns segundos.';
  }

  // ─── PROCESSAR COM IA ─────────────────────────────────────
  async function processarComIA(texto, sessao) {
    const resumo = await getResumoTexto(sessao.group, sessao.user);
    const hoje = todayIso();

    const system = `Você é o assistente financeiro do SalvaMoney, app de controle de gastos brasileiro.
WhatsApp: direto, amigável, português brasileiro informal. Emojis com moderação.

USUÁRIO: ${sessao.user} | GRUPO: ${sessao.group} | HOJE: ${hoje}
RESUMO DO MÊS: ${resumo}

CATEGORIAS PERMITIDAS:
Alimentação, Moradia, Transporte, Saúde, Lazer, Educação, Roupas, Academia, Outros.

REGRAS DE CATEGORIA:
- almoço, almocei, jantar, mercado, supermercado, ifood, padaria, lanche, restaurante, pizza, comida → Alimentação
- uber, 99, gasolina, posto, ônibus, passagem, estacionamento, táxi → Transporte
- farmácia, remédio, médico, consulta, exame, dentista → Saúde
- aluguel, luz, água, internet, condomínio, gás → Moradia
- netflix, spotify, cinema, bar, show, festa, ingresso → Lazer
- academia, musculação, gym, pilates → Academia
- curso, faculdade, escola, livro, aula → Educação
- roupa, camisa, calça, tênis, sapato → Roupas

RESPONDA APENAS JSON para ações, ou texto livre para conversa/dúvidas:
• Registrar:  {"acao":"registrar","desc":"...","valor":0.00,"cat":"...","data":"${hoje}"}
• Resumo:     {"acao":"resumo"}
• Apagar:     {"acao":"apagar","texto":"pedido original"}
• Parcelar:   {"acao":"parcelar","desc":"...","valor":0.00,"parcelas":12}

EXEMPLOS:
"almocei, gastei 30"       → {"acao":"registrar","desc":"almoço","valor":30.00,"cat":"Alimentação","data":"${hoje}"}
"almoço 35"                → {"acao":"registrar","desc":"almoço","valor":35.00,"cat":"Alimentação","data":"${hoje}"}
"paguei 150 no mercado"    → {"acao":"registrar","desc":"mercado","valor":150.00,"cat":"Alimentação","data":"${hoje}"}
"uber 22 conto"            → {"acao":"registrar","desc":"uber","valor":22.00,"cat":"Transporte","data":"${hoje}"}
"netflix 37"               → {"acao":"registrar","desc":"Netflix","valor":37.00,"cat":"Lazer","data":"${hoje}"}
"apagar último"            → {"acao":"apagar","texto":"apagar último"}
"lancei errado 50"         → {"acao":"apagar","texto":"lancei errado 50"}
"parcelei TV 1200 em 12x"  → {"acao":"parcelar","desc":"TV","valor":1200.00,"parcelas":12}

Nunca invente valores. Se não informou valor ao registrar, pergunte.`;

    const resposta = await chamarIA([
      { role: 'system', content: system },
      { role: 'user', content: texto },
    ]);

    try {
      const m = resposta.match(/\{[\s\S]*?\}/);

      if (!m) {
        throw new Error('sem json');
      }

      const json = JSON.parse(m[0]);

      if (json.acao === 'registrar') {
        return await registrarGasto(sessao, json, 'ia');
      }

      if (json.acao === 'resumo') {
        return await montarResumoFormatado(sessao);
      }

      if (json.acao === 'apagar') {
        return await apagarGastoPorTexto(sessao, json.texto || texto);
      }

      if (json.acao === 'parcelar') {
        return await registrarParcelamento(sessao, json);
      }
    } catch (_) {
      // Retorna texto livre da IA
    }

    return resposta;
  }

  // ─── PROCESSAR IMAGEM ─────────────────────────────────────
  async function processarImagem(base64, mimeType, sessao) {
    if (!base64) {
      return '⚠️ Imagem recebida sem arquivo. Ative *webhookBase64* na Evolution API.';
    }

    const resposta = await analisarImagem(base64, mimeType);
    const m = resposta.match(/\{[\s\S]*?\}/);

    if (!m) {
      throw new Error('sem json na resposta de visão');
    }

    const json = JSON.parse(m[0]);

    if (!json.encontrou_gasto) {
      return 'Recebi a imagem, mas não encontrei um gasto claro. Tente mandar com legenda: _mercado 45,90_';
    }

    return await registrarGasto(sessao, {
      desc: json.desc,
      valor: Number(json.valor || 0),
      cat: json.cat,
      data: json.data,
    }, 'imagem');
  }

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

    // ── CRIAR CÓDIGO ──
    if (isCreateCodeCommand(msg)) {
      const nome = extrairNomeDoCriarCodigo(msg);

      return await criarCodigoGrupo(phone, nome);
    }

    // ── ENTRAR / TROCAR CONTA ──
    const matchConta = msg.match(
      /^(entrar|(?:trocar|mudar)(?:\s+de)?\s+conta)\s+(.+)\s+([A-Za-z0-9_-]+)$/i
    );

    if (isSwitchAccountCommand(msg) && !matchConta) {
      const contaAtual = sessao
        ? `Conta atual: *${sessao.user}* | Grupo: *${sessao.group}*\n\n`
        : '';

      return `${contaAtual}Para trocar de conta, digite:
_trocar conta SEU NOME CODIGODOGRUPO_

Exemplo:
_trocar conta Ana CASA2024_

Você também pode usar:
_entrar SEU NOME CODIGODOGRUPO_`;
    }

    if (matchConta) {
      const isTroca = isSwitchAccountCommand(matchConta[1]);
      const user = sanitizeKey(matchConta[2]);
      const group = sanitizeKey(matchConta[3].toUpperCase());

      if (!user || !group) {
        return isTroca
          ? '❌ Use: _trocar conta SEU NOME CODIGODOGRUPO_'
          : '❌ Use: _entrar SEU NOME CODIGODOGRUPO_';
      }

      const snap = await get(ref(db, `grupos/${group}`));

      if (!snap.exists()) {
        return `❌ Grupo *${group}* não encontrado.

Verifique se o código está certo.

Se você ainda não tem um código, digite:
_criar código SEU NOME_

Exemplo:
_criar código Carlos_`;
      }

      await saveSession(phone, {
        user,
        group,
        updatedAt: todayIso(),
      });

      const mensagemConta = isTroca
        ? `✅ Conta trocada! Agora você está como *${user}* no grupo *${group}*.`
        : `✅ Pronto! Você entrou como *${user}* no grupo *${group}*.`;

      return `${mensagemConta}

Agora você pode registrar gastos pelo WhatsApp.

Exemplos:
_"almocei e gastei 35"_
_"paguei 150 de mercado"_
_"quanto gastei esse mês?"_

🔑 Esse código também serve para dividir contas.
Se outra pessoa entrar no mesmo código, as contas divididas do grupo ficarão visíveis para ela.

🌐 Ver no site:
${SITE_URL}`;
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
      try {
        let audioBase64 = mediaInfo.base64;

        if (!audioBase64 && mediaInfo.mediaUrl) {
          console.log(`🎙️ Baixando áudio por URL: ${logMediaUrl(mediaInfo.mediaUrl)}`);
          audioBase64 = await baixarMediaComoBase64(mediaInfo.mediaUrl);
        }

        if (!audioBase64) {
          console.log('⚠️ Áudio sem base64 e sem mediaUrl.');
          return '⚠️ Recebi seu áudio, mas ele veio sem arquivo. Mesmo com webhookBase64 ativo, a Evolution não mandou o base64 no payload.';
        }

        const transcricao = await transcreverAudio(audioBase64, mediaInfo.mimeType);

        if (!transcricao) {
          return 'Não entendi o áudio. Fale o valor e a descrição com clareza.';
        }

        console.log(`🎙️ [${maskPhone(phone)}] Transcrito: ${logText(transcricao)}`);

        return await processarMensagem(phone, transcricao, null);
      } catch (err) {
        console.error('Erro áudio:', err.response?.data || err.message);

        return 'Erro ao processar áudio. Tente mandar em texto por enquanto.';
      }
    }

    // ── IMAGEM ──
    if (mediaInfo?.type === 'image') {
      try {
        return await processarImagem(mediaInfo.base64, mediaInfo.mimeType, sessao);
      } catch (err) {
        console.error('Erro imagem:', err.message);

        return 'Não consegui ler a imagem. Tente mandar com legenda: _mercado 45,90_';
      }
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
    if (GROQ_API_KEY) {
      try {
        return await processarComIA(msg, sessao);
      } catch (err) {
        console.error('Erro IA:', err.response?.data || err.message);
      }
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
