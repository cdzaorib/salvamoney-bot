'use strict';

const {
  extrairNomeDoCriarCodigo,
  isCreateCodeCommand,
  isSwitchAccountCommand,
} = require('./commands');
const { normalizeText, sanitizeKey } = require('./text-utils');

function createAccountService({
  db,
  firebaseOps,
  saveSession,
  siteUrl,
  todayIso,
}) {
  const { get, ref, set } = firebaseOps;

  function gerarCodigoGrupo(nome = '') {
    const base = normalizeText(nome)
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase();

    const prefix = base || 'GRUPO';
    const numero = Math.floor(1000 + Math.random() * 9000);

    return `${prefix}${numero}`;
  }

  async function criarCodigoGrupo(phone, nomeInformado) {
    const nome = sanitizeKey(nomeInformado);

    if (!nome) {
      return `💰 *Criar código do SalvaMoney*

Para criar seu código, digite assim:

_criar código SEU NOME_

Exemplo:
_criar código Carlos_

Esse código serve para conectar você ao site e também para dividir contas com outras pessoas.

Se alguém entrar no mesmo código que você, essa pessoa conseguirá ver as contas divididas do grupo.

🌐 Site:
${siteUrl}`;
    }

    for (let i = 0; i < 8; i++) {
      const codigo = sanitizeKey(gerarCodigoGrupo(nome));
      const snap = await get(ref(db, `grupos/${codigo}`));

      if (!snap.exists()) {
        await set(ref(db, `grupos/${codigo}/info`), {
          criador: nome,
          criadoVia: 'whatsapp',
          criadoEm: new Date().toISOString(),
        });

        await saveSession(phone, {
          user: nome,
          group: codigo,
          updatedAt: todayIso(),
        });

        return `✅ Código criado com sucesso!

👤 Nome: *${nome}*
🔑 Código do grupo: *${codigo}*

Para outra pessoa entrar no mesmo grupo, ela deve mandar:
_entrar NOME ${codigo}_

Esse código serve para vincular sua conta ao site e também para dividir contas com outras pessoas.

Se uma pessoa estiver no mesmo código que você, as contas divididas desse grupo ficarão visíveis para ela.

🌐 Ver no site:
${siteUrl}`;
      }
    }

    return 'Não consegui gerar um código agora. Tente novamente em alguns segundos.';
  }

  async function processarComandoConta({ phone, texto, sessao }) {
    if (isCreateCodeCommand(texto)) {
      const nome = extrairNomeDoCriarCodigo(texto);

      return await criarCodigoGrupo(phone, nome);
    }

    const matchConta = texto.match(
      /^(entrar|(?:trocar|mudar)(?:\s+de)?\s+conta)\s+(.+)\s+([A-Za-z0-9_-]+)$/i
    );

    if (isSwitchAccountCommand(texto) && !matchConta) {
      const contaAtual = sessao
        ? `Conta atual: *${sessao.user}* | Grupo: *${sessao.group}*\n\n`
        : '';

      return `${contaAtual}Para trocar de conta, digite:
_trocar conta SEU NOME CODIGODOGRUPO_

Exemplo:
_trocar conta Ana CASA2024_

Você também pode usar:
_entrar SEU NOME CODIGODOGRUPO_`;
    }

    if (!matchConta) {
      return null;
    }

    const isTroca = isSwitchAccountCommand(matchConta[1]);
    const user = sanitizeKey(matchConta[2]);
    const group = sanitizeKey(matchConta[3].toUpperCase());

    if (!user || !group) {
      return isTroca
        ? '❌ Use: _trocar conta SEU NOME CODIGODOGRUPO_'
        : '❌ Use: _entrar SEU NOME CODIGODOGRUPO_';
    }

    const snap = await get(ref(db, `grupos/${group}`));

    if (!snap.exists()) {
      return `❌ Grupo *${group}* não encontrado.

Verifique se o código está certo.

Se você ainda não tem um código, digite:
_criar código SEU NOME_

Exemplo:
_criar código Carlos_`;
    }

    await saveSession(phone, {
      user,
      group,
      updatedAt: todayIso(),
    });

    const mensagemConta = isTroca
      ? `✅ Conta trocada! Agora você está como *${user}* no grupo *${group}*.`
      : `✅ Pronto! Você entrou como *${user}* no grupo *${group}*.`;

    return `${mensagemConta}

Agora você pode registrar gastos pelo WhatsApp.

Exemplos:
_"almocei e gastei 35"_
_"paguei 150 de mercado"_
_"quanto gastei esse mês?"_

🔑 Esse código também serve para dividir contas.
Se outra pessoa entrar no mesmo código, as contas divididas do grupo ficarão visíveis para ela.

🌐 Ver no site:
${siteUrl}`;
  }

  return {
    processarComandoConta,
  };
}

module.exports = {
  createAccountService,
};
