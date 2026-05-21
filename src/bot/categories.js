'use strict';

const { normalizeText } = require('./text-utils');

const CATEGORIAS = {
  Alimentacao: [
    'supermercado',
    'restaurante',
    'hamburguer',
    'hamburguer',
    'mercado',
    'comida',
    'almoco',
    'almoco',
    'almocei',
    'jantar',
    'jantei',
    'cafe',
    'cafe',
    'lanche',
    'ifood',
    'pizza',
    'padaria',
    'acai',
    'acai',
    'delivery',
    'rappi',
    'marmita',
    'hortifruti',
    'feira',
    'pastel',
    'sorvete',
    'churrasco',
    'bebida',
    'bebidas',
    'restaurante',
    'lanchonete',
  ],
  Transporte: [
    'combustivel',
    'combustivel',
    'estacionamento',
    'gasolina',
    'onibus',
    'onibus',
    'metro',
    'metro',
    'taxi',
    'taxi',
    'passagem',
    'posto',
    'uber',
    '99',
    'pedagio',
    'pedagio',
    'transporte',
  ],
  Saude: [
    'farmacia',
    'farmacia',
    'medico',
    'medico',
    'remedio',
    'remedio',
    'consulta',
    'exame',
    'hospital',
    'dentista',
    'plano',
    'unimed',
    'saude',
    'saude',
  ],
  Lazer: [
    'cinema',
    'show',
    'teatro',
    'jogo',
    'netflix',
    'spotify',
    'disney',
    'prime',
    'youtube',
    'bar',
    'balada',
    'festa',
    'ingresso',
    'parque',
    'lazer',
  ],
  Moradia: [
    'condominio',
    'condominio',
    'aluguel',
    'internet',
    'energia',
    'luz',
    'agua',
    'agua',
    'gas',
    'gas',
    'iptu',
    'wifi',
    'moradia',
    'casa',
  ],
  Educacao: [
    'faculdade',
    'apostila',
    'curso',
    'livro',
    'escola',
    'udemy',
    'aula',
    'educacao',
    'educacao',
  ],
  Roupas: [
    'camisa',
    'calca',
    'calca',
    'vestido',
    'roupa',
    'sapato',
    'tenis',
    'tenis',
    'loja',
    'short',
    'blusa',
  ],
  Academia: [
    'musculacao',
    'musculacao',
    'academia',
    'pilates',
    'crossfit',
    'gym',
    'creatina',
    'whey',
  ],
};

const CATEGORIAS_VALIDAS = [
  'Alimentacao',
  'Moradia',
  'Transporte',
  'Saude',
  'Lazer',
  'Educacao',
  'Roupas',
  'Academia',
  'Outros',
];

const CATEGORIA_LABELS = {
  Alimentacao: 'Alimentação',
  Educacao: 'Educação',
  Saude: 'Saúde',
};

function escapeRE(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCategoryLabel(category) {
  return CATEGORIA_LABELS[category] || category;
}

function getCategoryKey(category) {
  return Object.entries(CATEGORIA_LABELS)
    .find(([, label]) => label === category)?.[0] || category;
}

function detectarCategoria(texto) {
  const normalizedText = normalizeText(texto);

  for (const [category, words] of Object.entries(CATEGORIAS)) {
    for (const word of words) {
      const normalizedWord = normalizeText(word);

      if (normalizedWord.length <= 3) {
        if (new RegExp(`(^|\\W)${escapeRE(normalizedWord)}(\\W|$)`, 'i').test(normalizedText)) {
          return getCategoryLabel(category);
        }
      } else if (normalizedText.includes(normalizedWord)) {
        return getCategoryLabel(category);
      }
    }
  }

  return 'Outros';
}

function categoriaFinal(desc, categoriaSugerida) {
  const suggestedCategory = getCategoryKey(categoriaSugerida);
  const suggestedLabel = CATEGORIAS_VALIDAS.includes(suggestedCategory)
    ? getCategoryLabel(suggestedCategory)
    : 'Outros';
  const detectedCategory = detectarCategoria(desc);

  if (suggestedLabel === 'Outros' && detectedCategory !== 'Outros') {
    return detectedCategory;
  }

  if (!suggestedLabel || !CATEGORIAS_VALIDAS.includes(getCategoryKey(suggestedLabel))) {
    return detectedCategory;
  }

  return suggestedLabel;
}

module.exports = {
  categoriaFinal,
  detectarCategoria,
};
