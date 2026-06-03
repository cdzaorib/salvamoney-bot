'use strict';

const { normalizeText } = require('./text-utils');

const CATEGORIAS = {
  Alimentacao: [
    'acai',
    'açaí',
    'almoco',
    'almocei',
    'baccio',
    'cafe',
    'chocolate',
    'comida',
    'delivery',
    'doce',
    'hambúrguer',
    'hamburguer',
    'ifood',
    'jantar',
    'jantei',
    'lanche',
    'marmita',
    'mercado',
    'padaria',
    'pao de queijo',
    'pão de queijo',
    'pastel',
    'pizza',
    'restaurante',
    'salgado',
    'sorvete',
    'supermercado',
    'bebida',
    'bebidas',
    'churrasco',
    'feira',
    'hortifruti',
    'lanchonete',
    'rappi',
  ],
  Transporte: [
    'combustivel',
    'estacionamento',
    'gasolina',
    'onibus',
    'ônibus',
    'metro',
    'taxi',
    'táxi',
    'passagem',
    'posto',
    'uber',
    '99',
    'pedagio',
    'pedágio',
    'transporte',
  ],
  Saude: [
    'farmacia',
    'farmácia',
    'medico',
    'médico',
    'remedio',
    'remédio',
    'consulta',
    'exame',
    'hospital',
    'dentista',
    'plano',
    'unimed',
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
    'camiseta',
    'calca',
    'calça',
    'vestido',
    'roupa',
    'sapato',
    'tenis',
    'tênis',
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

function uniqueWords(words = []) {
  return Array.from(new Set(
    words
      .map((word) => normalizeText(word).trim())
      .filter((word) => word.length >= 2)
  ));
}

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

function normalizeCategoryName(value) {
  const text = String(value || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text
    .split(/\s+/)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ')
    .slice(0, 40);
}

function normalizeCustomCategories(value) {
  const entries = Array.isArray(value)
    ? value
    : Object.entries(value || {}).map(([id, category]) => ({
      id,
      ...(category && typeof category === 'object' ? category : { nome: category }),
    }));

  return entries
    .map((category) => {
      const name = normalizeCategoryName(category.nome || category.name || category.label || category.id);
      const words = Array.isArray(category.palavras || category.keywords)
        ? category.palavras || category.keywords
        : String(category.palavras || category.keywords || '')
          .split(/[,;]/);

      return {
        id: category.id || normalizeText(name).replace(/\W+/g, '-'),
        nome: name,
        palavras: uniqueWords([
          name,
          ...(words || []),
        ]),
      };
    })
    .filter((category) => category.nome && !CATEGORIAS_VALIDAS.includes(getCategoryKey(category.nome)));
}

function validCategories(customCategories = []) {
  return [
    ...CATEGORIAS_VALIDAS.map(getCategoryLabel),
    ...normalizeCustomCategories(customCategories).map((category) => category.nome),
  ];
}

function matchWords(normalizedText, words = []) {
  for (const word of words) {
    const normalizedWord = normalizeText(word);

    if (normalizedWord.length <= 3) {
      if (new RegExp(`(^|\\W)${escapeRE(normalizedWord)}(\\W|$)`, 'i').test(normalizedText)) {
        return true;
      }
    } else if (normalizedText.includes(normalizedWord)) {
      return true;
    }
  }

  return false;
}

function detectarCategoria(texto, customCategories = []) {
  const normalizedText = normalizeText(texto);

  for (const category of normalizeCustomCategories(customCategories)) {
    if (matchWords(normalizedText, category.palavras)) {
      return category.nome;
    }
  }

  for (const [category, words] of Object.entries(CATEGORIAS)) {
    if (matchWords(normalizedText, words)) {
      return getCategoryLabel(category);
    }
  }

  return 'Outros';
}

function categoriaFinal(desc, categoriaSugerida, customCategories = []) {
  const suggestedCategory = getCategoryKey(categoriaSugerida);
  const categories = validCategories(customCategories);
  const customCategory = normalizeCustomCategories(customCategories)
    .find((category) => normalizeText(category.nome) === normalizeText(categoriaSugerida));
  const suggestedLabel = CATEGORIAS_VALIDAS.includes(suggestedCategory)
    ? getCategoryLabel(suggestedCategory)
    : customCategory?.nome;
  const detectedCategory = detectarCategoria(desc, customCategories);

  if (detectedCategory !== 'Outros') {
    return detectedCategory;
  }

  if (!suggestedLabel || !categories.some((category) => normalizeText(category) === normalizeText(suggestedLabel))) {
    return detectedCategory;
  }

  return suggestedLabel;
}

module.exports = {
  categoriaFinal,
  detectarCategoria,
  normalizeCategoryName,
  normalizeCustomCategories,
  validCategories,
};
