'use strict';

const { validCategories } = require('./categories');
const { normalizeText } = require('./text-utils');

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

  function findAllowedCategory(category, customCategories = []) {
    const normalized = normalizeText(category);

    if (!normalized) {
      return null;
    }

    return validCategories(customCategories)
      .find((allowedCategory) => normalizeText(allowedCategory) === normalized) || null;
  }

  async function classificarCategoriaComIA({
    customCategories = [],
    desc,
    texto,
  } = {}) {
    if (!aiProviderRouter?.generateJson) {
      return null;
    }

    const categories = validCategories(customCategories);
    const customRules = customCategories.length
      ? customCategories.map((category) => `- ${category.nome}: ${category.palavras.join(', ')}`).join('\n')
      : '- Nenhuma categoria personalizada cadastrada.';
    const response = await aiProviderRouter.generateJson({
      task: 'expense_category_classifier',
      fallback: null,
      messages: [
        {
          role: 'system',
          content: [
            'Você classifica a categoria de um gasto do SalvaMoney.',
            'Responda somente JSON válido, sem markdown.',
            'Use somente uma categoria permitida.',
            'Categorias personalizadas do usuário têm prioridade quando fizerem sentido.',
            'Use "Outros" apenas quando nenhuma categoria padrão ou personalizada fizer sentido.',
            '',
            `Categorias permitidas: ${categories.join(', ')}.`,
            '',
            'Categorias padrão e palavras típicas:',
            '- Alimentação: salgado, doce, pão de queijo, padaria, lanche, pizza, hambúrguer, iFood, restaurante, mercado, açaí, sorvete, chocolate, marmita, comida, Baccio',
            '- Transporte: uber, 99, ônibus, passagem, gasolina, combustível, estacionamento, pedágio, táxi',
            '- Saúde: farmácia, remédio, médico, consulta, dentista, exame, hospital',
            '',
            'Categorias personalizadas:',
            customRules,
            '',
            'Formato obrigatório:',
            '{"categoria":"Alimentação","confidence":0.92}',
            '',
            'Exemplos:',
            '"paguei salgado 12" -> {"categoria":"Alimentação","confidence":0.95}',
            '"pão de queijo 6" -> {"categoria":"Alimentação","confidence":0.95}',
            '"uber 25" -> {"categoria":"Transporte","confidence":0.95}',
            '"remédio 40" -> {"categoria":"Saúde","confidence":0.95}',
            '"ração 80" e Pets personalizada -> {"categoria":"Pets","confidence":0.95}',
            '"coisa aleatória 17" -> {"categoria":"Outros","confidence":0.50}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Descrição: ${String(desc || '').trim()}`,
            `Mensagem original: ${String(texto || '').trim()}`,
          ].join('\n'),
        },
      ],
    });

    const category = findAllowedCategory(response?.categoria || response?.category, customCategories);
    const confidence = Number(response?.confidence ?? response?.confianca ?? 1);

    if (!category || category === 'Outros' || !Number.isFinite(confidence) || confidence < 0.6) {
      return null;
    }

    return category;
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
- salgado, doce, pão de queijo, padaria, lanche, pizza, hambúrguer, iFood, restaurante, mercado, açaí, sorvete, chocolate, marmita, comida, Baccio → Alimentação
- uber, 99, ônibus, passagem, gasolina, combustível, estacionamento, pedágio, táxi → Transporte
- farmácia, remédio, médico, consulta, dentista, exame, hospital → Saúde
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
"paguei salgado 12"        → {"acao":"registrar","desc":"salgado","valor":12.00,"cat":"Alimentação","data":"${hoje}"}
"doce 8"                   → {"acao":"registrar","desc":"doce","valor":8.00,"cat":"Alimentação","data":"${hoje}"}
"pão de queijo 6"          → {"acao":"registrar","desc":"pão de queijo","valor":6.00,"cat":"Alimentação","data":"${hoje}"}
"baccio 32"                → {"acao":"registrar","desc":"Baccio","valor":32.00,"cat":"Alimentação","data":"${hoje}"}
"uber 22 conto"            → {"acao":"registrar","desc":"uber","valor":22.00,"cat":"Transporte","data":"${hoje}"}
"remédio 40"               → {"acao":"registrar","desc":"remédio","valor":40.00,"cat":"Saúde","data":"${hoje}"}
"ração 80" com Pets criada → {"acao":"registrar","desc":"ração","valor":80.00,"cat":"Pets","data":"${hoje}"}
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
    classificarCategoriaComIA,
    processarAudio,
    processarImagemComFallback,
    processarTextoComIA,
  };
}

module.exports = {
  createAiMediaService,
};
