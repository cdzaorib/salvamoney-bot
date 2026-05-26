'use strict';

function createWebhookParser() {
  function isSupportedMessageEvent(body) {
    // A Evolution pode enviar o evento como:
    // messages.upsert, MESSAGES_UPSERT, messages_upsert ou messages-upsert.
    const eventName = String(body?.event || '').toLowerCase();

    return !eventName || ['messages.upsert', 'messages_upsert', 'messages-upsert'].includes(eventName);
  }

  function getEvolutionMsg(body) {
    return (body?.data || body)?.message || {};
  }

  function getTextFromWebhook(body) {
    const msg = getEvolutionMsg(body);

    return (
      msg?.conversation ||
      msg?.extendedTextMessage?.text ||
      msg?.imageMessage?.caption ||
      msg?.videoMessage?.caption ||
      ''
    );
  }

  function cleanPhoneNumber(value) {
    return String(value || '')
      .replace('@s.whatsapp.net', '')
      .replace('@lid', '')
      .replace(/\D/g, '');
  }

  function getPhoneCandidatesFromWebhook(body) {
    const data = body?.data || body;
    const key = data?.key || body?.key || {};

    return {
      keyRemoteJid: cleanPhoneNumber(key?.remoteJid),
      keyParticipant: cleanPhoneNumber(key?.participant),
      dataRemoteJid: cleanPhoneNumber(data?.remoteJid),
      dataSender: cleanPhoneNumber(data?.sender),
      bodyRemoteJid: cleanPhoneNumber(body?.remoteJid),
      bodySender: cleanPhoneNumber(body?.sender),
    };
  }

  function getPhoneFromWebhook(body) {
    const data = body?.data || body;
    const key = data?.key || body?.key || {};
    const candidates = getPhoneCandidatesFromWebhook(body);

    // Evolution API:
    // Em mensagem direta recebida, key.remoteJid costuma ser o número de quem enviou.
    // Alguns payloads também trazem body.sender/body.phone como o número da instância,
    // então NÃO devemos priorizar esses campos no Evolution.
    if (String(key?.remoteJid || '').includes('@g.us')) {
      return candidates.keyParticipant || candidates.dataSender || candidates.bodySender || '';
    }

    return (
      candidates.keyRemoteJid ||
      candidates.dataRemoteJid ||
      candidates.dataSender ||
      candidates.bodyRemoteJid ||
      candidates.bodySender ||
      ''
    );
  }

  function isFromMeWebhook(body) {
    return Boolean(body?.fromMe || (body?.data || body)?.key?.fromMe);
  }

  function isGroupWebhook(body) {
    if (body?.isGroup) {
      return true;
    }

    const jid = (body?.data || body)?.key?.remoteJid || (body?.data || body)?.remoteJid || '';

    return String(jid).includes('@g.us');
  }

  function getMessageId(body) {
    return body?.messageId || body?.id || body?.data?.key?.id || body?.key?.id;
  }

  function getMediaInfo(body) {
    const data = body?.data || body;
    const msg = getEvolutionMsg(body);

    const audioMsg =
      msg?.audioMessage ||
      msg?.audio ||
      data?.audioMessage ||
      null;

    const imageMsg =
      msg?.imageMessage ||
      msg?.image ||
      data?.imageMessage ||
      null;

    const base64 =
      body?.base64 ||
      data?.base64 ||
      msg?.base64 ||
      msg?.mediaBase64 ||
      msg?.media ||
      audioMsg?.base64 ||
      audioMsg?.mediaBase64 ||
      audioMsg?.media ||
      imageMsg?.base64 ||
      imageMsg?.mediaBase64 ||
      imageMsg?.media ||
      data?.message?.base64 ||
      data?.message?.mediaBase64 ||
      data?.message?.media ||
      null;

    const mediaUrl =
      body?.mediaUrl ||
      data?.mediaUrl ||
      msg?.mediaUrl ||
      msg?.url ||
      audioMsg?.url ||
      audioMsg?.mediaUrl ||
      imageMsg?.url ||
      imageMsg?.mediaUrl ||
      null;

    if (audioMsg) {
      return {
        type: 'audio',
        base64,
        mediaUrl,
        mimeType:
          audioMsg?.mimetype ||
          audioMsg?.mimeType ||
          msg?.mimetype ||
          data?.mimetype ||
          'audio/ogg',
      };
    }

    if (imageMsg) {
      return {
        type: 'image',
        base64,
        mediaUrl,
        mimeType:
          imageMsg?.mimetype ||
          imageMsg?.mimeType ||
          msg?.mimetype ||
          data?.mimetype ||
          'image/jpeg',
      };
    }

    return {
      type: null,
      base64: null,
      mediaUrl: null,
      mimeType: null,
    };
  }

  return {
    getMediaInfo,
    getMessageId,
    getPhoneCandidatesFromWebhook,
    getPhoneFromWebhook,
    getTextFromWebhook,
    isFromMeWebhook,
    isGroupWebhook,
    isSupportedMessageEvent,
  };
}

module.exports = {
  createWebhookParser,
};
