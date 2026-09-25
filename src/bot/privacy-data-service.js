'use strict';

const { normalizedCommand } = require('./finance-utils');
const { sessionTag, userPath } = require('./user-data');

const DELETE_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const EXPORT_MAX_CHARS = 60000;
const PHONE_FIELDS = new Set(['phone', 'phoneOrigem', 'phoneDestino', 'telefone', 'whatsapp']);

function stripPhones(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripPhones(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PHONE_FIELDS.has(key))
      .map(([key, item]) => [key, stripPhones(item, depth + 1)])
  );
}

function countEntries(value) {
  return value && typeof value === 'object' ? Object.keys(value).length : 0;
}

function countExpenses(gastos) {
  return Object.values(gastos || {}).reduce((total, month) => total + countEntries(month), 0);
}

function parsePrivacyDataCommand(text) {
  const command = normalizedCommand(text);

  if (/^(meus dados|ver meus dados|quais dados voce tem( sobre mim)?|dados armazenados|o que voce sabe sobre mim)$/.test(command)) {
    return { action: 'view' };
  }

  if (/^(exportar|baixar|enviar)\s+(meus\s+)?dados$/.test(command)) {
    return { action: 'export' };
  }

  if (/^(apagar|excluir|deletar)\s+(todos\s+os\s+)?meus\s+dados$/.test(command)) {
    return { action: 'delete_request' };
  }

  if (/^(apagar|limpar)\s+(o\s+)?(contexto|historico)\s+(da\s+)?(conversa|ia)$/.test(command) || command === 'limpar conversa') {
    return { action: 'clear_context' };
  }

  return null;
}

function deletionPhrase(tag) {
  return `APAGAR MEUS DADOS ${tag}`;
}

function createPrivacyDataService({
  conversationContext,
  db,
  firebaseOps,
  now = () => new Date(),
  saveSession,
  userData,
}) {
  const { ref, update } = firebaseOps;

  async function collect(session) {
    const tag = sessionTag(session);
    const record = (await userData.getUserRecord(tag)) || {};
    const phone = String(session.phone || record.phone || '').replace(/\D/g, '');
    const account = phone ? await userData.read(`users/${phone}`) : null;

    return { account, phone, record, tag };
  }

  function viewMessage({ account, record }) {
    const perfil = record.perfilFinanceiro || {};
    const privacidade = record.privacidade || {};

    return [
      '📂 Dados guardados no SalvaMoney:',
      `Conta: nome, e-mail${account?.email ? '' : ' (vazio)'}, tag e WhatsApp`,
      `Gastos: ${countExpenses(record.gastos)} · Fixos: ${countEntries(record.fixos)} · Parcelamentos incluídos nos gastos`,
      `Cobranças enviadas: ${countEntries(record.cobrancasEnviadas)} · recebidas: ${countEntries(record.cobrancasRecebidas)}`,
      `Divisões: ${countEntries(record.divisoes)} · Amigos: ${countEntries(record.amigos)} · Cartões: ${countEntries(record.cartoes)}`,
      `Metas: ${countEntries(record.metasEconomia)} · Alertas: ${countEntries(record.alertas)} · Pesquisas: ${countEntries(record.pesquisas)}`,
      `Perfil financeiro: ${Object.keys(perfil).length ? 'preenchido' : 'vazio'} · Preferências: ${Object.keys(record.preferencias || {}).join(', ') || 'padrão'}`,
      `IA externa: ${privacidade.ia?.estado || 'não perguntado'} · Pesquisa externa: ${privacidade.pesquisaExterna?.ativo ? 'ativa' : 'desativada'}`,
      '',
      'Conversas com a IA ficam só em memória por até 24h e não são gravadas.',
      'Comandos: exportar meus dados · apagar meus dados · desativar IA',
    ].join('\n');
  }

  async function exportMessage(data) {
    const { account, record } = data;
    const payload = stripPhones({
      conta: {
        email: account?.email || '',
        nome: account?.name || record.nome || '',
        tag: data.tag,
      },
      exportadoEm: now().toISOString(),
      dados: record,
    });
    let json = JSON.stringify(payload);
    let truncated = false;

    if (json.length > EXPORT_MAX_CHARS) {
      const months = Object.keys(record.gastos || {}).sort((a, b) => {
        const [ya, ma] = a.split('_').map(Number);
        const [yb, mb] = b.split('_').map(Number);

        return (ya * 12 + ma) - (yb * 12 + mb);
      });
      const recentMonths = Object.fromEntries(months.slice(-6).map((month) => [month, record.gastos[month]]));

      payload.dados = { ...stripPhones(record), gastos: recentMonths };
      json = JSON.stringify(payload).slice(0, EXPORT_MAX_CHARS);
      truncated = true;
    }

    return [
      '📦 Exportação dos seus dados (JSON):',
      truncated ? '(Arquivo grande: enviei os gastos dos últimos 6 meses. O site também mostra o histórico completo.)' : '',
      json,
    ].filter(Boolean).join('\n');
  }

  async function requestDeletion(phone, session) {
    const tag = sessionTag(session);
    const { phone: _phone, ...cleanSession } = session;

    await saveSession(phone, {
      ...cleanSession,
      pendingAction: {
        expiresAt: new Date(now().getTime() + DELETE_CONFIRMATION_TTL_MS).toISOString(),
        id: `del_${now().getTime()}`,
        tipo: 'data_deletion',
      },
    });

    return [
      '⚠️ Isso apaga de forma definitiva sua conta, gastos, fixos, metas, alertas, cartões, amigos, divisões, preferências e o vínculo deste WhatsApp.',
      'Cópias de cobranças que estão com outras pessoas continuam com elas.',
      '',
      'Para confirmar, envie exatamente:',
      deletionPhrase(tag),
      '',
      'A confirmação vale por 10 minutos. Para desistir: cancelar',
    ].join('\n');
  }

  async function confirmDeletion(phone, session, text) {
    const tag = sessionTag(session);
    const pending = session.pendingAction;
    const expired = !pending?.expiresAt || new Date(pending.expiresAt).getTime() < now().getTime();
    const { phone: _phone, pendingAction: _pending, ...cleanSession } = session;

    if (expired) {
      await saveSession(phone, cleanSession);

      return 'A confirmação expirou. Nada foi apagado. Se ainda quiser, envie: apagar meus dados';
    }

    if (String(text || '').trim() !== deletionPhrase(tag)) {
      if (['cancelar', 'cancela', 'nao', 'desistir'].includes(normalizedCommand(text))) {
        await saveSession(phone, cleanSession);

        return 'Exclusão cancelada. Nenhum dado foi apagado.';
      }

      return `Para apagar, envie exatamente: ${deletionPhrase(tag)} — ou "cancelar".`;
    }

    const data = await collect(session);
    const friends = data.record.amigos || {};
    const timestamp = now().toISOString();
    const multipath = {
      [userPath(tag)]: null,
      [`shareTags/${tag}`]: null,
    };

    if (data.phone) {
      multipath[`users/${data.phone}`] = null;
      multipath[`transactionsByUser/${data.phone}`] = null;
    }

    // Amizades: o outro lado mantém o histórico, mas a amizade deixa de estar ativa.
    Object.keys(friends).forEach((friendTag) => {
      multipath[`${userPath(friendTag)}/amigos/${tag}/estado`] = 'removida';
      multipath[`${userPath(friendTag)}/amigos/${tag}/contaExcluida`] = true;
      multipath[`${userPath(friendTag)}/amigos/${tag}/atualizadoEm`] = timestamp;
    });

    await update(ref(db), multipath);
    await saveSession(phone, null);
    conversationContext?.clear(tag);

    return 'Seus dados foram apagados. Obrigado por ter usado o SalvaMoney. Para voltar, envie: criar conta';
  }

  async function process(phone, session, text) {
    const command = parsePrivacyDataCommand(text);

    if (!command) {
      return null;
    }

    if (command.action === 'clear_context') {
      conversationContext?.clear(sessionTag(session));

      return 'Contexto da conversa apagado ✅';
    }

    if (command.action === 'delete_request') {
      return await requestDeletion(phone, session);
    }

    const data = await collect(session);

    return command.action === 'view'
      ? viewMessage(data)
      : await exportMessage(data);
  }

  return {
    confirmDeletion,
    process,
  };
}

module.exports = {
  createPrivacyDataService,
  deletionPhrase,
  parsePrivacyDataCommand,
  stripPhones,
};
