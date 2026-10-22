-- ============================================================================
-- Base de DEMONSTRAÇÃO das origens corporativas (schema erp_demo).
-- Simula, no mesmo PostgreSQL da VPS, as fontes externas mapeadas no RF-015:
--   SB1/SG1/SD1/CFD (ERP Protheus) · vw_CustoEntrada (Portal de Custos) ·
--   precos_saida (Sistema de Preços) · cotacoes (Câmbio) · fornecedores (Compras)
-- As fontes de dados seedadas apontam para cá via conector "postgres";
-- em produção basta reapontar host/porta/base/credencial para as origens reais
-- (Oracle/SQL Server/REST) sem alterar a aplicação.
-- ============================================================================

DROP SCHEMA IF EXISTS erp_demo CASCADE;
CREATE SCHEMA erp_demo;

-- ---------------------------------------------------------------------------
-- SB1 — cadastro de produtos (B1_COD, B1_DESC, B1_ORIGEM, B1_TIPO, B1_UM…)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.sb1 (
  b1_cod    TEXT PRIMARY KEY,
  b1_desc   TEXT NOT NULL,
  b1_origem TEXT NOT NULL DEFAULT '0',
  b1_tipo   TEXT NOT NULL DEFAULT 'MP',
  b1_um     TEXT NOT NULL DEFAULT 'un',
  b1_grupo  TEXT NOT NULL DEFAULT '',
  b1_posipi TEXT NOT NULL DEFAULT '',
  b1_conv   NUMERIC NOT NULL DEFAULT 0,      -- volume envasado (especificação do SKU · RF-014)
  b1_segum  TEXT NOT NULL DEFAULT 'ml',      -- unidade do volume
  b1_custd  NUMERIC NOT NULL DEFAULT 0       -- mão de obra e custos industriais (RF-012)
);

INSERT INTO erp_demo.sb1 (b1_cod, b1_desc, b1_origem, b1_tipo, b1_um, b1_grupo, b1_posipi, b1_conv, b1_segum, b1_custd) VALUES
  -- Matérias-primas
  ('MP-1001', 'Malte Pilsen',                              '0', 'MP', 'kg', 'Malte',    '1107.10.10', 0, 'ml', 0),
  ('MP-1002', 'Malte Munich',                              '1', 'MP', 'kg', 'Malte',    '1107.10.10', 0, 'ml', 0),
  ('MP-1005', 'Malte Munich nacional',                     '0', 'MP', 'kg', 'Malte',    '1107.10.10', 0, 'ml', 0),
  ('MP-1007', 'Malte Especial (estrang. merc. interno)',   '2', 'MP', 'kg', 'Malte',    '1107.10.10', 0, 'ml', 0),
  ('MP-1003', 'Lúpulo Cascade',                            '1', 'MP', 'kg', 'Lúpulo',   '1210.20.10', 0, 'ml', 0),
  ('MP-1006', 'Lúpulo Nacional (Vale Europeu)',            '0', 'MP', 'kg', 'Lúpulo',   '1210.20.10', 0, 'ml', 0),
  ('MP-1008', 'Lúpulo Fuggle UK',                          '1', 'MP', 'kg', 'Lúpulo',   '1210.20.10', 0, 'ml', 0),
  ('MP-1004', 'Levedura US-05',                            '1', 'MP', 'kg', 'Levedura', '2102.10.00', 0, 'ml', 0),
  ('MP-1009', 'Levedura Suíça Alpina',                     '1', 'MP', 'kg', 'Levedura', '2102.10.00', 0, 'ml', 0),
  ('MP-2001', 'Água tratada',                              '0', 'MP', 'L',  'Água',     '2201.90.00', 0, 'ml', 0),
  ('MP-3001', 'Lata Alumínio 350ml',                       '3', 'MP', 'un', 'Lata',     '7612.90.19', 0, 'ml', 0),
  ('MP-3002', 'Lata Alumínio 473ml',                       '3', 'MP', 'un', 'Lata',     '7612.90.19', 0, 'ml', 0),
  ('MP-3006', 'Lata Alumínio 473ml · Ball',                '5', 'MP', 'un', 'Lata',     '7612.90.19', 0, 'ml', 0),
  ('MP-3007', 'Lata Alumínio 350ml · faixa declarada',     '3', 'MP', 'un', 'Lata',     '7612.90.19', 0, 'ml', 0),
  ('MP-3003', 'Tampa/Anel Alumínio',                       '3', 'MP', 'un', 'Tampa',    '8309.90.00', 0, 'ml', 0),
  ('MP-3008', 'Tampa/Anel nacional integral',              '0', 'MP', 'un', 'Tampa',    '8309.90.00', 0, 'ml', 0),
  ('MP-4001', 'Rótulo BOPP nacional',                      '0', 'MP', 'un', 'Rótulo',   '4821.10.00', 0, 'ml', 0),
  ('MP-4002', 'Rótulo metalizado',                         '1', 'MP', 'un', 'Rótulo',   '4821.10.00', 0, 'ml', 0),
  ('MP-5001', 'CO2 industrial',                            '0', 'MP', 'kg', 'CO2',      '2811.21.00', 0, 'ml', 0),
  ('MP-3004', 'Garrafa Vidro 500ml',                       '1', 'MP', 'un', 'Garrafa',  '7010.90.21', 0, 'ml', 0),
  ('MP-3005', 'Garrafa PET 1,5L',                          '1', 'MP', 'un', 'Garrafa',  '3923.30.00', 0, 'ml', 0),
  ('MP-6001', 'Cartucho cartão 12un',                      '0', 'MP', 'un', 'Cartucho', '4819.10.00', 0, 'ml', 0),
  -- Produtos intermediários
  ('PI-7001', 'Mosto IPA',                                 '0', 'PI', 'L',  'Mosto',    '',           1,    'L',  0.10),
  ('PI-7002', 'Mosto Pilsen',                              '0', 'PI', 'L',  'Mosto',    '',           1,    'L',  0.10),
  -- Produtos acabados
  ('PA-9001', 'Cerveja Pilsen Lata 350ml',                 '0', 'PA', 'un', '',         '2203.00.00',  350, 'ml', 0.34),
  ('PA-9002', 'Cerveja IPA Lata 473ml',                    '0', 'PA', 'un', '',         '2203.00.00',  473, 'ml', 0.42),
  ('PA-9005', 'Pack 12 · Pilsen Lata 350ml',               '0', 'PA', 'un', '',         '2203.00.00', 4200, 'ml', 1.90),
  ('PA-9003', 'Água Mineral 1,5L',                         '0', 'PA', 'un', '',         '2201.10.00', 1500, 'ml', 0.18),
  ('PA-9004', 'Weiss Ed. Especial 500ml',                  '0', 'PA', 'un', '',         '2203.00.00',  500, 'ml', 0.50);

-- ---------------------------------------------------------------------------
-- SG1 — estrutura / lista técnica (G1_COD pai, G1_COMP componente, G1_QUANT)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.sg1 (
  g1_cod   TEXT NOT NULL,
  g1_comp  TEXT NOT NULL,
  g1_quant NUMERIC NOT NULL,
  PRIMARY KEY (g1_cod, g1_comp)
);

INSERT INTO erp_demo.sg1 (g1_cod, g1_comp, g1_quant) VALUES
  -- Mosto IPA (base 1 L)
  ('PI-7001', 'MP-1002', 0.180),
  ('PI-7001', 'MP-1001', 0.040),
  ('PI-7001', 'MP-1003', 0.0080),
  ('PI-7001', 'MP-1004', 0.0020),
  ('PI-7001', 'MP-2001', 1.0),
  -- Mosto Pilsen (base 1 L)
  ('PI-7002', 'MP-1001', 0.160),
  ('PI-7002', 'MP-1002', 0.020),
  ('PI-7002', 'MP-1003', 0.0020),
  ('PI-7002', 'MP-1004', 0.0015),
  ('PI-7002', 'MP-2001', 1.0),
  -- Cerveja Pilsen Lata 350ml
  ('PA-9001', 'PI-7002', 0.350),
  ('PA-9001', 'MP-3001', 1),
  ('PA-9001', 'MP-3003', 1),
  ('PA-9001', 'MP-4001', 1),
  ('PA-9001', 'MP-5001', 0.005),
  -- Cerveja IPA Lata 473ml
  ('PA-9002', 'PI-7001', 0.473),
  ('PA-9002', 'MP-3002', 1),
  ('PA-9002', 'MP-3003', 1),
  ('PA-9002', 'MP-4001', 1),
  ('PA-9002', 'MP-5001', 0.006),
  -- Pack 12 · Pilsen Lata 350ml
  ('PA-9005', 'PI-7002', 4.200),
  ('PA-9005', 'MP-3001', 12),
  ('PA-9005', 'MP-3003', 12),
  ('PA-9005', 'MP-4001', 12),
  ('PA-9005', 'MP-5001', 0.060),
  ('PA-9005', 'MP-6001', 1),
  -- Água Mineral 1,5L
  ('PA-9003', 'MP-2001', 1.5),
  ('PA-9003', 'MP-3005', 1),
  ('PA-9003', 'MP-4002', 1),
  ('PA-9003', 'MP-3003', 1),
  -- Weiss Ed. Especial 500ml
  ('PA-9004', 'PI-7001', 0.500),
  ('PA-9004', 'MP-3004', 1),
  ('PA-9004', 'MP-4002', 1),
  ('PA-9004', 'MP-3003', 1);

-- ---------------------------------------------------------------------------
-- SD1 — última NF de entrada por item (D1_COD, D1_CLASFIS)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.sd1 (
  d1_cod     TEXT PRIMARY KEY,
  d1_clasfis TEXT NOT NULL
);

INSERT INTO erp_demo.sd1 (d1_cod, d1_clasfis) VALUES
  ('MP-1001', '0'), ('MP-1002', '1'), ('MP-1005', '0'), ('MP-1007', '2'),
  ('MP-1003', '1'), ('MP-1006', '0'), ('MP-1008', '1'),
  ('MP-1004', '1'), ('MP-1009', '1'),
  ('MP-2001', '0'),
  ('MP-3001', '3'), ('MP-3002', '3'), ('MP-3006', '5'), ('MP-3007', '3'),
  ('MP-3003', '3'), ('MP-3008', '0'),
  ('MP-4001', '0'), ('MP-4002', '1'),
  ('MP-5001', '0'), ('MP-3004', '1'), ('MP-3005', '1'), ('MP-6001', '0');

-- ---------------------------------------------------------------------------
-- CFD — pré-apuração / Ficha FCI vigente por produto (CFD_COD, CFD_CONIMP)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.cfd (
  cfd_cod    TEXT PRIMARY KEY,
  cfd_conimp NUMERIC NOT NULL
);

INSERT INTO erp_demo.cfd (cfd_cod, cfd_conimp) VALUES
  ('PA-9001', 12), ('PA-9002', 39), ('PA-9005', 14), ('PA-9003', 41), ('PA-9004', 68);

-- ---------------------------------------------------------------------------
-- Portal de Custos — custo de entrada consolidado por item
-- (valores segregados de importação presentes apenas quando existirem)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.vw_custo_entrada (
  coditem            TEXT PRIMARY KEY,
  vlrtotal           NUMERIC NOT NULL DEFAULT 0,
  vlricms            NUMERIC NOT NULL DEFAULT 0,
  vlripi             NUMERIC NOT NULL DEFAULT 0,
  moeda              TEXT NOT NULL DEFAULT 'BRL',
  fornecedor         TEXT,
  vlrfob             NUMERIC NOT NULL DEFAULT 0,
  vlrfreteint        NUMERIC NOT NULL DEFAULT 0,
  vlrseguroint       NUMERIC NOT NULL DEFAULT 0,
  vlrii              NUMERIC NOT NULL DEFAULT 0,
  vlripiimp          NUMERIC NOT NULL DEFAULT 0,
  vlrpiscofinsimp    NUMERIC NOT NULL DEFAULT 0
);

INSERT INTO erp_demo.vw_custo_entrada
  (coditem, vlrtotal, vlricms, vlripi, moeda, fornecedor, vlrfob, vlrfreteint, vlrseguroint, vlrii, vlripiimp, vlrpiscofinsimp) VALUES
  ('MP-1001', 3.20,  0.38,  0, 'BRL', 'F01', 0, 0, 0, 0, 0, 0),
  ('MP-1002', 0,     0,     0, 'EUR', 'F02', 0.95, 0.35, 0.04, 1.55, 0.62, 0.98),
  ('MP-1005', 4.05,  0.49,  0, 'BRL', 'F01', 0, 0, 0, 0, 0, 0),
  ('MP-1007', 4.60,  0.55,  0, 'BRL', 'F01', 0, 0, 0, 0, 0, 0),
  ('MP-1003', 0,     0,     0, 'USD', 'F03', 12.0, 1.20, 0.30, 16.9, 6.80, 10.4),
  ('MP-1006', 186.0, 22.3,  0, 'BRL', 'F01', 0, 0, 0, 0, 0, 0),
  ('MP-1008', 0,     0,     0, 'GBP', 'F10', 9.80, 1.05, 0.26, 14.9, 5.90, 9.10),
  ('MP-1004', 0,     0,     0, 'EUR', 'F04', 9.50, 0.80, 0.10, 14.2, 5.10, 7.90),
  ('MP-1009', 0,     0,     0, 'CHF', 'F11', 11.20, 0.95, 0.14, 16.8, 6.10, 9.40),
  ('MP-2001', 0.006, 0.0007,0, 'BRL', 'F07', 0, 0, 0, 0, 0, 0),
  ('MP-3001', 0.285, 0.049, 0, 'BRL', 'F05', 0, 0, 0, 0, 0, 0),
  ('MP-3002', 0.342, 0.058, 0, 'BRL', 'F05', 0, 0, 0, 0, 0, 0),
  ('MP-3006', 0.361, 0.061, 0, 'BRL', 'F09', 0, 0, 0, 0, 0, 0),
  ('MP-3007', 0.291, 0.050, 0, 'BRL', 'F06', 0, 0, 0, 0, 0, 0),
  ('MP-3003', 0.041, 0.007, 0, 'BRL', 'F06', 0, 0, 0, 0, 0, 0),
  ('MP-3008', 0.047, 0.008, 0, 'BRL', 'F06', 0, 0, 0, 0, 0, 0),
  ('MP-4001', 0.028, 0.004, 0, 'BRL', 'F08', 0, 0, 0, 0, 0, 0),
  ('MP-4002', 0,     0,     0, 'USD', 'F09', 0.030, 0.004, 0.001, 0.040, 0.015, 0.020),
  ('MP-5001', 1.85,  0.31,  0, 'BRL', 'F07', 0, 0, 0, 0, 0, 0),
  ('MP-3004', 0,     0,     0, 'USD', 'F09', 0.11, 0.010, 0.003, 0.150, 0.055, 0.090),
  ('MP-3005', 0,     0,     0, 'USD', 'F09', 0.060, 0.008, 0.002, 0.085, 0.030, 0.050),
  ('MP-6001', 0.62,  0.093, 0, 'BRL', 'F08', 0, 0, 0, 0, 0, 0);

-- ---------------------------------------------------------------------------
-- Sistema de Preços — volumes e preços por UF (denominador · RC-013)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.precos_saida (
  sku            TEXT NOT NULL,
  uf             TEXT NOT NULL,
  volume         NUMERIC NOT NULL,
  preco_liquido  NUMERIC NOT NULL,
  PRIMARY KEY (sku, uf)
);

INSERT INTO erp_demo.precos_saida (sku, uf, volume, preco_liquido) VALUES
  ('PA-9001', 'SP', 200000, 2.15), ('PA-9001', 'RJ', 120000, 2.25), ('PA-9001', 'BA', 80000, 2.05),
  ('PA-9002', 'SP', 120000, 3.20), ('PA-9002', 'RJ', 80000, 3.35), ('PA-9002', 'BA', 60000, 3.10), ('PA-9002', 'GO', 40000, 3.25),
  ('PA-9005', 'SP', 38000, 26.90), ('PA-9005', 'RJ', 22000, 27.60), ('PA-9005', 'MG', 15000, 26.40),
  ('PA-9003', 'SP', 300000, 1.30), ('PA-9003', 'RJ', 150000, 1.35), ('PA-9003', 'GO', 90000, 1.28),
  ('PA-9004', 'SP', 40000, 3.10), ('PA-9004', 'RJ', 25000, 3.20);

-- ---------------------------------------------------------------------------
-- Câmbio — cotações vigentes (Financeiro / BACEN PTAX)
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.cotacoes (
  moeda          TEXT PRIMARY KEY,
  cotacao_venda  NUMERIC NOT NULL,
  data_cotacao   DATE NOT NULL DEFAULT CURRENT_DATE
);

INSERT INTO erp_demo.cotacoes (moeda, cotacao_venda) VALUES
  ('USD', 5.42), ('EUR', 5.88), ('GBP', 6.95), ('CHF', 6.12);

-- ---------------------------------------------------------------------------
-- Compras / Contratos — fornecedores
-- ---------------------------------------------------------------------------
CREATE TABLE erp_demo.fornecedores (
  id   TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  pais TEXT NOT NULL DEFAULT 'BR'
);

INSERT INTO erp_demo.fornecedores (id, nome, pais) VALUES
  ('F01', 'Maltaria Agrária', 'BR'),
  ('F02', 'Weyermann Malz GmbH', 'DE'),
  ('F03', 'Barth-Haas Group', 'DE'),
  ('F04', 'Fermentis (Lesaffre)', 'FR'),
  ('F05', 'CBA — Cia Bras. Alumínio', 'BR'),
  ('F06', 'Crown Embalagens', 'BR'),
  ('F07', 'White Martins', 'BR'),
  ('F08', 'Gráfica Rótulos Sul', 'BR'),
  ('F09', 'Ball Corporation', 'US'),
  ('F10', 'Charles Faram & Co (UK)', 'GB'),
  ('F11', 'Hefe Schweiz AG', 'CH');
