'use strict';

const { redactText } = require('../ai/privacy');
const { validateSchema } = require('../ai/schema');
const { validCategories, categoriaFinal } = require('./categories');
const { formatMoney, limitLines, roundMoney } = require('./finance-utils');
const { buildPlan, incomeInfo } = require('./financial-planner');
const { containsForbiddenWord, promptStyle } = require('./personality-service');
const { sessionTag } = require('./user-data');
const { parsearGasto } = require('../expense-parser');
const { foldText } = require('../ai/privacy');
const { relativeDateIso } = require('./relative-date');

const DESCRIPTION_STOP_WORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'com', 'pra', 'pro',
  'para', 'por', 'e', 'eu', 'me', 'meu', 'minha', 'hoje', 'ontem', 'anteontem', 'reais', 'real', 'conto', 'contos', 'pila',
  'gastei', 'gasto', 'torrei', 'paguei', 'comprei', 'foi', 'deu', 'custou', 'saiu', 'rolou', 'mandei', 'dei', 'lancei',
  'uns', 'umas', 'tipo', 'quase', 'cerca', 'mais', 'menos', 'ai', 'la', 'so', 'tipo', 'mano', 'ne',
]);

// Descrição local (a IA não define o texto salvo): palavras da própria mensagem.
function localDescription(text) {
  const parsed = parsearGasto(text);

  if (parsed?.desc && !/\d/.test(parsed.desc)) {
    return parsed.desc;
  }

  const words = String(text || '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter((word) => word && !/\d/.test(word) && !DESCRIPTION_STOP_WORDS.has(foldText(word)))
    .slice(0, 4);

  return words.join(' ') || 'Gasto';
}

const STANDARD_CATEGORIES = new Set(validCategories([]));
const PLACEHOLDER = /^PESSOA_\d{1,2}$/;
const MIN_CONFIDENCE = 0.6;

const INTERPRET_SCHEMA = {
  properties: {
    categoria: { maxLength: 40, nullable: true, type: 'string' },
    confidence: { maximum: 1, minimum: 0, type: 'number' },
    intent: {
      enum: ['register_expense', 'split', 'query_summary', 'query_balance', 'question', 'smalltalk', 'unknown'],
      type: 'string',
    },
    meio: { enum: ['pix', 'debito', 'cartao'], nullable: true, type: 'string' },
    pessoas: { items: { pattern: PLACEHOLDER, type: 'string' }, maxItems: 10, nullable: true, type: 'array' },
    precisaDados: { nullable: true, type: 'boolean' },
    resposta: { maxLength: 700, nullable: true, type: 'string' },
    somenteEntre: { nullable: true, type: 'boolean' },
    total: { maximum: 1000000, minimum: 0.01, nullable: true, type: 'number' },
    valor: { maximum: 1000000, minimum: 0.01, nullable: true, type: 'number' },
    valores: {
      items: {
        properties: {
          pessoa: { pattern: PLACEHOLDER, type: 'string' },
          valor: { maximum: 1000000, minimum: 0.01, type: 'number' },
        },
        required: ['pessoa', 'valor'],
        type: 'object',
      },
      maxItems: 10,
      nullable: true,
      type: 'array',
    },
  },
  required: ['intent', 'confidence'],
  type: 'object',
};

function interpretPrompt(personality) {
  return [
    'Você interpreta mensagens de WhatsApp do assistente financeiro SalvaMoney.',
    'Responda SOMENTE um objeto JSON. Você não executa ações nem acessa dados; o sistema valida e decide.',
    'Intenções: register_expense (registrar gasto), split (dividir conta com PESSOA_n), query_summary (resumo do mês),',
    'query_balance (saldo com amigos, a receber/a pagar), question (dúvida financeira), smalltalk, unknown.',
    'Campos: {"intent","confidence":0-1,"valor","categoria","total","pessoas":["PESSOA_1"],"valores":[{"pessoa":"PESSOA_1","valor":50}],',
    '"somenteEntre":bool,"meio":"pix|debito|cartao","resposta":"texto curto para question/smalltalk","precisaDados":bool}',
    'Regras: nunca invente valores; use null quando faltar. Pessoas só aparecem como PESSOA_n.',
    'Em "question", se a resposta depender dos números do usuário, use precisaDados=true e resposta=null.',
    'Respostas: português do Brasil, no máximo 5 linhas, sem prometer retorno, sem recomendar produto específico.',
    'Para investimentos, oriente a enviar "pesquisar investimentos". Nunca peça nome, telefone, e-mail ou tag.',
    promptStyle(personality),
  ].join('\n');
}

function replyPrompt(personality) {
  return [
    'Você responde dúvidas financeiras do usuário do SalvaMoney usando SOMENTE os dados agregados recebidos.',
    'Não invente números; não refaça cálculos principais; se faltar dado, diga qual informação ajudaria.',
    'Ordem de prioridade: essenciais, dívidas caras, reserva de emergência, metas de curto prazo, investimentos.',
    'No máximo 5 linhas. Não recomende produto específico nem prometa retorno. Não execute ações.',
    promptStyle(personality),
  ].join('\n');
}

function safeCategory(category) {
  return STANDARD_CATEGORIES.has(category) ? category : 'Outras';
}

function createConversationService({
  aiGateway,
  balanceService,
  config,
  consentService,
  conversationContext,
  expenseService,
  friendService,
  logger = console,
  personalityService,
  splitService,
  summaryHandler,
  todayIso = () => new Date().toISOString().slice(0, 10),
  transactionStore,
  userData,
}) {
  const features = config?.features || {};

  async function aggregates(session) {
    const tag = sessionTag(session);
    const profile = (await userData.readChild(tag, 'perfilFinanceiro')) || {};
    const expenses = transactionStore
      ? await transactionStore.listMonthlyExpensesWithIds({ group: 'SALVAMONEY', user: tag })
      : [];
    const byCategory = {};

    expenses.forEach((expense) => {
      const category = safeCategory(expense.cat || 'Outros');

      byCategory[category] = (byCategory[category] || 0) + Number(expense.value || 0);
    });

    const plan = buildPlan(profile);
    const balances = balanceService && features.splits ? await balanceService.computeBalances(tag) : null;
    const total = Object.values(byCategory).reduce((sum, value) => sum + value, 0);

    return {
      amigos: balances ? {
        aPagar: balances.aPagarCents / 100,
        aReceber: balances.aReceberCents / 100,
      } : null,
      mes: {
        orcamentoMensal: Number(profile.orcamentoMensal) || null,
        percentualOrcamento: Number(profile.orcamentoMensal) > 0 ? Math.round((total / Number(profile.orcamentoMensal)) * 100) : null,
        topCategorias: Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([categoria, value]) => ({ categoria, total: roundMoney(value) })),
        totalGastoLiquido: balances ? balances.gastoPessoalLiquidoCents / 100 : roundMoney(total),
      },
      perfil: {
        dividasCarasTotal: plan.dividasCarasTotal,
        essenciais: plan.essenciais || null,
        perfilRisco: profile.perfilRisco || null,
        prazoMeses: Number(profile.prazoMeses) || null,
        rendaConsiderada: incomeInfo(profile).conservadora,
        rendaVariavel: incomeInfo(profile).variavel,
        reservaAtual: plan.reservaAtual,
        reservaMeta: plan.reservaMeta,
      },
    };
  }

  function restorePlaceholders(text, placeholders) {
    return Object.entries(placeholders).reduce(
      (result, [placeholder, nickname]) => result.split(placeholder).join(nickname),
      String(text || '')
    );
  }

  function finalizeReply(text, placeholders) {
    const reply = limitLines(restorePlaceholders(text, placeholders), 6);

    if (!reply || containsForbiddenWord(reply)) {
      return null;
    }

    return reply;
  }

  async function answerWithData(session, question, personality, privacy) {
    const data = await aggregates(session);
    const result = await aiGateway.complete({
      messages: [
        { content: replyPrompt(personality), role: 'system' },
        { content: `Pergunta (redigida): ${question}\nDados agregados:\n${JSON.stringify(data)}`, role: 'user' },
      ],
      privacy,
      task: 'conversation_reply',
    });

    return result.ok ? result.text : null;
  }

  // Retorna string, { message, pendingAction } ou null (segue o fluxo determinístico).
  async function process(session, text) {
    if (!features.conversationalAi || !aiGateway) {
      return null;
    }

    const tag = sessionTag(session);
    const state = await consentService.aiState(tag);

    if (state === 'recusado' || state === 'revogado') {
      return null;
    }

    if (state === 'pendente') {
      return consentService.requestConsent(session, text);
    }

    const friends = friendService && features.friends ? await friendService.activeFriends(tag) : [];
    const me = await userData.getContact(tag);
    const privacy = {
      knownTags: [tag, ...friends.map((friend) => friend.tag)],
      names: me?.firstName && me.firstName !== 'Alguém' ? [me.firstName] : [],
      nicknames: friends.map((friend) => friend.apelido),
    };
    const redacted = redactText(text, privacy);
    const personality = personalityService ? await personalityService.getPersonality(tag) : 'equilibrado';
    const history = conversationContext ? conversationContext.recent(tag) : [];
    const result = await aiGateway.complete({
      json: true,
      messages: [
        { content: interpretPrompt(personality), role: 'system' },
        ...history.map((entry) => ({ content: entry.text, role: entry.role })),
        { content: redacted.text, role: 'user' },
      ],
      privacy,
      task: 'conversation_interpret',
    });

    if (!result.ok) {
      return null;
    }

    const validation = validateSchema(INTERPRET_SCHEMA, result.json);

    if (!validation.valid) {
      logger.info?.('[ai]', { status: 'schema_invalido', task: 'conversation_interpret' });
      return null;
    }

    const action = validation.value;

    conversationContext?.add(tag, 'user', redacted.text);

    if (action.confidence < MIN_CONFIDENCE || action.intent === 'unknown') {
      return null;
    }

    if (action.intent === 'register_expense') {
      if (!action.valor) {
        return 'Qual foi o valor? 💸';
      }

      const desc = String(localDescription(text)).slice(0, 60);
      const customCategories = expenseService?.getCategoriasPersonalizadas
        ? await expenseService.getCategoriasPersonalizadas(session)
        : [];
      const category = categoriaFinal(desc, action.categoria, customCategories);
      const value = roundMoney(action.valor);

      conversationContext?.add(tag, 'assistant', 'prévia de registro de gasto');

      return {
        message: [
          `Registrar este gasto? ${desc} — ${formatMoney(value)} (${category})${relativeDateIso(text, todayIso()) !== todayIso() ? ` em ${relativeDateIso(text, todayIso()).split('-').reverse().join('/')}` : ''}`,
          'Responda SIM para gravar ou CANCELAR.',
        ].join('\n'),
        pendingAction: {
          expense: { cat: category, data: relativeDateIso(text, todayIso()), desc, valor: value },
          tipo: 'ai_expense',
        },
      };
    }

    if (action.intent === 'split' && splitService && features.splits) {
      const people = (action.pessoas || []).map((placeholder) => redacted.placeholders[placeholder]).filter(Boolean);

      if (!people.length || !action.total) {
        return 'Para dividir, me diga o total e com quem. Exemplo: dividir 150 com Carlos';
      }

      const values = (action.valores || [])
        .filter((item) => redacted.placeholders[item.pessoa])
        .map((item) => `${redacted.placeholders[item.pessoa]} ${String(roundMoney(item.valor)).replace('.', ',')}`);
      const synthetic = [
        `dividir ${String(roundMoney(action.total)).replace('.', ',')}`,
        action.meio === 'pix' ? 'no pix' : action.meio === 'debito' ? 'no débito' : action.meio === 'cartao' ? 'no cartão' : '',
        action.somenteEntre ? 'somente entre' : 'com',
        people.join(' e '),
        values.length ? `, ${values.join(', ')}` : '',
      ].filter(Boolean).join(' ');

      conversationContext?.add(tag, 'assistant', 'prévia de divisão');

      return await splitService.start(session, synthetic);
    }

    if (action.intent === 'query_summary' && summaryHandler) {
      return await summaryHandler(session);
    }

    if (action.intent === 'query_balance' && balanceService && features.splits) {
      return await balanceService.report(session);
    }

    if (action.intent === 'question' || action.intent === 'smalltalk') {
      let reply = action.resposta;

      if (action.intent === 'question' && (action.precisaDados || !reply)) {
        reply = await answerWithData(session, redacted.text, personality, privacy);
      }

      const finalReply = finalizeReply(reply, redacted.placeholders);

      if (finalReply) {
        conversationContext?.add(tag, 'assistant', redactText(finalReply, privacy).text);
      }

      return finalReply;
    }

    return null;
  }

  return {
    aggregates,
    process,
  };
}

module.exports = {
  INTERPRET_SCHEMA,
  createConversationService,
  localDescription,
};
