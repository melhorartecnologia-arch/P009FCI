'use strict';
/**
 * Catálogo das variáveis do simulador (RF-091 · RC-015).
 * Cada variável aponta para uma tabela e um campo da fonte de origem
 * (ex.: SB1.B1_COD, SB1.B1_DESC, SB1.B1_ORIGEM, SD1.D1_CLASFIS).
 * O mapeamento por fonte fica na tabela fci.mapeamentos; a sincronização
 * agrupa as variáveis de mesma entidade+tabela em um único SELECT.
 */

const VARIAVEIS = [
  // entidade produto — cadastro de itens e estrutura (ERP · SB1/SG1)
  { variavel: 'produto.codigo',     entidade: 'produto',   rotulo: 'Código do item',                     chave: true,  padrao: { tabela: 'SB1', campo: 'B1_COD' } },
  { variavel: 'produto.descricao',  entidade: 'produto',   rotulo: 'Descrição do item',                  chave: false, padrao: { tabela: 'SB1', campo: 'B1_DESC' } },
  { variavel: 'produto.origem',     entidade: 'produto',   rotulo: 'Origem do produto (0–8)',            chave: false, padrao: { tabela: 'SB1', campo: 'B1_ORIGEM' } },
  { variavel: 'produto.tipo',       entidade: 'produto',   rotulo: 'Tipo (MP · PI · PA)',                chave: false, padrao: { tabela: 'SB1', campo: 'B1_TIPO' } },
  { variavel: 'produto.unidade',    entidade: 'produto',   rotulo: 'Unidade de medida',                  chave: false, padrao: { tabela: 'SB1', campo: 'B1_UM' } },
  { variavel: 'produto.grupo',      entidade: 'produto',   rotulo: 'Grupo de insumo',                    chave: false, padrao: { tabela: 'SB1', campo: 'B1_GRUPO' } },
  { variavel: 'produto.ncm',        entidade: 'produto',   rotulo: 'Classificação fiscal (NCM)',         chave: false, padrao: { tabela: 'SB1', campo: 'B1_POSIPI' } },
  { variavel: 'produto.fci_vigente', entidade: 'produto',  rotulo: 'CI% da FCI vigente (pré-apuração)',  chave: false, padrao: { tabela: 'CFD', campo: 'CFD_CONIMP' }, opcional: true },

  // entidade estrutura — lista técnica em cascata MP → PI → PA (ERP · SG1)
  { variavel: 'estrutura.pai',        entidade: 'estrutura', rotulo: 'Código do produto (pai)',          chave: true,  padrao: { tabela: 'SG1', campo: 'G1_COD' } },
  { variavel: 'estrutura.componente', entidade: 'estrutura', rotulo: 'Código do componente',             chave: true,  padrao: { tabela: 'SG1', campo: 'G1_COMP' } },
  { variavel: 'estrutura.quantidade', entidade: 'estrutura', rotulo: 'Quantidade na receita',            chave: false, padrao: { tabela: 'SG1', campo: 'G1_QUANT' } },

  // entidade cst — classificação fiscal da última entrada (ERP · SD1)
  { variavel: 'cst.item', entidade: 'cst', rotulo: 'Código do item (NF de entrada)', chave: true,  padrao: { tabela: 'SD1', campo: 'D1_COD' } },
  { variavel: 'cst.cst',  entidade: 'cst', rotulo: 'CST da entrada',                 chave: false, padrao: { tabela: 'SD1', campo: 'D1_CLASFIS' } },

  // entidade custo — custo de entrada (Portal de Custos)
  { variavel: 'custo.item',        entidade: 'custo', rotulo: 'Código do item',                  chave: true,  padrao: { tabela: 'vw_CustoEntrada', campo: 'CodItem' } },
  { variavel: 'custo.valor_total', entidade: 'custo', rotulo: 'Valor total de entrada',          chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrTotal' } },
  { variavel: 'custo.icms',        entidade: 'custo', rotulo: 'ICMS destacado',                  chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrICMS' } },
  { variavel: 'custo.ipi',         entidade: 'custo', rotulo: 'IPI destacado',                   chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrIPI' } },
  { variavel: 'custo.moeda',       entidade: 'custo', rotulo: 'Moeda de negociação',             chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'Moeda' } },
  { variavel: 'custo.fornecedor',  entidade: 'custo', rotulo: 'Fornecedor',                      chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'Fornecedor' } },
  // Componentes do valor aduaneiro — manuais no cenário por premissa (E-07);
  // aceitos na carga somente quando a origem os fornecer de forma segregada.
  { variavel: 'custo.fob',           entidade: 'custo', rotulo: 'FOB (moeda de negociação)',     chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrFOB' }, opcional: true },
  { variavel: 'custo.frete_int',     entidade: 'custo', rotulo: 'Frete internacional',           chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrFreteInt' }, opcional: true },
  { variavel: 'custo.seguro_int',    entidade: 'custo', rotulo: 'Seguro internacional',          chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrSeguroInt' }, opcional: true },
  { variavel: 'custo.ii',            entidade: 'custo', rotulo: 'Imposto de importação (II)',    chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrII' }, opcional: true },
  { variavel: 'custo.ipi_imp',       entidade: 'custo', rotulo: 'IPI de importação',             chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrIPIImp' }, opcional: true },
  { variavel: 'custo.piscofins_imp', entidade: 'custo', rotulo: 'PIS/COFINS de importação',      chave: false, padrao: { tabela: 'vw_CustoEntrada', campo: 'VlrPisCofinsImp' }, opcional: true },

  // entidade saida_uf — volumes e preços por UF (Sistema de Preços · RC-013)
  { variavel: 'saida.sku',    entidade: 'saida_uf', rotulo: 'SKU',              chave: true,  padrao: { tabela: 'precos_saida', campo: 'sku' } },
  { variavel: 'saida.uf',     entidade: 'saida_uf', rotulo: 'UF de destino',    chave: true,  padrao: { tabela: 'precos_saida', campo: 'uf' } },
  { variavel: 'saida.volume', entidade: 'saida_uf', rotulo: 'Volume',           chave: false, padrao: { tabela: 'precos_saida', campo: 'volume' } },
  { variavel: 'saida.preco',  entidade: 'saida_uf', rotulo: 'Preço líquido',    chave: false, padrao: { tabela: 'precos_saida', campo: 'preco_liquido' } },

  // entidade cambio — cotações (Financeiro / BACEN PTAX)
  { variavel: 'cambio.moeda',   entidade: 'cambio', rotulo: 'Moeda',   chave: true,  padrao: { tabela: 'cotacoes', campo: 'moeda' } },
  { variavel: 'cambio.cotacao', entidade: 'cambio', rotulo: 'Cotação', chave: false, padrao: { tabela: 'cotacoes', campo: 'cotacao_venda' } },

  // entidade fornecedor — cadastro (Compras / Contratos)
  { variavel: 'fornecedor.codigo', entidade: 'fornecedor', rotulo: 'Código do fornecedor', chave: true,  padrao: { tabela: 'fornecedores', campo: 'id' } },
  { variavel: 'fornecedor.nome',   entidade: 'fornecedor', rotulo: 'Nome do fornecedor',   chave: false, padrao: { tabela: 'fornecedores', campo: 'nome' } },
  { variavel: 'fornecedor.pais',   entidade: 'fornecedor', rotulo: 'País',                 chave: false, padrao: { tabela: 'fornecedores', campo: 'pais' } },
];

const porVariavel = Object.fromEntries(VARIAVEIS.map((v) => [v.variavel, v]));

/**
 * Regra de conversão origem → conteúdo importado (E-04 · RF-015 do REV06).
 * Origem 0 = 0% · 1 e 2 = 100% · 3 = 50% · 4 a 7 = 0% · 8 = 100%.
 * Padrão provisório até o gate G2 (validação Fiscal em 25/09) — duas camadas:
 * a origem do cadastro inicializa o CI do item; o fator de faixa é da cascata.
 */
function classificacaoPorOrigem(origem) {
  const o = String(origem == null ? '' : origem).trim();
  switch (o) {
    case '1': return { classSim: 'importado_direto', ciPct: 100 };
    case '2': return { classSim: 'estrangeiro_mi',  ciPct: 100 };
    case '3': return { classSim: 'nacional_ci',     ciPct: 50 };
    case '8': return { classSim: 'nacional_ci',     ciPct: 100 };
    case '0': case '4': case '5': case '6': case '7':
      return { classSim: 'nacional', ciPct: 0 };
    default:
      return { classSim: 'nacional', ciPct: 0 };
  }
}

/** CST sugerido pela classificação adotada (RF-050 — base para o aviso E-05). */
function cstSugerido(classSim, ciPct) {
  if (classSim === 'importado_direto') return '1';
  if (classSim === 'estrangeiro_mi') return '2';
  if (classSim === 'nacional_ci') {
    if (ciPct > 70) return '8';
    if (ciPct > 40) return '3';
    return '5';
  }
  return '0';
}

module.exports = { VARIAVEIS, porVariavel, classificacaoPorOrigem, cstSugerido };
