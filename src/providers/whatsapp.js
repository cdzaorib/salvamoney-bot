'use strict';

const axios = require('axios');

function createSendMessage(config, safeLog) {
  return async function sendMessage(phone, message) {
    try {
      if (!message) {
        console.log('⚠️ sendMessage chamado sem mensagem.');
        return false;
      }

      console.log(`📤 Tentando enviar para ${safeLog.maskPhone(phone)}: ${safeLog.logText(message)}`);

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
        return false;
      }

      return true;
    } catch (e) {
      console.error('Erro ao enviar msg:', e.response?.status, e.response?.data || e.message);
      return false;
    }
  };
}

module.exports = {
  createSendMessage,
};
