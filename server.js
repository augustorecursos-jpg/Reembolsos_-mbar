// Portal de Reembolsos · Âmbar Energia (RH)
// Servidor HTTP: API do colaborador (CPF + matrícula), API do RH (usuário e senha) e arquivos estáticos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, DATA_DIR, ANEXOS_DIR, gerarHash, conferirSenha, garantirAdministrador } = require('./db');
const R = require('./regras');
const { avisar, emailAtivo } = require('./email');

const PORT = Number(process.env.PORT) || 3001;
const PRODUCAO = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PRODUCAO ? null : 'ambar-rh');

// Segredo para assinar os cookies de sessão (persistido para sobreviver a reinícios).
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(SECRET_FILE, 'utf8');
})();

const temUsuarioRh = db.prepare('SELECT COUNT(*) AS n FROM usuarios_rh').get().n > 0;
if (!temUsuarioRh && !ADMIN_PASSWORD) {
  console.error('[erro] Em produção é obrigatório definir ADMIN_PASSWORD (senha inicial do usuário "admin" do RH).');
  process.exit(1);
}
if (!temUsuarioRh && !process.env.ADMIN_PASSWORD) {
  console.warn('[aviso] ADMIN_PASSWORD não definido — usuário "admin" criado com a senha padrão "ambar-rh". Troque em Configurações.');
}
garantirAdministrador(ADMIN_PASSWORD);

// ---------- utilitários ----------

/** Mantém só os dígitos e recoloca zeros à esquerda que o Excel costuma remover. */
function normalizarCpf(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos || digitos.length > 11) return null;
  return digitos.padStart(11, '0');
}

/** Matrícula comparada sem zeros à esquerda e sem espaços (o Excel costuma removê-los). */
const normalizarMatricula = (v) => String(v ?? '').trim().replace(/^0+(?=.)/, '').toUpperCase();

function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}

function verificar(token) {
  if (!token) return null;
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  if (payload.exp < Date.now()) return null;
  return payload;
}

function lerCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function definirSessao(res, nome, payload, horas) {
  const token = assinar({ ...payload, exp: Date.now() + horas * 3600e3 });
  res.cookie(nome, token, { httpOnly: true, sameSite: 'lax', maxAge: horas * 3600e3, secure: PRODUCAO });
}

function lerColaborador(cpf) {
  const c = db.prepare('SELECT * FROM colaboradores WHERE cpf = ? AND ativo = 1').get(cpf);
  if (c) c.elegibilidade = JSON.parse(c.elegibilidade || '{}');
  return c;
}

function exigirColaborador(req, res, next) {
  const s = verificar(lerCookies(req).sess_colab);
  const colab = s && lerColaborador(s.cpf);
  if (!colab) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente com seu CPF e matrícula.' });
  req.colab = colab;
  next();
}

function sessaoRh(req) {
  const s = verificar(lerCookies(req).sess_rh);
  return s && db.prepare('SELECT id, nome, login FROM usuarios_rh WHERE id = ? AND ativo = 1').get(s.uid);
}

function exigirRh(req, res, next) {
  const u = sessaoRh(req);
  if (!u) return res.status(401).json({ erro: 'Acesso restrito ao RH.' });
  req.rh = u;
  next();
}

function configuracao() {
  const r = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'portal'").get();
  return R.mesclarConfiguracao(r ? JSON.parse(r.valor) : null);
}

/** Limita tentativas de login com falha por IP. Só as falhas contam. */
function limitadorDeFalhas({ maximo, janelaMin }) {
  const falhas = new Map();
  setInterval(() => {
    const agora = Date.now();
    for (const [ip, r] of falhas) if (r.expira < agora) falhas.delete(ip);
  }, 60e3).unref();
  return {
    bloqueado(req) {
      const r = falhas.get(req.ip);
      return Boolean(r && r.expira > Date.now() && r.n >= maximo);
    },
    registrar(req) {
      const agora = Date.now();
      const r = falhas.get(req.ip);
      if (!r || r.expira < agora) falhas.set(req.ip, { n: 1, expira: agora + janelaMin * 60e3 });
      else r.n += 1;
    },
  };
}
const limiteColab = limitadorDeFalhas({ maximo: 30, janelaMin: 15 });
const limiteRh = limitadorDeFalhas({ maximo: 10, janelaMin: 15 });
const MSG_LIMITE = 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';

const registrarEvento = db.prepare('INSERT INTO eventos (solicitacao_id, evento, detalhe, por) VALUES (?, ?, ?, ?)');

// ---------- limites e elegibilidade ----------

/**
 * Quanto do limite já está comprometido: solicitações aprovadas (valor aprovado) e em análise
 * (valor solicitado). Reprovadas liberam o saldo.
 */
function usoDoLimite({ cpf, beneficio, dependenteId, competencia, referencia, excluirId = 0 }, config) {
  const b = R.BENEFICIOS[beneficio];
  const janela = R.janelaDoLimite(beneficio, config, competencia, referencia);
  let sql = `SELECT COALESCE(SUM(CASE WHEN status = 'aprovado' THEN valor_aprovado ELSE valor_solicitado END), 0) AS usado
             FROM solicitacoes WHERE cpf = ? AND beneficio = ? AND status IN ('analise', 'aprovado') AND id <> ?`;
  const params = [cpf, beneficio, excluirId];
  if (b.escopo !== 'familia_mes') { sql += ' AND dependente_id IS ?'; params.push(dependenteId ?? null); }
  if (janela.tipo === 'competencia') { sql += ' AND competencia = ?'; params.push(competencia); }
  else { sql += ' AND data_documento > ?'; params.push(janela.desde); }
  return { usado: db.prepare(sql).get(...params).usado, janela };
}

function saldo(colab, beneficio, dependenteId, competencia, referencia, config, excluirId) {
  const limite = R.limiteDoBeneficio(beneficio, colab, config);
  const { usado, janela } = usoDoLimite({ cpf: colab.cpf, beneficio, dependenteId, competencia, referencia, excluirId }, config);
  return { limite, usado, disponivel: Math.max(0, limite - usado), janela };
}

function dependentesDe(cpf) {
  return db.prepare('SELECT * FROM dependentes WHERE cpf_titular = ? AND ativo = 1 ORDER BY nome').all(cpf)
    .map(d => ({ ...d, elegibilidade: JSON.parse(d.elegibilidade || '{}') }));
}

/** Benefícios disponíveis ao colaborador, cada um só com os beneficiários elegíveis e o saldo de cada um. */
function beneficiosDoColaborador(colab, hoje, config) {
  const competencia = R.competenciaDe(hoje);
  const deps = dependentesDe(colab.cpf);
  const lista = [];
  for (const codigo of R.CODIGOS) {
    const b = R.BENEFICIOS[codigo];
    const pessoas = [{ id: 0, nome: colab.nome, tipo: 'titular', rotulo: 'Titular', dep: null }, ...deps.map(d => ({
      id: d.id, nome: d.nome, tipo: d.parentesco, rotulo: R.PARENTESCOS[d.parentesco] || d.parentesco, dep: d,
    }))];
    const beneficiarios = pessoas
      .filter(p => R.elegibilidade(codigo, colab, p.dep, hoje, config).elegivel)
      .map(p => {
        const s = saldo(colab, codigo, p.dep ? p.dep.id : null, competencia, hoje, config);
        return { id: p.id, nome: p.nome, tipo: p.tipo, rotulo: p.rotulo, limite: s.limite, usado: s.usado, disponivel: s.disponivel };
      });
    if (!beneficiarios.length) continue;
    const limite = R.limiteDoBeneficio(codigo, colab, config);
    lista.push({
      codigo, nome: b.nome, curto: b.curto, icone: b.icone, escopo: b.escopo, limite,
      periodo_meses: config.beneficios[codigo].periodoMeses,
      elegiveis: b.elegiveis, observacao: b.observacao,
      documentos: b.documentos.map(d => ({ tipo: d, nome: R.DOCUMENTOS[d] })),
      beneficiarios,
      // Medicamento: limite único da família; o saldo é o mesmo para todos os beneficiários.
      disponivel_familia: b.escopo === 'familia_mes' ? beneficiarios[0].disponivel : null,
    });
  }
  return lista;
}

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (PRODUCAO) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '15mb' }));

app.get('/healthz', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

const TIPOS_ARQUIVO = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const CAMPOS_ANEXO = ['receita', 'nota_fiscal', 'boleto', 'comprovante', 'outro'];
const upload = multer({
  storage: multer.diskStorage({
    destination: ANEXOS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${TIPOS_ARQUIVO[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    const ok = Boolean(TIPOS_ARQUIVO[file.mimetype]) && /\.(pdf|jpe?g|png)$/i.test(file.originalname);
    cb(ok ? null : Object.assign(new Error('Envie os documentos em PDF, JPG ou PNG.'), { status: 400 }), ok);
  },
});
const receberAnexos = upload.fields(CAMPOS_ANEXO.map(name => ({ name, maxCount: 3 })));

// ===== Público =====

app.get('/api/publico/info', (_req, res) => {
  const config = configuracao();
  const hoje = R.hojeISO();
  res.json({
    hoje,
    periodo: R.situacaoPeriodo(config, hoje),
    prazo_documento_dias: config.prazo_documento_dias,
    beneficios: R.CODIGOS.filter(c => config.beneficios[c].ativo).map(c => {
      const b = R.BENEFICIOS[c];
      const cfg = config.beneficios[c];
      return {
        codigo: c, nome: b.nome, icone: b.icone, escopo: b.escopo, elegiveis: b.elegiveis, observacao: b.observacao,
        documentos: b.documentos.map(d => R.DOCUMENTOS[d]),
        limite: cfg.limite, limite_sucedido: cfg.limiteSucedido, limite_nao_sucedido: cfg.limiteNaoSucedido, periodo_meses: cfg.periodoMeses,
      };
    }),
  });
});

// ===== Colaborador =====

app.post('/api/entrar', (req, res) => {
  if (limiteColab.bloqueado(req)) return res.status(429).json({ erro: MSG_LIMITE });
  const cpf = normalizarCpf(req.body?.cpf);
  const matricula = normalizarMatricula(req.body?.matricula);
  const colab = cpf && matricula && lerColaborador(cpf);
  if (!colab || normalizarMatricula(colab.matricula) !== matricula) {
    limiteColab.registrar(req);
    return res.status(403).json({ erro: 'CPF ou matrícula não encontrados na base de elegibilidade. Procure o time de RH.' });
  }
  db.prepare("UPDATE colaboradores SET acessos = acessos + 1, ultimo_acesso = datetime('now') WHERE cpf = ?").run(cpf);
  definirSessao(res, 'sess_colab', { cpf }, 8);
  res.json({ ok: true, nome: colab.nome });
});

app.post('/api/sair', (_req, res) => {
  res.clearCookie('sess_colab');
  res.json({ ok: true });
});

function solicitacoesDe(cpf) {
  const lista = db.prepare('SELECT * FROM solicitacoes WHERE cpf = ? ORDER BY id DESC').all(cpf);
  const anexos = db.prepare('SELECT id, tipo, nome_original, tamanho FROM anexos WHERE solicitacao_id = ? ORDER BY id');
  const eventos = db.prepare('SELECT evento, detalhe, em FROM eventos WHERE solicitacao_id = ? ORDER BY id');
  return lista.map(s => ({
    ...s,
    detalhes: JSON.parse(s.detalhes || '{}'),
    beneficio_nome: R.BENEFICIOS[s.beneficio]?.nome || s.beneficio,
    beneficiario_rotulo: s.beneficiario_tipo === 'titular' ? 'Titular' : (R.PARENTESCOS[s.beneficiario_tipo] || s.beneficiario_tipo),
    anexos: anexos.all(s.id).map(a => ({ ...a, tipo_nome: R.DOCUMENTOS[a.tipo] || 'Outro documento' })),
    // O colaborador vê o histórico sem o nome de quem analisou.
    eventos: eventos.all(s.id),
  }));
}

app.get('/api/me', exigirColaborador, (req, res) => {
  const c = req.colab;
  const config = configuracao();
  const hoje = R.hojeISO();
  const ano = hoje.slice(0, 4);
  const resumo = db.prepare(`
    SELECT
      SUM(status = 'analise') AS analise,
      SUM(status = 'aprovado' AND substr(competencia, 1, 4) = ?) AS aprovadas_ano,
      SUM(status = 'reprovado' AND substr(competencia, 1, 4) = ?) AS reprovadas_ano,
      COALESCE(SUM(CASE WHEN status = 'aprovado' AND substr(competencia, 1, 4) = ? THEN valor_aprovado END), 0) AS valor_ano
    FROM solicitacoes WHERE cpf = ?`).get(ano, ano, ano, c.cpf);
  res.json({
    hoje,
    colaborador: {
      cpf: c.cpf, matricula: c.matricula, nome: c.nome, email: c.email, empresa: c.empresa, cnpj: c.cnpj, unidade: c.unidade,
      sucedido: R.ehSucedido(c), data_desligamento: c.data_desligamento,
    },
    periodo: R.situacaoPeriodo(config, hoje),
    prazo_documento_dias: config.prazo_documento_dias,
    niveis_ensino: R.NIVEIS_ENSINO,
    beneficios: beneficiosDoColaborador(c, hoje, config),
    resumo: { analise: resumo.analise || 0, aprovadas_ano: resumo.aprovadas_ano || 0, reprovadas_ano: resumo.reprovadas_ano || 0, valor_ano: resumo.valor_ano },
    email_ativo: emailAtivo(),
  });
});

app.get('/api/solicitacoes', exigirColaborador, (req, res) => res.json(solicitacoesDe(req.colab.cpf)));

/** Saldo de um beneficiário (óculos depende da data do documento, por isso a consulta separada). */
app.get('/api/saldo', exigirColaborador, (req, res) => {
  const config = configuracao();
  const hoje = R.hojeISO();
  const beneficio = String(req.query.beneficio || '');
  if (!R.BENEFICIOS[beneficio]) return res.status(400).json({ erro: 'Benefício inválido.' });
  const depId = Number(req.query.beneficiario) || null;
  const referencia = R.normalizarData(req.query.data_documento) || hoje;
  const s = saldo(req.colab, beneficio, depId, R.competenciaDe(hoje), referencia > hoje ? hoje : referencia, config);
  res.json({ limite: s.limite, usado: s.usado, disponivel: s.disponivel });
});

function apagarArquivos(files) {
  for (const lista of Object.values(files || {})) for (const f of lista) fs.rm(f.path, { force: true }, () => {});
}

app.post('/api/solicitacoes', exigirColaborador, receberAnexos, (req, res) => {
  const colab = req.colab;
  const config = configuracao();
  const hoje = R.hojeISO();
  const files = req.files || {};
  const falhar = (msg, status = 400) => { apagarArquivos(files); res.status(status).json({ erro: msg }); };

  const periodo = R.situacaoPeriodo(config, hoje);
  if (!periodo.aberto) {
    return falhar(`O portal recebe solicitações do dia ${String(config.dia_inicio).padStart(2, '0')} ao dia ${String(config.dia_fim).padStart(2, '0')} de cada mês. Próxima abertura: ${periodo.proxima_abertura.split('-').reverse().join('/')}.`);
  }

  const beneficio = String(req.body.beneficio || '');
  const b = R.BENEFICIOS[beneficio];
  if (!b) return falhar('Selecione o benefício.');

  const depId = Number(req.body.beneficiario) || 0;
  let dep = null;
  if (depId) {
    dep = dependentesDe(colab.cpf).find(d => d.id === depId);
    if (!dep) return falhar('Beneficiário não encontrado na sua base de dependentes.');
  }
  const eleg = R.elegibilidade(beneficio, colab, dep, hoje, config);
  if (!eleg.elegivel) return falhar(`Solicitação não permitida: ${eleg.motivo}`);

  const dataDoc = R.normalizarData(req.body.data_documento);
  const erroData = R.validarDataDocumento(dataDoc, hoje, config.prazo_documento_dias);
  if (erroData) return falhar(erroData);
  if (colab.data_desligamento && dataDoc > colab.data_desligamento) {
    return falhar('A data do documento é posterior à data de desligamento registrada na base.');
  }

  const valor = R.paraCentavos(req.body.valor);
  if (!valor || valor <= 0) return falhar('Informe o valor da despesa.');

  const faltando = b.documentos.filter(d => !(files[d] && files[d].length));
  if (faltando.length) return falhar(`Anexe os documentos obrigatórios: ${faltando.map(d => R.DOCUMENTOS[d]).join(', ')}.`);

  const detalhes = {};
  if (beneficio === 'educacional') {
    if (!R.NIVEIS_ENSINO.includes(req.body.nivel_ensino)) return falhar('Informe o nível de ensino do dependente.');
    detalhes.nivel_ensino = req.body.nivel_ensino;
  }
  if (req.body.declaracao !== 'sim') return falhar('Confirme a declaração antes de enviar.');
  const descricao = String(req.body.descricao || '').trim().slice(0, 500);
  if (descricao) detalhes.descricao = descricao;

  const competencia = R.competenciaDe(hoje);
  // Verificação do limite e gravação sem nenhuma espera entre elas (node:sqlite é síncrono),
  // então duas solicitações simultâneas não passam juntas do limite.
  const s = saldo(colab, beneficio, dep ? dep.id : null, competencia, dataDoc, config);
  if (valor > s.disponivel) {
    const onde = b.escopo === 'familia_mes' ? 'para o grupo familiar neste mês'
      : b.escopo === 'dependente_mes' ? 'para este dependente neste mês'
        : `para este beneficiário nos últimos ${s.janela.meses} meses`;
    return falhar(s.disponivel > 0
      ? `Valor acima do saldo disponível ${onde}: ${R.formatarReais(s.disponivel)} (limite ${R.formatarReais(s.limite)}). Ajuste o valor solicitado.`
      : `Limite atingido ${onde} (${R.formatarReais(s.limite)}). Não há saldo disponível.`);
  }

  let id;
  db.exec('BEGIN IMMEDIATE');
  try {
    id = Number(db.prepare(`
      INSERT INTO solicitacoes (cpf, matricula, nome, empresa, cnpj, unidade, sucedido, beneficio, dependente_id,
        beneficiario_nome, beneficiario_tipo, competencia, data_documento, valor_solicitado, detalhes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      colab.cpf, colab.matricula, colab.nome, colab.empresa, colab.cnpj, colab.unidade, R.ehSucedido(colab) ? 1 : 0,
      beneficio, dep ? dep.id : null, dep ? dep.nome : colab.nome, dep ? dep.parentesco : 'titular',
      competencia, dataDoc, valor, JSON.stringify(detalhes)).lastInsertRowid);
    const protocolo = `RB${competencia.replace('-', '')}-${String(id).padStart(5, '0')}`;
    db.prepare('UPDATE solicitacoes SET protocolo = ? WHERE id = ?').run(protocolo, id);
    const ins = db.prepare('INSERT INTO anexos (solicitacao_id, tipo, arquivo, nome_original, mime, tamanho) VALUES (?, ?, ?, ?, ?, ?)');
    for (const tipo of CAMPOS_ANEXO) for (const f of files[tipo] || []) ins.run(id, tipo, f.filename, f.originalname, f.mimetype, f.size);
    registrarEvento.run(id, 'Solicitação enviada', null, colab.nome);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    apagarArquivos(files);
    throw e;
  }
  const sol = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
  avisar('recebida', sol, colab.email);
  res.status(201).json({ ok: true, protocolo: sol.protocolo, id });
});

/** Anexo: acessível ao próprio colaborador ou ao RH. */
app.get('/api/anexos/:id', (req, res) => {
  const anexo = db.prepare('SELECT a.*, s.cpf FROM anexos a JOIN solicitacoes s ON s.id = a.solicitacao_id WHERE a.id = ?').get(Number(req.params.id));
  if (!anexo) return res.status(404).json({ erro: 'Documento não encontrado.' });
  const colab = verificar(lerCookies(req).sess_colab);
  if (!sessaoRh(req) && !(colab && colab.cpf === anexo.cpf)) return res.status(401).json({ erro: 'Acesso não autorizado.' });
  const arquivo = path.join(ANEXOS_DIR, path.basename(anexo.arquivo));
  if (!fs.existsSync(arquivo)) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  const nome = encodeURIComponent(anexo.nome_original || path.basename(arquivo));
  res.setHeader('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${nome}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.type(anexo.mime || 'application/octet-stream').sendFile(arquivo);
});

// ===== RH =====

app.post('/api/admin/entrar', (req, res) => {
  if (limiteRh.bloqueado(req)) return res.status(429).json({ erro: MSG_LIMITE });
  const login = String(req.body?.login || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM usuarios_rh WHERE login = ? AND ativo = 1').get(login);
  if (!u || !conferirSenha(String(req.body?.senha || ''), u.senha_hash)) {
    limiteRh.registrar(req);
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  definirSessao(res, 'sess_rh', { uid: u.id }, 8);
  res.json({ ok: true, nome: u.nome });
});

app.post('/api/admin/sair', (_req, res) => {
  res.clearCookie('sess_rh');
  res.json({ ok: true });
});

app.get('/api/admin/sessao', exigirRh, (req, res) => res.json({ ...req.rh, email_ativo: emailAtivo() }));

// -- Painel --

app.get('/api/admin/painel', exigirRh, (req, res) => {
  const config = configuracao();
  const hoje = R.hojeISO();
  const competencia = /^\d{4}-\d{2}$/.test(req.query.competencia || '') ? req.query.competencia : R.competenciaDe(hoje);
  const tot = db.prepare(`
    SELECT COUNT(*) AS total, SUM(status = 'analise') AS analise, SUM(status = 'aprovado') AS aprovadas, SUM(status = 'reprovado') AS reprovadas,
      COALESCE(SUM(valor_solicitado), 0) AS valor_solicitado,
      COALESCE(SUM(CASE WHEN status = 'aprovado' THEN valor_aprovado END), 0) AS valor_aprovado,
      COUNT(DISTINCT cpf) AS colaboradores,
      AVG(CASE WHEN analisado_em IS NOT NULL THEN julianday(analisado_em) - julianday(criado_em) END) AS dias_analise
    FROM solicitacoes WHERE competencia = ?`).get(competencia);
  const porBeneficio = R.CODIGOS.map(c => {
    const r = db.prepare(`
      SELECT COUNT(*) AS total, SUM(status = 'analise') AS analise, SUM(status = 'aprovado') AS aprovadas, SUM(status = 'reprovado') AS reprovadas,
        COALESCE(SUM(CASE WHEN status = 'aprovado' THEN valor_aprovado END), 0) AS valor_aprovado
      FROM solicitacoes WHERE competencia = ? AND beneficio = ?`).get(competencia, c);
    return { codigo: c, nome: R.BENEFICIOS[c].nome, icone: R.BENEFICIOS[c].icone, ...r };
  });
  const porEmpresa = db.prepare(`
    SELECT COALESCE(NULLIF(empresa, ''), '—') AS empresa, COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'aprovado' THEN valor_aprovado END), 0) AS valor_aprovado
    FROM solicitacoes WHERE competencia = ? GROUP BY 1 ORDER BY valor_aprovado DESC, total DESC`).all(competencia);
  const base = db.prepare('SELECT COUNT(*) AS ativos, (SELECT COUNT(*) FROM dependentes d JOIN colaboradores c ON c.cpf = d.cpf_titular WHERE d.ativo = 1 AND c.ativo = 1) AS dependentes FROM colaboradores WHERE ativo = 1').get();
  const ultimaCarga = db.prepare('SELECT tipo, linhas, por, em FROM importacoes ORDER BY id DESC LIMIT 1').get() || null;
  const pendentesAnteriores = db.prepare("SELECT COUNT(*) AS n FROM solicitacoes WHERE status = 'analise' AND competencia < ?").get(competencia).n;
  res.json({
    competencia, hoje, periodo: R.situacaoPeriodo(config, hoje), totais: tot, por_beneficio: porBeneficio, por_empresa: porEmpresa,
    base, ultima_carga: ultimaCarga, pendentes_anteriores: pendentesAnteriores,
  });
});

// -- Solicitações --

app.get('/api/admin/filtros', exigirRh, (_req, res) => {
  const col = (sql) => db.prepare(sql).all().map(r => r.v).filter(Boolean);
  res.json({
    competencias: [...new Set([R.competenciaDe(R.hojeISO()), ...col('SELECT DISTINCT competencia AS v FROM solicitacoes ORDER BY v DESC')])].sort().reverse(),
    empresas: col("SELECT DISTINCT empresa AS v FROM colaboradores WHERE empresa <> '' UNION SELECT DISTINCT empresa FROM solicitacoes WHERE empresa <> '' ORDER BY v"),
    unidades: col("SELECT DISTINCT unidade AS v FROM colaboradores WHERE unidade <> '' UNION SELECT DISTINCT unidade FROM solicitacoes WHERE unidade <> '' ORDER BY v"),
    beneficios: R.CODIGOS.map(c => ({ codigo: c, nome: R.BENEFICIOS[c].nome })),
  });
});

function filtrarSolicitacoes(q) {
  const where = [];
  const params = [];
  if (/^\d{4}-\d{2}$/.test(q.competencia || '')) { where.push('competencia = ?'); params.push(q.competencia); }
  if (['analise', 'aprovado', 'reprovado'].includes(q.status)) { where.push('status = ?'); params.push(q.status); }
  if (R.BENEFICIOS[q.beneficio]) { where.push('beneficio = ?'); params.push(q.beneficio); }
  if (q.empresa) { where.push('empresa = ?'); params.push(q.empresa); }
  if (q.unidade) { where.push('unidade = ?'); params.push(q.unidade); }
  if (R.normalizarData(q.de)) { where.push('date(criado_em) >= ?'); params.push(R.normalizarData(q.de)); }
  if (R.normalizarData(q.ate)) { where.push('date(criado_em) <= ?'); params.push(R.normalizarData(q.ate)); }
  const busca = String(q.busca || '').trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    where.push('(nome LIKE ? OR matricula LIKE ? OR protocolo LIKE ? OR beneficiario_nome LIKE ?' + (digitos ? ' OR cpf LIKE ?' : '') + ')');
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
    if (digitos) params.push(`%${digitos}%`);
  }
  return db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM anexos a WHERE a.solicitacao_id = s.id) AS qtd_anexos
    FROM solicitacoes s ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE status WHEN 'analise' THEN 0 ELSE 1 END, s.id DESC LIMIT 2000`).all(...params);
}

app.get('/api/admin/solicitacoes', exigirRh, (req, res) => {
  res.json(filtrarSolicitacoes(req.query).map(s => ({
    ...s, beneficio_nome: R.BENEFICIOS[s.beneficio]?.nome || s.beneficio,
    beneficiario_rotulo: s.beneficiario_tipo === 'titular' ? 'Titular' : (R.PARENTESCOS[s.beneficiario_tipo] || s.beneficiario_tipo),
  })));
});

app.get('/api/admin/solicitacoes/:id', exigirRh, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ erro: 'Solicitação não encontrada.' });
  const config = configuracao();
  const colab = db.prepare('SELECT * FROM colaboradores WHERE cpf = ?').get(s.cpf) || {};
  // Saldo calculado com o cadastro do envio (sucedido) e desconsiderando a própria solicitação.
  const ctx = { ...colab, cpf: s.cpf, sucedido: s.sucedido };
  const sal = saldo(ctx, s.beneficio, s.dependente_id, s.competencia, s.data_documento, config, s.id);
  const b = R.BENEFICIOS[s.beneficio];
  let historico = db.prepare(`
    SELECT id, protocolo, competencia, data_documento, beneficiario_nome, valor_solicitado, valor_aprovado, status
    FROM solicitacoes WHERE cpf = ? AND beneficio = ? AND id <> ? ${b.escopo === 'familia_mes' ? '' : 'AND dependente_id IS ?'}
    ORDER BY id DESC LIMIT 20`);
  historico = b.escopo === 'familia_mes' ? historico.all(s.cpf, s.beneficio, s.id) : historico.all(s.cpf, s.beneficio, s.id, s.dependente_id);
  res.json({
    ...s,
    detalhes: JSON.parse(s.detalhes || '{}'),
    beneficio_nome: b.nome,
    beneficiario_rotulo: s.beneficiario_tipo === 'titular' ? 'Titular' : (R.PARENTESCOS[s.beneficiario_tipo] || s.beneficiario_tipo),
    documentos_exigidos: b.documentos.map(d => R.DOCUMENTOS[d]),
    email: colab.email || null,
    anexos: db.prepare('SELECT id, tipo, nome_original, mime, tamanho FROM anexos WHERE solicitacao_id = ? ORDER BY id').all(s.id)
      .map(a => ({ ...a, tipo_nome: R.DOCUMENTOS[a.tipo] || 'Outro documento' })),
    eventos: db.prepare('SELECT evento, detalhe, por, em FROM eventos WHERE solicitacao_id = ? ORDER BY id').all(s.id),
    saldo: { limite: sal.limite, usado: sal.usado, disponivel: sal.disponivel, escopo: b.escopo, janela: sal.janela },
    historico,
    dias_documento: R.diasEntre(s.data_documento, s.criado_em.slice(0, 10)),
  });
});

app.post('/api/admin/solicitacoes/:id/decidir', exigirRh, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ erro: 'Solicitação não encontrada.' });
  if (s.status !== 'analise') return res.status(409).json({ erro: 'Esta solicitação já foi analisada. Reabra-a para alterar a decisão.' });
  const decisao = req.body?.decisao;
  const observacao = String(req.body?.observacao || '').trim().slice(0, 1000);
  const config = configuracao();

  if (decisao === 'reprovado') {
    if (observacao.length < 5) return res.status(400).json({ erro: 'Informe a justificativa da reprovação (ela será exibida ao colaborador).' });
    db.prepare("UPDATE solicitacoes SET status = 'reprovado', valor_aprovado = NULL, observacao_rh = ?, analisado_em = datetime('now'), analisado_por = ? WHERE id = ?")
      .run(observacao, req.rh.nome, s.id);
    registrarEvento.run(s.id, 'Reprovada', observacao, req.rh.nome);
  } else if (decisao === 'aprovado') {
    const valor = req.body?.valor_aprovado === undefined || req.body?.valor_aprovado === '' ? s.valor_solicitado : R.paraCentavos(req.body.valor_aprovado);
    if (!valor || valor <= 0) return res.status(400).json({ erro: 'Informe o valor aprovado.' });
    if (valor > s.valor_solicitado) return res.status(400).json({ erro: 'O valor aprovado não pode ser maior que o valor solicitado.' });
    const colab = db.prepare('SELECT * FROM colaboradores WHERE cpf = ?').get(s.cpf) || {};
    const sal = saldo({ ...colab, cpf: s.cpf, sucedido: s.sucedido }, s.beneficio, s.dependente_id, s.competencia, s.data_documento, config, s.id);
    if (valor > sal.disponivel) {
      return res.status(400).json({ erro: `O valor ultrapassa o saldo do limite (${R.formatarReais(sal.disponivel)} disponível de ${R.formatarReais(sal.limite)}). Aprove até o saldo ou reprove.` });
    }
    db.prepare("UPDATE solicitacoes SET status = 'aprovado', valor_aprovado = ?, observacao_rh = ?, analisado_em = datetime('now'), analisado_por = ? WHERE id = ?")
      .run(valor, observacao || null, req.rh.nome, s.id);
    registrarEvento.run(s.id, 'Aprovada', `${R.formatarReais(valor)}${valor < s.valor_solicitado ? ' (parcial)' : ''}${observacao ? ` · ${observacao}` : ''}`, req.rh.nome);
  } else {
    return res.status(400).json({ erro: 'Decisão inválida.' });
  }
  const atual = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(s.id);
  const email = db.prepare('SELECT email FROM colaboradores WHERE cpf = ?').get(s.cpf)?.email;
  avisar(decisao, atual, email);
  res.json({ ok: true });
});

app.post('/api/admin/solicitacoes/:id/reabrir', exigirRh, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ erro: 'Solicitação não encontrada.' });
  if (s.status === 'analise') return res.status(409).json({ erro: 'A solicitação já está em análise.' });
  const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
  if (motivo.length < 5) return res.status(400).json({ erro: 'Informe o motivo da reabertura.' });
  db.prepare("UPDATE solicitacoes SET status = 'analise', valor_aprovado = NULL, observacao_rh = NULL, analisado_em = NULL, analisado_por = NULL WHERE id = ?").run(s.id);
  registrarEvento.run(s.id, 'Reaberta para nova análise', motivo, req.rh.nome);
  res.json({ ok: true });
});

// -- Base de elegibilidade --

app.get('/api/admin/colaboradores', exigirRh, (_req, res) => {
  const config = configuracao();
  const hoje = R.hojeISO();
  const deps = db.prepare('SELECT * FROM dependentes WHERE ativo = 1 ORDER BY nome').all();
  const porTitular = new Map();
  for (const d of deps) {
    d.elegibilidade = JSON.parse(d.elegibilidade || '{}');
    if (!porTitular.has(d.cpf_titular)) porTitular.set(d.cpf_titular, []);
    porTitular.get(d.cpf_titular).push(d);
  }
  const lista = db.prepare('SELECT * FROM colaboradores ORDER BY nome').all().map(c => {
    c.elegibilidade = JSON.parse(c.elegibilidade || '{}');
    const ds = porTitular.get(c.cpf) || [];
    // Para cada benefício: quem é elegível (titular e/ou dependentes).
    const beneficios = Object.fromEntries(R.CODIGOS.map(cod => {
      const nomes = [];
      if (R.elegibilidade(cod, c, null, hoje, config).elegivel) nomes.push('Titular');
      for (const d of ds) if (R.elegibilidade(cod, c, d, hoje, config).elegivel) nomes.push(d.nome);
      return [cod, nomes];
    }));
    return {
      cpf: c.cpf, matricula: c.matricula, nome: c.nome, email: c.email, empresa: c.empresa, cnpj: c.cnpj, unidade: c.unidade,
      data_admissao: c.data_admissao, sucedido: R.ehSucedido(c), data_desligamento: c.data_desligamento, ativo: c.ativo,
      ultimo_acesso: c.ultimo_acesso,
      dependentes: ds.map(d => ({ nome: d.nome, parentesco: R.PARENTESCOS[d.parentesco] || d.parentesco, data_nascimento: d.data_nascimento })),
      beneficios,
    };
  });
  res.json(lista);
});

app.patch('/api/admin/colaboradores/:cpf', exigirRh, (req, res) => {
  const cpf = normalizarCpf(req.params.cpf);
  const r = db.prepare("UPDATE colaboradores SET ativo = ?, atualizado_em = datetime('now') WHERE cpf = ?").run(req.body?.ativo ? 1 : 0, cpf);
  if (!r.changes) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
  res.json({ ok: true });
});

const lerElegibilidade = (l) => Object.fromEntries(R.CODIGOS.map(c => [c, R.lerMarcador(l[c])]));

app.post('/api/admin/base/colaboradores', exigirRh, (req, res) => {
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
  const substituir = req.body?.modo === 'substituir';
  const invalidas = [];
  const validos = [];
  linhas.forEach((l, i) => {
    const cpf = normalizarCpf(l.cpf);
    const nome = String(l.nome || '').trim();
    const matricula = String(l.matricula || '').trim();
    const motivo = !cpf ? 'CPF inválido' : !nome ? 'Nome vazio' : !matricula ? 'Matrícula vazia' : null;
    if (motivo) return invalidas.push({ linha: i + 2, motivo });
    const suc = R.lerMarcador(l.sucedido);
    validos.push({
      cpf, matricula, nome,
      email: String(l.email || '').trim().toLowerCase(),
      empresa: String(l.empresa || '').trim(),
      cnpj: String(l.cnpj || '').trim(),
      unidade: String(l.unidade || '').trim(),
      data_admissao: R.normalizarData(l.data_admissao),
      sucedido: suc === 'S' ? 1 : suc === 'N' ? 0 : null,
      data_desligamento: R.normalizarData(l.data_desligamento),
      elegibilidade: JSON.stringify(lerElegibilidade(l)),
    });
  });
  const upsert = db.prepare(`
    INSERT INTO colaboradores (cpf, matricula, nome, email, empresa, cnpj, unidade, data_admissao, sucedido, data_desligamento, elegibilidade, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(cpf) DO UPDATE SET matricula = excluded.matricula, nome = excluded.nome, email = excluded.email, empresa = excluded.empresa,
      cnpj = excluded.cnpj, unidade = excluded.unidade, data_admissao = excluded.data_admissao, sucedido = excluded.sucedido,
      data_desligamento = excluded.data_desligamento, elegibilidade = excluded.elegibilidade, ativo = 1, atualizado_em = datetime('now')`);
  db.exec('BEGIN');
  try {
    if (substituir) db.exec("UPDATE colaboradores SET ativo = 0, atualizado_em = datetime('now')");
    for (const c of validos) upsert.run(c.cpf, c.matricula, c.nome, c.email, c.empresa, c.cnpj, c.unidade, c.data_admissao, c.sucedido, c.data_desligamento, c.elegibilidade);
    db.prepare('INSERT INTO importacoes (tipo, modo, linhas, invalidas, por) VALUES (?, ?, ?, ?, ?)').run('colaboradores', substituir ? 'substituir' : 'atualizar', validos.length, invalidas.length, req.rh.nome);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const ativos = db.prepare('SELECT COUNT(*) AS n FROM colaboradores WHERE ativo = 1').get().n;
  res.json({ importados: validos.length, invalidas, ativos });
});

app.post('/api/admin/base/dependentes', exigirRh, (req, res) => {
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
  const substituir = req.body?.modo === 'substituir';
  const invalidas = [];
  const validos = [];
  const titulares = new Set(db.prepare('SELECT cpf FROM colaboradores').all().map(r => r.cpf));
  linhas.forEach((l, i) => {
    const cpfTitular = normalizarCpf(l.cpf_titular);
    const nome = String(l.nome || '').trim();
    const parentesco = R.normalizarParentesco(l.parentesco);
    const nascimento = R.normalizarData(l.data_nascimento);
    const cpf = normalizarCpf(l.cpf);
    const motivo = !cpfTitular ? 'CPF do titular inválido' : !titulares.has(cpfTitular) ? 'Titular não está na base de colaboradores'
      : !nome ? 'Nome vazio' : !parentesco ? `Parentesco não reconhecido (${l.parentesco || 'vazio'})` : null;
    if (motivo) return invalidas.push({ linha: i + 2, motivo });
    const chave = cpf || `${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ')}|${nascimento || ''}`;
    validos.push({ cpfTitular, chave, nome, cpf, parentesco, nascimento, elegibilidade: JSON.stringify(lerElegibilidade(l)) });
  });
  const upsert = db.prepare(`
    INSERT INTO dependentes (cpf_titular, chave, nome, cpf, parentesco, data_nascimento, elegibilidade, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(cpf_titular, chave) DO UPDATE SET nome = excluded.nome, cpf = excluded.cpf, parentesco = excluded.parentesco,
      data_nascimento = excluded.data_nascimento, elegibilidade = excluded.elegibilidade, ativo = 1, atualizado_em = datetime('now')`);
  db.exec('BEGIN');
  try {
    if (substituir) db.exec("UPDATE dependentes SET ativo = 0, atualizado_em = datetime('now')");
    for (const d of validos) upsert.run(d.cpfTitular, d.chave, d.nome, d.cpf, d.parentesco, d.nascimento, d.elegibilidade);
    db.prepare('INSERT INTO importacoes (tipo, modo, linhas, invalidas, por) VALUES (?, ?, ?, ?, ?)').run('dependentes', substituir ? 'substituir' : 'atualizar', validos.length, invalidas.length, req.rh.nome);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const ativos = db.prepare('SELECT COUNT(*) AS n FROM dependentes WHERE ativo = 1').get().n;
  res.json({ importados: validos.length, invalidas, ativos });
});

app.get('/api/admin/importacoes', exigirRh, (_req, res) => {
  res.json(db.prepare('SELECT * FROM importacoes ORDER BY id DESC LIMIT 24').all());
});

// -- Relatório para a folha de pagamento --

function linhasDaFolha(competencia) {
  const config = configuracao();
  return db.prepare("SELECT * FROM solicitacoes WHERE competencia = ? AND status = 'aprovado' ORDER BY empresa, nome, beneficio").all(competencia).map(s => ({
    matricula: s.matricula, nome: s.nome, cpf: s.cpf, empresa: s.empresa, cnpj: s.cnpj, unidade: s.unidade,
    beneficio: R.BENEFICIOS[s.beneficio]?.nome || s.beneficio,
    beneficiario: s.beneficiario_nome,
    parentesco: s.beneficiario_tipo === 'titular' ? 'Titular' : (R.PARENTESCOS[s.beneficiario_tipo] || s.beneficiario_tipo),
    competencia: s.competencia,
    valor_aprovado: s.valor_aprovado,
    verba: config.beneficios[s.beneficio]?.verba || '',
    data_aprovacao: s.analisado_em,
    aprovado_por: s.analisado_por,
    protocolo: s.protocolo,
    status: 'Aprovado',
  }));
}

app.get('/api/admin/folha', exigirRh, (req, res) => {
  const competencia = /^\d{4}-\d{2}$/.test(req.query.competencia || '') ? req.query.competencia : R.competenciaDe(R.hojeISO());
  const linhas = linhasDaFolha(competencia);
  const pendentes = db.prepare("SELECT COUNT(*) AS n FROM solicitacoes WHERE competencia = ? AND status = 'analise'").get(competencia).n;
  res.json({ competencia, linhas, pendentes, total: linhas.reduce((a, l) => a + l.valor_aprovado, 0) });
});

app.get('/api/admin/folha.csv', exigirRh, (req, res) => {
  const competencia = /^\d{4}-\d{2}$/.test(req.query.competencia || '') ? req.query.competencia : R.competenciaDe(R.hojeISO());
  const cab = ['Matrícula', 'Nome do colaborador', 'CPF', 'Empresa', 'CNPJ', 'Unidade/lotação', 'Benefício', 'Beneficiário', 'Parentesco',
    'Competência', 'Valor aprovado', 'Verba de folha', 'Data da aprovação', 'Aprovado por', 'Protocolo', 'Status'];
  const campo = (v) => {
    const s = String(v ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = linhasDaFolha(competencia).map(l => [
    l.matricula, l.nome, l.cpf, l.empresa, l.cnpj, l.unidade, l.beneficio, l.beneficiario, l.parentesco,
    l.competencia.split('-').reverse().join('/'), (l.valor_aprovado / 100).toFixed(2).replace('.', ','), l.verba,
    (l.data_aprovacao || '').slice(0, 10).split('-').reverse().join('/'), l.aprovado_por, l.protocolo, l.status,
  ].map(campo).join(';'));
  res.setHeader('Content-Disposition', `attachment; filename="reembolsos-folha-${competencia}.csv"`);
  res.type('text/csv; charset=utf-8').send(`﻿${[cab.join(';'), ...linhas].join('\r\n')}\r\n`);
});

// -- Configurações e usuários do RH --

app.get('/api/admin/configuracoes', exigirRh, (_req, res) => {
  res.json({
    config: configuracao(),
    beneficios: Object.fromEntries(R.CODIGOS.map(c => [c, { nome: R.BENEFICIOS[c].nome, icone: R.BENEFICIOS[c].icone, escopo: R.BENEFICIOS[c].escopo }])),
    email_ativo: emailAtivo(),
  });
});

app.put('/api/admin/configuracoes', exigirRh, (req, res) => {
  const atual = configuracao();
  const e = req.body || {};
  const inteiro = (v, min, max, padrao) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
  };
  const nova = {
    dia_inicio: inteiro(e.dia_inicio, 1, 28, atual.dia_inicio),
    dia_fim: inteiro(e.dia_fim, 1, 31, atual.dia_fim),
    prazo_documento_dias: inteiro(e.prazo_documento_dias, 1, 365, atual.prazo_documento_dias),
    excecao_ate: R.normalizarData(e.excecao_ate) || '',
    beneficios: {},
  };
  if (nova.dia_fim < nova.dia_inicio) return res.status(400).json({ erro: 'O dia de fechamento deve ser igual ou posterior ao dia de abertura.' });
  for (const c of R.CODIGOS) {
    const b = (e.beneficios || {})[c] || {};
    const a = atual.beneficios[c];
    const cent = (v, padrao) => (v === undefined ? padrao : (R.paraCentavos(v) ?? padrao));
    nova.beneficios[c] = {
      ativo: b.ativo === undefined ? a.ativo : Boolean(b.ativo),
      verba: String(b.verba ?? a.verba).trim().slice(0, 30),
      limite: a.limite === null ? null : cent(b.limite, a.limite),
      limiteSucedido: a.limiteSucedido === null ? null : cent(b.limiteSucedido, a.limiteSucedido),
      limiteNaoSucedido: a.limiteNaoSucedido === null ? null : cent(b.limiteNaoSucedido, a.limiteNaoSucedido),
      periodoMeses: a.periodoMeses === null ? null : inteiro(b.periodoMeses, 1, 60, a.periodoMeses),
    };
  }
  db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('portal', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(nova));
  res.json({ ok: true, config: nova });
});

app.get('/api/admin/usuarios', exigirRh, (_req, res) => {
  res.json(db.prepare('SELECT id, nome, login, ativo, criado_em FROM usuarios_rh ORDER BY nome').all());
});

app.post('/api/admin/usuarios', exigirRh, (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const login = String(req.body?.login || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  if (!nome || !/^[a-z0-9._@-]{3,60}$/.test(login)) return res.status(400).json({ erro: 'Informe nome e um login válido (letras, números, ponto ou e-mail).' });
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios_rh WHERE login = ?').get(login)) return res.status(409).json({ erro: 'Já existe um usuário com este login.' });
  db.prepare('INSERT INTO usuarios_rh (nome, login, senha_hash) VALUES (?, ?, ?)').run(nome, login, gerarHash(senha));
  res.status(201).json({ ok: true });
});

app.patch('/api/admin/usuarios/:id', exigirRh, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM usuarios_rh WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (req.body?.senha !== undefined) {
    if (String(req.body.senha).length < 8) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' });
    db.prepare('UPDATE usuarios_rh SET senha_hash = ? WHERE id = ?').run(gerarHash(req.body.senha), id);
  }
  if (req.body?.ativo !== undefined) {
    if (id === req.rh.id && !req.body.ativo) return res.status(400).json({ erro: 'Você não pode desativar o próprio usuário.' });
    db.prepare('UPDATE usuarios_rh SET ativo = ? WHERE id = ?').run(req.body.ativo ? 1 : 0, id);
  }
  res.json({ ok: true });
});

// -- Backup do banco (base, solicitações e histórico; os anexos ficam na pasta de dados) --

app.get('/api/admin/backup', exigirRh, (_req, res) => {
  const arquivo = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
  res.download(arquivo, `reembolsos-backup-${R.hojeISO()}.db`, () => fs.rm(arquivo, { force: true }, () => {}));
});

// ---------- estáticos e erros ----------

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, _next) => {
  if (req.files) apagarArquivos(req.files);
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Cada documento pode ter no máximo 10 MB.' : 'Quantidade de arquivos acima do permitido.';
    return res.status(400).json({ erro: msg });
  }
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ erro: err.status ? err.message : 'Erro inesperado. Tente novamente.' });
});

app.listen(PORT, () => console.log(`Portal de Reembolsos rodando em http://localhost:${PORT}`));
