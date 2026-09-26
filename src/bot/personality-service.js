'use strict';

const { formatMoney, formatPercent, normalizedCommand } = require('./finance-utils');
const { sessionTag } = require('./user-data');

const DEFAULT_PERSONALITY = 'equilibrado';

// A personalidade muda apenas tom, vocabulário e apresentação. Cálculos, permissões,
// segurança e política de investimento são idênticos para todas.
const PERSONALITIES = {
  equilibrado: {
    aliases: ['equilibrado', 'equilibrada', 'neutro', 'padrao', 'normal'],
    descricao: 'amigável e neutro',
    emoji: '🙂',
    exemplo: 'Registrei seu gasto. Se quiser, te mostro como está o mês.',
    fechamento: {
      advice: 'Qualquer dúvida, é só chamar.',
      report: 'Boa semana!',
    },
    nome: 'Equilibrado',
    prompt: 'Tom amigável, neutro e claro. Frases curtas.',
    abertura: {
      advice: 'Vamos lá:',
      alert: 'Aviso rápido:',
      confirmation: 'Pronto ✅',
      preview: 'Confere comigo antes de salvar:',
      reminder: 'Lembrete amigável:',
      report: 'Seu resumo da semana:',
      research: 'Encontrei isto para você comparar:',
    },
  },
  economico: {
    aliases: ['economico', 'economica', 'econ', 'poupador', 'mao de vaca'],
    descricao: 'firme quando um gasto prejudica orçamento ou meta',
    emoji: '🧮',
    exemplo: 'Esse gasto leva seu orçamento a 92%. Restam R$ 160,00 até o fim do mês.',
    fechamento: {
      advice: 'Cada real bem direcionado aproxima sua meta.',
      report: 'Foco no orçamento nesta semana.',
    },
    nome: 'Econômico',
    prompt: 'Tom firme e objetivo sobre impacto no orçamento e nas metas definidas pelo usuário. Nunca julgue moralmente o gasto; explique o impacto em números já calculados.',
    abertura: {
      advice: 'Vamos direto ao impacto no seu dinheiro:',
      alert: 'Atenção ao orçamento:',
      confirmation: 'Registrado ✅',
      preview: 'Antes de gravar, confira os números:',
      reminder: 'Lembrete de pendência:',
      report: 'Balanço da semana, com foco no orçamento:',
      research: 'Opções para comparar com calma:',
    },
  },
  estrategista: {
    aliases: ['estrategista', 'estrategico', 'estrategica', 'analitico', 'analitica'],
    descricao: 'analítico, elegante e objetivo',
    emoji: '♟️',
    exemplo: 'Cenário: 62% do orçamento usado com 40% do mês decorrido. Próximo passo: ajustar a categoria líder.',
    fechamento: {
      advice: 'Execute um passo por vez e reavalie.',
      report: 'Próxima revisão: domingo.',
    },
    nome: 'Estrategista',
    prompt: 'Tom analítico, elegante e objetivo. Estruture em cenário, prioridade e próximo passo.',
    abertura: {
      advice: 'Leitura do cenário:',
      alert: 'Sinal de atenção:',
      confirmation: 'Operação registrada ✅',
      preview: 'Resumo da operação para validação:',
      reminder: 'Pendência em aberto:',
      report: 'Leitura estratégica da semana:',
      research: 'Comparativo objetivo:',
    },
  },
  motivador: {
    aliases: ['motivador', 'motivadora', 'animado', 'animada', 'coach'],
    descricao: 'celebra progresso e incentiva constância',
    emoji: '🚀',
    exemplo: 'Mais um registro feito! Constância é o que transforma o mês. 💪',
    fechamento: {
      advice: 'Um passo de cada vez — você está no caminho!',
      report: 'Cada registro conta. Bora pra mais uma semana! 💪',
    },
    nome: 'Motivador',
    prompt: 'Tom encorajador: celebre progresso real e incentive constância, sem exageros nem promessas.',
    abertura: {
      advice: 'Bora organizar isso juntos:',
      alert: 'Ei, vale um olhar aqui:',
      confirmation: 'Mandou bem ✅',
      preview: 'Quase lá! Confere antes de salvar:',
      reminder: 'Passando pra lembrar:',
      report: 'Sua semana em números — bora ver o progresso:',
      research: 'Achei opções para você avaliar:',
    },
  },
  professor: {
    aliases: ['professor', 'professora', 'didatico', 'didatica', 'explicativo'],
    descricao: 'explica conceitos de forma didática',
    emoji: '📚',
    exemplo: 'Registrado. Dica: gasto fixo se repete todo mês; variável muda conforme o uso.',
    fechamento: {
      advice: 'Se quiser, explico qualquer termo com mais calma.',
      report: 'Conceito da semana: orçamento é um plano, não uma punição.',
    },
    nome: 'Professor',
    prompt: 'Tom didático: explique conceitos em linguagem simples, com um exemplo curto quando útil.',
    abertura: {
      advice: 'Vamos entender por partes:',
      alert: 'Vale entender este aviso:',
      confirmation: 'Registrado ✅',
      preview: 'Veja como ficou a conta antes de salvar:',
      reminder: 'Lembrete (e um lembrete de como funciona):',
      report: 'Aula rápida sobre a sua semana:',
      research: 'Vamos comparar entendendo cada item:',
    },
  },
  sincerao: {
    aliases: ['sincerao', 'sincero', 'sincera', 'sincerona', 'direto', 'direta'],
    descricao: 'direto e bem-humorado, sem insultar ou humilhar',
    emoji: '😎',
    exemplo: 'Papo reto: anotado. O mês ainda tem jogo, mas o delivery está artilheiro.',
    fechamento: {
      advice: 'Sem mistério: um ajuste por vez.',
      report: 'Resumo sincero entregue. Semana que vem tem revanche. 😄',
    },
    nome: 'Sincerão',
    prompt: 'Tom direto e bem-humorado, sem ironia ofensiva, sem insultos, sem humilhar e sem julgamento moral.',
    abertura: {
      advice: 'Papo reto:',
      alert: 'Sem rodeios:',
      confirmation: 'Anotado ✅',
      preview: 'Confere aí antes de eu gravar:',
      reminder: 'Toc toc, lembrete:',
      report: 'Sua semana, sem filtro (mas com carinho):',
      research: 'Sem enrolação, as opções:',
    },
  },
};

// Vocabulário proibido em qualquer personalidade (insultos ou julgamento moral).
const FORBIDDEN_WORDS = [
  'burro',
  'idiota',
  'irresponsavel',
  'vergonha',
  'otario',
  'fracassado',
  'inutil',
  'desnecessario',
  'superfluo',
];

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);

  for (let j = 1; j < cols; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return matrix[a.length][b.length];
}

function resolvePersonality(value) {
  const text = normalizedCommand(value).replace(/^(o|a|modo|personalidade)\s+/, '').trim();

  if (!text) {
    return null;
  }

  for (const [id, personality] of Object.entries(PERSONALITIES)) {
    if (personality.aliases.includes(text)) {
      return id;
    }
  }

  let best = null;

  for (const [id, personality] of Object.entries(PERSONALITIES)) {
    for (const alias of personality.aliases) {
      const distance = levenshtein(text, alias);

      // Tolerância a erro de digitação proporcional ao tamanho da palavra.
      const tolerance = alias.length >= 8 ? 2 : alias.length >= 5 ? 1 : 0;

      if (distance <= tolerance && (!best || distance < best.distance)) {
        best = { distance, id };
      }
    }
  }

  return best?.id || null;
}

function parsePersonalityCommand(text) {
  const command = normalizedCommand(text);

  if (/^(personalidades|listar personalidades|quais (sao as )?personalidades|ver personalidades|modos)$/.test(command)) {
    return { action: 'list' };
  }

  if (/^(minha personalidade|qual (e )?minha personalidade|personalidade atual)$/.test(command)) {
    return { action: 'current' };
  }

  let match = command.match(/^(?:testar|teste|exemplo(?: de)?|como fala o|como fala a|mostrar)\s+(?:a\s+)?(?:personalidade\s+|modo\s+)?(.+)$/);

  if (match && (/personalidade|modo/.test(command) || resolvePersonality(match[1]))) {
    return { action: 'test', personality: resolvePersonality(match[1]), raw: match[1] };
  }

  match = command.match(/^(?:mudar|trocar|alterar|usar|escolher|definir|ativar)\s+(?:minha\s+)?(?:a\s+)?(?:personalidade|modo)\s+(?:para\s+|pra\s+)?(.+)$/) ||
    command.match(/^(?:quero|prefiro)\s+(?:o\s+|a\s+)?(?:modo|personalidade)\s+(.+)$/) ||
    command.match(/^(?:personalidade|modo)\s+(.+)$/) ||
    command.match(/^(?:fala|fale)\s+(?:comigo\s+)?(?:como|no modo)\s+(?:o\s+|a\s+)?(.+)$/);

  if (match) {
    return { action: 'set', personality: resolvePersonality(match[1]), raw: match[1] };
  }

  return null;
}

function listMessage(currentId) {
  return [
    'Personalidades disponíveis:',
    ...Object.entries(PERSONALITIES).map(([id, item], index) =>
      `${index + 1}. ${item.emoji} ${item.nome} — ${item.descricao}${id === currentId ? ' (atual)' : ''}`),
    '',
    'Para trocar: _mudar personalidade para professor_',
    'Para ver um exemplo: _testar personalidade sincerão_',
  ].join('\n');
}

function personalityOf(id) {
  return PERSONALITIES[id] || PERSONALITIES[DEFAULT_PERSONALITY];
}

// Envolve um corpo já calculado com abertura/fechamento do tom escolhido.
// O corpo (valores, datas, instruções) nunca é alterado.
function frame(id, kind, body, { closing = false } = {}) {
  const personality = personalityOf(id);
  const opening = personality.abertura[kind];
  const lines = [];

  if (opening) {
    lines.push(opening);
  }

  lines.push(body);

  if (closing && personality.fechamento[kind]) {
    lines.push('', personality.fechamento[kind]);
  }

  return lines.join('\n');
}

function promptStyle(id) {
  const personality = personalityOf(id);

  return [
    `Personalidade: ${personality.nome}. ${personality.prompt}`,
    'A personalidade altera apenas o tom. Não mude números, cálculos, regras de segurança nem a política de investimento.',
    'Nunca insulte, humilhe ou faça julgamento moral de gastos.',
  ].join('\n');
}

// Comentário do Econômico: só existe quando o usuário definiu orçamento, meta ou
// prioridade, e descreve o impacto objetivo já calculado.
function economicoComment(id, impact = {}) {
  if (id !== 'economico') {
    return '';
  }

  const hasBudget = Number(impact.orcamentoMensal) > 0;
  const hasGoal = Number(impact.valorMeta) > 0;
  const hasPriority = Array.isArray(impact.prioridades) && impact.prioridades.length > 0;

  if (!hasBudget && !hasGoal && !hasPriority) {
    return '';
  }

  if (hasBudget) {
    const used = Number(impact.totalMes) / Number(impact.orcamentoMensal) * 100;

    if (used >= 80) {
      const remaining = Number(impact.orcamentoMensal) - Number(impact.totalMes);

      return remaining >= 0
        ? `Impacto: com esse gasto você usou ${formatPercent(used)} do orçamento do mês. Restam ${formatMoney(remaining)}.`
        : `Impacto: com esse gasto o mês passou ${formatMoney(Math.abs(remaining))} do orçamento definido (${formatPercent(used)}).`;
    }
  }

  if (hasGoal && Number.isFinite(Number(impact.economiaProjetada)) && Number(impact.economiaProjetada) < Number(impact.valorMeta)) {
    return `Impacto na meta: a economia projetada está em ${formatMoney(impact.economiaProjetada)}, abaixo da meta de ${formatMoney(impact.valorMeta)}.`;
  }

  if (hasPriority && !hasBudget && !hasGoal) {
    return `Lembrete da sua prioridade: ${impact.prioridades[0]}. Esse gasto reduz o valor disponível para ela neste mês.`;
  }

  return '';
}

function containsForbiddenWord(text) {
  const normalized = normalizedCommand(text);

  return FORBIDDEN_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(normalized));
}

function createPersonalityService({
  now = () => new Date(),
  userData,
}) {
  async function getPersonality(sessionOrTag) {
    const tag = typeof sessionOrTag === 'string' ? sessionOrTag : sessionTag(sessionOrTag);
    const preference = tag ? await userData.readChild(tag, 'preferencias/personalidade') : null;
    const id = preference?.id;

    return PERSONALITIES[id] ? id : DEFAULT_PERSONALITY;
  }

  async function process(session, text) {
    const command = parsePersonalityCommand(text);

    if (!command) {
      return null;
    }

    const tag = sessionTag(session);
    const current = await getPersonality(tag);

    if (command.action === 'list') {
      return listMessage(current);
    }

    if (command.action === 'current') {
      const personality = personalityOf(current);

      return `Sua personalidade atual: ${personality.emoji} ${personality.nome} — ${personality.descricao}.`;
    }

    if (!command.personality) {
      return [
        `Não reconheci a personalidade "${command.raw}".`,
        '',
        listMessage(current),
      ].join('\n');
    }

    const personality = personalityOf(command.personality);

    if (command.action === 'test') {
      return [
        `Exemplo ${personality.emoji} ${personality.nome}:`,
        `"${personality.exemplo}"`,
        '',
        `Para usar: _mudar personalidade para ${personality.nome.toLowerCase()}_`,
      ].join('\n');
    }

    await userData.updateChild(tag, 'preferencias/personalidade', {
      id: command.personality,
      atualizadoEm: now().toISOString(),
    });

    return [
      `Personalidade trocada para ${personality.emoji} ${personality.nome} ✅`,
      `"${personality.exemplo}"`,
      'Vale também para alertas e relatórios automáticos. Os cálculos continuam os mesmos.',
    ].join('\n');
  }

  return {
    getPersonality,
    process,
  };
}

module.exports = {
  DEFAULT_PERSONALITY,
  FORBIDDEN_WORDS,
  PERSONALITIES,
  containsForbiddenWord,
  createPersonalityService,
  economicoComment,
  frame,
  parsePersonalityCommand,
  promptStyle,
  resolvePersonality,
};
