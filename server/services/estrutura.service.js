'use strict';
/**
 * Carga da estrutura de origem do ERP para o cenário (RF-002 · RC-001/RC-015).
 * Ao criar/recarregar um cenário, a lista técnica e o cadastro de insumos são
 * montados a partir do staging integrado — sem digitação manual (marco M1).
 * O resultado é um snapshot isolado gravado no próprio cenário (RF-007).
 */
const { query } = require('../db');
const { classificacaoPorOrigem, cstSugerido } = require('./catalogo');

async function lerEntidade(entidade) {
  const { rows } = await query(
    `SELECT s.chave, s.payload, s.sync_em, f.codigo AS fonte_codigo, f.nome AS fonte_nome
       FROM stg_registros s
       JOIN fontes_dados f ON f.id = s.fonte_id
      WHERE s.entidade = $1
      ORDER BY s.id`,
    [entidade]
  );
  return rows;
}

function num(v, padrao = 0) {
  if (v == null || v === '') return padrao;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

const MOEDAS_VALIDAS = ['USD', 'EUR', 'GBP', 'CHF'];

/**
 * Monta o objeto de dados do cenário a partir do staging.
 * Estrutura compatível com o motor de cálculo do front-end (protótipo):
 * { cambio, fornecedores, insumos, produtos, origemCarga }
 */
async function montarDadosDeOrigem({ cambioPadrao } = {}) {
  const [produtosStg, estruturaStg, cstStg, custoStg, saidasStg, cambioStg, fornecedoresStg] =
    await Promise.all([
      lerEntidade('produto'), lerEntidade('estrutura'), lerEntidade('cst'),
      lerEntidade('custo'), lerEntidade('saida_uf'), lerEntidade('cambio'),
      lerEntidade('fornecedor'),
    ]);

  const fontesUsadas = new Map();
  const marcaFonte = (rows) => rows.forEach((r) => fontesUsadas.set(r.fonte_codigo, {
    codigo: r.fonte_codigo, nome: r.fonte_nome, syncEm: r.sync_em,
  }));
  [produtosStg, estruturaStg, cstStg, custoStg, saidasStg, cambioStg, fornecedoresStg].forEach(marcaFonte);

  // Câmbio do cenário (base) — staging > parâmetros padrão
  const cambio = Object.assign({}, cambioPadrao || { USD: 5.42, EUR: 5.88, GBP: 6.95, CHF: 6.12 });
  for (const r of cambioStg) {
    const moeda = String(r.payload.moeda || '').toUpperCase();
    if (MOEDAS_VALIDAS.includes(moeda)) cambio[moeda] = num(r.payload.cotacao, cambio[moeda]);
  }

  // Fornecedores
  const fornecedores = fornecedoresStg.map((r) => ({
    id: String(r.payload.codigo || r.chave),
    nome: String(r.payload.nome || r.chave),
    pais: String(r.payload.pais || 'BR'),
  }));
  const fornecedorPorId = new Map(fornecedores.map((f) => [f.id, f]));

  // Índices auxiliares
  const cstPorItem = new Map(cstStg.map((r) => [String(r.payload.item || r.chave), String(r.payload.cst == null ? '' : r.payload.cst)]));
  const custoPorItem = new Map(custoStg.map((r) => [String(r.payload.item || r.chave), r.payload]));
  const saidasPorSku = new Map();
  for (const r of saidasStg) {
    const sku = String(r.payload.sku || '');
    if (!saidasPorSku.has(sku)) saidasPorSku.set(sku, []);
    saidasPorSku.get(sku).push({
      uf: String(r.payload.uf || '').toUpperCase(),
      volume: num(r.payload.volume),
      preco: num(r.payload.preco),
    });
  }

  const componentesPorPai = new Map();
  for (const r of estruturaStg) {
    const pai = String(r.payload.pai || '');
    if (!componentesPorPai.has(pai)) componentesPorPai.set(pai, []);
    componentesPorPai.get(pai).push({
      componente: String(r.payload.componente || ''),
      quantidade: num(r.payload.quantidade),
    });
  }

  const insumos = [];
  const produtos = [];
  for (const r of produtosStg) {
    const p = r.payload;
    const codigo = String(p.codigo || r.chave);
    const tipo = String(p.tipo || 'MP').toUpperCase();
    const origemErp = p.origem == null ? '' : String(p.origem).trim();
    const custo = custoPorItem.get(codigo) || {};
    const cstErp = cstPorItem.get(codigo) || '';

    if (tipo === 'PA' || tipo === 'PI') {
      produtos.push({
        id: codigo,
        sku: codigo,
        nome: String(p.descricao || codigo),
        tipo,
        kind: tipo,
        grupo: String(p.grupo || (tipo === 'PI' ? 'Intermediário' : '')),
        unidade: String(p.unidade || 'un'),
        overhead: 0,
        overheadPadrao: 0,
        espec: null,
        obrig: [],
        pend: false,
        fciVigente: num(p.fci_vigente, 0),
        componentes: (componentesPorPai.get(codigo) || []).map((c) => ({
          ref: c.componente,
          qtd: c.quantidade,
          qtdPadrao: c.quantidade,
        })),
        saidas: saidasPorSku.get(codigo) || [],
      });
    } else {
      // Duas camadas (E-04): a origem do cadastro inicializa a classificação e
      // o CI do item; o fator de faixa é aplicado depois, na cascata.
      const cls = classificacaoPorOrigem(origemErp);
      const moeda = String(custo.moeda || 'BRL').toUpperCase();
      const importado = cls.classSim === 'importado_direto';
      insumos.push({
        id: codigo,
        codigo,
        nome: String(p.descricao || codigo),
        unidade: String(p.unidade || 'un'),
        grupo: String(p.grupo || '—'),
        classSim: cls.classSim,
        origemCad: importado ? 'importado' : (cls.classSim === 'estrangeiro_mi' ? 'estrangeiro_mi' : 'nacional'),
        origemErp,
        fornecedorId: fornecedorPorId.has(String(custo.fornecedor)) ? String(custo.fornecedor) : null,
        cstErp,
        cstOrigem: cstErp || cstSugerido(cls.classSim, cls.ciPct),
        classFiscal: String(p.ncm || ''),
        ciModo: 'pct',
        ciFaixa: 'ate40',
        ciPct: cls.classSim === 'nacional_ci' ? cls.ciPct : 0,
        moeda: importado ? (MOEDAS_VALIDAS.includes(moeda) ? moeda : 'USD') : 'BRL',
        // Importação: FOB/frete/seguro são manuais no cenário (premissa E-07);
        // valores segregados entram somente se a origem os fornecer.
        fob: num(custo.fob), freteInt: num(custo.frete_int), seguroInt: num(custo.seguro_int),
        ii: num(custo.ii), ipiImp: num(custo.ipi_imp), pisCofinsImp: num(custo.piscofins_imp),
        // Nacional: custo FCI = valor total de entrada − ICMS − IPI (RN-03)
        precoNacional: num(custo.valor_total),
        icms: num(custo.icms),
        ipi: num(custo.ipi),
        alt: false,
      });
    }
  }

  // Ordena PA depois de PI para exibição em cascata natural
  produtos.sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === 'PI' ? -1 : 1));

  const origemCarga = [...fontesUsadas.values()];
  return {
    cambio,
    fornecedores,
    insumos,
    produtos,
    origemCarga,
    temDados: produtos.length > 0 || insumos.length > 0,
  };
}

module.exports = { montarDadosDeOrigem };
