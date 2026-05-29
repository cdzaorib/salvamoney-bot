'use strict';

function isCreateCodeCommand(message = '') {
  return /^(criar|gerar|novo)\s+(codigo|código)\b/i.test(message);
}

function isSwitchAccountCommand(message = '') {
  return /^(trocar|mudar)(\s+de)?\s+conta\b/i.test(message);
}

function extrairNomeDoCriarCodigo(message = '') {
  return message
    .replace(/^(criar|gerar|novo)\s+(codigo|código)\s*/i, '')
    .trim();
}

function isHelpCommand(message) {
  return ['ajuda', 'help', 'oi', 'olá', 'ola', 'menu', 'start', '/start'].includes(message);
}

function isSummaryCommand(message) {
  return ['resumo', 'extrato', 'total'].includes(message) ||
    /quanto\s+(eu\s+)?gastei|gastos?\s+do\s+m[eê]s/i.test(message);
}

function isTodayCommand(message) {
  return ['hoje', 'resumo hoje', 'gastos hoje', 'gastei hoje'].includes(message) ||
    /quanto\s+(eu\s+)?gastei\s+hoje/i.test(message);
}

function isListCommand(message) {
  return ['lista', 'listar', 'ultimos gastos', 'últimos gastos'].includes(message) ||
    /^(listar|mostrar|ver)\s+(meus\s+)?gastos\b/i.test(message);
}

function isDeleteCommand(message) {
  return /^(apagar|deletar|excluir|remover|desfazer|cancelar)\b/i.test(message) ||
    /\b(errado|lancei errado|valor errado|já tinha pago|ja tinha pago|duplicado|repetido)\b/i.test(message);
}

function isParcelamento(message) {
  return /parcelei|parcelado|comprei parcelado|\bem\s+\d+\s*x\b/i.test(message);
}

module.exports = {
  extrairNomeDoCriarCodigo,
  isCreateCodeCommand,
  isDeleteCommand,
  isHelpCommand,
  isListCommand,
  isParcelamento,
  isSummaryCommand,
  isSwitchAccountCommand,
  isTodayCommand,
};
