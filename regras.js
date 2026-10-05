// Regras do Portal de Reembolsos (documento de requisitos, seções 4, 6 e 10).
// Funções puras: não acessam o banco, para poderem ser testadas isoladamente (test/regras.test.js).
// Valores sempre em centavos (inteiros) para evitar erros de arredondamento.

const FUSO = 'America/Sao_Paulo';

/** Parentescos aceitos na base de dependentes (coluna PARENTESCO). */
const PARENTESCOS = {
  conjuge: 'Cônjuge',
  filho: 'Filho(a)',
  enteado: 'Enteado(a)',
  neto: 'Neto(a) com tutela',
  tutelado: 'Dependente legal com tutela',
  pai: 'Pai',
  mae: 'Mãe',
};

/** Tipos de documento exigidos nos anexos. */
const DOCUMENTOS = {
  receita: 'Receita médica',
  nota_fiscal: 'Nota fiscal',
  boleto: 'Boleto ou recibo',
  comprovante: 'Comprovante de pagamento',
};

/**
 * Catálogo dos benefícios. Os limites e verbas de folha são o padrão inicial; o RH pode ajustá-los
 * em Configurações (ficam salvos no banco e substituem estes valores).
 */
const BENEFICIOS = {
  medicamento: {
    nome: 'Reembolso Medicamento',
    curto: 'Medicamento',
    icone: '💊',
    escopo: 'familia_mes', // limite compartilhado pelo grupo familiar no mês
    limite: 80000,
    titular: true,
    parentescos: ['conjuge', 'filho', 'neto', 'tutelado'],
    parentescosSucedido: ['pai', 'mae'], // pai e mãe somente para sucedidos
    documentos: ['receita', 'nota_fiscal'],
    elegiveis: 'Titular, cônjuge, filhos e dependentes legais com tutela. Pai e mãe somente para colaboradores sucedidos (admitidos até 2011).',
    observacao: 'Não abrange itens de estética, beleza, higiene pessoal, suplementos ou produtos que não sejam medicamentos.',
    verba: '',
  },
  educacional: {
    nome: 'Reembolso Educacional',
    curto: 'Educacional',
    icone: '🎒',
    escopo: 'dependente_mes', // limite individual por dependente no mês
    limiteSucedido: 73363,
    limiteNaoSucedido: 60000,
    titular: false,
    parentescos: ['filho', 'enteado', 'neto'],
    faixa: 'educacional',
    documentos: ['boleto', 'comprovante'],
    elegiveis: 'Filhos, enteados e netos com tutela, de 7 a 17 anos (resguardado o ano letivo), cursando ensino fundamental, médio ou médio técnico.',
    observacao: 'Limite mensal individual por dependente.',
    verba: '',
  },
  creche: {
    nome: 'Reembolso Creche/Babá',
    curto: 'Creche/Babá',
    icone: '🧸',
    escopo: 'dependente_mes',
    limiteSucedido: 110317,
    limiteNaoSucedido: 80000,
    titular: false,
    parentescos: ['filho', 'enteado', 'neto'],
    faixa: 'creche',
    documentos: ['boleto', 'comprovante'],
    elegiveis: 'Filhos, enteados e netos com tutela, a partir de 6 meses até 6 anos.',
    observacao: 'Limite mensal individual por dependente.',
    verba: '',
  },
  oculos: {
    nome: 'Reembolso Óculos',
    curto: 'Óculos',
    icone: '👓',
    escopo: 'beneficiario_periodo', // limite por beneficiário em uma janela de N meses
    limite: 150000,
    periodoMeses: 18,
    titular: true,
    parentescos: ['conjuge'],
    documentos: ['receita', 'nota_fiscal'],
    elegiveis: 'Somente titular e cônjuge.',
    observacao: 'Limite por beneficiário a cada 18 meses, considerando o histórico de reembolsos.',
    verba: '',
  },
};
const CODIGOS = Object.keys(BENEFICIOS);

const NIVEIS_ENSINO = ['Ensino fundamental', 'Ensino médio', 'Ensino médio técnico'];

/** Configuração padrão do período e dos benefícios (o RH altera em Configurações). */
function configuracaoPadrao() {
  return {
    dia_inicio: 1,
    dia_fim: 10,
    prazo_documento_dias: 60,
    excecao_ate: '', // AAAA-MM-DD: mantém o portal aberto excepcionalmente até essa data
    beneficios: Object.fromEntries(CODIGOS.map(c => {
      const b = BENEFICIOS[c];
      return [c, {
        ativo: true,
        verba: b.verba,
        limite: b.limite ?? null,
        limiteSucedido: b.limiteSucedido ?? null,
        limiteNaoSucedido: b.limiteNaoSucedido ?? null,
        periodoMeses: b.periodoMeses ?? null,
      }];
    })),
  };
}

/** Junta a configuração salva com a padrão (campos novos ganham o valor padrão). */
function mesclarConfiguracao(salva) {
  const padrao = configuracaoPadrao();
  const c = { ...padrao, ...(salva || {}) };
  c.beneficios = Object.fromEntries(CODIGOS.map(k => [k, { ...padrao.beneficios[k], ...((salva && salva.beneficios && salva.beneficios[k]) || {}) }]));
  return c;
}

// ---------- datas ----------

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília. */
function hojeISO(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** Aceita AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, DD/MM/AA e número de série do Excel. Devolve AAAA-MM-DD ou null. */
function normalizarData(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;
  let a, m, d;
  let r;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [a, m, d] = [r[1], r[2], r[3]];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    [d, m, a] = [r[1], r[2], r[3]];
    if (a.length === 2) a = String(Number(a) > 40 ? 1900 + Number(a) : 2000 + Number(a));
  } else if (/^\d{4,5}$/.test(s)) {
    // Número de série do Excel (dias desde 30/12/1899).
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400e3);
    return dt.toISOString().slice(0, 10);
  } else return null;
  const iso = `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

const partes = (iso) => iso.split('-').map(Number);

function diasEntre(deISO, ateISO) {
  return Math.round((Date.parse(`${ateISO}T00:00:00Z`) - Date.parse(`${deISO}T00:00:00Z`)) / 86400e3);
}

/** Soma meses a uma data (dia ajustado ao fim do mês quando necessário). */
function somarMeses(iso, meses) {
  const [a, m, d] = partes(iso);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Idade em anos completos na data de referência. */
function idadeEm(nascimento, referencia) {
  const [an, mn, dn] = partes(nascimento);
  const [ar, mr, dr] = partes(referencia);
  let idade = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) idade -= 1;
  return idade;
}

/** Idade em meses completos na data de referência. */
function mesesDeIdade(nascimento, referencia) {
  const [an, mn, dn] = partes(nascimento);
  const [ar, mr, dr] = partes(referencia);
  let meses = (ar - an) * 12 + (mr - mn);
  if (dr < dn) meses -= 1;
  return meses;
}

const competenciaDe = (iso) => iso.slice(0, 7);

function formatarCompetencia(comp) {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [a, m] = comp.split('-').map(Number);
  return `${nomes[m - 1]}/${a}`;
}

// ---------- período de solicitação ----------

/**
 * Situação do portal na data informada: aberto do dia_inicio ao dia_fim de cada mês
 * (ou até a data de exceção definida pelo RH). Devolve também a próxima janela.
 */
function situacaoPeriodo(config, hoje) {
  const [a, m, d] = partes(hoje);
  const dentroDaJanela = d >= config.dia_inicio && d <= config.dia_fim;
  const porExcecao = Boolean(config.excecao_ate) && hoje <= config.excecao_ate;
  const aberto = dentroDaJanela || porExcecao;
  const mesIso = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);
  const fimJanela = mesIso(a, m, config.dia_fim);
  const encerraEm = porExcecao && config.excecao_ate > fimJanela ? config.excecao_ate : fimJanela;
  const proximaAbertura = d < config.dia_inicio ? mesIso(a, m, config.dia_inicio) : mesIso(a, m + 1, config.dia_inicio);
  const proximoFim = d < config.dia_inicio ? mesIso(a, m, config.dia_fim) : mesIso(a, m + 1, config.dia_fim);
  return {
    aberto,
    por_excecao: porExcecao && !dentroDaJanela,
    competencia: competenciaDe(hoje),
    encerra_em: aberto ? encerraEm : null,
    dias_restantes: aberto ? diasEntre(hoje, encerraEm) + 1 : 0,
    proxima_abertura: aberto ? null : proximaAbertura,
    proximo_fim: aberto ? null : proximoFim,
    dia_inicio: config.dia_inicio,
    dia_fim: config.dia_fim,
  };
}

/** Valida a data do documento: não pode ser futura nem ter mais de N dias (padrão 60). */
function validarDataDocumento(dataDoc, hoje, prazoDias) {
  if (!dataDoc) return 'Informe a data de emissão do documento.';
  if (dataDoc > hoje) return 'A data do documento não pode ser futura.';
  const dias = diasEntre(dataDoc, hoje);
  if (dias > prazoDias) {
    return `Documento emitido há ${dias} dias. O prazo para solicitar reembolso é de até ${prazoDias} dias da emissão da nota fiscal ou do comprovante de pagamento.`;
  }
  return null;
}

// ---------- elegibilidade ----------

/** Lê as colunas S/N da base: 'S' libera, 'N' bloqueia, vazio segue a regra do benefício. */
function lerMarcador(valor) {
  const s = String(valor ?? '').trim().toUpperCase();
  if (['S', 'SIM', 'X', '1', 'TRUE', 'VERDADEIRO'].includes(s)) return 'S';
  if (['N', 'NAO', 'NÃO', '0', 'FALSE', 'FALSO'].includes(s)) return 'N';
  return '';
}

/** Converte o texto da coluna PARENTESCO para um código conhecido (ou null). */
function normalizarParentesco(valor) {
  const s = String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (!s) return null;
  if (/^(conjuge|companheir|espos|marido|mulher)/.test(s)) return 'conjuge';
  if (/^enteado|^enteada/.test(s)) return 'enteado';
  if (/^net[oa]/.test(s)) return 'neto';
  if (/^filh/.test(s)) return 'filho';
  if (/tutel|guarda|dependente legal/.test(s)) return 'tutelado';
  if (/^pai$/.test(s)) return 'pai';
  if (/^mae$/.test(s)) return 'mae';
  return null;
}

/**
 * Colaborador sucedido: definido pela coluna SUCEDIDO da base; se vazia, considera sucedido
 * quem foi admitido até 31/12/2011.
 */
function ehSucedido(colab) {
  if (colab.sucedido === 1 || colab.sucedido === 0) return colab.sucedido === 1;
  return Boolean(colab.data_admissao) && colab.data_admissao <= '2011-12-31';
}

/** Verifica a faixa etária do benefício (educacional: 7 a 17 anos com ano letivo resguardado; creche: 6 meses a 6 anos). */
function dentroDaFaixa(faixa, nascimento, hoje) {
  if (!faixa) return { ok: true };
  if (!nascimento) return { ok: false, motivo: 'Data de nascimento não informada na base.' };
  if (faixa === 'educacional') {
    const ano = Number(hoje.slice(0, 4));
    // Quem completa 18 anos durante o ano continua elegível até o fim do ano letivo.
    const idadeInicioAno = idadeEm(nascimento, `${ano}-01-01`);
    const idade = idadeEm(nascimento, hoje);
    if (idade < 7) return { ok: false, motivo: 'Benefício a partir dos 7 anos.' };
    if (idadeInicioAno > 17) return { ok: false, motivo: 'Benefício até os 17 anos (resguardado o ano letivo).' };
    return { ok: true };
  }
  if (faixa === 'creche') {
    if (mesesDeIdade(nascimento, hoje) < 6) return { ok: false, motivo: 'Benefício a partir dos 6 meses de idade.' };
    if (idadeEm(nascimento, hoje) > 6) return { ok: false, motivo: 'Benefício até os 6 anos de idade.' };
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Elegibilidade de uma pessoa (titular ou dependente) a um benefício.
 * colab: { sucedido, data_admissao, elegibilidade: { medicamento: 'S'|'N'|'' , ... } }
 * dep:   null (titular) ou { parentesco, data_nascimento, ativo, elegibilidade: {...} }
 */
function elegibilidade(codigo, colab, dep, hoje, config) {
  const b = BENEFICIOS[codigo];
  const cfg = config.beneficios[codigo];
  if (!b || !cfg || !cfg.ativo) return { elegivel: false, motivo: 'Benefício indisponível.' };
  const marcadorTitular = (colab.elegibilidade || {})[codigo] || '';
  if (marcadorTitular === 'N') return { elegivel: false, motivo: 'Benefício não disponível para o seu cadastro.' };
  if (!dep) {
    // Titular: só os benefícios que o contemplam (medicamento e óculos).
    return b.titular ? { elegivel: true } : { elegivel: false, motivo: 'Benefício exclusivo para dependentes.' };
  }
  if (dep.ativo === 0) return { elegivel: false, motivo: 'Dependente inativo na base.' };
  const marcador = (dep.elegibilidade || {})[codigo] || '';
  if (marcador === 'N') return { elegivel: false, motivo: 'Dependente não elegível a este benefício na base do RH.' };
  if (marcador === 'S') return { elegivel: true };
  const permitidos = [...b.parentescos, ...(ehSucedido(colab) ? (b.parentescosSucedido || []) : [])];
  if (!permitidos.includes(dep.parentesco)) return { elegivel: false, motivo: 'Grau de parentesco não contemplado por este benefício.' };
  const faixa = dentroDaFaixa(b.faixa, dep.data_nascimento, hoje);
  if (!faixa.ok) return { elegivel: false, motivo: faixa.motivo };
  return { elegivel: true };
}

// ---------- limites ----------

/** Limite (em centavos) aplicável ao colaborador para o benefício. */
function limiteDoBeneficio(codigo, colab, config) {
  const cfg = config.beneficios[codigo];
  if (BENEFICIOS[codigo].escopo === 'dependente_mes') return ehSucedido(colab) ? cfg.limiteSucedido : cfg.limiteNaoSucedido;
  return cfg.limite;
}

/**
 * Janela de controle do limite. Medicamento, educacional e creche: a competência (mês).
 * Óculos: os últimos N meses (padrão 18) até a data de referência, pela data do documento.
 */
function janelaDoLimite(codigo, config, competencia, referencia) {
  const b = BENEFICIOS[codigo];
  if (b.escopo === 'beneficiario_periodo') {
    const meses = config.beneficios[codigo].periodoMeses || b.periodoMeses;
    return { tipo: 'periodo', desde: somarMeses(referencia, -meses), ate: referencia, meses };
  }
  return { tipo: 'competencia', competencia };
}

/** Converte "1.234,56", "1234.56" ou número em centavos. */
function paraCentavos(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  let s = String(valor ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

function formatarReais(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = {
  FUSO, PARENTESCOS, DOCUMENTOS, BENEFICIOS, CODIGOS, NIVEIS_ENSINO,
  configuracaoPadrao, mesclarConfiguracao,
  hojeISO, normalizarData, diasEntre, somarMeses, idadeEm, mesesDeIdade, competenciaDe, formatarCompetencia,
  situacaoPeriodo, validarDataDocumento,
  lerMarcador, normalizarParentesco, ehSucedido, dentroDaFaixa, elegibilidade,
  limiteDoBeneficio, janelaDoLimite, paraCentavos, formatarReais,
};
