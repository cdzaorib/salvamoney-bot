'use strict';

const { normalizedCommand } = require('./finance-utils');
const { sessionTag } = require('./user-data');

const PROMPT_TTL_MS = 30 * 60 * 1000;

const COMMANDS = [
  { action: 'ativar_ia', pattern: /^(ativar|ligar|habilitar|reativar)\s+(a\s+)?(ia|inteligencia artificial)$/ },
  { action: 'desativar_ia', pattern: /^(desativar|desligar|desabilitar)\s+(a\s+)?(ia|inteligencia artificial)$/ },
  { action: 'desativar_ia', pattern: /^revogar\s+(meu\s+)?(consentimento|ia)(\s+da\s+ia)?$/ },
  { action: 'ativar_pesquisa', pattern: /^(ativar|ligar|habilitar)\s+(a\s+)?pesquisa(s)?\s+externa(s)?$/ },
  { action: 'desativar_pesquisa', pattern: /^(desativar|desligar|desabilitar)\s+(a\s+)?pesquisa(s)?\s+externa(s)?$/ },
  { action: 'status', pattern: /^(minha\s+)?privacidade$/ },
];

const ACCEPT_PATTERN = /^(sim[, ]+)?(aceito|eu aceito|concordo|aceito os termos|aceitar ia)$/;
const REFUSE_PATTERN = /^(nao aceito|não aceito|recuso|nao quero|não quero|nao concordo)$/;

function consentNotice() {
  return [
    '🔒 Esse recurso usa IA externa (DeepSeek).',
    'Envio só números agregados, percentuais, categorias e prazos — nunca nome, telefone, e-mail, tag, apelidos ou descrições dos seus gastos.',
    'Responda *aceito* para ativar ou *não aceito* para seguir só com respostas locais.',
    'Você pode desativar quando quiser: _desativar IA_.',
  ].join('\n');
}

function researchNotice() {
  return [
    '🔎 A pesquisa externa usa a Brave Search com consultas genéricas (sem seus dados).',
    'Para permitir, envie: _ativar pesquisa externa_. Para bloquear: _desativar pesquisa externa_.',
  ].join('\n');
}

function aiConsentState(privacy, version) {
  const ia = privacy?.ia || {};

  if (ia.estado === 'aceito') {
    return ia.versao === version ? 'aceito' : 'pendente';
  }

  if (ia.estado === 'recusado' || ia.estado === 'revogado') {
    return ia.estado;
  }

  return 'pendente';
}

function createConsentService({
  config,
  conversationContext,
  now = () => new Date(),
  userData,
}) {
  const version = config?.ai?.consentVersion || '2026-09-v1';
  const pendingPrompts = new Map();

  async function getPrivacy(tag) {
    return (await userData.readChild(tag, 'privacidade')) || {};
  }

  async function aiState(tag) {
    return aiConsentState(await getPrivacy(tag), version);
  }

  async function researchEnabled(tag) {
    const privacy = await getPrivacy(tag);

    return privacy?.pesquisaExterna?.ativo === true;
  }

  function markPrompt(tag, pendingText = null) {
    pendingPrompts.set(tag, {
      at: now().getTime(),
      pendingText,
    });
  }

  function takePrompt(tag) {
    const prompt = pendingPrompts.get(tag);

    pendingPrompts.delete(tag);

    return prompt && now().getTime() - prompt.at <= PROMPT_TTL_MS ? prompt : null;
  }

  function hasPrompt(tag) {
    const prompt = pendingPrompts.get(tag);

    return Boolean(prompt && now().getTime() - prompt.at <= PROMPT_TTL_MS);
  }

  // Mostra o aviso uma vez; a mensagem original fica só em memória para ser
  // processada logo após o aceite.
  function requestConsent(session, pendingText = null) {
    markPrompt(sessionTag(session), pendingText);

    return consentNotice();
  }

  async function setAiState(tag, estado) {
    const timestamp = now().toISOString();
    const fields = {
      estado,
      versao: version,
      atualizadoEm: timestamp,
    };

    if (estado === 'aceito') {
      fields.aceitoEm = timestamp;
    }

    if (estado === 'revogado') {
      fields.revogadoEm = timestamp;
    }

    if (estado === 'recusado') {
      fields.recusadoEm = timestamp;
    }

    await userData.updateChild(tag, 'privacidade/ia', fields);
  }

  async function setResearch(tag, ativo) {
    await userData.updateChild(tag, 'privacidade/pesquisaExterna', {
      ativo,
      atualizadoEm: now().toISOString(),
    });
  }

  function statusMessage(state, research) {
    const iaLabel = {
      aceito: 'ativa (consentimento registrado)',
      pendente: 'aguardando seu aceite',
      recusado: 'desativada (você não aceitou)',
      revogado: 'desativada (consentimento revogado)',
    }[state];

    return [
      '🔒 Sua privacidade no SalvaMoney:',
      `IA externa: ${iaLabel}`,
      `Pesquisa externa: ${research ? 'ativa' : 'desativada'}`,
      '',
      'Comandos: ativar IA · desativar IA · ativar pesquisa externa · desativar pesquisa externa · meus dados',
    ].join('\n');
  }

  // Retorna { message, resumeText } ou null quando o texto não é sobre consentimento.
  async function process(session, text) {
    const tag = sessionTag(session);
    const command = normalizedCommand(text);
    const matched = COMMANDS.find(({ pattern }) => pattern.test(command));

    if (!matched && (ACCEPT_PATTERN.test(command) || REFUSE_PATTERN.test(command))) {
      const state = await aiState(tag);

      if (!hasPrompt(tag) && state === 'aceito') {
        return null;
      }

      if (!hasPrompt(tag) && state !== 'pendente') {
        return null;
      }

      const prompt = takePrompt(tag);

      if (ACCEPT_PATTERN.test(command)) {
        await setAiState(tag, 'aceito');

        return {
          message: 'IA ativada ✅ Consentimento registrado. Para desativar: _desativar IA_.',
          resumeText: prompt?.pendingText || null,
        };
      }

      await setAiState(tag, 'recusado');
      conversationContext?.clear(tag);

      return {
        message: 'Tudo bem. Sigo só com respostas locais, sem IA externa. Se mudar de ideia: _ativar IA_.',
        resumeText: null,
      };
    }

    if (!matched) {
      return null;
    }

    if (matched.action === 'ativar_ia') {
      if (await aiState(tag) === 'aceito') {
        return { message: 'A IA já está ativa para você ✅' };
      }

      return { message: requestConsent(session) };
    }

    if (matched.action === 'desativar_ia') {
      await setAiState(tag, 'revogado');
      conversationContext?.clear(tag);
      pendingPrompts.delete(tag);

      return {
        message: 'IA desativada. Consentimento revogado e contexto da conversa apagado. Gastos, consultas e exclusões seguem funcionando sem IA.',
      };
    }

    if (matched.action === 'ativar_pesquisa') {
      await setResearch(tag, true);

      return {
        message: 'Pesquisa externa ativada ✅ Só pesquiso quando você pedir, com consultas genéricas.',
      };
    }

    if (matched.action === 'desativar_pesquisa') {
      await setResearch(tag, false);

      return { message: 'Pesquisa externa desativada.' };
    }

    return {
      message: statusMessage(await aiState(tag), await researchEnabled(tag)),
    };
  }

  return {
    aiState,
    getPrivacy,
    hasPrompt,
    process,
    requestConsent,
    researchEnabled,
    version,
  };
}

module.exports = {
  aiConsentState,
  consentNotice,
  createConsentService,
  researchNotice,
};
