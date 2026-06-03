'use strict';

const { validCategories } = require('./categories');

function createAiMediaService({
  aiProviderRouter,
  expenseService,
  groq,
  safeLog,
  todayIso,
}) {
  const {
    apagarGastoPorTexto,
    getCategoriasPersonalizadas,
    getResumoTexto,
    montarResumoFormatado,
    registrarGasto,
    registrarParcelamento,
  } = expenseService;
  const { analisarImagem, baixarMediaComoBase64, transcreverAudio } = groq;
  const { logMediaUrl, logText, maskPhone } = safeLog;

  function errorDetails(err) {
    return err.response?.data || err.error || err.message;
  }

  async function processarComIA(texto, sessao) {
    const resumo = await getResumoTexto(sessao.group, sessao.user);
    const hoje = todayIso();
    const customCategories = typeof getCategoriasPersonalizadas === 'function'
      ? await getCategoriasPersonalizadas(sessao)
      : [];
    const categories = validCategories(customCategories).join(', ');
    const customRules = customCategories.length
      ? [
        '',
        'CATEGORIAS PERSONALIZADAS DO USUÁRIO:',
        ...customCategories.map((category) => `- ${category.nome}: ${category.palavras.join(', ')}`),
      ].join('\n')
      : '';

    const system = `Você é o assistente financeiro do SalvaMoney, app de controle de gastos brasileiro.
WhatsApp: direto, amigável, português brasileiro informal. Emojis com moderação.

HOJE: ${hoje}
RESUMO DO MÊS: ${resumo}

CATEGORIAS PERMITIDAS:
${categories}.

REGRAS DE CATEGORIA:
- almoço, almocei, jantar, mercado, supermercado, ifood, padaria, lanche, restaurante, pizza, comida → Alimentação
- uber, 99, gasolina, posto, ônibus, passagem, estacionamento, táxi → Transporte
- farmácia, remédio, médico, consulta, exame, dentista → Saúde
- aluguel, luz, água, internet, condomínio, gás → Moradia
- netflix, spotify, cinema, bar, show, festa, ingresso → Lazer
- academia, musculação, gym, pilates → Academia
- curso, faculdade, escola, livro, aula → Educação
- roupa, camisa, calça, tênis, sapato → Roupas
${customRules}

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

    const resposta = await aiProviderRouter.generateText({
      task: 'legacy_financial_text_parser',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: texto },
      ],
      fallback: null,
    });

    if (!resposta) {
      return undefined;
    }

    try {
      const match = resposta.match(/\{[\s\S]*?\}/);

      if (!match) {
        throw new Error('sem json');
      }

      const json = JSON.parse(match[0]);

      if (json.acao === 'registrar') {
        return await registrarGasto(sessao, json, 'ia');
      }

      if (json.acao === 'resumo') {
        return await montarResumoFormatado(sessao);
      }

      if (json.acao === 'apagar') {
        return [
          'Para apagar com segurança, envie o comando começando com _apagar_.',
          'Eu vou listar os gastos parecidos para você confirmar antes de excluir.',
        ].join('\n');
      }

      if (json.acao === 'parcelar') {
        return await registrarParcelamento(sessao, json);
      }
    } catch (_) {
      // Retorna texto livre da IA.
    }

    return resposta;
  }

  async function processarTextoComIA(texto, sessao) {
    try {
      return await processarComIA(texto, sessao);
    } catch (err) {
      console.error('Erro IA:', errorDetails(err));

      return undefined;
    }
  }

  async function processarImagem(base64, mimeType, sessao) {
    if (!base64) {
      return '⚠️ Imagem recebida sem arquivo. Ative *webhookBase64* na Evolution API.';
    }

    const resposta = await analisarImagem(base64, mimeType);
    const match = resposta.match(/\{[\s\S]*?\}/);

    if (!match) {
      throw new Error('sem json na resposta de visão');
    }

    const json = JSON.parse(match[0]);

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

  async function processarAudio(phone, mediaInfo, processarMensagem) {
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
      console.error('Erro áudio:', errorDetails(err));

      return 'Erro ao processar áudio. Tente mandar em texto por enquanto.';
    }
  }

  async function processarImagemComFallback(mediaInfo, sessao) {
    try {
      return await processarImagem(mediaInfo.base64, mediaInfo.mimeType, sessao);
    } catch (err) {
      console.error('Erro imagem:', errorDetails(err));

      return 'Não consegui ler a imagem. Tente mandar com legenda: _mercado 45,90_';
    }
  }

  return {
    processarAudio,
    processarImagemComFallback,
    processarTextoComIA,
  };
}

module.exports = {
  createAiMediaService,
};
