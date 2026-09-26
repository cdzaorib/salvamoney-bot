'use strict';

// Características estáveis de cada classe de produto. Taxas, preços e rentabilidades
// atuais nunca ficam aqui: só aparecem quando vêm de fontes pesquisadas ao vivo.
const PRODUCTS = [
  {
    custos: 'IR regressivo (22,5% até 180 dias, caindo até 15% após 720 dias); taxa de custódia da B3 pode se aplicar',
    id: 'tesouro_selic',
    indicador: 'acompanha a taxa Selic',
    liquidez: 'D+1 (resgate em dia útil)',
    liquidezNivel: 'alta',
    nome: 'Tesouro Selic',
    objetivos: ['reserva de emergência', 'curto prazo', 'outro', 'viagem'],
    perfis: ['conservador', 'moderado', 'arrojado'],
    prazoMinMeses: 0,
    query: 'Tesouro Selic rentabilidade liquidez Tesouro Direto',
    risco: 'baixo (título público federal)',
    riscoNivel: 1,
  },
  {
    custos: 'IR regressivo; em geral sem taxa de custódia',
    id: 'cdb_liquidez',
    indicador: 'percentual do CDI',
    liquidez: 'diária (conforme o banco emissor)',
    liquidezNivel: 'alta',
    nome: 'CDB com liquidez diária',
    objetivos: ['reserva de emergência', 'curto prazo', 'outro', 'viagem'],
    perfis: ['conservador', 'moderado', 'arrojado'],
    prazoMinMeses: 0,
    query: 'CDB liquidez diária percentual do CDI garantia FGC',
    risco: 'baixo a moderado (banco emissor; garantia do FGC até o limite legal)',
    riscoNivel: 1,
  },
  {
    custos: 'taxa de administração e come-cotas semestral',
    id: 'fundo_di',
    indicador: 'rentabilidade comparada ao CDI',
    liquidez: 'geralmente D+0 a D+1',
    liquidezNivel: 'alta',
    nome: 'Fundo DI / renda fixa simples',
    objetivos: ['reserva de emergência', 'curto prazo', 'outro'],
    perfis: ['conservador', 'moderado'],
    prazoMinMeses: 0,
    query: 'fundo DI taxa de administração come-cotas CVM',
    risco: 'baixo',
    riscoNivel: 1,
  },
  {
    custos: 'isenta de IR para pessoa física; pode ter carência',
    id: 'lci_lca',
    indicador: 'percentual do CDI',
    liquidez: 'após carência (geralmente 90 dias ou mais)',
    liquidezNivel: 'media',
    nome: 'LCI/LCA',
    objetivos: ['curto prazo', 'viagem', 'carro', 'casamento', 'reforma', 'outro'],
    perfis: ['conservador', 'moderado', 'arrojado'],
    prazoMinMeses: 6,
    query: 'LCI LCA carência isenção imposto de renda FGC',
    risco: 'baixo a moderado (garantia do FGC até o limite legal)',
    riscoNivel: 1,
  },
  {
    custos: 'IR regressivo; taxa de custódia da B3 pode se aplicar',
    id: 'tesouro_prefixado',
    indicador: 'taxa prefixada ao ano',
    liquidez: 'D+1, mas o preço oscila antes do vencimento',
    liquidezNivel: 'baixa',
    nome: 'Tesouro Prefixado',
    objetivos: ['viagem', 'carro', 'casamento', 'reforma', 'estudos', 'faculdade', 'outro'],
    perfis: ['conservador', 'moderado', 'arrojado'],
    prazoMinMeses: 12,
    query: 'Tesouro Prefixado taxa marcação a mercado Tesouro Direto',
    risco: 'baixo de crédito; oscila se vendido antes do vencimento',
    riscoNivel: 2,
  },
  {
    custos: 'IR regressivo; taxa de custódia da B3 pode se aplicar',
    id: 'tesouro_ipca',
    indicador: 'IPCA + taxa real',
    liquidez: 'D+1, mas o preço oscila antes do vencimento',
    liquidezNivel: 'baixa',
    nome: 'Tesouro IPCA+',
    objetivos: ['aposentadoria', 'casa', 'imovel', 'estudos', 'faculdade', 'outro'],
    perfis: ['conservador', 'moderado', 'arrojado'],
    prazoMinMeses: 36,
    query: 'Tesouro IPCA+ taxa real marcação a mercado Tesouro Direto',
    risco: 'baixo de crédito; oscila se vendido antes do vencimento',
    riscoNivel: 2,
  },
  {
    custos: 'taxa de administração do ETF; IR sobre ganho; corretagem pode se aplicar',
    id: 'etf_indice',
    indicador: 'índice de referência do fundo',
    liquidez: 'negociado em bolsa (liquidação D+2)',
    liquidezNivel: 'media',
    nome: 'ETFs de índice amplo',
    objetivos: ['aposentadoria', 'outro', 'casa', 'imovel'],
    perfis: ['moderado', 'arrojado'],
    prazoMinMeses: 60,
    query: 'ETF fundo de índice B3 como funciona taxa de administração',
    risco: 'alto (oscilação do mercado de ações)',
    riscoNivel: 3,
  },
  {
    custos: 'corretagem pode se aplicar; IR sobre ganho de capital conforme regra vigente',
    id: 'acoes',
    indicador: 'sem indicador fixo (varia com o mercado)',
    liquidez: 'negociado em bolsa (liquidação D+2)',
    liquidezNivel: 'media',
    nome: 'Ações (carteira diversificada)',
    objetivos: ['aposentadoria', 'outro'],
    perfis: ['arrojado'],
    prazoMinMeses: 60,
    query: 'investir em ações diversificação riscos B3 CVM',
    risco: 'alto',
    riscoNivel: 4,
  },
  {
    custos: 'taxas da plataforma; IR sobre ganho conforme regra vigente',
    id: 'cripto',
    indicador: 'sem indicador (alta volatilidade)',
    liquidez: 'alta, com forte oscilação de preço',
    liquidezNivel: 'media',
    nome: 'Criptoativos (parcela pequena)',
    objetivos: ['outro', 'aposentadoria'],
    perfis: ['arrojado'],
    prazoMinMeses: 60,
    query: 'criptoativos riscos alerta CVM Banco Central',
    requerCompatibilidadeCripto: true,
    risco: 'muito alto',
    riscoNivel: 5,
  },
];

const PROHIBITED_PATTERN = /\b(alavancag\w*|alavancad\w*|derivativ\w*|opcoes binarias|opcao binaria|mercado futuro|contratos? futuros?|minicontratos?|mini indice|mini dolar|day ?trade|operar vendido|venda a descoberto|swap)\b/;

function isProhibitedRequest(normalizedText) {
  return PROHIBITED_PATTERN.test(String(normalizedText || ''));
}

// Seleção determinística de até 3 opções compatíveis com o perfil.
function selectOptions(profile, plan) {
  const risk = profile?.perfilRisco || 'conservador';
  const horizon = Number(profile?.prazoMeses || 0);
  const liquidity = profile?.liquidezNecessaria || 'media';
  const goal = profile?.objetivoInvestimento || 'outro';
  const reserveComplete = plan ? plan.reservaFalta <= 0 : false;
  const expensiveDebt = plan ? plan.dividasCaras.length > 0 : false;
  const emergency = goal === 'reserva de emergência';

  const compatible = PRODUCTS.filter((product) => {
    if (!product.perfis.includes(risk) || horizon < product.prazoMinMeses) {
      return false;
    }

    if ((liquidity === 'alta' || emergency) && product.liquidezNivel !== 'alta') {
      return false;
    }

    if (emergency && product.riscoNivel > 1) {
      return false;
    }

    // Sem reserva completa ou com dívida cara, renda variável fica para depois.
    if ((!reserveComplete || expensiveDebt) && product.riscoNivel > 2) {
      return false;
    }

    if (product.requerCompatibilidadeCripto && !(risk === 'arrojado' && horizon >= 60 && reserveComplete && !expensiveDebt)) {
      return false;
    }

    return true;
  });

  return compatible
    .map((product) => ({
      product,
      score: (product.objetivos.includes(goal) ? 10 : 0) +
        (risk === 'conservador' ? 5 - product.riscoNivel : product.riscoNivel) +
        (liquidity === 'baixa' && product.liquidezNivel !== 'alta' ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.product.riscoNivel - b.product.riscoNivel)
    .slice(0, 3)
    .map(({ product }) => product);
}

function compatibilityLine(product, profile) {
  const parts = [];

  if (product.objetivos.includes(profile?.objetivoInvestimento)) {
    parts.push(`combina com o objetivo (${profile.objetivoInvestimento})`);
  } else {
    parts.push('uso geral');
  }

  parts.push(`perfil ${profile?.perfilRisco || 'conservador'}`);

  if (profile?.prazoMeses) {
    parts.push(`prazo de ${profile.prazoMeses} meses`);
  }

  return parts.join(' · ');
}

module.exports = {
  PRODUCTS,
  compatibilityLine,
  isProhibitedRequest,
  selectOptions,
};
