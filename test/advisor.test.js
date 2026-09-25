'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProfileUpdate } = require('../src/bot/advisor-service');
const { buildPlan, incomeInfo, missingForPlan } = require('../src/bot/financial-planner');
const { USERS, createHarness } = require('./helpers/assistant-harness');

test('renda variável usa faixa conservadora (mínimo informado ou 80% da média)', () => {
  assert.equal(incomeInfo({ rendaMedia: 5000, rendaMinima: 3500, tipoRenda: 'variavel' }).conservadora, 3500);
  assert.equal(incomeInfo({ rendaMedia: 5000, tipoRenda: 'variavel' }).conservadora, 4000);
  assert.equal(incomeInfo({ rendaMensal: 3000 }).conservadora, 3000);

  const parsed = parseProfileUpdate('ganho entre 2000 e 4000');

  assert.deepEqual(parsed.fields, { rendaMedia: 3000, rendaMinima: 2000, tipoRenda: 'variavel' });
});

test('reserva padrão de 6 meses de essenciais, ajustável entre 3 e 12', () => {
  const plan = buildPlan({ despesasEssenciais: 2000, reservaAtual: 3000, rendaMensal: 5000 });

  assert.equal(plan.reservaMeses, 6);
  assert.equal(plan.reservaMeta, 12000);
  assert.equal(plan.reservaFalta, 9000);
  assert.equal(buildPlan({ despesasEssenciais: 2000, reservaMeses: 12, rendaMensal: 5000 }).reservaMeta, 24000);
  assert.equal(buildPlan({ despesasEssenciais: 2000, reservaMeses: 20, rendaMensal: 5000 }).reservaMeses, 6);
  assert.match(parseProfileUpdate('quero reserva de 15 meses').message, /entre 3 e 12/);
  assert.deepEqual(parseProfileUpdate('reserva de 3 meses').fields, { reservaMeses: 3 });
});

test('dívida cara vem antes da reserva e dos investimentos (cálculo determinístico)', () => {
  const plan = buildPlan({
    despesasEssenciais: 2000,
    dividas: { d1: { jurosMensal: 12, saldo: 3000, tipo: 'cartao' }, d2: { jurosMensal: 1, saldo: 20000, tipo: 'financiamento', parcela: 500 } },
    reservaAtual: 0,
    rendaMensal: 5000,
  });

  assert.equal(plan.dividasCaras.length, 1);
  assert.equal(plan.dividasCarasTotal, 3000);
  assert.equal(plan.sobraMensal, 2500);
  assert.deepEqual(plan.alocacao.dividas, { percentual: 60, valor: 1500 });
  assert.deepEqual(plan.alocacao.reserva, { percentual: 30, valor: 750 });

  const debt = parseProfileUpdate('dívida cartão 2000 juros 240% ao ano');

  assert.equal(debt.divida.tipo, 'cartao');
  assert.ok(debt.divida.jurosMensal > 10 && debt.divida.jurosMensal < 11);
});

test('50/30/20 é só referência: percentuais calculados pela situação real', () => {
  const plan = buildPlan({ despesasEssenciais: 3300, dividasInformadas: true, reservaAtual: 30000, rendaMensal: 5000 });

  assert.equal(plan.essenciaisPct, 66);
  assert.equal(plan.sobraPct, 34);
  assert.deepEqual(Object.keys(plan.alocacao).sort(), ['investimentos', 'livre']);
});

test('onboarding progressivo pergunta só o próximo dado necessário e monta o plano', async () => {
  const harness = createHarness();

  assert.match(await harness.say(USERS.ana, 'orientação financeira'), /renda mensal/);
  assert.match(await harness.say(USERS.ana, '4000'), /essencial/);
  assert.match(await harness.say(USERS.ana, 'R$ 2.000'), /dívidas/);
  assert.match(await harness.say(USERS.ana, 'dívida cheque especial 1500 juros 8% ao mês'), /reserva/);

  const plan = await harness.say(USERS.ana, 'não tenho reserva');

  assert.match(plan, /1\) Essenciais: R\$ 2\.000,00 \(50% da renda considerada\)/);
  assert.match(plan, /2\) Dívidas caras: R\$ 1\.500,00/);
  assert.match(plan, /3\) Reserva de emergência \(6 meses de essenciais\)/);
  assert.match(plan, /5\) Investimentos: depois das etapas anteriores/);
  assert.match(plan, /não é recomendação personalizada/);
  assert.deepEqual(missingForPlan(harness.userValue(USERS.ana, 'perfilFinanceiro')), null);
});

test('perfil de investidor pede revisão após 6 meses ou mudança importante', async () => {
  const old = buildPlan({ despesasEssenciais: 1000, perfilInvestidorAtualizadoEm: '2026-01-01T00:00:00.000Z', rendaMensal: 3000 }, {
    now: new Date('2026-09-25T00:00:00.000Z'),
  });

  assert.equal(old.revisaoPerfilPendente, true);

  const harness = createHarness();

  await harness.say(USERS.ana, 'sou moderado');
  assert.equal(harness.userValue(USERS.ana, 'perfilFinanceiro/revisaoPendente'), false);
  await harness.say(USERS.ana, 'tenho 2 dependentes');
  assert.equal(harness.userValue(USERS.ana, 'perfilFinanceiro/revisaoPendente'), true);
});

test('perfil ampliado: essenciais, reserva, dependentes, objetivos, liquidez e prioridades', async () => {
  const harness = createHarness();

  await harness.say(USERS.ana, 'minha renda é variável, média 6000 mínimo 4000');
  await harness.say(USERS.ana, 'despesas essenciais 2500');
  await harness.say(USERS.ana, 'tenho reserva de 8000');
  await harness.say(USERS.ana, 'objetivo viagem 6000 em 12 meses');
  await harness.say(USERS.ana, 'liquidez alta');
  await harness.say(USERS.ana, 'minha prioridade é quitar o carro');

  const profile = harness.userValue(USERS.ana, 'perfilFinanceiro');
  const view = await harness.say(USERS.ana, 'meu perfil financeiro');

  assert.equal(profile.tipoRenda, 'variavel');
  assert.equal(profile.rendaMinima, 4000);
  assert.equal(profile.reservaAtual, 8000);
  assert.equal(Object.values(profile.objetivos)[0].prazoMeses, 12);
  assert.equal(profile.liquidezNecessaria, 'alta');
  assert.deepEqual(profile.prioridades, ['quitar o carro']);
  assert.match(view, /variável — média R\$ 6\.000,00, base conservadora R\$ 4\.000,00/);
});
