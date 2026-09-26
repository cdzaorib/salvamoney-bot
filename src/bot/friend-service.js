'use strict';

const { normalizeAccessTag } = require('../services/user-service');
const { normalizedCommand } = require('./finance-utils');
const { findFriendMentions, normalizeNickname } = require('./friend-matcher');
const { sessionTag, userPath } = require('./user-data');

const REINVITE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RESERVED_NICKNAMES = new Set([
  'amiga', 'amigo', 'cancelar', 'cartao', 'credito', 'debito', 'eu', 'mim', 'nao', 'ninguem',
  'pix', 'sim', 'todos', 'todo mundo', 'voce', 'padrao',
]);
const OPEN_STATES = new Set(['ativa', 'convite_enviado', 'convite_recebido']);

function validateNickname(raw) {
  const nickname = String(raw || '')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = normalizeNickname(nickname);

  if (nickname.length < 2 || nickname.length > 30) {
    return { error: 'O apelido precisa ter entre 2 e 30 caracteres.' };
  }

  if (!/[\p{L}]/u.test(nickname) || !/^[\p{L}\p{N}' -]+$/u.test(nickname)) {
    return { error: 'Use só letras, números e espaços no apelido. Exemplo: Carlos trabalho' };
  }

  if (RESERVED_NICKNAMES.has(normalized)) {
    return { error: `"${nickname}" é uma palavra reservada. Escolha outro apelido.` };
  }

  return {
    nickname: nickname.split(' ').map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' '),
    normalized,
  };
}

function parseFriendCommand(text) {
  const command = normalizedCommand(text);
  let match = command.match(/^(?:adicionar|adiciona|add|convidar)\s+(?:amig[oa]\s+)?(?:(?:a|da)\s+)?(?:tag\s+)?(\d{6})$/);

  if (match) {
    return { action: 'invite', tag: match[1] };
  }

  match = command.match(/^aceitar\s+(?:amig[oa]|amizade|convite)(?:\s+(?:de\s+)?(?:tag\s+)?(\d{6}))?$/);

  if (match) {
    return { action: 'accept', tag: match[1] || null };
  }

  match = command.match(/^recusar\s+(?:amig[oa]|amizade|convite)(?:\s+(?:de\s+)?(?:tag\s+)?(\d{6}))?$/);

  if (match) {
    return { action: 'decline', tag: match[1] || null };
  }

  match = command.match(/^cancelar\s+convite(?:\s+(?:de\s+amizade\s+)?(?:para\s+)?(?:tag\s+)?(\d{6}))?$/);

  if (match) {
    return { action: 'cancel_invite', tag: match[1] || null };
  }

  if (/^(meus amigos|minhas amigas|amigos|listar amigos|ver amigos|lista de amigos|convites|convites de amizade|meus convites)$/.test(command)) {
    return { action: 'list' };
  }

  const original = String(text || '').trim();

  match = original.match(/^apelido\s+(?:(\d{6})\s+)?(.+)$/i);

  if (match) {
    return { action: 'nickname', nickname: match[2], tag: match[1] || null };
  }

  match = original.match(/^(?:apelidar|chamar)\s+(?:o\s+|a\s+)?(?:amig[oa]\s+)?(?:tag\s+)?(\d{6})\s+(?:como|de)\s+(.+)$/i);

  if (match) {
    return { action: 'nickname', nickname: match[2], tag: match[1] };
  }

  match = original.match(/^renomear\s+(?:amig[oa]\s+)?(.+?)\s+para\s+(.+)$/i);

  if (match) {
    return { action: 'rename', from: match[1], nickname: match[2] };
  }

  match = original.match(/^(?:remover|excluir|apagar)\s+amig[oa]\s+(.+)$/i) ||
    original.match(/^desfazer\s+amizade\s+(?:com\s+)?(.+)$/i);

  if (match) {
    return { action: 'remove', name: match[1] };
  }

  if (/\bcarteira\s+compartilhada\b/.test(command)) {
    return { action: 'shared_wallet' };
  }

  return null;
}

function createFriendService({
  db,
  firebaseOps,
  notify,
  now = () => new Date(),
  userData,
}) {
  const { ref, update } = firebaseOps;

  async function listFriends(tag) {
    const amigos = (await userData.readChild(tag, 'amigos')) || {};

    return Object.entries(amigos)
      .map(([friendTag, value]) => ({
        ...(value || {}),
        tag: normalizeAccessTag(friendTag),
      }))
      .filter((friend) => friend.tag)
      .sort((a, b) => String(a.apelido || a.primeiroNome || '').localeCompare(String(b.apelido || b.primeiroNome || '')));
  }

  async function activeFriends(tag) {
    return (await listFriends(tag)).filter((friend) => friend.estado === 'ativa' && friend.apelido);
  }

  async function findActiveFriendByTag(tag, friendTag) {
    return (await listFriends(tag)).find((friend) => friend.tag === friendTag && friend.estado === 'ativa') || null;
  }

  function friendPath(ownerTag, friendTag) {
    return `${userPath(ownerTag)}/amigos/${friendTag}`;
  }

  function fieldsUpdate(ownerTag, friendTag, fields) {
    return Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [`${friendPath(ownerTag, friendTag)}/${key}`, value])
    );
  }

  async function invite(session, targetTag) {
    const tag = sessionTag(session);
    const friendTag = normalizeAccessTag(targetTag);

    if (!friendTag) {
      return 'Informe a tag de 6 dígitos. Exemplo: adicionar amigo 123456';
    }

    if (friendTag === tag) {
      return 'Essa é a sua própria tag 🙂';
    }

    const contact = await userData.getContact(friendTag);

    if (!contact) {
      return 'Não encontrei essa tag. Confira os 6 dígitos com a pessoa.';
    }

    const existing = (await listFriends(tag)).find((friend) => friend.tag === friendTag);

    if (existing?.estado === 'ativa') {
      return `Vocês já são amigos${existing.apelido ? ` (${existing.apelido})` : ''}.`;
    }

    if (existing?.estado === 'convite_enviado') {
      return 'Convite já enviado. Aguardando a resposta da pessoa.';
    }

    if (existing?.estado === 'convite_recebido') {
      return await accept(session, friendTag);
    }

    const lastInvite = new Date(existing?.ultimoConviteEm || 0).getTime();

    if (existing && now().getTime() - lastInvite < REINVITE_INTERVAL_MS) {
      return 'Você já convidou essa pessoa recentemente. Tente de novo depois de 24 horas.';
    }

    const me = await userData.getContact(tag);
    const timestamp = now().toISOString();

    await update(ref(db), {
      ...fieldsUpdate(tag, friendTag, {
        atualizadoEm: timestamp,
        criadoEm: existing?.criadoEm || timestamp,
        estado: 'convite_enviado',
        primeiroNome: contact.firstName,
        ultimoConviteEm: timestamp,
      }),
      ...fieldsUpdate(friendTag, tag, {
        atualizadoEm: timestamp,
        criadoEm: timestamp,
        estado: 'convite_recebido',
        primeiroNome: me?.firstName || 'Alguém',
      }),
    });

    await notify(contact.phone, [
      `👋 ${me?.firstName || 'Alguém'} (tag ${tag}) quer te adicionar como amigo no SalvaMoney.`,
      'Amigos podem dividir contas e ver só as operações em que participam juntos.',
      '',
      `Responda: aceitar amigo ${tag}`,
      `ou: recusar amigo ${tag}`,
    ].join('\n'));

    return `Convite enviado para ${contact.firstName} ✅ Assim que aceitar, vocês escolhem um apelido.`;
  }

  async function pickInvite(tag, friendTag, estado) {
    const invites = (await listFriends(tag)).filter((friend) => friend.estado === estado);

    if (friendTag) {
      return { invite: invites.find((friend) => friend.tag === friendTag) || null, invites };
    }

    return { invite: invites.length === 1 ? invites[0] : null, invites };
  }

  async function accept(session, targetTag) {
    const tag = sessionTag(session);
    const { invite: selected, invites } = await pickInvite(tag, normalizeAccessTag(targetTag), 'convite_recebido');

    if (!selected) {
      if (invites.length > 1) {
        return [
          'Você tem mais de um convite:',
          ...invites.map((friend) => `- ${friend.primeiroNome || 'Alguém'}: aceitar amigo ${friend.tag}`),
        ].join('\n');
      }

      return 'Não encontrei convite de amizade pendente.';
    }

    const timestamp = now().toISOString();
    const me = await userData.getContact(tag);
    const contact = await userData.getContact(selected.tag);

    await update(ref(db), {
      ...fieldsUpdate(tag, selected.tag, { aceitaEm: timestamp, atualizadoEm: timestamp, estado: 'ativa' }),
      ...fieldsUpdate(selected.tag, tag, { aceitaEm: timestamp, atualizadoEm: timestamp, estado: 'ativa' }),
    });

    await notify(contact?.phone, [
      `${me?.firstName || 'Seu amigo'} aceitou seu convite ✅`,
      `Escolha como chamar essa pessoa: apelido ${tag} ${me?.firstName || 'Nome'}`,
    ].join('\n'));

    return [
      `Agora vocês são amigos ✅`,
      `Como quer chamar ${selected.primeiroNome || 'essa pessoa'}? Envie: apelido ${selected.primeiroNome || 'Nome'}`,
      'Se já tiver alguém com esse nome, use algo como "Carlos trabalho".',
    ].join('\n');
  }

  async function decline(session, targetTag) {
    const tag = sessionTag(session);
    const { invite: selected, invites } = await pickInvite(tag, normalizeAccessTag(targetTag), 'convite_recebido');

    if (!selected) {
      return invites.length > 1
        ? 'Você tem mais de um convite. Informe a tag: recusar amigo 123456'
        : 'Não encontrei convite de amizade pendente.';
    }

    const timestamp = now().toISOString();
    const contact = await userData.getContact(selected.tag);

    await update(ref(db), {
      ...fieldsUpdate(tag, selected.tag, { atualizadoEm: timestamp, estado: 'recusada' }),
      ...fieldsUpdate(selected.tag, tag, { atualizadoEm: timestamp, estado: 'recusada' }),
    });
    await notify(contact?.phone, `Seu convite de amizade para a tag ${tag} não foi aceito.`);

    return 'Convite recusado.';
  }

  async function cancelInvite(session, targetTag) {
    const tag = sessionTag(session);
    const { invite: selected } = await pickInvite(tag, normalizeAccessTag(targetTag), 'convite_enviado');

    if (!selected) {
      return 'Não encontrei convite enviado pendente.';
    }

    const timestamp = now().toISOString();

    await update(ref(db), {
      ...fieldsUpdate(tag, selected.tag, { atualizadoEm: timestamp, estado: 'removida' }),
      ...fieldsUpdate(selected.tag, tag, { atualizadoEm: timestamp, estado: 'removida' }),
    });

    return 'Convite cancelado.';
  }

  async function setNickname(session, command) {
    const tag = sessionTag(session);
    const validation = validateNickname(command.nickname);

    if (validation.error) {
      return validation.error;
    }

    const friends = await listFriends(tag);
    let target = null;

    if (command.from) {
      const from = normalizeNickname(command.from);

      target = friends.find((friend) => friend.estado === 'ativa' && normalizeNickname(friend.apelido) === from) || null;

      if (!target) {
        return `Não encontrei o amigo "${command.from}".`;
      }
    } else if (command.tag) {
      target = friends.find((friend) => friend.tag === command.tag && friend.estado === 'ativa') || null;

      if (!target) {
        return 'Essa tag não está entre seus amigos ativos.';
      }
    } else {
      const withoutNickname = friends.filter((friend) => friend.estado === 'ativa' && !friend.apelido);

      if (withoutNickname.length !== 1) {
        return withoutNickname.length > 1
          ? 'Tem mais de um amigo sem apelido. Informe a tag: apelido 123456 Carlos'
          : 'Para renomear um amigo, envie: renomear Carlos para Carlos trabalho';
      }

      [target] = withoutNickname;
    }

    const duplicate = friends.find((friend) =>
      friend.tag !== target.tag &&
      OPEN_STATES.has(friend.estado) &&
      friend.apelido &&
      normalizeNickname(friend.apelido) === validation.normalized
    );

    if (duplicate) {
      return [
        `Você já tem um amigo chamado ${duplicate.apelido}.`,
        `Escolha um apelido diferente, por exemplo: ${validation.nickname} trabalho`,
      ].join('\n');
    }

    await update(ref(db), fieldsUpdate(tag, target.tag, {
      apelido: validation.nickname,
      atualizadoEm: now().toISOString(),
    }));

    return `Pronto! Vou chamar essa pessoa de ${validation.nickname} ✅ Exemplo: dividir 100 com ${validation.nickname}`;
  }

  async function listMessage(session) {
    const friends = await listFriends(sessionTag(session));
    const active = friends.filter((friend) => friend.estado === 'ativa');
    const received = friends.filter((friend) => friend.estado === 'convite_recebido');
    const sent = friends.filter((friend) => friend.estado === 'convite_enviado');

    if (!active.length && !received.length && !sent.length) {
      return 'Você ainda não tem amigos no SalvaMoney. Para convidar: adicionar amigo 123456';
    }

    const lines = [];

    if (active.length) {
      lines.push('👥 Seus amigos:', ...active.map((friend, index) => friend.apelido
        ? `${index + 1}. ${friend.apelido}`
        : `${index + 1}. (sem apelido) — envie: apelido ${friend.tag} Nome`));
    }

    if (received.length) {
      lines.push('', 'Convites recebidos:', ...received.map((friend) =>
        `- ${friend.primeiroNome || 'Alguém'}: aceitar amigo ${friend.tag}`));
    }

    if (sent.length) {
      lines.push('', 'Convites enviados (aguardando):', ...sent.map((friend) => `- tag ${friend.tag}`));
    }

    return lines.join('\n').trim();
  }

  async function requestRemoval(session, name) {
    const tag = sessionTag(session);
    const normalized = normalizeNickname(name);
    const friend = (await listFriends(tag)).find((item) =>
      item.estado === 'ativa' && item.apelido && normalizeNickname(item.apelido) === normalized);

    if (!friend) {
      return `Não encontrei o amigo "${String(name).trim()}".`;
    }

    return {
      message: [
        `Remover a amizade com ${friend.apelido}?`,
        'O histórico e as pendências continuam visíveis; nada financeiro é apagado.',
        'Novas divisões e cobranças com essa pessoa ficam bloqueadas.',
        '',
        'Responda SIM para confirmar ou CANCELAR.',
      ].join('\n'),
      pendingAction: {
        friendTag: friend.tag,
        tipo: 'friend_remove',
      },
    };
  }

  async function confirmRemoval(session, friendTag) {
    const tag = sessionTag(session);
    const friend = await findActiveFriendByTag(tag, friendTag);

    if (!friend) {
      return 'Essa amizade já não está ativa.';
    }

    const timestamp = now().toISOString();

    await update(ref(db), {
      ...fieldsUpdate(tag, friendTag, { atualizadoEm: timestamp, estado: 'removida', removidaEm: timestamp }),
      ...fieldsUpdate(friendTag, tag, { atualizadoEm: timestamp, estado: 'removida', removidaEm: timestamp }),
    });

    return `Amizade com ${friend.apelido} removida. Histórico e pendências foram preservados.`;
  }

  // Perguntas sobre gastos de um amigo: amigos só veem operações em comum.
  async function privacyGuard(session, text) {
    const command = normalizedCommand(text);

    if (!/\b(gast|extrato|resumo|saldo|fatura|salario|renda|orcamento)\w*\b/.test(command)) {
      return null;
    }

    // "gastei com Carlos" / "dividir entre" são operações, não consultas sobre o amigo.
    if (/\b(com|entre|c)\b/.test(command) || /^(gastei|paguei|comprei|dividir|rachar|cobrar)\b/.test(command)) {
      return null;
    }

    const friends = (await listFriends(sessionTag(session))).filter((friend) => friend.apelido);
    const { matches } = findFriendMentions(text, friends, { requireVerb: false });

    if (!matches.length) {
      return null;
    }

    const friend = matches[0].friend;

    return [
      `🔒 Não mostro os gastos pessoais de ${friend.apelido}.`,
      'Amigos veem somente as operações em que os dois participam.',
      `Para ver o que há entre vocês: cobranças com ${friend.apelido}`,
    ].join('\n');
  }

  async function process(session, text) {
    const command = parseFriendCommand(text);

    if (!command) {
      return await privacyGuard(session, text);
    }

    if (command.action === 'invite') {
      return await invite(session, command.tag);
    }

    if (command.action === 'accept') {
      return await accept(session, command.tag);
    }

    if (command.action === 'decline') {
      return await decline(session, command.tag);
    }

    if (command.action === 'cancel_invite') {
      return await cancelInvite(session, command.tag);
    }

    if (command.action === 'list') {
      return await listMessage(session);
    }

    if (command.action === 'nickname' || command.action === 'rename') {
      return await setNickname(session, command);
    }

    if (command.action === 'remove') {
      return await requestRemoval(session, command.name);
    }

    if (command.action === 'shared_wallet') {
      return [
        'Carteira compartilhada é uma permissão diferente de amizade e não está ativa.',
        'Amigos só veem as divisões e cobranças em que participam.',
      ].join('\n');
    }

    return null;
  }

  return {
    activeFriends,
    confirmRemoval,
    findActiveFriendByTag,
    listFriends,
    process,
  };
}

module.exports = {
  createFriendService,
  parseFriendCommand,
  validateNickname,
};
