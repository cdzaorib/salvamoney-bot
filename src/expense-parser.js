'use strict';

function parseMoney(raw) {
  const c = String(raw || '')
    .replace(/r\$/gi, '')
    .replace(/\s/g, '')
    .trim();

  let n = c;

  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(c)) {
    n = c.replace(/\./g, '').replace(',', '.');
  } else if (c.includes(',') && !c.includes('.')) {
    n = c.replace(',', '.');
  }

  const v = parseFloat(n);

  return isFinite(v) ? v : null;
}

function parsearGasto(texto) {
  const t = String(texto || '')
    .trim()
    .replace(/^(gastei|gasto|paguei|comprei|lancei|registrar|registre)\s*/i, '')
    .replace(/\b(reais?|conto|contos)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const mp = '(?:R\\$\\s*)?\\d{1,3}(?:\\.\\d{3})*(?:[,.]\\d{1,2})?|(?:R\\$\\s*)?\\d+(?:[,.]\\d{1,2})?';

  let m = t.match(new RegExp(`^(${mp})\\s+(.+)$`, 'i'));

  if (m) {
    const v = parseMoney(m[1]);
    const d = m[2].replace(/^(no|na|em)\s+/i, '').trim();

    if (v && v > 0 && d) {
      return { valor: v, desc: d };
    }
  }

  m = t.match(new RegExp(`^(.+?)\\s+(${mp})$`, 'i'));

  if (m) {
    const v = parseMoney(m[2]);
    const d = m[1].replace(/^(no|na|em)\s+/i, '').trim();

    if (v && v > 0 && d) {
      return { valor: v, desc: d };
    }
  }

  return null;
}

function parsearParcelamento(texto) {
  let m = String(texto || '').match(
    /(?:parcelei|comprei parcelado?)\s+([\d.,]+)\s+(.+?)\s+em\s+(\d+)\s*[xX]/i
  );

  if (m) {
    return {
      valor: parseMoney(m[1]),
      desc: m[2].trim(),
      parcelas: parseInt(m[3], 10),
    };
  }

  m = String(texto || '').match(
    /(?:parcelei|comprei parcelado?)\s+(.+?)\s+([\d.,]+)\s+em\s+(\d+)\s*[xX]/i
  );

  if (m) {
    return {
      valor: parseMoney(m[2]),
      desc: m[1].trim(),
      parcelas: parseInt(m[3], 10),
    };
  }

  m = String(texto || '').match(
    /(?:gastei|paguei|comprei)\s+([\d.,]+)\s+em\s+(\d+)\s*[xX]\s+(?:no|na|em)\s+(.+)/i
  );

  if (m) {
    return {
      valor: parseMoney(m[1]),
      desc: m[3].trim(),
      parcelas: parseInt(m[2], 10),
    };
  }

  return null;
}

module.exports = {
  parseMoney,
  parsearGasto,
  parsearParcelamento,
};
