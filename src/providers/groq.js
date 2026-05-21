'use strict';

const axios = require('axios');
const FormData = require('form-data');

function createGroqClient(config) {
  function limparBase64(v = '') {
    return String(v).replace(/^data:.*?;base64,/, '').trim();
  }

  async function baixarMediaComoBase64(mediaUrl) {
    if (!mediaUrl) return null;

    const r = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return Buffer.from(r.data).toString('base64');
  }

  async function chamarIA(mensagens) {
    if (!config.groqApiKey) {
      throw new Error('GROQ_API_KEY ausente.');
    }

    const r = await axios.post(
      config.groqChatUrl,
      {
        model: config.groqModel,
        messages: mensagens,
        temperature: 0.2,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${config.groqApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return r.data?.choices?.[0]?.message?.content?.trim() || '';
  }

  async function transcreverAudio(base64Audio, mimeType = 'audio/ogg') {
    if (!config.groqApiKey) {
      throw new Error('GROQ_API_KEY ausente.');
    }

    const buffer = Buffer.from(limparBase64(base64Audio), 'base64');

    if (buffer.length > 24 * 1024 * 1024) {
      throw new Error('Áudio maior que 24MB.');
    }

    const form = new FormData();

    form.append('file', buffer, {
      filename: 'audio.ogg',
      contentType: mimeType || 'audio/ogg',
    });

    form.append('model', config.groqAudioModel);
    form.append('language', 'pt');
    form.append('response_format', 'json');

    const r = await axios.post(config.groqAudioUrl, form, {
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return r.data?.text?.trim() || '';
  }

  async function analisarImagem(base64Image, mimeType = 'image/jpeg') {
    if (!config.groqApiKey) {
      throw new Error('GROQ_API_KEY ausente.');
    }

    const imageUrl = `data:${mimeType || 'image/jpeg'};base64,${limparBase64(base64Image)}`;

    const r = await axios.post(
      config.groqChatUrl,
      {
        model: config.groqVisionModel,
        messages: [
          {
            role: 'system',
            content: `Você é o leitor de comprovantes do SalvaMoney.

Extraia dados financeiros de imagens, prints, notas fiscais e comprovantes.

Responda APENAS JSON válido, sem markdown.

Formato quando encontrar gasto:
{"encontrou_gasto":true,"desc":"descrição curta","valor":00.00,"cat":"Categoria","data":"YYYY-MM-DD"}

Categorias permitidas:
Alimentação, Moradia, Transporte, Saúde, Lazer, Educação, Roupas, Academia, Outros.

Regras de categoria:
- mercado, supermercado, restaurante, almoço, jantar, lanche, ifood, padaria, pizza, comida → Alimentação
- uber, 99, gasolina, posto, ônibus, estacionamento → Transporte
- farmácia, remédio, consulta, médico, exame → Saúde
- aluguel, luz, água, internet, condomínio, gás → Moradia
- netflix, spotify, cinema, bar, festa, ingresso → Lazer
- academia, gym, musculação, pilates → Academia

Se não encontrar gasto claro:
{"encontrou_gasto":false}

Nunca invente valor.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analise esta imagem e extraia o gasto principal. Não invente valor.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 400,
      },
      {
        headers: {
          Authorization: `Bearer ${config.groqApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    return r.data?.choices?.[0]?.message?.content?.trim() || '';
  }

  return {
    analisarImagem,
    baixarMediaComoBase64,
    chamarIA,
    transcreverAudio,
  };
}

module.exports = {
  createGroqClient,
};
