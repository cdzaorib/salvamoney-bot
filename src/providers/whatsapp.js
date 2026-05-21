'use strict';

const axios = require('axios');

function createSendMessage(config, safeLog) {
  return async function sendMessage(phone, message, messageId) {
    try {
      if (!message) {
        console.log('⚠️ sendMessage chamado sem mensagem.');
        return;
      }

      console.log(`📤 Tentando enviar para ${safeLog.maskPhone(phone)}: ${safeLog.logText(message)}`);

      if (config.whatsappProvider === 'evolution') {
        const cleanPhone = String(phone || '').replace(/\D/g, '');
        const url = `${config.evolutionApiUrl}/message/sendText/${config.evolutionInstance}`;

        console.log('📤 Evolution URL:', url);
        console.log('📤 Evolution instance:', config.evolutionInstance);
        console.log('📤 Evolution number:', safeLog.maskPhone(cleanPhone));

        const response = await axios.post(
          url,
          {
            number: cleanPhone,
            text: message,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              apikey: config.evolutionApiKey,
            },
            timeout: 15000,
            validateStatus: () => true,
          }
        );

        console.log('📨 Evolution status:', response.status);
        console.log('📨 Evolution response:', JSON.stringify(response.data).slice(0, 1000));

        if (response.status >= 400) {
          console.error('❌ Evolution recusou envio:', response.status, response.data);
        }

        return;
      }

      if (!config.zapiUrl) {
        throw new Error('Z-API não configurada.');
      }

      const headers = { 'Content-Type': 'application/json' };

      if (config.zapiClientToken) {
        headers['Client-Token'] = config.zapiClientToken;
      }

      const payload = { phone, message };

      if (messageId) {
        payload.messageId = messageId;
      }

      const response = await axios.post(`${config.zapiUrl}/send-text`, payload, {
        headers,
        timeout: 15000,
        validateStatus: () => true,
      });

      console.log('📨 Z-API status:', response.status);
      console.log('📨 Z-API response:', JSON.stringify(response.data).slice(0, 1000));

      if (response.status >= 400) {
        console.error('❌ Z-API recusou envio:', response.status, response.data);
      }
    } catch (e) {
      console.error('Erro ao enviar msg:', e.response?.status, e.response?.data || e.message);
    }
  };
}

module.exports = {
  createSendMessage,
};
