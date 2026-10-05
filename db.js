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
  empresa           TEXT,
  cnpj              TEXT,
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
  empresa            TEXT,
  cnpj               TEXT,
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

/** Na primeira execução cria o usuário "admin" do RH com a senha de ADMIN_PASSWORD. */
function garantirAdministrador(senhaInicial) {
  const existe = db.prepare('SELECT COUNT(*) AS n FROM usuarios_rh').get().n;
  if (existe || !senhaInicial) return;
  db.prepare('INSERT INTO usuarios_rh (nome, login, senha_hash) VALUES (?, ?, ?)').run('Administrador', 'admin', gerarHash(senhaInicial));
  console.log('[rh] Usuário "admin" criado com a senha de ADMIN_PASSWORD. Cadastre os analistas em Configurações.');
}

module.exports = { db, DATA_DIR, ANEXOS_DIR, gerarHash, conferirSenha, garantirAdministrador };
