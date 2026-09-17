-- ============================================================================
-- Simulador FCI · Cervejaria Cidade Imperial
-- Schema PostgreSQL — Semana 1 (fundação de dados, parâmetros e cenário)
-- Requisitos: RF-001, RF-002, RF-007, RF-090..RF-100 · RNF-04/05/06/07
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS fci;
SET search_path TO fci, public;

-- ----------------------------------------------------------------------------
-- Usuários e perfis (RF-100 · RNF-05/09)
-- Perfis por área seguem a matriz do protótipo; is_admin = perfil TI/Administrador.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nome          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  senha_hash    TEXT        NOT NULL,
  area          TEXT        NOT NULL DEFAULT 'Custos',   -- Custos, Controladoria, Fiscal, Pricing, Compras, Industrial, PCP, SGI/CGI, Negócio, TI
  perfil        TEXT        NOT NULL DEFAULT 'Simulador',-- Simulador, Validador, Especialista, Aprovador, Administrador
  is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
  ativo         BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Fontes de dados configuráveis no nível do usuário administrador (RF-090)
-- Credencial SEMPRE cifrada (AES-256-GCM) — nunca em texto claro (RNF-05).
-- Conector abstrato: postgres | mysql | mssql | oracle | rest | arquivo
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fontes_dados (
  id             SERIAL PRIMARY KEY,
  codigo         TEXT        NOT NULL UNIQUE,           -- ex.: protheus, portal_custos, precos, cambio
  nome           TEXT        NOT NULL,
  icone          TEXT        NOT NULL DEFAULT '🗄',
  descricao      TEXT        NOT NULL DEFAULT '',
  fontes_label   TEXT        NOT NULL DEFAULT '',       -- variáveis atendidas (exibição)
  conector       TEXT        NOT NULL DEFAULT 'postgres',
  sgbd_label     TEXT        NOT NULL DEFAULT '',       -- ex.: "Oracle 19c", "REST API (JSON)"
  host           TEXT        NOT NULL DEFAULT '',
  porta          INTEGER,
  base           TEXT        NOT NULL DEFAULT '',
  usuario        TEXT        NOT NULL DEFAULT '',
  credencial_enc TEXT,                                  -- cifrada; NULL = sem credencial
  opcoes         JSONB       NOT NULL DEFAULT '{}'::jsonb, -- schema, ssl, headers, caminho de arquivo…
  -- Sincronização (RF-093)
  sync_freq      TEXT        NOT NULL DEFAULT 'manual', -- manual | 15min | horaria | diaria
  sync_hora      TEXT        NOT NULL DEFAULT '06:00',  -- usada quando diaria
  sync_ativa     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Status (RF-092 / RF-094 / RF-095)
  status         TEXT        NOT NULL DEFAULT 'nao_configurado', -- nao_configurado | conectado | sincronizando | erro
  testado_em     TIMESTAMPTZ,
  teste_ok       BOOLEAN,
  teste_msg      TEXT,
  last_sync_at   TIMESTAMPTZ,
  last_sync_ok   BOOLEAN,
  last_error     TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Mapeamento variável do simulador → tabela · campo da origem (RF-091)
-- Catálogo de variáveis fica na aplicação (server/services/catalogo.js).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mapeamentos (
  id         SERIAL PRIMARY KEY,
  fonte_id   INTEGER NOT NULL REFERENCES fontes_dados(id) ON DELETE CASCADE,
  variavel   TEXT    NOT NULL,   -- ex.: produto.codigo, produto.origem, cst.cst
  tabela     TEXT    NOT NULL,   -- ex.: SB1, SD1, vw_CustoEntrada, GET /contratos
  campo      TEXT    NOT NULL,   -- ex.: B1_COD, D1_CLASFIS
  ordem      INTEGER NOT NULL DEFAULT 0,
  -- a mesma variável pode vir de mais de uma tabela (ex.: chave de junção)
  UNIQUE (fonte_id, variavel, tabela)
);

-- ----------------------------------------------------------------------------
-- Execuções de sincronização (RF-093/094/095 · rastreabilidade RNF-04)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_execucoes (
  id          SERIAL PRIMARY KEY,
  fonte_id    INTEGER NOT NULL REFERENCES fontes_dados(id) ON DELETE CASCADE,
  disparo     TEXT    NOT NULL DEFAULT 'manual',  -- manual | agendada
  usuario_id  INTEGER REFERENCES usuarios(id),
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em TIMESTAMPTZ,
  status      TEXT    NOT NULL DEFAULT 'executando', -- executando | ok | erro
  mensagem    TEXT,
  registros   INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- Staging dos dados carregados das origens (RF-002 · RNF-06/07)
-- Genérico por entidade — as origens externas nunca são alteradas; a falha de
-- uma sincronização não apaga a última carga válida (RF-095).
-- entidade: produto | estrutura | cst | custo | saida_uf | cambio | fornecedor
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stg_registros (
  id         BIGSERIAL PRIMARY KEY,
  fonte_id   INTEGER NOT NULL REFERENCES fontes_dados(id) ON DELETE CASCADE,
  entidade   TEXT    NOT NULL,
  chave      TEXT    NOT NULL,
  payload    JSONB   NOT NULL,
  sync_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fonte_id, entidade, chave)
);
CREATE INDEX IF NOT EXISTS idx_stg_entidade ON stg_registros (entidade);

-- ----------------------------------------------------------------------------
-- Parâmetros mestres (RF-096 MV_FCI/CFOP · RF-097 alíquotas · RF-098 faixas ·
-- RF-099 gatilho de reemissão) — versionados por atualização (RNF-04).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parametros (
  chave         TEXT PRIMARY KEY,
  valor         JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS parametros_hist (
  id            SERIAL PRIMARY KEY,
  chave         TEXT NOT NULL,
  valor_antes   JSONB,
  valor_depois  JSONB NOT NULL,
  usuario_id    INTEGER REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Cenários de simulação (RF-001 · RF-007) — dados isolados por cenário em JSONB;
-- alterações em um cenário jamais afetam outro nem o staging (RF-007/RNF-06).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cenarios (
  id            SERIAL PRIMARY KEY,
  codigo        TEXT        NOT NULL UNIQUE,          -- CEN-001…
  nome          TEXT        NOT NULL,
  tipo          TEXT        NOT NULL DEFAULT 'revisao',-- orcamento | revisao
  ciclo         TEXT        NOT NULL DEFAULT '',
  status        TEXT        NOT NULL DEFAULT 'rascunho', -- rascunho | calculado | congelado | consolidado
  versao        INTEGER     NOT NULL DEFAULT 1,
  origem_id     INTEGER REFERENCES cenarios(id),      -- cenário de origem (duplicação)
  autor_id      INTEGER REFERENCES usuarios(id),
  autor_nome    TEXT        NOT NULL DEFAULT '',
  modo          TEXT        NOT NULL DEFAULT 'padrao', -- padrao | avancado (S5)
  origem_dados  TEXT        NOT NULL DEFAULT '',      -- descrição da carga (fontes + data) p/ rastreabilidade
  dados         JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {cambio, fornecedores, insumos, produtos}
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sequência do código do cenário
CREATE SEQUENCE IF NOT EXISTS cenario_codigo_seq START 1;

-- ----------------------------------------------------------------------------
-- Trilha de auditoria dos cenários (RC-010 / RNF-04)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cenario_eventos (
  id           SERIAL PRIMARY KEY,
  cenario_id   INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  usuario_id   INTEGER REFERENCES usuarios(id),
  usuario_nome TEXT NOT NULL DEFAULT '',
  tipo         TEXT NOT NULL,          -- criacao | edicao | duplicacao | status | carga
  detalhe      JSONB NOT NULL DEFAULT '{}'::jsonb,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cen_ev ON cenario_eventos (cenario_id, registrado_em);
