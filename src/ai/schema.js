'use strict';

// Validador mínimo de esquema para ações estruturadas devolvidas pela IA.
// Propriedades desconhecidas são descartadas; tipos inválidos invalidam a ação.
function validateSchema(schema, value, path = '$') {
  const errors = [];

  function check(node, current, currentPath) {
    if (current === null || current === undefined) {
      if (node.nullable || node.optional) {
        return current ?? null;
      }

      errors.push(`${currentPath}: obrigatório`);
      return undefined;
    }

    if (node.type === 'object') {
      if (typeof current !== 'object' || Array.isArray(current)) {
        errors.push(`${currentPath}: objeto esperado`);
        return undefined;
      }

      const result = {};

      Object.entries(node.properties || {}).forEach(([key, child]) => {
        const required = (node.required || []).includes(key);

        if (!Object.hasOwn(current, key) || current[key] === undefined) {
          if (required) {
            errors.push(`${currentPath}.${key}: obrigatório`);
          }

          return;
        }

        const checked = check({ ...child, optional: !required || child.optional }, current[key], `${currentPath}.${key}`);

        if (checked !== undefined) {
          result[key] = checked;
        }
      });

      return result;
    }

    if (node.type === 'array') {
      if (!Array.isArray(current)) {
        errors.push(`${currentPath}: lista esperada`);
        return undefined;
      }

      if (node.maxItems !== undefined && current.length > node.maxItems) {
        errors.push(`${currentPath}: itens demais`);
        return undefined;
      }

      return current.map((item, index) => check(node.items || {}, item, `${currentPath}[${index}]`));
    }

    if (node.type === 'string') {
      if (typeof current !== 'string') {
        errors.push(`${currentPath}: texto esperado`);
        return undefined;
      }

      if (node.enum && !node.enum.includes(current)) {
        errors.push(`${currentPath}: valor não permitido`);
        return undefined;
      }

      if (node.pattern && !node.pattern.test(current)) {
        errors.push(`${currentPath}: formato inválido`);
        return undefined;
      }

      return node.maxLength ? current.slice(0, node.maxLength) : current;
    }

    if (node.type === 'number' || node.type === 'integer') {
      const number = typeof current === 'string' && current.trim() !== '' ? Number(current) : current;

      if (typeof number !== 'number' || !Number.isFinite(number)) {
        errors.push(`${currentPath}: número esperado`);
        return undefined;
      }

      if (node.type === 'integer' && !Number.isInteger(number)) {
        errors.push(`${currentPath}: inteiro esperado`);
        return undefined;
      }

      if (node.minimum !== undefined && number < node.minimum) {
        errors.push(`${currentPath}: abaixo do mínimo`);
        return undefined;
      }

      if (node.maximum !== undefined && number > node.maximum) {
        errors.push(`${currentPath}: acima do máximo`);
        return undefined;
      }

      return number;
    }

    if (node.type === 'boolean') {
      if (typeof current !== 'boolean') {
        errors.push(`${currentPath}: booleano esperado`);
        return undefined;
      }

      return current;
    }

    return undefined;
  }

  const result = check(schema, value, path);

  return {
    errors,
    valid: errors.length === 0,
    value: errors.length === 0 ? result : null,
  };
}

module.exports = {
  validateSchema,
};
