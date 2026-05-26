'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookParser } = require('../src/webhook-parser');

const evolution = createWebhookParser();

function evolutionText(event = 'messages.upsert') {
  return {
    event,
    data: {
      key: {
        id: 'message-1',
        remoteJid: '5511987654321@s.whatsapp.net',
      },
      message: {
        conversation: 'almoco 35',
      },
    },
  };
}

test('Evolution messages.upsert payload is accepted and parsed', () => {
  const payload = evolutionText('messages.upsert');

  assert.equal(evolution.isSupportedMessageEvent(payload), true);
  assert.equal(evolution.getTextFromWebhook(payload), 'almoco 35');
  assert.equal(evolution.getMessageId(payload), 'message-1');
});

test('Evolution MESSAGES_UPSERT payload keeps the accepted event behavior', () => {
  const payload = evolutionText('MESSAGES_UPSERT');

  assert.equal(evolution.isSupportedMessageEvent(payload), true);
  assert.equal(evolution.getTextFromWebhook(payload), 'almoco 35');
});

test('audio payload extracts media info', () => {
  const payload = {
    data: {
      message: {
        audioMessage: {
          mediaBase64: 'audio-base64',
          mimetype: 'audio/ogg; codecs=opus',
          url: 'https://media.example/audio',
        },
      },
    },
  };

  assert.deepEqual(evolution.getMediaInfo(payload), {
    type: 'audio',
    base64: 'audio-base64',
    mediaUrl: 'https://media.example/audio',
    mimeType: 'audio/ogg; codecs=opus',
  });
});

test('image payload extracts media info and caption', () => {
  const payload = {
    data: {
      message: {
        imageMessage: {
          caption: 'mercado 45',
          base64: 'image-base64',
          mimetype: 'image/jpeg',
          mediaUrl: 'https://media.example/image',
        },
      },
    },
  };

  assert.equal(evolution.getTextFromWebhook(payload), 'mercado 45');
  assert.deepEqual(evolution.getMediaInfo(payload), {
    type: 'image',
    base64: 'image-base64',
    mediaUrl: 'https://media.example/image',
    mimeType: 'image/jpeg',
  });
});

test('fromMe payload is marked to be ignored', () => {
  assert.equal(evolution.isFromMeWebhook({
    data: {
      key: {
        fromMe: true,
      },
    },
  }), true);
});

test('group payload is marked to be ignored', () => {
  assert.equal(evolution.isGroupWebhook({
    data: {
      key: {
        remoteJid: '120363000000000000@g.us',
      },
    },
  }), true);
});

test('Evolution extracts contact from key.remoteJid before instance numbers', () => {
  const payload = {
    data: {
      key: {
        remoteJid: '5511987654321@s.whatsapp.net',
      },
      sender: '5511900000000@s.whatsapp.net',
    },
    phone: '5511900000000',
    sender: '5511900000000',
  };

  assert.equal(evolution.getPhoneFromWebhook(payload), '5511987654321');
});

test('Evolution group phone uses key.participant for the sender candidate', () => {
  const payload = {
    data: {
      key: {
        remoteJid: '120363000000000000@g.us',
        participant: '5511977777777@s.whatsapp.net',
      },
    },
  };

  assert.equal(evolution.getPhoneCandidatesFromWebhook(payload).keyParticipant, '5511977777777');
  assert.equal(evolution.getPhoneFromWebhook(payload), '5511977777777');
});
