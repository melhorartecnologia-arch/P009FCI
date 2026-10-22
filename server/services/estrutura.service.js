'use strict';
/**
 * Carga da estrutura de origem do ERP para o cenário (RF-002 · RC-001/RC-015).
 *
 * Ao criar ou recarregar um cenário, a lista técnica e o cadastro de insumos
 * são montados a partir do staging integrado — sem digitação manual (marco M1).
 * O resultado é um snapshot isolado gravado no próprio cenário (RF-007), que
 * inclui os VALORES PADRÃO de cada premissa (quantidade, overhead, cotação,
 * preço e volume de saída, classificação e conteúdo) para que a rastreabilidade
 * e a submissão à validação técnica consigam apontar o que mudou (RF-036).
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
const UNIDADES_DISCRETAS = ['un', 'UN', 'pç', 'pc', 'cx'];

/**
 * Tolerância de quantidade por grupo obrigatório (RF-027).
 * Itens discretos (latas, tampas, rótulos) não admitem desvio — uma embalagem
 * que exige 12 tampas não é aceita com 11. Itens contínuos (kg, L) admitem a
 * tolerância técnica relativa da receita.
 */
function toleranciaDe(unidade, quantidade) {
  if (UNIDADES_DISCRETAS.includes(unidade)) return 0;
  return Math.max(0.0005, Math.abs(quantidade) * 0.005);
}

/**
 * Monta o objeto de dados do cenário a partir do staging.
 * Estrutura consumida pelo motor compartilhado (shared/engine.mjs):
 * { base, cambio, cambioPadrao, fornecedores, insumos, produtos, origemCarga }
 */
async function montarDadosDeOrigem({ cambioPadrao, baseCalculo } = {}) {
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

  // ---- Câmbio do cenário (RF-052): staging sobrepõe o padrão dos parâmetros
  const padraoMoedas = Object.assign({}, cambioPadrao || { USD: 5.42, EUR: 5.88, GBP: 6.95, CHF: 6.12 });
  const cambio = Object.assign({}, padraoMoedas);
  for (const r of cambioStg) {
    const moeda = String(r.payload.moeda || '').toUpperCase();
    if (MOEDAS_VALIDAS.includes(moeda)) cambio[moeda] = num(r.payload.cotacao, cambio[moeda]);
  }
  const cambioBase = Object.assign({}, cambio);   // referência para o diff (RF-036)

  // ---- Fornecedores (variável 7)
  const fornecedores = fornecedoresStg.map((r) => ({
    id: String(r.payload.codigo || r.chave),
    nome: String(r.payload.nome || r.chave),
    pais: String(r.payload.pais || 'BR'),
  }));
  const fornecedorPorId = new Map(fornecedores.map((f) => [f.id, f]));

  // ---- Índices auxiliares
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
      volumePadrao: num(r.payload.volume),   // RF-036 — referência da carga
      precoPadrao: num(r.payload.preco),
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

  // ---- Cadastro de itens: insumos (MP) e produtos (PI/PA)
  const insumos = [];
  const produtos = [];
  const unidadePorItem = new Map();
  const grupoPorItem = new Map();

  for (const r of produtosStg) {
    const p = r.payload;
    const codigo = String(p.codigo || r.chave);
    unidadePorItem.set(codigo, String(p.unidade || 'un'));
    grupoPorItem.set(codigo, String(p.grupo || ''));
  }

  for (const r of produtosStg) {
    const p = r.payload;
    const codigo = String(p.codigo || r.chave);
    const tipo = String(p.tipo || 'MP').toUpperCase();
    const origemErp = p.origem == null ? '' : String(p.origem).trim();
    const custo = custoPorItem.get(codigo) || {};
    const cstErp = cstPorItem.get(codigo) || '';

    if (tipo === 'PA' || tipo === 'PI') {
      const comps = (componentesPorPai.get(codigo) || []).map((c) => ({
        ref: c.componente,
        qtd: c.quantidade,
        qtdPadrao: c.quantidade,          // RF-011/RF-036 — quantidade da receita padrão
      }));

      // RF-026 / RF-027 — a receita carregada do ERP é a referência dos grupos
      // obrigatórios: cada grupo presente passa a ser exigido, com a quantidade
      // total carregada e a tolerância técnica da unidade.
      const porGrupo = new Map();
      for (const c of comps) {
        const g = grupoPorItem.get(c.ref) || '—';
        const u = unidadePorItem.get(c.ref) || 'un';
        if (!porGrupo.has(g)) porGrupo.set(g, { grupo: g, qtd: 0, unidade: u });
        porGrupo.get(g).qtd += c.qtd;
      }
      const obrig = [...porGrupo.values()].map((g) => ({
        grupo: g.grupo, qtd: g.qtd, unidade: g.unidade, tol: toleranciaDe(g.unidade, g.qtd),
      }));

      // RF-014 — especificação técnica do SKU (volume envasado de referência)
      const volume = num(p.volume);
      const espec = volume > 0
        ? { descr: String(p.descricao || codigo), volume, unidVol: String(p.unidade_volume || 'ml') }
        : null;

      produtos.push({
        id: codigo,
        sku: codigo,
        nome: String(p.descricao || codigo),
        tipo, kind: tipo,
        grupo: String(p.grupo || (tipo === 'PI' ? 'Intermediário' : '')),
        unidade: String(p.unidade || 'un'),
        overhead: num(p.overhead),
        overheadPadrao: num(p.overhead),  // RF-012/RF-036
        espec,
        obrig,
        pend: false,
        fciVigente: num(p.fci_vigente, 0),
        componentes: comps,
        saidas: saidasPorSku.get(codigo) || [],
      });
    } else {
      // Duas camadas (decisão E-04): a origem do cadastro INICIALIZA a
      // classificação e o conteúdo do item (RF-047); ambos permanecem
      // editáveis de forma independente no cenário (RF-051).
      const cls = classificacaoPorOrigem(origemErp);
      const moeda = String(custo.moeda || 'BRL').toUpperCase();
      const importado = cls.classSim === 'importado_direto';
      const ciInicial = cls.classSim === 'nacional_ci' ? cls.ciPct : 0;

      insumos.push({
        id: codigo,
        codigo,
        nome: String(p.descricao || codigo),
        unidade: String(p.unidade || 'un'),
        grupo: String(p.grupo || '—'),
        classSim: cls.classSim,
        classPadrao: cls.classSim,                       // RF-036
        origemCad: importado ? 'importado' : (cls.classSim === 'estrangeiro_mi' ? 'estrangeiro_mi' : 'nacional'),
        origemErp,                                       // RF-047 — origem do cadastro exibida
        fornecedorId: fornecedorPorId.has(String(custo.fornecedor)) ? String(custo.fornecedor) : null,
        cstErp,                                          // RF-033 — CST da entrada (SD1)
        cstOrigem: cstErp || cstSugerido(cls.classSim, cls.ciPct),
        classFiscal: String(p.ncm || ''),
        ciModo: 'pct',
        ciFaixa: 'ate40',
        ciPct: ciInicial,
        ciPadrao: ciInicial,                             // RF-036
        moeda: importado ? (MOEDAS_VALIDAS.includes(moeda) ? moeda : 'USD') : 'BRL',
        // Importação: FOB, frete e seguro são manuais no cenário (premissa E-07);
        // valores segregados entram apenas quando a origem os fornece (RF-059).
        fob: num(custo.fob), freteInt: num(custo.frete_int), seguroInt: num(custo.seguro_int),
        ii: num(custo.ii), ipiImp: num(custo.ipi_imp), pisCofinsImp: num(custo.piscofins_imp),
        // Nacional: custo FCI = valor total de entrada − ICMS − IPI (RN-03)
        precoNacional: num(custo.valor_total),
        precoPadrao: num(custo.valor_total),
        icms: num(custo.icms),
        ipi: num(custo.ipi),
        alt: false,                                      // RF-055 — alternativa cadastral
      });
    }
  }

  // Intermediários antes dos acabados, para leitura natural da cascata
  produtos.sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === 'PI' ? -1 : 1));

  const origemCarga = [...fontesUsadas.values()];
  return {
    base: baseCalculo || 'saida',            // RF-060 — denominador vigente
    cambio,
    cambioPadrao: cambioBase,
    fornecedores,
    insumos,
    produtos,
    origemCarga,
    carregadoEm: new Date().toISOString(),
    temDados: produtos.length > 0 || insumos.length > 0,
  };
}

module.exports = { montarDadosDeOrigem, toleranciaDe };
