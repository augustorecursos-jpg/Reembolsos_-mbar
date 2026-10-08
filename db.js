// Banco de dados SQLite (módulo nativo node:sqlite, sem dependências nativas).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ANEXOS_DIR = path.join(DATA_DIR, 'anexos');
fs.mkdirSync(ANEXOS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'reembolsos.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
-- Base mensal de elegibilidade: colaboradores (titulares).
-- elegibilidade: JSON { medicamento: 'S'|'N'|'', educacional, creche, oculos } (vazio = segue a regra do benefício).
CREATE TABLE IF NOT EXISTS colaboradores (
  cpf               TEXT PRIMARY KEY,
  matricula         TEXT NOT NULL,
  nome              TEXT NOT NULL,
  email             TEXT,
  unidade           TEXT,
  data_admissao     TEXT,
  sucedido          INTEGER,          -- 1 sucedido, 0 não sucedido, NULL = pela data de admissão
  data_desligamento TEXT,
  elegibilidade     TEXT NOT NULL DEFAULT '{}',
  ativo             INTEGER NOT NULL DEFAULT 1,
  acessos           INTEGER NOT NULL DEFAULT 0,
  ultimo_acesso     TEXT,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dependentes. A chave identifica o mesmo dependente entre uma carga mensal e outra
-- (CPF do dependente ou, sem CPF, nome + data de nascimento), preservando o histórico de limites.
CREATE TABLE IF NOT EXISTS dependentes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cpf_titular     TEXT NOT NULL REFERENCES colaboradores(cpf) ON DELETE CASCADE,
  chave           TEXT NOT NULL,
  nome            TEXT NOT NULL,
  cpf             TEXT,
  parentesco      TEXT NOT NULL,
  data_nascimento TEXT,
  elegibilidade   TEXT NOT NULL DEFAULT '{}',
  ativo           INTEGER NOT NULL DEFAULT 1,
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cpf_titular, chave)
);

-- Solicitações. Os dados cadastrais são copiados no envio para o relatório da folha não mudar
-- quando a base mensal for atualizada.
CREATE TABLE IF NOT EXISTS solicitacoes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  protocolo          TEXT UNIQUE,
  cpf                TEXT NOT NULL REFERENCES colaboradores(cpf),
  matricula          TEXT,
  nome               TEXT,
  unidade            TEXT,
  sucedido           INTEGER,
  beneficio          TEXT NOT NULL,
  dependente_id      INTEGER REFERENCES dependentes(id),   -- NULL = o próprio titular
  beneficiario_nome  TEXT NOT NULL,
  beneficiario_tipo  TEXT NOT NULL,                        -- titular | código do parentesco
  competencia        TEXT NOT NULL,                        -- AAAA-MM
  data_documento     TEXT NOT NULL,
  valor_solicitado   INTEGER NOT NULL,                     -- centavos
  valor_aprovado     INTEGER,                              -- centavos
  detalhes           TEXT NOT NULL DEFAULT '{}',           -- JSON: nível de ensino, descrição etc.
  status             TEXT NOT NULL DEFAULT 'analise',      -- analise | aprovado | reprovado
  observacao_rh      TEXT,
  criado_em          TEXT NOT NULL DEFAULT (datetime('now')),
  analisado_em       TEXT,
  analisado_por      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sol_cpf ON solicitacoes (cpf, beneficio, competencia);
CREATE INDEX IF NOT EXISTS idx_sol_comp ON solicitacoes (competencia, status);

CREATE TABLE IF NOT EXISTS anexos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitacao_id INTEGER NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL,     -- receita | nota_fiscal | boleto | comprovante | outro
  arquivo        TEXT NOT NULL,
  nome_original  TEXT,
  mime           TEXT,
  tamanho        INTEGER,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rastreabilidade: quem fez o quê e quando em cada solicitação.
CREATE TABLE IF NOT EXISTS eventos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitacao_id INTEGER NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
  evento         TEXT NOT NULL,
  detalhe        TEXT,
  por            TEXT,
  em             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios_rh (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  login      TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS importacoes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo       TEXT NOT NULL,         -- colaboradores | dependentes
  modo       TEXT NOT NULL,
  linhas     INTEGER NOT NULL,
  invalidas  INTEGER NOT NULL,
  por        TEXT,
  em         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`);

// ---------- atualizações do esquema (bancos criados antes de cada versão) ----------

function adicionarColuna(tabela, coluna, definicao) {
  const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some(c => c.name === coluna);
  if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  return !existe;
}

// Perfis de acesso: 'rh' (analisa solicitações) e 'admin' (controla a ferramenta inteira).
if (adicionarColuna('usuarios_rh', 'perfil', "TEXT NOT NULL DEFAULT 'rh'")) {
  db.exec("UPDATE usuarios_rh SET perfil = 'admin' WHERE login = 'admin'");
}
adicionarColuna('usuarios_rh', 'ultimo_acesso', 'TEXT');
// Comentários internos do RH não aparecem para o colaborador.
adicionarColuna('eventos', 'interno', 'INTEGER NOT NULL DEFAULT 0');
// Controle de acesso do colaborador pelo RH (nunca apaga o cadastro: o histórico de solicitações é mantido).
// ativo = está na base; bloqueado = bloqueio manual (vale mesmo após novas cargas da base);
// excluido_em = acesso excluído pelo RH (some da lista padrão; volta se o CPF vier numa nova carga ou for restaurado).
adicionarColuna('colaboradores', 'bloqueado', 'INTEGER NOT NULL DEFAULT 0');
adicionarColuna('colaboradores', 'motivo_bloqueio', 'TEXT');
adicionarColuna('colaboradores', 'excluido_em', 'TEXT');
adicionarColuna('colaboradores', 'origem', "TEXT NOT NULL DEFAULT 'base'"); // base | manual

// Registro das ações de quem usa a Área do RH e a Administração.
db.exec(`
CREATE TABLE IF NOT EXISTS auditoria (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT,
  perfil  TEXT,
  acao    TEXT NOT NULL,
  detalhe TEXT,
  ip      TEXT,
  em      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auditoria_em ON auditoria (em);
`);

// ---------- senhas do RH (scrypt) ----------

function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha), sal, 32);
  return `${sal.toString('hex')}:${hash.toString('hex')}`;
}

function conferirSenha(senha, guardado) {
  const [salHex, hashHex] = String(guardado).split(':');
  if (!salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

/** Garante um administrador: na primeira execução cria o usuário "admin" com a senha de ADMIN_PASSWORD. */
function garantirAdministrador(senhaInicial) {
  const existe = db.prepare("SELECT COUNT(*) AS n FROM usuarios_rh WHERE perfil = 'admin'").get().n;
  if (existe || !senhaInicial) return;
  if (db.prepare("SELECT 1 FROM usuarios_rh WHERE login = 'admin'").get()) {
    db.prepare("UPDATE usuarios_rh SET perfil = 'admin', ativo = 1 WHERE login = 'admin'").run();
    return;
  }
  db.prepare("INSERT INTO usuarios_rh (nome, login, senha_hash, perfil) VALUES (?, ?, ?, 'admin')").run('Administrador', 'admin', gerarHash(senhaInicial));
  console.log('[admin] Usuário "admin" (administrador) criado com a senha de ADMIN_PASSWORD. Cadastre o time de RH na Administração.');
}

module.exports = { db, DATA_DIR, ANEXOS_DIR, gerarHash, conferirSenha, garantirAdministrador };
