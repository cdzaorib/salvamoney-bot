'use strict';

// Resumo de erro seguro para logs: sem corpo de resposta, mensagem, telefone ou tag.
function errorSummary(err) {
  return {
    code: err?.code || null,
    name: err?.name || 'Error',
    status: err?.response?.status || err?.status || null,
  };
}

module.exports = {
  errorSummary,
};
