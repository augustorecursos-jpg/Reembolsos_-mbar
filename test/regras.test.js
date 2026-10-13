// Testes das regras do documento de requisitos (npm test).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../regras');

const config = R.configuracaoPadrao();
const sucedido = { sucedido: 1, data_admissao: '2008-03-01', elegibilidade: {} };
const naoSucedido = { sucedido: 0, data_admissao: '2025-01-10', elegibilidade: {} };
const dep = (parentesco, data_nascimento, elegibilidade = {}) => ({ parentesco, data_nascimento, elegibilidade, ativo: 1 });

test('período: envios todos os dias, ciclo do dia 11 ao dia 10 do mês seguinte', () => {
  assert.equal(R.competenciaDe('2026-10-10'), '2026-10');
  assert.equal(R.competenciaDe('2026-10-11'), '2026-11');
  assert.equal(R.competenciaDe('2026-09-11'), '2026-10');
  assert.equal(R.competenciaDe('2026-12-11'), '2027-01');
  assert.deepEqual(R.cicloDaCompetencia('2026-10'), { inicio: '2026-09-11', fim: '2026-10-10' });
  assert.deepEqual(R.cicloDaCompetencia('2027-01'), { inicio: '2026-12-11', fim: '2027-01-10' });
  assert.deepEqual(R.cicloDaCompetencia('2026-03'), { inicio: '2026-02-11', fim: '2026-03-10' });
  for (const dia of ['2026-10-01', '2026-10-10', '2026-10-11', '2026-10-31']) assert.equal(R.situacaoPeriodo(config, dia).aberto, true);
  const s = R.situacaoPeriodo(config, '2026-10-13');
  assert.equal(s.competencia, '2026-11');
  assert.equal(s.inicio_ciclo, '2026-10-11');
  assert.equal(s.encerra_em, '2026-11-10');
  assert.equal(s.dias_restantes, 29);
  assert.equal(s.dias_ciclo, 31);
  assert.equal(s.proxima_competencia, '2026-12');
  assert.equal(R.situacaoPeriodo(config, '2026-10-10').dias_restantes, 1);
  assert.equal(R.situacaoPeriodo(config, '2026-10-10').competencia, '2026-10');
});

test('período: fechamento configurável (ex.: dia 5 → ciclo do dia 6 ao dia 5)', () => {
  const c = { ...config, dia_fim: 5 };
  assert.equal(R.competenciaDe('2026-10-05', 5), '2026-10');
  assert.equal(R.competenciaDe('2026-10-06', 5), '2026-11');
  assert.equal(R.situacaoPeriodo(c, '2026-10-06').inicio_ciclo, '2026-10-06');
});

test('documento: até 60 dias da emissão, sem data futura', () => {
  assert.equal(R.validarDataDocumento('2026-08-06', '2026-10-05', 60), null); // 60 dias
  assert.match(R.validarDataDocumento('2026-08-05', '2026-10-05', 60), /61 dias/);
  assert.match(R.validarDataDocumento('2026-10-06', '2026-10-05', 60), /futura/);
});

test('medicamento: titular, cônjuge, filhos e tutelados; pai e mãe só para sucedidos', () => {
  const hoje = '2026-10-05';
  assert.ok(R.elegibilidade('medicamento', naoSucedido, null, hoje, config).elegivel);
  assert.ok(R.elegibilidade('medicamento', naoSucedido, dep('conjuge', '1990-01-01'), hoje, config).elegivel);
  assert.ok(R.elegibilidade('medicamento', naoSucedido, dep('tutelado', '2015-01-01'), hoje, config).elegivel);
  assert.equal(R.elegibilidade('medicamento', naoSucedido, dep('mae', '1960-01-01'), hoje, config).elegivel, false);
  assert.ok(R.elegibilidade('medicamento', sucedido, dep('mae', '1960-01-01'), hoje, config).elegivel);
  assert.equal(R.elegibilidade('medicamento', naoSucedido, dep('enteado', '2015-01-01'), hoje, config).elegivel, false);
});

test('educacional: 7 a 17 anos, resguardado o ano letivo', () => {
  const hoje = '2026-10-05';
  assert.ok(R.elegibilidade('educacional', sucedido, dep('filho', '2019-05-01'), hoje, config).elegivel); // 7 anos
  assert.equal(R.elegibilidade('educacional', sucedido, dep('filho', '2020-01-01'), hoje, config).elegivel, false); // 6 anos
  assert.ok(R.elegibilidade('educacional', sucedido, dep('enteado', '2008-03-01'), hoje, config).elegivel); // fez 18 em 2026
  assert.equal(R.elegibilidade('educacional', sucedido, dep('filho', '2008-01-01'), hoje, config).elegivel, false); // 18 em 01/01
  assert.equal(R.elegibilidade('educacional', sucedido, null, hoje, config).elegivel, false); // titular não
  assert.equal(R.elegibilidade('educacional', sucedido, dep('conjuge', '1990-01-01'), hoje, config).elegivel, false);
});

test('creche: de 6 meses a 6 anos', () => {
  const hoje = '2026-10-05';
  assert.ok(R.elegibilidade('creche', naoSucedido, dep('filho', '2026-04-05'), hoje, config).elegivel); // 6 meses
  assert.equal(R.elegibilidade('creche', naoSucedido, dep('filho', '2026-04-06'), hoje, config).elegivel, false); // 5 meses
  assert.ok(R.elegibilidade('creche', naoSucedido, dep('neto', '2019-10-06'), hoje, config).elegivel); // 6 anos
  assert.equal(R.elegibilidade('creche', naoSucedido, dep('filho', '2019-10-05'), hoje, config).elegivel, false); // 7 anos
});

test('óculos: somente titular e cônjuge', () => {
  const hoje = '2026-10-05';
  assert.ok(R.elegibilidade('oculos', naoSucedido, null, hoje, config).elegivel);
  assert.ok(R.elegibilidade('oculos', naoSucedido, dep('conjuge', '1990-01-01'), hoje, config).elegivel);
  assert.equal(R.elegibilidade('oculos', naoSucedido, dep('filho', '2010-01-01'), hoje, config).elegivel, false);
});

test('marcadores S/N da base prevalecem sobre a regra', () => {
  const hoje = '2026-10-05';
  const semMedicamento = { ...naoSucedido, elegibilidade: { medicamento: 'N' } };
  assert.equal(R.elegibilidade('medicamento', semMedicamento, null, hoje, config).elegivel, false);
  assert.ok(R.elegibilidade('creche', naoSucedido, dep('filho', '2018-01-01', { creche: 'S' }), hoje, config).elegivel);
  assert.equal(R.elegibilidade('medicamento', naoSucedido, dep('filho', '2018-01-01', { medicamento: 'N' }), hoje, config).elegivel, false);
});

test('limites por perfil (sucedido / não sucedido)', () => {
  assert.equal(R.limiteDoBeneficio('medicamento', naoSucedido, config), 80000);
  assert.equal(R.limiteDoBeneficio('educacional', sucedido, config), 73363);
  assert.equal(R.limiteDoBeneficio('educacional', naoSucedido, config), 60000);
  assert.equal(R.limiteDoBeneficio('creche', sucedido, config), 110317);
  assert.equal(R.limiteDoBeneficio('creche', naoSucedido, config), 80000);
  assert.equal(R.limiteDoBeneficio('oculos', sucedido, config), 150000);
  assert.ok(R.ehSucedido({ sucedido: null, data_admissao: '2011-12-31' }));
  assert.equal(R.ehSucedido({ sucedido: null, data_admissao: '2012-01-02' }), false);
});

test('óculos: janela de 18 meses', () => {
  const j = R.janelaDoLimite('oculos', config, '2026-10', '2026-10-05');
  assert.deepEqual(j, { tipo: 'periodo', desde: '2025-04-05', ate: '2026-10-05', meses: 18 });
  assert.equal(R.somarMeses('2026-08-31', -18), '2025-02-28');
  // Histórico importado: pago em 29/08/2026 → próxima elegibilidade 29/02/2028 (como na planilha do RH).
  assert.equal(R.somarMeses('2026-08-29', 18), '2028-02-29');
  assert.equal(R.somarMeses('2026-09-10', 18), '2028-03-10');
});

test('conversões de data, valor e parentesco', () => {
  assert.equal(R.normalizarData('05/10/2026'), '2026-10-05');
  assert.equal(R.normalizarData('2026-10-05'), '2026-10-05');
  assert.equal(R.normalizarData('31/02/2026'), null);
  assert.equal(R.normalizarData('45000'), '2023-03-15');
  assert.equal(R.paraCentavos('1.234,56'), 123456);
  assert.equal(R.paraCentavos('733.63'), 73363);
  assert.equal(R.paraCentavos('abc'), null);
  assert.equal(R.normalizarParentesco('Mãe'), 'mae');
  assert.equal(R.normalizarParentesco('Cônjuge'), 'conjuge');
  assert.equal(R.normalizarParentesco('Filha'), 'filho');
  assert.equal(R.normalizarParentesco('Enteada'), 'enteado');
  assert.equal(R.normalizarParentesco('Neta'), 'neto');
});

test('material escolar/uniforme: filhos de 7 a 17 anos, limites e janelas de fevereiro e julho', () => {
  const hoje = '2027-02-05';
  assert.equal(R.limiteDoBeneficio('material', sucedido, config), 146726);
  assert.equal(R.limiteDoBeneficio('material', naoSucedido, config), 120000);
  assert.equal(R.elegibilidade('material', sucedido, null, hoje, config).elegivel, false);
  assert.equal(R.elegibilidade('material', sucedido, dep('filho', '2016-04-22'), hoje, config).elegivel, true);
  assert.equal(R.elegibilidade('material', sucedido, dep('filho', '2024-01-10'), hoje, config).elegivel, false);
  assert.equal(R.elegibilidade('material', sucedido, dep('conjuge', '1980-07-10'), hoje, config).elegivel, false);
  assert.deepEqual(R.janelaDeSolicitacao('material', '2027-02', config), { aberta: true, meses: [2, 7], nomes: ['fevereiro', 'julho'], proxima: '2027-07' });
  assert.equal(R.janelaDeSolicitacao('material', '2027-07', config).proxima, '2028-02');
  assert.deepEqual(R.janelaDeSolicitacao('material', '2026-10', config), { aberta: false, meses: [2, 7], nomes: ['fevereiro', 'julho'], proxima: '2027-02' });
  assert.equal(R.janelaDeSolicitacao('educacional', '2026-10', config), null);
});
