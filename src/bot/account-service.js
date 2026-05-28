'use strict';

const { isCreateCodeCommand, isSwitchAccountCommand } = require('./commands');
const { DEFAULT_GROUP, normalizeAccessTag } = require('../services/user-service');

const TAG_ONLY_MESSAGE = 'Agora o SalvaMoney usa apenas sua tag de 6 dígitos. Use: criar conta SeuNome ou entrar 123456.';
const TAG_NOT_FOUND_MESSAGE = 'Tag não encontrada. Crie sua conta pelo WhatsApp usando: criar conta SeuNome';

function createAccountService({
  db,
  firebaseOps,
  saveSession,
  siteUrl,
  todayIso,
  userService,
}) {
  const { get, ref } = firebaseOps;

  function isLegacyGroupCommand(text) {
    return isCreateCodeCommand(text) ||
      isSwitchAccountCommand(text) ||
      /^(grupo|trocar grupo|criar grupo)\b/i.test(text);
  }

  async function saveAccessSession(phone, user) {
    const tag = normalizeAccessTag(user?.tag || user?.shareTag);

    await saveSession(phone, {
      group: DEFAULT_GROUP,
      user: tag,
      name: user?.name || user?.nome || '',
      tag,
      updatedAt: todayIso(),
    });
  }

  async function processarComandoConta({ phone, texto, sessao }) {
    const enterMatch = String(texto || '').match(/^entrar\s+(.+)$/i);

    if (enterMatch) {
      const tag = normalizeAccessTag(enterMatch[1]);

      if (!tag) {
        return TAG_ONLY_MESSAGE;
      }

      const foundUser = await userService.getUserByAccessTag(tag);

      if (!foundUser) {
        const snap = await get(ref(db, `grupos/${DEFAULT_GROUP}/usuarios/${tag}`));

        if (!snap.exists()) {
          return TAG_NOT_FOUND_MESSAGE;
        }

        const siteUser = snap.val() || {};

        await saveAccessSession(phone, {
          name: siteUser.nome || '',
          tag,
        });

        return `✅ Pronto! Você entrou com a tag *${tag}*.`;
      }

      await saveAccessSession(phone, foundUser);

      return `✅ Pronto! Você entrou com a tag *${tag}*.`;
    }

    if (isLegacyGroupCommand(texto)) {
      return TAG_ONLY_MESSAGE;
    }

    return null;
  }

  return {
    processarComandoConta,
    saveAccessSession,
  };
}

module.exports = {
  TAG_NOT_FOUND_MESSAGE,
  TAG_ONLY_MESSAGE,
  createAccountService,
};
