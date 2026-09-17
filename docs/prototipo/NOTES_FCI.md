# FCI Simulator — Research Notes (Cervejaria Cidade Imperial / CCI, Frutal-MG)

## Purpose
Web prototype of an **FCI simulator** (Ficha de Conteúdo de Importação). Simulation-only — no fiscal transmission, no official obligation. Supports managerial decisions (Custos, Fiscal, Pricing, Compras, Controladoria).

## Theme colors (from image, LIGHT theme)
- DOURADO (gold): `#B38335`  (CMYK 20/50/100/5 · Pantone 871C · RGB 179/131/53)
- PRETO (black): `#272525` (RGB 39/37/37)

## Core formula
`CI% = (Valor da Parcela Importada ÷ Custo Total da Mercadoria) × 100` (Convênio ICMS 38/2013)
- Parcela Importada = valor aduaneiro dos insumos importados (CIF + II + IPI-imp + PIS/COFINS-imp + tributos aduaneiros).
- Denominador (simulador): **média ponderada global das saídas interestaduais** (volume × preço por destino), SEM ICMS/IPI/ST. No breakdown by UF in final result.
- Custo FCI do insumo = valor total de entrada − ICMS − IPI (PIS/COFINS NÃO deduzem).
- Cascata: MP → PI → PA. Fatores de faixa aplicados: 0%, 50%, 100%.

## Faixas legais do CI%
- CI% = 0% → 100% Nacional → 7% (N/NE/CO/ES) ou 12% → FCI não obrigatória
- 0% < CI% ≤ 40% → Nacional c/ Conteúdo Importação → 7%/12% → FCI obrigatória
- 40% < CI% ≤ 70% → Nacional com CI > 40%
- CI% > 70% → Equiparado a importado
- CI% > 40% → alíquota 4% (RSF 13/2012, todos estados)
- Reemissão FCI quando CI% varia > 5 p.p. vs vigente.

## Base legal
Res. SF 13/2012 · Convênio ICMS 38/2013 · Ajuste SINIEF 19/2012 · LC 87/1996 (Kandir)

## 17 Variáveis do simulador (MATRIZ) + fonte de dados (todas ALTO salvo última)
1. Movimento de entrada (baseline) — Protheus / histórico entrada
2. Vínculo insumo-produto-fornecedor — Estrutura + histórico
3. Produto Acabado / BOM / lista técnica — CGI / PCP
4. Origem / classificação do item — Fiscal / classificação do ERP
5. Preço de entrada / valor monetário — Portal Custos / histórico / compras
6. Câmbio — Financeiro / parametrização
7. Fornecedor — Compras / contratos
8. Preço de saída — Pricing / premissa
9. UF de destino — Pricing / premissa
10. Faixa de conteúdo por aquisição nacional — Documento anexo FCI
11. Janela temporal da apuração — Documento anexo FCI
12. Alíquotas de ICMS — Parâmetros Protheus
13. Cálculo CST lata — Pricing
14. Gatilho de reemissão — Regra fiscal
15. Versão da fórmula do CI% — Sistema / Governança
16. Status de validade do cenário — Sistema / Governança
17. Comparação entre cenários — Sistema / Simulador (MÉDIO)

## Processo (SIPOC) — 11 passos
1. Abrir cenário (orçamento anual OU revisão mensal) — Custos/Controladoria
2. Carregar estrutura de origem (insumos/produtos/fornecedor do orçamento) — ERP Protheus
3. Decompor PA e relacionar insumos (por SKU) — Compras/CGI
4. Classificar origem importada/nacional (CST, class. fiscal, origem) — Fiscal
5. Parametrizar compra/custos entrada (FOB, frete int'l, seguro int'l, fornecedor, câmbio, contratos) — Compras/Fiscal/Financeiro
6. Calcular denominador CI% (média ponderada global) — Pricing
7. Calcular CI% consolidado (cascata MP→PI→PA, fatores 0/50/100%) — Simulador
8. Classificar enquadramento e impacto tributário (3 faixas) — Simulador
9. Avaliar gatilhos de alerta/atualização — Simulador
10. Consolidar cenário p/ decisão executiva (relatório, comparativo) — Simulador/Custos
11. Encaminhar decisão às áreas — Custos → Compras/Pricing/Tributário

## Governança
Congelar premissas após cálculo; alteração gera NOVA VERSÃO; histórico + rastreabilidade (autor, data, origem dados, versões). Não transmite ao governo. Alertas: risco fiscal + reemissão. Alterações de rendimento/produtividade/índice exigem validação da área de estrutura.

## Integrações / fontes de dados (config de master data — external DBs)
- ERP Protheus/TOTVS (SB1 produto, SA8 pré-apuração FCI, CFD ficha, SD1 NF entrada, SD3 produção, SF4 TES, SC2 OP)
- Portal de Custos
- Pricing
- Compras / Contratos
- Financeiro (câmbio)
- Fiscal (classificação/CST)

## Parâmetros Protheus (config) — do PDF
- MV_FCICL: classificações fiscais (lista de códigos origem/CST)
- MV_FCIVE: CFOP saída interestadual
- MV_FCIVI: CFOP saída interna
- MV_FCIALIQ: alíquotas ICMS = 4, 6, 7, 11, 12, 18, 23, 25
- MV_FCITR: CFOP transferência
- MV_FCINTHD: multithread (5)
- MV_FCICOMP: considera NF complemento · MV_FCICF: CFOPs excluídas

## Casos práticos (apostila) para sample data
- Caso 1: bebida c/ embalagem+rótulo importados → CI% 18,75% (≤40%, 12%)
- Caso 2: MP principal importada → CI% 75% (>40%, 4%)
- Contexto: cervejaria — malte, lúpulo, água, latas de alumínio (importado/beneficiado), rótulos, embalagens.
