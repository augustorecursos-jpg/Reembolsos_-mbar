// Popula o banco com dados de demonstração (base de elegibilidade e algumas solicitações).
// Uso: npm run seed
const fs = require('node:fs');
const path = require('node:path');
const { db, ANEXOS_DIR } = require('../db');
const R = require('../regras');

const hoje = R.hojeISO();
const competencia = R.competenciaDe(hoje);
const ano = Number(hoje.slice(0, 4));
// Datas relativas a hoje, para as regras de idade e de prazo funcionarem em qualquer data.
const anosAtras = (n, mmdd) => `${ano - n}-${mmdd}`;
const diasAtras = (n) => new Date(Date.parse(`${hoje}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);

// PDF mínimo válido para os anexos de exemplo.
function pdfDemo(texto) {
  const conteudo = `BT /F1 18 Tf 60 760 Td (${texto.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const nome = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  fs.writeFileSync(path.join(ANEXOS_DIR, nome), pdf);
  return { nome, tamanho: Buffer.byteLength(pdf) };
}

const colaboradores = [
  { cpf: '12345678909', matricula: '1001', nome: 'Maria Souza', email: 'maria.souza@exemplo.com.br', empresa: 'Âmbar Energia', cnpj: '00.000.000/0001-00', unidade: 'Cuiabá', data_admissao: '2008-03-15', sucedido: 1 },
  { cpf: '98765432100', matricula: '2002', nome: 'João Pereira', email: 'joao.pereira@exemplo.com.br', empresa: 'Fluxus', cnpj: '00.000.000/0002-00', unidade: 'Campo Grande', data_admissao: '2025-02-03', sucedido: 0 },
  { cpf: '11144477735', matricula: '3003', nome: 'Ana Lima', email: 'ana.lima@exemplo.com.br', empresa: 'MGAS', cnpj: '00.000.000/0003-00', unidade: 'São Paulo', data_admissao: '2025-06-01', sucedido: 0 },
];
const dependentes = [
  { titular: '12345678909', nome: 'Carlos Souza', parentesco: 'conjuge', nascimento: '1980-07-10' },
  { titular: '12345678909', nome: 'Pedro Souza', parentesco: 'filho', nascimento: anosAtras(10, '04-22') },
  { titular: '12345678909', nome: 'Laura Souza', parentesco: 'filho', nascimento: anosAtras(3, '01-15') },
  { titular: '12345678909', nome: 'Helena Souza', parentesco: 'mae', nascimento: '1955-11-02' },
  { titular: '98765432100', nome: 'Beatriz Pereira', parentesco: 'conjuge', nascimento: '1992-02-20' },
  { titular: '98765432100', nome: 'Clara Pereira', parentesco: 'enteado', nascimento: anosAtras(8, '09-05') },
  { titular: '98765432100', nome: 'Lucas Pereira', parentesco: 'filho', nascimento: anosAtras(5, '06-30') },
  { titular: '98765432100', nome: 'Rosa Pereira', parentesco: 'mae', nascimento: '1960-03-12' }, // não sucedido: sem medicamento
];

const insColab = db.prepare(`
  INSERT OR REPLACE INTO colaboradores (cpf, matricula, nome, email, empresa, cnpj, unidade, data_admissao, sucedido, elegibilidade, ativo)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 1)`);
for (const c of colaboradores) insColab.run(c.cpf, c.matricula, c.nome, c.email, c.empresa, c.cnpj, c.unidade, c.data_admissao, c.sucedido);

const insDep = db.prepare(`
  INSERT INTO dependentes (cpf_titular, chave, nome, parentesco, data_nascimento, elegibilidade, ativo) VALUES (?, ?, ?, ?, ?, '{}', 1)
  ON CONFLICT(cpf_titular, chave) DO UPDATE SET parentesco = excluded.parentesco, data_nascimento = excluded.data_nascimento, ativo = 1`);
for (const d of dependentes) insDep.run(d.titular, `${d.nome.toUpperCase()}|${d.nascimento}`, d.nome, d.parentesco, d.nascimento);
const depId = (titular, nome) => db.prepare('SELECT id FROM dependentes WHERE cpf_titular = ? AND nome = ?').get(titular, nome).id;

if (!db.prepare('SELECT 1 FROM solicitacoes LIMIT 1').get()) {
  const exemplos = [
    { cpf: '12345678909', beneficio: 'medicamento', dep: null, comp: competencia, data: diasAtras(12), valor: 32050, status: 'aprovado', aprovado: 32050 },
    { cpf: '12345678909', beneficio: 'medicamento', dep: 'Helena Souza', comp: competencia, data: diasAtras(5), valor: 18990, status: 'analise' },
    { cpf: '12345678909', beneficio: 'educacional', dep: 'Pedro Souza', comp: competencia, data: diasAtras(3), valor: 68000, status: 'analise' },
    { cpf: '12345678909', beneficio: 'oculos', dep: null, comp: R.competenciaDe(diasAtras(240)), data: diasAtras(250), valor: 90000, status: 'aprovado', aprovado: 90000 },
    { cpf: '98765432100', beneficio: 'creche', dep: 'Lucas Pereira', comp: competencia, data: diasAtras(8), valor: 78000, status: 'analise' },
    { cpf: '98765432100', beneficio: 'medicamento', dep: 'Beatriz Pereira', comp: R.competenciaDe(diasAtras(35)), data: diasAtras(40), valor: 12000, status: 'reprovado',
      obs: 'Nota fiscal ilegível e sem a identificação dos medicamentos. Envie uma nova solicitação com a nota completa.' },
  ];
  const ins = db.prepare(`
    INSERT INTO solicitacoes (cpf, matricula, nome, empresa, cnpj, unidade, sucedido, beneficio, dependente_id, beneficiario_nome, beneficiario_tipo,
      competencia, data_documento, valor_solicitado, valor_aprovado, detalhes, status, observacao_rh, criado_em, analisado_em, analisado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insAnexo = db.prepare('INSERT INTO anexos (solicitacao_id, tipo, arquivo, nome_original, mime, tamanho) VALUES (?, ?, ?, ?, ?, ?)');
  const insEvento = db.prepare('INSERT INTO eventos (solicitacao_id, evento, detalhe, por, em) VALUES (?, ?, ?, ?, ?)');
  for (const e of exemplos) {
    const c = colaboradores.find(x => x.cpf === e.cpf);
    const d = e.dep ? dependentes.find(x => x.titular === e.cpf && x.nome === e.dep) : null;
    const enviada = `${e.comp === competencia ? hoje.slice(0, 8) + '02' : e.comp + '-05'} 13:00:00`;
    const analisada = e.status === 'analise' ? null : `${enviada.slice(0, 10)} 17:30:00`;
    const id = Number(ins.run(c.cpf, c.matricula, c.nome, c.empresa, c.cnpj, c.unidade, c.sucedido, e.beneficio, d ? depId(e.cpf, d.nome) : null,
      d ? d.nome : c.nome, d ? d.parentesco : 'titular', e.comp, e.data, e.valor, e.aprovado ?? null,
      JSON.stringify(e.beneficio === 'educacional' ? { nivel_ensino: 'Ensino fundamental' } : {}), e.status, e.obs ?? null,
      enviada, analisada, analisada ? 'Administrador' : null).lastInsertRowid);
    db.prepare('UPDATE solicitacoes SET protocolo = ? WHERE id = ?').run(`RB${e.comp.replace('-', '')}-${String(id).padStart(5, '0')}`, id);
    for (const tipo of R.BENEFICIOS[e.beneficio].documentos) {
      const arq = pdfDemo(`${R.DOCUMENTOS[tipo]} - exemplo`);
      insAnexo.run(id, tipo, arq.nome, `${tipo}.pdf`, 'application/pdf', arq.tamanho);
    }
    insEvento.run(id, 'Solicitação enviada', null, c.nome, enviada);
    if (e.status === 'aprovado') insEvento.run(id, 'Aprovada', R.formatarReais(e.aprovado), 'Administrador', analisada);
    if (e.status === 'reprovado') insEvento.run(id, 'Reprovada', e.obs, 'Administrador', analisada);
  }
}

console.log('Dados de demonstração criados. Acesso do colaborador (CPF / matrícula):');
for (const c of colaboradores) console.log(`  ${c.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')} / ${c.matricula}  ${c.nome}`);
console.log('Área do RH: usuário "admin" com a senha de ADMIN_PASSWORD (padrão local: ambar-rh).');
