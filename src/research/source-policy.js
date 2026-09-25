'use strict';

// Política de fontes: oficiais primeiro, depois instituições/profissionais
// identificáveis. Todo conteúdo web é tratado como dado não confiável.

const OFFICIAL_DOMAINS = [
  'bcb.gov.br',
  'cvm.gov.br',
  'gov.br',
  'tesourodireto.com.br',
  'tesouro.gov.br',
  'b3.com.br',
  'receita.fazenda.gov.br',
  'fgc.org.br',
  'anbima.com.br',
];

// Páginas oficiais de produtos (bancos e corretoras identificáveis).
const INSTITUTION_DOMAINS = [
  'bb.com.br',
  'bradesco.com.br',
  'btgpactual.com',
  'caixa.gov.br',
  'inter.co',
  'itau.com.br',
  'nubank.com.br',
  'nuinvest.com.br',
  'rico.com.vc',
  'santander.com.br',
  'xpi.com.br',
  'c6bank.com.br',
];

// Veículos e profissionais identificáveis (opinião, nunca fonte única de número).
const IDENTIFIED_MEDIA_DOMAINS = [
  'einvestidor.estadao.com.br',
  'estadao.com.br',
  'exame.com',
  'folha.uol.com.br',
  'infomoney.com.br',
  'moneytimes.com.br',
  'valor.globo.com',
  'valorinveste.globo.com',
  'g1.globo.com',
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /ignor[ea]\s+(as\s+)?instru[cç][oõ]es/i,
  /desconsidere\s+(as\s+)?(instru|regras)/i,
  /system\s*prompt|prompt\s+do\s+sistema/i,
  /\b(you are|voc[eê] (agora )?[eé] um)\b.*\b(assistant|assistente|ia|ai)\b/i,
  /\b(api[_\s-]?key|token|senha|password|secret)\b/i,
  /\b(execute|executar|rode|run)\b.*\b(comando|command|script|a[cç][aã]o)\b/i,
  /\b(envie|mande|transfira|send)\b.*\b(dados|pix|dinheiro|mensagem|message)\b/i,
  /<\/?(script|iframe|system|assistant)\b/i,
  /\b(assistant|system)\s*:/i,
];

function hostnameOf(url) {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch (_) {
    return null;
  }
}

function matchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function sourceTier(url) {
  const host = hostnameOf(url);

  if (!host) {
    return null;
  }

  if (OFFICIAL_DOMAINS.some((domain) => matchesDomain(host, domain))) {
    return 1;
  }

  if (INSTITUTION_DOMAINS.some((domain) => matchesDomain(host, domain))) {
    return 2;
  }

  if (IDENTIFIED_MEDIA_DOMAINS.some((domain) => matchesDomain(host, domain))) {
    return 3;
  }

  return null;
}

// Organização responsável pela fonte (para exigir duas fontes independentes).
function sourceOrganization(url) {
  const host = hostnameOf(url);

  if (!host) {
    return null;
  }

  const known = [...OFFICIAL_DOMAINS, ...INSTITUTION_DOMAINS, ...IDENTIFIED_MEDIA_DOMAINS]
    .filter((domain) => domain !== 'gov.br')
    .sort((a, b) => b.length - a.length)
    .find((domain) => matchesDomain(host, domain));

  if (known) {
    return known.replace(/^(einvestidor\.|valorinveste\.|g1\.)/, '');
  }

  if (matchesDomain(host, 'gov.br')) {
    const parts = host.split('.');

    return parts.length >= 3 ? parts.slice(-3).join('.') : host;
  }

  return host;
}

function looksLikeInjection(text) {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(String(text || '')));
}

function sanitizeSnippet(text, maxLength = 280) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// Percentuais citados no trecho, com a unidade (ao ano, do CDI ou simples),
// usados só para comparar fontes. Nunca viram instrução ou conclusão sozinhos.
function extractPercentages(text) {
  return Array.from(String(text || '').matchAll(/(?<![\d.,])(\d{1,3}(?:[,.]\d{1,2})?)\s*%\s*(a\.?\s?a\.?|ao ano|do cdi)?/gi))
    .map((match) => {
      const unitText = String(match[2] || '').toLowerCase();

      return {
        unit: unitText.includes('cdi') ? 'cdi' : unitText ? 'aa' : 'simples',
        value: Number(match[1].replace(',', '.')),
      };
    })
    .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.value <= 300);
}

// Filtra e classifica resultados. Retorna somente dados mínimos e seguros.
function vetResults(results) {
  const accepted = [];
  let suspicious = 0;
  let untrusted = 0;

  (results || []).forEach((result) => {
    const tier = sourceTier(result.url);
    const title = sanitizeSnippet(result.title, 120);
    const snippet = sanitizeSnippet(result.description);

    if (looksLikeInjection(`${result.title} ${result.description}`)) {
      suspicious += 1;
      return;
    }

    if (!tier) {
      untrusted += 1;
      return;
    }

    accepted.push({
      organization: sourceOrganization(result.url),
      percentages: extractPercentages(snippet),
      snippet,
      tier,
      title,
      url: result.url,
    });
  });

  return {
    accepted: accepted.sort((a, b) => a.tier - b.tier),
    suspicious,
    untrusted,
  };
}

module.exports = {
  IDENTIFIED_MEDIA_DOMAINS,
  INSTITUTION_DOMAINS,
  OFFICIAL_DOMAINS,
  extractPercentages,
  hostnameOf,
  looksLikeInjection,
  sanitizeSnippet,
  sourceOrganization,
  sourceTier,
  vetResults,
};
