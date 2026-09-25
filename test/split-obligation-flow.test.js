'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProactiveScheduler } = require('../src/bot/proactive-scheduler');
const { USERS, createHarness, friendsSeed } = require('./helpers/assistant-harness');

function sentCharges(harness, user = USERS.ana) {
  return Object.values(harness.userValue(user, 'cobrancasEnviadas') || {});
}

function receivedCharges(harness, user = USERS.carlos) {
  return Object.values(harness.userValue(user, 'cobrancasRecebidas') || {});
}

function allExpenses(harness, user) {
  return Object.values(harness.userValue(user, 'gastos') || {}).flatMap((month) => Object.values(month));
}

async function createPixSplit(harness, text = 'dividir 150 do almoço no pix com Carlos') {
  await harness.say(USERS.ana, text);
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();
}

test('divisão: prévia completa e nada é gravado antes da confirmação', async () => {
  const harness = createHarness();
  const preview = await harness.say(USERS.ana, 'dividir 150 do almoço no pix com Carlos');

  assert.match(preview, /Almoço — total R\$ 150,00/);
  assert.match(preview, /Participantes: você, Carlos/);
  assert.match(preview, /Você: R\$ 75,00 \(sua parte\)/);
  assert.match(preview, /Carlos: R\$ 75,00 a cobrar/);
  assert.match(preview, /Pagamento: Pix/);
  assert.match(preview, /Seu lançamento líquido: R\$ 75,00/);
  assert.deepEqual(sentCharges(harness), []);
  assert.deepEqual(allExpenses(harness, USERS.ana), []);
});

test('divisão: confirmação grava tudo de forma atômica (gasto líquido, duas cópias e gasto vinculado)', async () => {
  const harness = createHarness();
  const updatesBefore = harness.firebase.updates.length;

  await harness.say(USERS.ana, 'dividir 150 do almoço no pix com Carlos');
  const reply = await harness.say(USERS.ana, 'sim');
  const [sent] = sentCharges(harness);
  const [received] = receivedCharges(harness);
  const payerExpense = allExpenses(harness, USERS.ana).find((expense) => expense.origem === 'divisao');
  const linked = allExpenses(harness, USERS.carlos).find((expense) => expense.origem === 'cobranca');
  const splitWrites = harness.firebase.updates.slice(updatesBefore).filter((item) =>
    Object.keys(item.value).some((key) => key.includes('/divisoes/')));

  assert.match(reply, /Divisão registrada/);
  assert.equal(splitWrites.length, 1);
  assert.equal(sent.id, received.id);
  assert.equal(sent.estado, 'aguardando_aceite');
  assert.equal(sent.status, 'pendente');
  assert.equal(sent.valorCobrado, 75);
  assert.equal(sent.valorOriginal, 75);
  assert.equal(payerExpense.value, 75);
  assert.equal(payerExpense.valorBruto, 150);
  assert.equal(linked.pendente, true);
  assert.equal(linked.value, 75);
  assert.equal(sent.phoneOrigem, undefined);
  assert.equal(sent.phoneDestino, undefined);
});

test('divisão: sem meio informado pergunta Pix/débito/cartão e oferece o cartão padrão', async () => {
  const harness = createHarness();
  const question = await harness.say(USERS.ana, 'dividir 150 com Carlos');

  assert.match(question, /1\. Pix/);
  assert.match(question, /2\. Débito/);
  assert.match(question, /3\. Cartão \(padrão: Nubank\)/);
  assert.match(question, /4\. Cartão Inter/);

  const cardQuestion = await harness.say(USERS.ana, '3');

  assert.match(cardQuestion, /Qual cartão\?/);
  assert.match(cardQuestion, /padrão/);

  const preview = await harness.say(USERS.ana, 'padrão');

  assert.match(preview, /Cartão Nubank · fecha ~03\/10\/2026 · vence 10\/10\/2026/);
  await harness.say(USERS.ana, 'sim');

  const [charge] = sentCharges(harness);

  assert.equal(charge.estado, 'aguardando_fechamento');
  assert.equal(charge.fechamentoPrevisto, '2026-10-03');
  assert.equal(charge.vencimento, '2026-10-10');
  assert.equal(charge.cartaoId, 'c_nubank');
});

test('divisão: débito e frase explícita com cartão pulam perguntas mas mantêm a prévia', async () => {
  const harness = createHarness();
  const debit = await harness.say(USERS.ana, 'dividir 60 no débito com Carlos');

  assert.match(debit, /Pagamento: Débito/);
  assert.match(debit, /Responda SIM/);
  await harness.say(USERS.ana, 'cancelar');

  const card = await harness.say(USERS.ana, 'dividir 150 no Inter com Carlos');

  assert.match(card, /Cartão Inter · fecha ~20\/10\/2026 · vence 28\/10\/2026/);
  assert.match(card, /Responda SIM/);
});

test('parcelamento: acerto por parcela gera cobranças ligadas aos ciclos das faturas', async () => {
  const harness = createHarness();

  assert.match(await harness.say(USERS.ana, 'dividir 1000 em 3x no Nubank com Carlos'), /Por parcela \(padrão\)/);
  const preview = await harness.say(USERS.ana, '1');

  assert.match(preview, /3x — acerto por parcela/);
  await harness.say(USERS.ana, 'sim');

  const charges = sentCharges(harness).sort((a, b) => a.parcelaNum - b.parcelaNum);

  assert.deepEqual(charges.map((charge) => charge.valorCobrado), [166.67, 166.67, 166.66]);
  assert.deepEqual(charges.map((charge) => charge.fechamentoPrevisto), ['2026-10-03', '2026-11-03', '2026-12-03']);
  assert.ok(charges.every((charge) => charge.grupoParcelasId && charge.grupoParcelasId === charges[0].grupoParcelasId));
  assert.ok(charges.every((charge) => charge.divisaoId === charges[0].divisaoId && charge.cartaoId === 'c_nubank'));

  const payerInstallments = allExpenses(harness, USERS.ana).filter((expense) => expense.divisaoId);

  assert.equal(payerInstallments.length, 3);
  assert.equal(payerInstallments.reduce((sum, expense) => sum + expense.value, 0), 500);
});

test('parcelamento: acerto pelo total gera uma única cobrança', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 1000 em 3x no Nubank com Carlos');
  await harness.say(USERS.ana, 'pelo total');
  await harness.say(USERS.ana, 'sim');

  const charges = sentCharges(harness);

  assert.equal(charges.length, 1);
  assert.equal(charges[0].valorCobrado, 500);
});

test('pagamento: devedor informa "paguei", credor confirma "recebi" e só então encerra', async () => {
  const harness = createHarness();

  await createPixSplit(harness);

  const informed = await harness.say(USERS.carlos, 'paguei');
  const [creditorNotice] = harness.takeSent();

  assert.match(informed, /informado/);
  assert.equal(receivedCharges(harness)[0].estado, 'pagamento_informado');
  assert.equal(creditorNotice.phone, USERS.ana.phone);
  assert.match(creditorNotice.message, /recebi cobrança 1/);

  const confirmed = await harness.say(USERS.ana, 'recebi cobrança 1');
  const [charge] = sentCharges(harness);
  const linked = allExpenses(harness, USERS.carlos).find((expense) => expense.cobrancaId === charge.id);

  assert.match(confirmed, /quitada/);
  assert.equal(charge.estado, 'paga');
  assert.equal(charge.status, 'paga');
  assert.equal(charge.valorPago, 75);
  assert.equal(linked.pendente, false);
  assert.equal(linked.cobrancaStatus, 'paga');
});

test('pagamento parcial preserva valor original, total pago e saldo restante', async () => {
  const harness = createHarness();

  await createPixSplit(harness);
  assert.match(await harness.say(USERS.carlos, 'paguei R$ 30'), /Responda SIM/);
  await harness.say(USERS.carlos, 'sim');
  const partial = await harness.say(USERS.ana, 'recebi cobrança 1');
  let [charge] = sentCharges(harness);

  assert.match(partial, /Original R\$ 75,00 · pago R\$ 30,00 · saldo R\$ 45,00/);
  assert.equal(charge.estado, 'pagamento_parcial');
  assert.equal(charge.valorOriginal, 75);
  assert.equal(charge.valorPago, 30);

  await harness.say(USERS.carlos, 'paguei cobrança 1');
  await harness.say(USERS.ana, 'recebi cobrança 1');
  [charge] = sentCharges(harness);

  assert.equal(charge.estado, 'paga');
  assert.equal(charge.valorPago, 75);
  assert.equal(Object.keys(charge.pagamentos).length, 2);
});

test('pagamento: "não recebi" devolve a cobrança ao estado anterior e avisa o devedor', async () => {
  const harness = createHarness();

  await createPixSplit(harness);
  await harness.say(USERS.carlos, 'paguei');
  harness.takeSent();

  assert.match(await harness.say(USERS.ana, 'não recebi cobrança 1'), /ainda não chegou/);
  assert.equal(sentCharges(harness)[0].estado, 'aguardando_aceite');
  assert.match(harness.takeSent()[0].message, /ainda não identificou/);
});

test('recebimento espontâneo ("recebi do Carlos") mostra confirmação antes de encerrar', async () => {
  const harness = createHarness();

  await createPixSplit(harness);

  const preview = await harness.say(USERS.ana, 'recebi do Carlos');

  assert.match(preview, /Confirmar recebimento de R\$ 75,00 de Carlos/);
  assert.equal(sentCharges(harness)[0].estado, 'aguardando_aceite');
  assert.match(await harness.say(USERS.ana, 'sim'), /quitada/);
  assert.equal(sentCharges(harness)[0].estado, 'paga');
});

test('contestação: sugestão não altera dados; credor aprova e reenvia', async () => {
  const harness = createHarness();

  await createPixSplit(harness);

  const contest = await harness.say(USERS.carlos, 'contestar cobrança 1 valor 50 motivo só comi salada');

  assert.match(contest, /Nada muda até quem cobrou aprovar/);

  let [charge] = sentCharges(harness);

  assert.equal(charge.estado, 'contestada');
  assert.equal(charge.valorCobrado, 75);
  assert.equal(charge.contestacao.valorSugerido, 50);
  assert.match(harness.takeSent()[0].message, /aprovar sugestão 1/);
  assert.match(await harness.say(USERS.ana, 'aprovar sugestão 1'), /R\$ 75,00 → R\$ 50,00/);
  assert.equal(sentCharges(harness)[0].valorCobrado, 75);
  await harness.say(USERS.ana, 'sim');
  [charge] = sentCharges(harness);

  assert.equal(charge.valorCobrado, 50);
  assert.equal(charge.valorOriginal, 75);
  assert.equal(charge.estado, 'aguardando_aceite');
  assert.equal(Object.values(charge.historicoValores)[0].de, 75);
});

test('recusa com motivo e aceite de cobrança', async () => {
  const harness = createHarness();

  await createPixSplit(harness);
  assert.match(await harness.say(USERS.carlos, 'recusar cobrança 1 motivo não participei'), /recusada/);
  assert.equal(sentCharges(harness)[0].estado, 'recusada');
  assert.equal(sentCharges(harness)[0].motivoRecusa, 'não participei');
  assert.match(harness.takeSent()[0].message, /Motivo: não participei/);

  await createPixSplit(harness, 'dividir 40 no pix com Carlos');
  assert.match(await harness.say(USERS.carlos, 'aceitar cobrança 1'), /aceita/);
  assert.equal(sentCharges(harness).find((charge) => charge.valorCobrado === 20).estado, 'aceita');
});

test('cancelamento pelo credor exige confirmação', async () => {
  const harness = createHarness();

  await createPixSplit(harness);
  assert.match(await harness.say(USERS.ana, 'cancelar cobrança 1'), /Responda SIM/);
  assert.equal(sentCharges(harness)[0].estado, 'aguardando_aceite');
  await harness.say(USERS.ana, 'sim');
  assert.equal(sentCharges(harness)[0].estado, 'cancelada');
});

test('lembrete manual: no máximo um a cada 24 horas e respeita silêncio', async () => {
  const harness = createHarness();

  await createPixSplit(harness);
  assert.match(await harness.say(USERS.ana, 'cobrar novamente Carlos'), /Lembrete enviado/);

  const [reminder] = harness.takeSent();

  assert.match(reminder.message, /Almoço — saldo R\$ 75,00/);
  assert.match(reminder.message, /paguei cobrança 1 · contestar cobrança 1 · silenciar lembretes cobrança 1/);
  assert.match(await harness.say(USERS.ana, 'cobrar novamente Carlos'), /últimas 24 horas/);
  assert.equal(harness.takeSent().length, 0);

  harness.clock.now = new Date('2026-09-26T16:00:00.000Z');
  await harness.say(USERS.carlos, 'silenciar lembretes cobrança 1');
  assert.match(await harness.say(USERS.ana, 'cobrar novamente Carlos'), /silenciou os lembretes/);
});

test('scheduler: avisa no fechamento, lembra no vencimento uma vez e para após pagamento', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 150 no Nubank com Carlos');
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();

  const scheduler = createProactiveScheduler({
    db: {},
    enabled: true,
    firebaseOps: harness.firebase.ops,
    now: () => harness.clock.now,
    obligationService: harness.service.obligationService,
    timeZone: 'America/Sao_Paulo',
  });

  harness.clock.now = new Date('2026-10-03T13:00:00.000Z');
  await scheduler.runOnce();

  const closing = harness.takeSent();

  assert.equal(sentCharges(harness)[0].estado, 'disponivel_pagamento');
  assert.equal(closing.length, 2);
  assert.ok(closing.some((item) => item.phone === USERS.carlos.phone && /disponível para pagamento/.test(item.message)));
  assert.ok(closing.some((item) => item.phone === USERS.ana.phone && /valores a receber/.test(item.message)));

  await scheduler.runOnce();
  assert.equal(harness.takeSent().length, 0);

  harness.clock.now = new Date('2026-10-10T13:00:00.000Z');
  await scheduler.runOnce();
  assert.match(harness.takeSent()[0].message, /vencimento/);
  await scheduler.runOnce();
  assert.equal(harness.takeSent().length, 0);

  harness.clock.now = new Date('2026-10-15T13:00:00.000Z');
  await scheduler.runOnce();
  assert.equal(harness.takeSent().length, 0, 'depois do vencimento os lembretes são manuais');
});

test('scheduler: não envia fora do horário e nada após pagamento confirmado', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 150 no Nubank com Carlos');
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();

  const scheduler = createProactiveScheduler({
    db: {},
    enabled: true,
    firebaseOps: harness.firebase.ops,
    now: () => harness.clock.now,
    obligationService: harness.service.obligationService,
  });

  harness.clock.now = new Date('2026-10-03T02:00:00.000Z');
  assert.equal((await scheduler.runOnce()).reason, 'fora_do_horario');

  await harness.say(USERS.carlos, 'paguei cobrança 1');
  await harness.say(USERS.ana, 'recebi cobrança 1');
  harness.takeSent();
  harness.clock.now = new Date('2026-10-10T13:00:00.000Z');
  await scheduler.runOnce();
  assert.equal(harness.takeSent().length, 0);
});

test('fechamento corrigido ("fatura fechou hoje") libera a cobrança e notifica os dois', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 150 no Nubank com Carlos');
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();

  const reply = await harness.say(USERS.ana, 'minha fatura Nubank fechou hoje');
  const notices = harness.takeSent();

  assert.match(reply, /1 cobrança\(s\).*disponíveis/);
  assert.equal(sentCharges(harness)[0].estado, 'disponivel_pagamento');
  assert.equal(sentCharges(harness)[0].fechamentoPrevisto, '2026-09-25');
  assert.equal(notices.length, 2);
  assert.match(await harness.say(USERS.carlos, 'cobranças'), /A pagar \(R\$ 75,00\)/);
});

test('compatibilidade: cobrança antiga (só status) aparece e aceita o fluxo novo', async () => {
  const seed = friendsSeed();
  const legacy = {
    createdAt: '2026-09-01T10:00:00.000Z',
    descricao: 'Almoço antigo',
    id: 'cob_legacy',
    nomeDestino: 'Carlos Lima',
    nomeOrigem: 'Ana Souza',
    phoneDestino: USERS.carlos.phone,
    phoneOrigem: USERS.ana.phone,
    status: 'pendente',
    tagDestino: '222222',
    tagOrigem: '111111',
    valorCobrado: 40,
    valorTotal: 80,
  };

  seed.grupos.SALVAMONEY.usuarios[111111].cobrancasEnviadas = { cob_legacy: legacy };
  seed.grupos.SALVAMONEY.usuarios[222222].cobrancasRecebidas = { cob_legacy: legacy };

  const harness = createHarness({ seed });

  assert.match(await harness.say(USERS.carlos, 'cobranças'), /Almoço antigo — R\$ 40,00 para Ana — aguardando aceite/);
  await harness.say(USERS.carlos, 'aceitar cobrança 1');
  assert.equal(harness.userValue(USERS.ana, 'cobrancasEnviadas/cob_legacy/estado'), 'aceita');
  assert.equal(harness.userValue(USERS.ana, 'cobrancasEnviadas/cob_legacy/status'), 'aceita');
  assert.equal(harness.userValue(USERS.carlos, 'cobrancasRecebidas/cob_legacy/status'), 'aceita');
});

test('relatório: separa gasto líquido, a receber, a pagar, confirmações, parciais e compartilhados', async () => {
  const seed = friendsSeed();
  const monthKey = '2026_8';

  seed.grupos.SALVAMONEY.usuarios[111111].gastos = {
    [monthKey]: {
      legado: { cat: 'Alimentação', cobranca: true, cobrancaId: 'cob_old', date: '2026-09-02', desc: 'Jantar', value: 100 },
      mercado: { cat: 'Alimentação', date: '2026-09-03', desc: 'Mercado', value: 50 },
    },
  };
  seed.grupos.SALVAMONEY.usuarios[111111].cobrancasEnviadas = {
    cob_old: { id: 'cob_old', status: 'paga', tagDestino: '222222', tagOrigem: '111111', valorCobrado: 50 },
  };

  const harness = createHarness({ seed });

  await createPixSplit(harness, 'dividir 90 no pix com Carlos');
  await harness.say(USERS.bia, 'cobrar 20 da Ana');
  await harness.say(USERS.bia, 'sim');
  await harness.say(USERS.carlos, 'paguei R$ 10');
  await harness.say(USERS.carlos, 'sim');

  const report = await harness.say(USERS.ana, 'balanço');

  assert.match(report, /Gastos pessoais líquidos: R\$ 145,00/);
  assert.match(report, /Valores a receber: R\$ 0,00 \(0\)/);
  assert.match(report, /Valores a pagar: R\$ 20,00 \(1\)/);
  assert.match(report, /Pagamentos aguardando confirmação: R\$ 10,00 \(1\)/);
  assert.match(report, /Gastos compartilhados no mês: total R\$ 190,00 · sua parte R\$ 95,00/);
});

test('privacidade entre amigos: cada um vê só as operações em que participa', async () => {
  const harness = createHarness();

  await createPixSplit(harness, 'dividir 90 no pix com Carlos');
  await createPixSplit(harness, 'dividir 60 do cinema no pix com Bia');

  const carlosView = await harness.say(USERS.carlos, 'cobranças');
  const biaView = await harness.say(USERS.bia, 'cobranças');

  assert.doesNotMatch(carlosView, /Cinema/);
  assert.match(biaView, /Cinema/);
  assert.doesNotMatch(biaView, /R\$ 45,00/);
  assert.match(await harness.say(USERS.ana, 'cobranças com Bia'), /Cinema/);
  assert.doesNotMatch(await harness.say(USERS.ana, 'cobranças com Bia'), /R\$ 45,00/);
});

test('scheduler: consulta antes do scheduler não faz o aviso de fechamento se perder', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'dividir 150 no Nubank com Carlos');
  await harness.say(USERS.ana, 'sim');
  harness.takeSent();
  harness.clock.now = new Date('2026-10-03T13:00:00.000Z');

  assert.match(await harness.say(USERS.carlos, 'cobranças'), /disponível para pagamento/);
  assert.equal(harness.takeSent().length, 0);

  const scheduler = createProactiveScheduler({
    db: {},
    enabled: true,
    firebaseOps: harness.firebase.ops,
    now: () => harness.clock.now,
    obligationService: harness.service.obligationService,
  });

  await scheduler.runOnce();
  assert.equal(harness.takeSent().length, 2);
  await scheduler.runOnce();
  assert.equal(harness.takeSent().length, 0);
});
