'use strict';

const { normalizeText } = require('./text-utils');

const CONFIDENCE_THRESHOLD = 0.75;
const ALLOWED_INTENTS = new Set([
  'register_expense',
  'delete_expense',
  'monthly_summary',
  'expense_query',
  'financial_advice',
  'create_alert',
  'list_alerts',
  'savings_goal',
  'charge',
  'financial_profile',
  'help',
  'unknown',
]);

function normalizedCommand(value) {
  return normalizeText(value).trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
}

function isRiskCommand(command) {
  return /^(apagar|excluir|remover|deletar|desfazer|cancelar)\b/.test(command) ||
    /^(aceitar|recusar)\s+(cobranca|cobrança)?\s*\d+\b/.test(command) ||
    /^(marcar\s+(cobranca|cobrança)|marcar\s+como\s+paga|paguei\s+(a\s+)?cobranca|recebi\s+(o\s+pagamento\s+da\s+)?cobranca)\b/.test(command);
}

function shouldSkipIntentRouter(text) {
  const command = normalizedCommand(text);

  if (!command || isRiskCommand(command)) {
    return true;
  }

  return /^(gastei|gasto|paguei|comprei|almocei|jantei|lancei|registrar|registre)\b/.test(command) ||
    /^(cobrar|cobranca|cobrancas)\b/.test(command) ||
    /^cobranças?\b/.test(command) ||
    /\b(tag\s+(dela|dele)|ela\s+paga|ele\s+paga|dividir)\b/.test(command) ||
    /^(me avise|alerta|criar alerta|limite\s+(mensal|de)|listar alertas|meus alertas|alertas)\b/.test(command) ||
    /^(criar\s+meta|quero\s+economizar|minha\s+meta|quanto\s+falta\s+para\s+minha\s+meta|como\s+esta\s+minha\s+meta)\b/.test(command) ||
    /^(recebo|ganho|meu salario|salario|meu cartao|cartao vence|definir orcamento|meu orcamento|meu perfil financeiro|ver perfil financeiro)\b/.test(command) ||
    /^(resumo do mes|resumo mensal|meu resumo|como estou indo esse mes|analise do mes|relatorio do mes)$/.test(command) ||
    /^quanto\s+(eu\s+)?gastei\b/.test(command) ||
    /^gastos?\s+(com|de|do|da)\b/.test(command) ||
    /^total\s+(de|do|da)\b/.test(command) ||
    /^(ajuda|help|oi|ola|menu|start|\/start)\b/.test(command) ||
    /^(entrar|criar conta|cadastro|sair da conta|minha tag|qual .*tag|buscar tag|procurar tag|encontrar tag)\b/.test(command) ||
    /\b(gasto fixo|fixo|parcelei|parcelar|em\s+\d+\s*x)\b/.test(command);
}

function buildIntentRouterPrompt(text) {
  return [
    {
      role: 'system',
      content: [
        'Você é o roteador seguro de intenção do bot financeiro SalvaMoney.',
        'Sua única tarefa é classificar a intenção da mensagem do usuário.',
        'Não execute ações. Não salve, apague, edite ou crie dados.',
        'Responda somente JSON válido, sem markdown e sem texto fora do JSON.',
        'Use apenas uma das intenções permitidas.',
        'Se estiver em dúvida, use unknown com confidence baixa.',
        'Nunca invente valores, tags ou categorias.',
        'Não peça nem use phone, tag real, tokens, chaves ou dados financeiros completos.',
        '',
        'Intenções permitidas:',
        Array.from(ALLOWED_INTENTS).join(', '),
        '',
        'Formato obrigatório:',
        '{"intent":"financial_advice","confidence":0.92,"reason":"Usuário pede orientação financeira geral","entities":{"amount":null,"category":null,"period":null,"targetTag":null}}',
        '',
        'Exemplos:',
        '"onde posso economizar?" -> financial_advice',
        '"me ajuda a organizar meu dinheiro" -> financial_advice',
        '"quanto gastei com mercado?" -> expense_query',
        '"me avise se eu passar de 300 em delivery" -> create_alert',
        '"resumo do mês" -> monthly_summary',
        '"criar meta de economizar 500" -> savings_goal',
        '"cobrar 80 da tag 123456" -> charge',
        '"ajuda" -> help',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Mensagem do usuário: ${String(text || '').trim()}`,
    },
  ];
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function sanitizeEntities(value) {
  const entities = value && typeof value === 'object' ? value : {};
  const targetTag = entities.targetTag === null || entities.targetTag === undefined
    ? null
    : String(entities.targetTag).replace(/\D/g, '');

  return {
    amount: safeNumber(entities.amount),
    category: entities.category ? String(entities.category).slice(0, 60) : null,
    period: entities.period ? String(entities.period).slice(0, 40) : null,
    targetTag: targetTag && targetTag.length === 6 ? targetTag : null,
  };
}

function unknownClassification(confidence = 0, reason = 'Confiança baixa ou intenção desconhecida') {
  return {
    intent: 'unknown',
    confidence,
    reason,
    entities: {
      amount: null,
      category: null,
      period: null,
      targetTag: null,
    },
  };
}

function parseIntentRouterResponse(response) {
  let parsed;

  if (response && typeof response === 'object' && !Array.isArray(response)) {
    parsed = response;
  } else {
    const text = String(response || '').trim();

    if (!text || !text.startsWith('{') || !text.endsWith('}')) {
      return null;
    }

    try {
      parsed = JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  const confidence = safeNumber(parsed.confidence);
  const intent = ALLOWED_INTENTS.has(parsed.intent) ? parsed.intent : 'unknown';

  if (confidence === null) {
    return null;
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    return unknownClassification(confidence, 'Confiança abaixo do limite seguro');
  }

  return {
    intent,
    confidence,
    reason: parsed.reason ? String(parsed.reason).slice(0, 160) : '',
    entities: sanitizeEntities(parsed.entities),
  };
}

function logClassification(logger, classification) {
  if (!classification || !logger?.info) {
    return;
  }

  logger.info('[intent-router]', {
    confidence: classification.confidence,
    intent: classification.intent,
  });
}

function createIntentRouterService({
  aiProviderRouter,
  logger,
}) {
  async function classificarIntencao(text) {
    if (!aiProviderRouter?.generateJson || shouldSkipIntentRouter(text)) {
      return null;
    }

    const response = await aiProviderRouter.generateJson({
      task: 'intent_router',
      messages: buildIntentRouterPrompt(text),
      fallback: null,
    });
    const classification = parseIntentRouterResponse(response);

    if (classification) {
      logClassification(logger, classification);
    }

    return classification;
  }

  return {
    classificarIntencao,
  };
}

module.exports = {
  ALLOWED_INTENTS,
  CONFIDENCE_THRESHOLD,
  buildIntentRouterPrompt,
  createIntentRouterService,
  isRiskCommand,
  parseIntentRouterResponse,
  shouldSkipIntentRouter,
};
