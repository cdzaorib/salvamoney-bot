'use strict';

function createWebhookParser() {

  function normalizeEvent(body) {
    const raw = String(body?.event || '').toLowerCase();

    if (!raw) return 'messages.upsert';

    const map = {
      'messages_upsert': 'messages.upsert',
      'messages-upsert': 'messages.upsert',
      'messages.upsert': 'messages.upsert',
      'message': 'messages.upsert',
      'messages': 'messages.upsert',

      'chats.upsert': 'chats.upsert',
      'chat.upsert': 'chats.upsert',
      'chats': 'chats.upsert',
    };

    return map[raw] || raw;
  }

  function isSupportedMessageEvent(body) {
    const event = normalizeEvent(body);

    return [
      'messages.upsert',
      'chats.upsert',
    ].includes(event);
  }

  function getEvent(body) {
    return normalizeEvent(body);
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
    if (body?.isGroup) return true;

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
    normalizeEvent,
    getEvent,
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
