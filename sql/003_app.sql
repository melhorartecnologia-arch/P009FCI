-- ============================================================================
-- Simulador FCI · Cervejaria Cidade Imperial
-- Migração 003 — escopo funcional completo (RF-001 a RF-100)
-- Acrescenta governança de cenário, validação técnica, direcionamentos,
-- análise assistida e seleção de comparação.
-- ============================================================================
SET search_path TO fci, public;

-- ----------------------------------------------------------------------------
-- Cenários: base de cálculo do denominador (RF-060), congelamento (RF-005) e
-- consolidação para decisão (RF-008), com autoria e data (RNF-04).
-- ----------------------------------------------------------------------------
ALTER TABLE cenarios ADD COLUMN IF NOT EXISTS base_calculo    TEXT NOT NULL DEFAULT 'saida';
ALTER TABLE cenarios ADD COLUMN IF NOT EXISTS congelado_em    TIMESTAMPTZ;
ALTER TABLE cenarios ADD COLUMN IF NOT EXISTS congelado_por   TEXT;
ALTER TABLE cenarios ADD COLUMN IF NOT EXISTS consolidado_em  TIMESTAMPTZ;
ALTER TABLE cenarios ADD COLUMN IF NOT EXISTS consolidado_por TEXT;
ALTER TABLE cenarios ADD COLUMN IF NOT EXISTS observacoes     TEXT NOT NULL DEFAULT '';

-- ----------------------------------------------------------------------------
-- Validação técnica das alterações de receita (RF-036 · RF-037 · RF-038 · RN-11)
-- Cada submissão congela a lista de pontos alterados (valor padrão × valor no
-- cenário) e registra a decisão com responsável, área e data.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validacoes_tecnicas (
  id             SERIAL PRIMARY KEY,
  cenario_id     INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL DEFAULT 'pendente',   -- pendente | aprovada | reprovada
  pontos         JSONB   NOT NULL DEFAULT '[]'::jsonb,  -- diffs() no momento da submissão
  submetido_por  INTEGER REFERENCES usuarios(id),
  submetido_nome TEXT    NOT NULL DEFAULT '',
  submetido_area TEXT    NOT NULL DEFAULT '',
  submetido_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_por   INTEGER REFERENCES usuarios(id),
  decidido_nome  TEXT,
  decidido_area  TEXT,
  decidido_em    TIMESTAMPTZ,
  notas          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_valid_cenario ON validacoes_tecnicas (cenario_id, submetido_em DESC);

-- ----------------------------------------------------------------------------
-- Direcionamentos por área decorrentes do cenário (RF-009 · RF-088)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direcionamentos (
  id          SERIAL PRIMARY KEY,
  cenario_id  INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  area        TEXT    NOT NULL,            -- Compras | Pricing | Fiscal/Tributário | ...
  produto     TEXT    NOT NULL DEFAULT '— cenário —',
  texto       TEXT    NOT NULL,
  prioridade  TEXT    NOT NULL DEFAULT 'media',  -- alta | media | baixa
  origem      TEXT    NOT NULL DEFAULT 'manual', -- manual | automatico
  criado_por  INTEGER REFERENCES usuarios(id),
  criado_nome TEXT    NOT NULL DEFAULT '',
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_direc_cenario ON direcionamentos (cenario_id, area);

-- ----------------------------------------------------------------------------
-- Análise assistida: histórico da conversa por contexto (RF-080)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analise_mensagens (
  id          SERIAL PRIMARY KEY,
  contexto    TEXT    NOT NULL,            -- chave do contexto (ids de cenários ordenados)
  cenario_id  INTEGER REFERENCES cenarios(id) ON DELETE CASCADE,
  usuario_id  INTEGER REFERENCES usuarios(id),
  usuario_nome TEXT   NOT NULL DEFAULT '',
  papel       TEXT    NOT NULL,            -- usuario | assistente
  pergunta    TEXT,
  analise     TEXT,                        -- id da análise padrão (RF-081)
  conteudo    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analise_ctx ON analise_mensagens (contexto, criado_em);

-- ----------------------------------------------------------------------------
-- Seleção de cenários para comparação, por usuário (RF-073)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comparacao_selecao (
  usuario_id  INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  cenario_ids INTEGER[] NOT NULL DEFAULT '{}',
  prod_foco   TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Relatórios consolidados gerados (RF-087 · RF-089) — histórico de emissão
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relatorios (
  id          SERIAL PRIMARY KEY,
  cenario_id  INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  versao      INTEGER NOT NULL DEFAULT 1,
  formato     TEXT    NOT NULL DEFAULT 'pdf',
  resumo      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  gerado_por  INTEGER REFERENCES usuarios(id),
  gerado_nome TEXT    NOT NULL DEFAULT '',
  gerado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rel_cenario ON relatorios (cenario_id, gerado_em DESC);
