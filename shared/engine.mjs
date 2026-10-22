/**
 * ============================================================================
 * MOTOR DE CÁLCULO, SUBSTITUIÇÃO E VALIDAÇÃO DO SIMULADOR FCI
 * Cervejaria Cidade Imperial · Frutal-MG
 * ----------------------------------------------------------------------------
 * Fonte única de verdade, compartilhada entre navegador (ESM) e servidor
 * (import dinâmico em server/engine.js) — garante que a prévia na tela e a
 * validação gravada no banco usem exatamente a mesma regra (RNF-10).
 *
 * Base legal: Resolução SF 13/2012 · Convênio ICMS 38/2013 · Ajuste SINIEF
 * 19/2012 · LC 87/1996.
 *
 * Regras de negócio materializadas:
 *   RN-01 CI% = parcela importada ÷ denominador × 100
 *   RN-02 denominador padrão = média ponderada global das saídas interestaduais
 *   RN-03 custo FCI = valor total de entrada − ICMS − IPI (PIS/COFINS não deduzem)
 *   RN-04 importado direto e estrangeiro no mercado interno = conteúdo integral
 *   RN-05 fatores de faixa na cascata: 0 · 0,5 · 1
 *   RN-06 enquadramento nas quatro situações legais
 *   RN-07 CI% > 40% ⇒ alíquota interestadual de 4%
 *   RN-08 reemissão quando a variação supera o gatilho parametrizado
 *   RN-09 soma das proporções = 100% e soma das quantidades = quantidade original
 *   RN-10 premissas congeladas não são editáveis
 *   RN-11 alteração de receita exige validação da área de estrutura
 *   RN-12 o simulador não transmite nem substitui a FCI oficial
 * ============================================================================
 */

export const VERSAO_FORMULA_PADRAO = 'CI% v1 · Convênio ICMS 38/2013';

export const RESSALVA_GERENCIAL =
  'Análise de caráter gerencial, sem validade fiscal: não substitui a Ficha de ' +
  'Conteúdo de Importação oficial, não gera transmissão a órgão fiscal e não ' +
  'constitui apuração tributária (RN-12 · RF-082).';

/** Classificações de origem do item (RF-046 · RN-04). */
export const CLASSES = {
  nacional: {
    label: 'Nacional', curto: 'Nacional', cst: '0',
    bg: '#e9f1eb', fg: '#2f6b46', border: '#a9c9b5',
    desc: 'Produzido no país, sem conteúdo de importação',
    importado: false, permiteCI: false, permiteCustoImp: false,
  },
  importado_direto: {
    label: 'Importado diretamente', curto: 'Import. direto', cst: '1',
    bg: '#f5e5e0', fg: '#a03d2c', border: '#e0a898',
    desc: 'Importação própria — custo pelo valor aduaneiro (conteúdo integral)',
    importado: true, permiteCI: false, permiteCustoImp: true,
  },
  estrangeiro_mi: {
    label: 'Estrangeiro adquirido no mercado interno', curto: 'Estrang. merc. int.', cst: '2',
    bg: '#f6e3ea', fg: '#8e2f56', border: '#dfa9be',
    desc: 'Item estrangeiro comprado de terceiro no Brasil (conteúdo integral)',
    importado: true, permiteCI: false, permiteCustoImp: false,
  },
  nacional_ci: {
    label: 'Nacional com conteúdo de importação', curto: 'Nacional c/ CI', cst: '3 / 5 / 8',
    bg: '#f6ecd6', fg: '#8a5e12', border: '#dcc182',
    desc: 'Produzido no país com insumos importados — CI% informado ou por faixa',
    importado: false, permiteCI: true, permiteCustoImp: false,
  },
};

/** Faixas legais de conteúdo e respectivos fatores de cascata (RN-05 · RF-098). */
export const FAIXAS = {
  ate40:   { id: 'ate40',   label: '≤ 40%',       ci: 40, fator: 0,   cst: '5', fg: '#2f6b46', bg: '#e9f1eb' },
  de40a70: { id: 'de40a70', label: '40% – 70%',   ci: 55, fator: 0.5, cst: '3', fg: '#8a5e12', bg: '#f6ecd6' },
  acima70: { id: 'acima70', label: '> 70%',       ci: 85, fator: 1,   cst: '8', fg: '#a03d2c', bg: '#f5e5e0' },
};

/** Moedas parametrizáveis (RF-052 · decisão E-06). */
export const MOEDAS = {
  BRL: { codigo: 'BRL', nome: 'Real',            simbolo: 'R$'  },
  USD: { codigo: 'USD', nome: 'Dólar americano', simbolo: 'US$' },
  EUR: { codigo: 'EUR', nome: 'Euro',            simbolo: '€'   },
  GBP: { codigo: 'GBP', nome: 'Libra esterlina', simbolo: '£'   },
  CHF: { codigo: 'CHF', nome: 'Franco suíço',    simbolo: 'CHF' },
};

/** Unidades da Federação para volumes e destinos (RF-066). */
export const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

/** Áreas responsáveis pelo tratamento de alertas e direcionamentos (RF-086 · RF-088). */
export const AREAS_TRATAMENTO = ['Compras', 'Pricing', 'Fiscal/Tributário', 'Controladoria', 'Industrial/PCP'];

/** Componentes do valor aduaneiro, na ordem de exibição (RF-059). */
export const CAMPOS_ADUANEIROS = [
  { campo: 'fob',          rotulo: 'FOB (na moeda do insumo)', emMoeda: true },
  { campo: 'freteInt',     rotulo: 'Frete internacional',      emMoeda: false },
  { campo: 'seguroInt',    rotulo: 'Seguro internacional',     emMoeda: false },
  { campo: 'ii',           rotulo: 'Imposto de importação (II)', emMoeda: false },
  { campo: 'ipiImp',       rotulo: 'IPI de importação',        emMoeda: false },
  { campo: 'pisCofinsImp', rotulo: 'PIS/COFINS de importação', emMoeda: false },
];

// ---------------------------------------------------------------------------
// Utilitários numéricos e de formatação (RNF-03 — português do Brasil)
// ---------------------------------------------------------------------------
const EPS = 1e-9;

export function n(v, padrao = 0) {
  if (v == null || v === '') return padrao;
  const x = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : padrao;
}

export function num(v, casas = 2) {
  return n(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function pct(v, casas = 1) {
  return n(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

export function brl(v, casas = 4) {
  return 'R$ ' + n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
}

export function pp(v, casas = 1) {
  const x = n(v);
  return (x > 0 ? '+' : '') + x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + ' p.p.';
}

/** Cópia profunda isolada — garante que um cenário nunca compartilhe estado (RF-007). */
export function clonar(o) { return JSON.parse(JSON.stringify(o)); }

// ---------------------------------------------------------------------------
// Classificação, origem e CST
// ---------------------------------------------------------------------------

/** Fator de faixa aplicado na cascata (RN-05). */
export function fator(ci) {
  const c = n(ci);
  if (c > 70) return 1;
  if (c > 40) return 0.5;
  return 0;
}

/** Faixa correspondente a um CI% (RF-098). */
export function faixaDoCi(ci) {
  const c = n(ci);
  if (c > 70) return FAIXAS.acima70;
  if (c > 40) return FAIXAS.de40a70;
  return FAIXAS.ate40;
}

/**
 * Conversão da origem do cadastro (SB1.B1_ORIGEM) para conteúdo importado.
 * Padrão provisório do REV06 até a validação Fiscal (decisão E-04):
 * 0 = 0% · 1 e 2 = 100% · 3 = 50% · 4 a 7 = 0% · 8 = 100%.
 * A origem do cadastro apenas INICIALIZA a classificação do item (RF-047);
 * o conteúdo adotado é editável de forma independente (RF-051).
 */
export function classificacaoPorOrigem(origem) {
  const o = String(origem == null ? '' : origem).trim();
  switch (o) {
    case '1': return { classSim: 'importado_direto', ciPct: 100 };
    case '2': return { classSim: 'estrangeiro_mi',   ciPct: 100 };
    case '3': return { classSim: 'nacional_ci',      ciPct: 50  };
    case '8': return { classSim: 'nacional_ci',      ciPct: 100 };
    case '0': case '4': case '5': case '6': case '7':
      return { classSim: 'nacional', ciPct: 0 };
    default:
      return { classSim: 'nacional', ciPct: 0 };
  }
}

/** CST de origem sugerido pela classificação e faixa adotadas (RF-050). */
export function cstSugerido(classSim, ciFaixa, ciPct, ciModo) {
  if (classSim === 'importado_direto') return '1';
  if (classSim === 'estrangeiro_mi') return '2';
  if (classSim === 'nacional_ci') {
    const f = (ciModo === 'faixa') ? (FAIXAS[ciFaixa] || FAIXAS.ate40) : faixaDoCi(ciPct);
    return f.cst;
  }
  return '0';
}

/**
 * Conteúdo de importação adotado para o nó do insumo (RF-048 · RN-04).
 * Importado direto e estrangeiro adquirido no mercado interno entram com
 * conteúdo integral; nacional com CI usa percentual informado ou faixa.
 */
export function nodeInfo(ins) {
  const cls = ins.classSim || 'nacional';
  if (cls === 'importado_direto' || cls === 'estrangeiro_mi') {
    return { ci: 100, fator: 1, ciLabel: '100%', modo: 'integral' };
  }
  if (cls === 'nacional_ci') {
    if (ins.ciModo === 'faixa') {
      const f = FAIXAS[ins.ciFaixa] || FAIXAS.ate40;
      return { ci: f.ci, fator: f.fator, ciLabel: f.label, modo: 'faixa', faixa: f };
    }
    const p = n(ins.ciPct);
    return { ci: p, fator: fator(p), ciLabel: pct(p), modo: 'pct' };
  }
  return { ci: 0, fator: 0, ciLabel: '0%', modo: 'nacional' };
}

// ---------------------------------------------------------------------------
// Custo FCI e valor aduaneiro
// ---------------------------------------------------------------------------

/**
 * Composição do valor aduaneiro do insumo importado diretamente (RF-059):
 * FOB convertido pelo câmbio + frete e seguro internacional + II + IPI +
 * PIS/COFINS de importação. Todos os componentes são editáveis no cenário.
 */
export function valorAduaneiro(ins, cambio) {
  const taxa = n((cambio || {})[ins.moeda], ins.moeda === 'BRL' ? 1 : 1);
  const fobBRL = n(ins.fob) * taxa;
  const itens = [
    { campo: 'fob',          rotulo: 'FOB convertido',             valor: fobBRL, original: n(ins.fob), moeda: ins.moeda, taxa },
    { campo: 'freteInt',     rotulo: 'Frete internacional',        valor: n(ins.freteInt) },
    { campo: 'seguroInt',    rotulo: 'Seguro internacional',       valor: n(ins.seguroInt) },
    { campo: 'ii',           rotulo: 'Imposto de importação (II)', valor: n(ins.ii) },
    { campo: 'ipiImp',       rotulo: 'IPI de importação',          valor: n(ins.ipiImp) },
    { campo: 'pisCofinsImp', rotulo: 'PIS/COFINS de importação',   valor: n(ins.pisCofinsImp) },
  ];
  const total = itens.reduce((a, i) => a + i.valor, 0);
  return { itens, total, taxa, fobBRL };
}

/**
 * Custo FCI unitário do insumo (RF-058 · RN-03).
 * Importado direto → valor aduaneiro completo.
 * Demais → valor total de entrada deduzidos ICMS e IPI; PIS e COFINS NÃO deduzem.
 */
export function custoFCI(ins, cambio) {
  if (!ins) return 0;
  if (ins.classSim === 'importado_direto') return valorAduaneiro(ins, cambio).total;
  return n(ins.precoNacional) - n(ins.icms) - n(ins.ipi);
}

/** Memória de cálculo do custo FCI, demonstrável até o insumo (RNF-08). */
export function memoriaCustoFCI(ins, cambio) {
  if (ins.classSim === 'importado_direto') {
    const va = valorAduaneiro(ins, cambio);
    return {
      tipo: 'aduaneiro',
      linhas: va.itens.map((i) => ({ rotulo: i.rotulo, valor: i.valor })),
      total: va.total,
      nota: `FOB ${num(n(ins.fob), 4)} ${ins.moeda} convertido pela cotação de ${num(va.taxa, 4)} (RF-059).`,
    };
  }
  const entrada = n(ins.precoNacional);
  return {
    tipo: 'nacional',
    linhas: [
      { rotulo: 'Valor total de entrada', valor: entrada },
      { rotulo: 'ICMS destacado (dedutível)', valor: -n(ins.icms) },
      { rotulo: 'IPI destacado (dedutível)', valor: -n(ins.ipi) },
    ],
    total: entrada - n(ins.icms) - n(ins.ipi),
    nota: 'PIS e COFINS não deduzem do custo FCI (RN-03).',
  };
}

// ---------------------------------------------------------------------------
// Localização de itens na estrutura
// ---------------------------------------------------------------------------

export function acharInsumo(data, ref) { return (data.insumos || []).find((i) => i.id === ref) || null; }
export function acharProduto(data, ref) { return (data.produtos || []).find((p) => p.id === ref) || null; }

export function nomeDe(data, ref) {
  const p = acharProduto(data, ref); if (p) return p.nome;
  const i = acharInsumo(data, ref); return i ? i.nome : '(item não encontrado)';
}

export function grupoDe(data, ref) {
  const p = acharProduto(data, ref); if (p) return p.grupo || 'Intermediário';
  const i = acharInsumo(data, ref); return i ? (i.grupo || '—') : '—';
}

export function unidadeDe(data, ref) {
  const p = acharProduto(data, ref); if (p) return p.unidade || 'un';
  const i = acharInsumo(data, ref); return i ? (i.unidade || 'un') : 'un';
}

export function fornecedorDe(data, ins) {
  if (!ins || !ins.fornecedorId) return null;
  return (data.fornecedores || []).find((f) => f.id === ins.fornecedorId) || null;
}

/**
 * Alternativas de um componente (RF-019): quando há substituição, a lista
 * contém o item original e o substituto — ambos permanecem visíveis mesmo
 * com proporção zero.
 */
export function mixOf(comp) {
  return (comp && comp.mix && comp.mix.length) ? comp.mix : [{ ref: comp.ref, pct: 100 }];
}

export function temSubstituicao(comp) { return !!(comp && comp.mix && comp.mix.length > 1); }

// ---------------------------------------------------------------------------
// Cascata MP → PI → PA (RF-010 · RF-013 · RF-057)
// ---------------------------------------------------------------------------

/**
 * Calcula um nó da estrutura (produto acabado, intermediário ou insumo),
 * percorrendo a cascata MP → PI → PA e aplicando o fator de faixa de cada nó
 * conforme o seu conteúdo de importação (RF-057 · RN-05).
 *
 * Para cada componente devolve quantidade, custo, CI do nó, fator aplicado e
 * parcela importada — a soma das parcelas dos componentes é exatamente a
 * parcela importada do produto (critério de aceite do RF-013).
 */
export function computeNode(data, id, memo, pilha) {
  memo = memo || {};
  pilha = pilha || [];
  if (memo[id]) return memo[id];

  // Proteção contra estrutura cíclica (A contém B que contém A)
  if (pilha.includes(id)) {
    const r = { kind: 'ciclo', id, nome: nomeDe(data, id), custo: 0, parcela: 0, ci: 0, fator: 0, ciLabel: '—', ciclico: true };
    memo[id] = r; return r;
  }

  const prod = acharProduto(data, id);
  if (prod) {
    const proxPilha = pilha.concat([id]);
    let custo = n(prod.overhead);     // RF-012 — overhead compõe o custo total
    let parcela = 0;                  // ... e nunca integra a parcela importada
    const children = [];

    const comps = prod.componentes || [];
    for (let idx = 0; idx < comps.length; idx++) {
      const c = comps[idx];
      const mix = mixOf(c);
      let custoComp = 0, parcelaComp = 0;
      const parts = [];

      for (let mi = 0; mi < mix.length; mi++) {
        const m = mix[mi];
        const filho = computeNode(data, m.ref, memo, proxPilha);
        const proporcao = n(m.pct) / 100;
        const qtd = n(c.qtd) * proporcao;              // RF-018 — quantidade da alternativa
        const custoTot = filho.custo * qtd;
        const f = (filho.fator != null ? filho.fator : fator(filho.ci));
        const contrib = custoTot * f;                   // RF-013 — parcela importada
        custoComp += custoTot;
        parcelaComp += contrib;
        parts.push({
          mi, ref: m.ref, pct: n(m.pct), qtd, node: filho,
          custoUnit: filho.custo, custoTot, fator: f, contrib,
          origem: mi === 0 ? 'original' : 'substituto',
        });
      }

      custo += custoComp;
      parcela += parcelaComp;
      children.push({
        idx,
        ref: mix[0].ref,
        qtd: n(c.qtd),
        qtdPadrao: c.qtdPadrao == null ? n(c.qtd) : n(c.qtdPadrao),
        node: parts[0].node,
        parts,
        hasMix: mix.length > 1,
        grupo: grupoDe(data, mix[0].ref),
        unidade: unidadeDe(data, mix[0].ref),
        custoTot: custoComp,
        fator: custoComp > 0 ? parcelaComp / custoComp : 0,
        contrib: parcelaComp,
        pctTotal: mix.reduce((a, b) => a + n(b.pct), 0),
      });
    }

    const ci = custo > 0 ? parcela / custo * 100 : 0;
    const r = {
      kind: 'prod', tipo: prod.tipo || 'PA', id, nome: prod.nome, sku: prod.sku || prod.id,
      custo, parcela, ci, fator: fator(ci), ciLabel: pct(ci),
      overhead: n(prod.overhead), children, prod,
    };
    memo[id] = r;
    return r;
  }

  const ins = acharInsumo(data, id);
  if (!ins) {
    const r = { kind: 'ausente', id, nome: '(item não encontrado: ' + id + ')', custo: 0, parcela: 0, ci: 0, fator: 0, ciLabel: '—', ausente: true };
    memo[id] = r; return r;
  }

  const custo = custoFCI(ins, data.cambio);
  const ni = nodeInfo(ins);
  const r = {
    kind: 'mp', id, nome: ins.nome, codigo: ins.codigo || ins.id,
    custo, ci: ni.ci, fator: ni.fator, ciLabel: ni.ciLabel, modoCi: ni.modo,
    parcela: custo * ni.fator, ins,
    grupo: ins.grupo || '—', unidade: ins.unidade || 'un',
    classSim: ins.classSim || 'nacional', moeda: ins.moeda || 'BRL',
  };
  memo[id] = r;
  return r;
}

/** Estrutura achatada do produto para exibição em árvore (RF-010 · RF-075). */
export function achatarEstrutura(data, prodId, base) {
  const raiz = computeNode(data, prodId, {});
  const linhas = [];
  const percorrer = (node, nivel, parentId, parentQtd) => {
    for (const filho of node.children || []) {
      linhas.push({ ...filho, nivel, parentId, qtdEfetiva: filho.qtd * (parentQtd || 1) });
      for (const parte of filho.parts) {
        if (parte.node.kind === 'prod') {
          percorrer(parte.node, nivel + 1, node.id, (parentQtd || 1) * parte.qtd);
        }
      }
    }
  };
  percorrer(raiz, 0, null, 1);
  return { raiz, linhas };
}

// ---------------------------------------------------------------------------
// Volumes, preços e destinos (RF-066 a RF-072)
// ---------------------------------------------------------------------------

/** Preço médio ponderado das saídas interestaduais — denominador padrão (RN-02). */
export function precoMedio(prod) {
  let valor = 0, volume = 0;
  for (const s of (prod && prod.saidas) || []) { valor += n(s.volume) * n(s.preco); volume += n(s.volume); }
  return volume > 0 ? valor / volume : 0;
}

/** Peso de cada UF no volume e no preço médio; os pesos totalizam 100% (RF-070). */
export function pesosUF(prod) {
  const saidas = (prod && prod.saidas) || [];
  const volTotal = saidas.reduce((a, s) => a + n(s.volume), 0);
  const valTotal = saidas.reduce((a, s) => a + n(s.volume) * n(s.preco), 0);
  return saidas.map((s) => ({
    uf: s.uf,
    volume: n(s.volume),
    preco: n(s.preco),
    pesoVolume: volTotal > 0 ? n(s.volume) / volTotal * 100 : 0,
    pesoValor: valTotal > 0 ? (n(s.volume) * n(s.preco)) / valTotal * 100 : 0,
  })).sort((a, b) => b.pesoVolume - a.pesoVolume);
}

/**
 * Sensibilidade de preço por UF (RF-071): efeito no CI% de uma variação
 * percentual aplicada ao preço daquela UF, mantidas as demais premissas.
 */
export function sensibilidadeUF(data, prodId, variacaoPct = 5, base) {
  const prod = acharProduto(data, prodId);
  if (!prod || !(prod.saidas || []).length) return [];
  const atual = resultadoProduto(data, prodId, base);
  return (prod.saidas || []).map((s) => {
    const copia = clonar(data);
    const p = acharProduto(copia, prodId);
    const alvo = (p.saidas || []).find((x) => x.uf === s.uf);
    if (alvo) alvo.preco = n(alvo.preco) * (1 + n(variacaoPct) / 100);
    const simulado = resultadoProduto(copia, prodId, base);
    return {
      uf: s.uf,
      volume: n(s.volume),
      precoAtual: n(s.preco),
      precoSimulado: n(s.preco) * (1 + n(variacaoPct) / 100),
      ciAtual: atual.ci,
      ciSimulado: simulado.ci,
      deltaPp: simulado.ci - atual.ci,
      mudaFaixa: faixaDe(simulado.ci).key !== faixaDe(atual.ci).key,
    };
  }).sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
}

// ---------------------------------------------------------------------------
// Enquadramento, alíquota e ICMS-ST (RF-061 · RF-062 · RN-06 · RN-07)
// ---------------------------------------------------------------------------

/** Faixa de enquadramento do produto a partir do CI% (RN-06). */
export function faixaDe(ci) {
  const c = n(ci);
  if (c > 70) return { key: 'alto', label: 'Equiparado a importado', range: 'CI% > 70%', fg: '#a03d2c', bg: '#f5e5e0', chip: '#e79b86', ordem: 4 };
  if (c > 40) return { key: 'medio', label: 'Nacional com CI acima de 40%', range: '40% < CI% ≤ 70%', fg: '#8a5e12', bg: '#f6ecd6', chip: '#e0b866', ordem: 3 };
  if (c > 0)  return { key: 'baixo', label: 'Nacional com conteúdo de importação', range: '0% < CI% ≤ 40%', fg: '#2f6b46', bg: '#e9f1eb', chip: '#7fb193', ordem: 2 };
  return { key: 'nacional', label: '100% nacional', range: 'CI% = 0%', fg: '#2f6b46', bg: '#e9f1eb', chip: '#7fb193', ordem: 1 };
}

/** Enquadramento completo, com obrigatoriedade da FCI (RN-06 · RF-087). */
export function enquadramento(ci, aliqNormal = 12) {
  const fx = faixaDe(ci);
  return {
    ...fx,
    ci: n(ci),
    aliquota: aliqInter(ci, aliqNormal),
    fciObrigatoria: n(ci) > 0,
    baseLegal: n(ci) > 40
      ? 'Resolução SF 13/2012 (alíquota de 4%) · Convênio ICMS 38/2013'
      : 'Convênio ICMS 38/2013 · Ajuste SINIEF 19/2012',
  };
}

/** Alíquota interestadual resultante (RN-07 · Resolução SF 13/2012). */
export function aliqInter(ci, aliqNormal = 12) { return n(ci) > 40 ? 4 : n(aliqNormal, 12); }

/**
 * Simulação do impacto na alíquota e no ICMS-ST (RF-062).
 * Compara ICMS próprio e ICMS-ST nas duas alíquotas (a resultante do CI% e a
 * normal do destino), com MVA e alíquota interna parametrizáveis.
 */
export function icmsST(precoUnitario, ci, params = {}) {
  const mva = n(params.mva, 30);
  const aliqInterna = n(params.aliqInterna, 18);
  const aliqNormal = n(params.aliqNormal, 12);
  const preco = n(precoUnitario);
  const aliqResultante = aliqInter(ci, aliqNormal);

  const cenario = (aliq) => {
    const icmsProprio = preco * (aliq / 100);
    const baseST = preco * (1 + mva / 100);
    const icmsTotal = baseST * (aliqInterna / 100);
    const st = Math.max(0, icmsTotal - icmsProprio);
    return { aliquota: aliq, icmsProprio, baseST, icmsTotal, st, carga: icmsProprio + st };
  };

  const comCI = cenario(aliqResultante);
  const semCI = cenario(aliqNormal);
  return {
    preco, mva, aliqInterna, aliqNormal, aliqResultante,
    comCI, semCI,
    difST: comCI.st - semCI.st,
    difCarga: comCI.carga - semCI.carga,
    aplicavel: aliqResultante !== aliqNormal,
    nota: aliqResultante === 4
      ? 'CI% acima de 40% reduz a alíquota interestadual para 4% e desloca carga para o ICMS-ST do destino (RN-07).'
      : 'Alíquota interestadual normal do destino; sem efeito da Resolução SF 13/2012.',
  };
}

// ---------------------------------------------------------------------------
// Resultado do produto (RF-056 · RF-060 · RF-064)
// ---------------------------------------------------------------------------

/**
 * Resultado consolidado de um produto:
 *   CI% = parcela importada ÷ denominador × 100 (RN-01)
 * Denominador parametrizável (RF-060 · RN-02):
 *   'saida' → média ponderada global das saídas interestaduais (padrão)
 *   'custo' → custo total da mercadoria (alternativa)
 * Quando a base vigente é 'saida' mas o produto não tem saídas carregadas, o
 * cálculo recai sobre o custo total e a tela identifica a base efetivamente
 * usada (critério de aceite do RF-060).
 */
export function resultadoProduto(data, prodId, baseParam, params = {}) {
  const base = baseParam || data.base || 'saida';
  const node = computeNode(data, prodId, {});
  const prod = node.prod || acharProduto(data, prodId);
  const pm = prod ? precoMedio(prod) : 0;
  const usaSaida = base === 'saida' && pm > 0;
  const denominador = usaSaida ? pm : node.custo;
  const ci = denominador > 0 ? node.parcela / denominador * 100 : 0;
  const aliqNormal = n(params.aliqNormal, 12);

  return {
    produtoId: prodId,
    node,
    produto: prod,
    custo: node.custo,
    parcela: node.parcela,
    denominador,
    baseSolicitada: base,
    baseUsada: usaSaida ? 'saida' : 'custo',
    baseLabel: usaSaida
      ? 'média ponderada global das saídas interestaduais'
      : (base === 'saida' ? 'custo total (sem saídas carregadas para este produto)' : 'custo total da mercadoria'),
    ci,
    ciCusto: node.ci,
    precoMedio: pm,
    faixa: faixaDe(ci),
    enquadramento: enquadramento(ci, aliqNormal),
    fciVigente: n(prod && prod.fciVigente),
    deltaVigente: ci - n(prod && prod.fciVigente),
    versaoFormula: params.versaoFormula || data.versaoFormula || VERSAO_FORMULA_PADRAO,
  };
}

/** Memória de cálculo do CI% do produto, demonstrável até o insumo (RNF-08). */
export function memoriaCalculo(data, prodId, base, params = {}) {
  const r = resultadoProduto(data, prodId, base, params);
  const linhas = [
    { rotulo: 'Custo total da mercadoria (cascata + overhead)', valor: r.custo, tipo: 'moeda' },
    { rotulo: 'Parcela importada (Σ custo × quantidade × fator de faixa)', valor: r.parcela, tipo: 'moeda', destaque: true },
    { rotulo: `Denominador vigente — ${r.baseLabel}`, valor: r.denominador, tipo: 'moeda' },
    { rotulo: 'CI% = parcela importada ÷ denominador × 100', valor: r.ci, tipo: 'pct', destaque: true },
    { rotulo: 'CI% pela base alternativa (custo total)', valor: r.ciCusto, tipo: 'pct' },
    { rotulo: 'Enquadramento resultante', valor: r.enquadramento.label, tipo: 'texto' },
    { rotulo: 'Alíquota interestadual resultante', valor: r.enquadramento.aliquota, tipo: 'pctInt' },
    { rotulo: 'FCI vigente (pré-apuração integrada)', valor: r.fciVigente, tipo: 'pct' },
    { rotulo: 'Variação vs FCI vigente', valor: r.deltaVigente, tipo: 'pp' },
  ];
  return { resultado: r, linhas, versaoFormula: r.versaoFormula };
}

/** Componentes ordenados por contribuição na parcela importada (RF-065). */
export function maioresContribuicoes(resultado, limite = 10) {
  const total = resultado.node.parcela;
  return (resultado.node.children || [])
    .map((c) => ({
      idx: c.idx, ref: c.ref, nome: c.node.nome, grupo: c.grupo,
      qtd: c.qtd, unidade: c.unidade,
      custoTot: c.custoTot, fator: c.fator, contrib: c.contrib,
      participacao: total > 0 ? c.contrib / total * 100 : 0,
      pesoCusto: resultado.custo > 0 ? c.custoTot / resultado.custo * 100 : 0,
      hasMix: c.hasMix,
    }))
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, limite);
}

/** Painel do cenário com indicadores recalculados (RF-004). */
export function resumoCenario(data, base, params = {}) {
  const pas = (data.produtos || []).filter((p) => (p.tipo || 'PA') === 'PA');
  const dist = { nacional: 0, baixo: 0, medio: 0, alto: 0 };
  let somaCiPeso = 0, somaPeso = 0, acima40 = 0;
  const porProduto = [];

  for (const p of pas) {
    const r = resultadoProduto(data, p.id, base, params);
    const peso = (p.saidas || []).reduce((a, s) => a + n(s.volume), 0) || 1;
    somaCiPeso += r.ci * peso;
    somaPeso += peso;
    if (r.ci > 40) acima40++;
    dist[r.faixa.key] = (dist[r.faixa.key] || 0) + 1;
    porProduto.push({ produto: p, resultado: r });
  }

  porProduto.sort((a, b) => b.resultado.ci - a.resultado.ci);
  return {
    ciMedio: somaPeso > 0 ? somaCiPeso / somaPeso : 0,
    nProdutos: pas.length,
    nIntermediarios: (data.produtos || []).filter((p) => p.tipo === 'PI').length,
    nInsumos: (data.insumos || []).length,
    acima40,
    dist,
    porProduto,
    base: base || data.base || 'saida',
  };
}

// ---------------------------------------------------------------------------
// Substituição controlada de componentes (RF-015 a RF-024 · RN-09)
// ---------------------------------------------------------------------------

/**
 * Alternativas elegíveis para substituir um componente (RF-020).
 * As alternativas do MESMO GRUPO DE INSUMO são apresentadas primeiro; cada
 * opção declara a natureza da troca (nacional ↔ importado, fornecedor, grupo).
 * Intermediários só podem ser trocados por outros intermediários (RF-021).
 */
export function opcoesSubstituicao(data, prodId, idx) {
  const prod = acharProduto(data, prodId);
  if (!prod) return { mesmoGrupo: [], outros: [], atual: null };
  const comp = (prod.componentes || [])[idx];
  if (!comp) return { mesmoGrupo: [], outros: [], atual: null };

  const refAtual = mixOf(comp)[0].ref;
  const atualProd = acharProduto(data, refAtual);
  const atualIns = acharInsumo(data, refAtual);
  const grupoAtual = grupoDe(data, refAtual);
  const ehIntermediario = !!atualProd;
  const fornAtual = atualIns ? atualIns.fornecedorId : null;
  const classAtual = atualIns ? atualIns.classSim : null;

  const candidatos = ehIntermediario
    // RF-021 — intermediário é trocado por outro intermediário
    ? (data.produtos || [])
        .filter((p) => p.tipo === 'PI' && p.id !== refAtual && p.id !== prodId)
        .map((p) => ({ ref: p.id, nome: p.nome, codigo: p.sku || p.id, grupo: p.grupo || 'Intermediário', tipo: 'PI' }))
    : (data.insumos || [])
        .filter((i) => i.id !== refAtual)
        .map((i) => ({
          ref: i.id, nome: i.nome, codigo: i.codigo || i.id, grupo: i.grupo || '—', tipo: 'MP',
          classSim: i.classSim, fornecedorId: i.fornecedorId, alt: !!i.alt,
        }));

  const anotar = (o) => {
    const ins = acharInsumo(data, o.ref);
    const mesmoGrupo = o.grupo === grupoAtual;
    const trocaOrigem = !!(ins && classAtual && CLASSES[ins.classSim] && CLASSES[classAtual] &&
      CLASSES[ins.classSim].importado !== CLASSES[classAtual].importado);
    const trocaFornecedor = !!(ins && fornAtual && ins.fornecedorId && ins.fornecedorId !== fornAtual);
    const forn = fornecedorDe(data, ins);
    const naturezas = [];
    if (mesmoGrupo) naturezas.push('Alternativa do mesmo grupo de insumo');
    if (trocaOrigem) naturezas.push(ins && CLASSES[ins.classSim] && CLASSES[ins.classSim].importado
      ? 'Troca nacional → importado' : 'Troca importado → nacional');
    if (trocaFornecedor) naturezas.push('Troca de fornecedor' + (forn ? ' · ' + forn.nome : ''));
    if (!naturezas.length) naturezas.push('Troca entre grupos de insumo');
    const custo = ins ? custoFCI(ins, data.cambio) : computeNode(data, o.ref, {}).custo;
    const ni = ins ? nodeInfo(ins) : { ci: computeNode(data, o.ref, {}).ci, ciLabel: pct(computeNode(data, o.ref, {}).ci) };
    return {
      ...o, mesmoGrupo, trocaOrigem, trocaFornecedor,
      fornecedor: forn ? forn.nome : '—',
      naturezas, custoFCI: custo, ci: ni.ci, ciLabel: ni.ciLabel,
      classeLabel: ins && CLASSES[ins.classSim] ? CLASSES[ins.classSim].curto : 'Intermediário',
      rotulo: `${o.nome} · ${o.codigo}`,
    };
  };

  const anotados = candidatos.map(anotar);
  return {
    atual: {
      ref: refAtual, nome: nomeDe(data, refAtual), grupo: grupoAtual,
      qtdReceita: n(comp.qtd), unidade: unidadeDe(data, refAtual),
      classeLabel: atualIns && CLASSES[atualIns.classSim] ? CLASSES[atualIns.classSim].curto : 'Intermediário',
      fornecedor: (fornecedorDe(data, atualIns) || {}).nome || '—',
      custoFCI: atualIns ? custoFCI(atualIns, data.cambio) : computeNode(data, refAtual, {}).custo,
      ci: atualIns ? nodeInfo(atualIns).ci : computeNode(data, refAtual, {}).ci,
      ehIntermediario,
    },
    mesmoGrupo: anotados.filter((o) => o.mesmoGrupo).sort((a, b) => a.nome.localeCompare(b.nome)),
    outros: anotados.filter((o) => !o.mesmoGrupo).sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome)),
  };
}

/**
 * Aplica a substituição de um componente (RF-015 · RF-016 · RF-017 · RF-021).
 * modo 'integral' → substituto assume 100% e o item original PERMANECE na
 * estrutura com proporção zero (RF-016 · RF-019).
 * modo 'parcial'  → ao informar a proporção do substituto, a do original é
 * complementada automaticamente para totalizar 100% (RF-017).
 * A quantidade total da receita nunca é alterada pela substituição (RF-018).
 * Devolve uma NOVA cópia dos dados — o cenário de origem não é mutado.
 */
export function aplicarSubstituicao(data, prodId, idx, { refSubstituto, modo = 'integral', pct: pctSub = 100 }) {
  const novo = clonar(data);
  const prod = acharProduto(novo, prodId);
  if (!prod) throw new Error('Produto não encontrado na estrutura do cenário.');
  const comp = (prod.componentes || [])[idx];
  if (!comp) throw new Error('Componente não encontrado na estrutura do produto.');
  if (!refSubstituto) throw new Error('Informe o item substituto.');

  const refOriginal = mixOf(comp)[0].ref;
  if (refSubstituto === refOriginal) {
    throw new Error('O item substituto é igual ao item original — não há substituição a realizar (RF-045).');
  }
  const existe = acharInsumo(novo, refSubstituto) || acharProduto(novo, refSubstituto);
  if (!existe) throw new Error('Item substituto inexistente no cenário.');

  // RF-021 — intermediário só é trocado por outro intermediário
  const originalEhPI = !!acharProduto(novo, refOriginal);
  const substitutoEhPI = !!acharProduto(novo, refSubstituto);
  if (originalEhPI !== substitutoEhPI) {
    throw new Error('Produto intermediário só pode ser substituído por outro intermediário (RF-021).');
  }
  if (substitutoEhPI && refSubstituto === prodId) {
    throw new Error('Um produto não pode ser componente de si mesmo.');
  }

  const p = modo === 'integral' ? 100 : Math.min(100, Math.max(0, n(pctSub)));
  // RF-016/RF-017 — original permanece listado; proporção complementar automática
  comp.mix = [
    { ref: refOriginal, pct: 100 - p },
    { ref: refSubstituto, pct: p },
  ];
  comp.substituidoEm = comp.substituidoEm || true;
  return novo;
}

/** Ajusta a proporção de uma alternativa complementando a outra (RF-017 · RF-023). */
export function ajustarProporcao(data, prodId, idx, mi, novoPct) {
  const novo = clonar(data);
  const prod = acharProduto(novo, prodId);
  const comp = prod && (prod.componentes || [])[idx];
  if (!comp) throw new Error('Componente não encontrado.');
  const mix = mixOf(comp);
  if (mix.length < 2) throw new Error('Componente sem alternativas para ajustar.');
  const valor = Math.min(100, Math.max(0, n(novoPct)));
  comp.mix = mix.map((m, i) => ({ ...m, pct: i === Number(mi) ? valor : m.pct }));
  // Com exatamente duas alternativas, a outra é complementada automaticamente
  if (comp.mix.length === 2) {
    const outro = Number(mi) === 0 ? 1 : 0;
    comp.mix[outro] = { ...comp.mix[outro], pct: 100 - valor };
  }
  return novo;
}

/** Normaliza as proporções redistribuindo proporcionalmente até 100% (RF-023). */
export function normalizarProporcoes(data, prodId, idx) {
  const novo = clonar(data);
  const prod = acharProduto(novo, prodId);
  const comp = prod && (prod.componentes || [])[idx];
  if (!comp) throw new Error('Componente não encontrado.');
  const mix = mixOf(comp);
  const total = mix.reduce((a, m) => a + n(m.pct), 0);
  if (Math.abs(total - 100) < EPS) return novo;
  if (total <= 0) {
    comp.mix = mix.map((m, i) => ({ ...m, pct: i === 0 ? 100 : 0 }));
    return novo;
  }
  const ajustado = mix.map((m) => ({ ...m, pct: n(m.pct) / total * 100 }));
  // Corrige o arredondamento no maior item para fechar exatamente 100%
  const soma = ajustado.reduce((a, m) => a + m.pct, 0);
  let maior = 0;
  ajustado.forEach((m, i) => { if (m.pct > ajustado[maior].pct) maior = i; });
  ajustado[maior].pct += 100 - soma;
  comp.mix = ajustado;
  return novo;
}

/**
 * Reverte a substituição (RF-024): a estrutura retorna ao componente original
 * com 100% e sem alternativas residuais.
 */
export function reverterSubstituicao(data, prodId, idx) {
  const novo = clonar(data);
  const prod = acharProduto(novo, prodId);
  const comp = prod && (prod.componentes || [])[idx];
  if (!comp) throw new Error('Componente não encontrado.');
  const refOriginal = mixOf(comp)[0].ref;
  comp.ref = refOriginal;
  delete comp.mix;
  delete comp.substituidoEm;
  return novo;
}

/**
 * Prévia do efeito da substituição antes da confirmação (RF-022):
 * CI% atual, CI% simulado, faixa resultante e variação em pontos percentuais.
 */
export function previaSubstituicao(data, prodId, idx, opcoes, base, params = {}) {
  const atual = resultadoProduto(data, prodId, base, params);
  let simuladoDados;
  try {
    simuladoDados = aplicarSubstituicao(data, prodId, idx, opcoes);
  } catch (err) {
    return { erro: err.message, atual, aplicavel: false };
  }
  const simulado = resultadoProduto(simuladoDados, prodId, base, params);
  const prod = acharProduto(data, prodId);
  const comp = (prod.componentes || [])[idx];
  const qtdBase = n(comp.qtd);
  const p = opcoes.modo === 'integral' ? 100 : Math.min(100, Math.max(0, n(opcoes.pct)));

  return {
    aplicavel: true,
    atual, simulado,
    ciAtual: atual.ci,
    ciSimulado: simulado.ci,
    deltaPp: simulado.ci - atual.ci,
    faixaAtual: atual.faixa,
    faixaSimulada: simulado.faixa,
    mudaFaixa: atual.faixa.key !== simulado.faixa.key,
    aliquotaAtual: atual.enquadramento.aliquota,
    aliquotaSimulada: simulado.enquadramento.aliquota,
    custoAtual: atual.custo,
    custoSimulado: simulado.custo,
    deltaCusto: simulado.custo - atual.custo,
    // RF-018 — quantidades calculadas sobre a quantidade original da receita
    quantidades: [
      { papel: 'original', ref: mixOf(comp)[0].ref, nome: nomeDe(data, mixOf(comp)[0].ref), pct: 100 - p, qtd: qtdBase * (100 - p) / 100 },
      { papel: 'substituto', ref: opcoes.refSubstituto, nome: nomeDe(data, opcoes.refSubstituto), pct: p, qtd: qtdBase * p / 100 },
    ],
    qtdOriginalReceita: qtdBase,
    unidade: unidadeDe(data, mixOf(comp)[0].ref),
  };
}

// ---------------------------------------------------------------------------
// Alterações em massa por grupo de insumo (RF-040 a RF-045)
// ---------------------------------------------------------------------------

/** Grupos de insumo existentes na ficha técnica do cenário (RF-040). */
export function gruposDeInsumo(data) {
  const mapa = new Map();
  for (const p of data.produtos || []) {
    for (let idx = 0; idx < (p.componentes || []).length; idx++) {
      const c = p.componentes[idx];
      const ref = mixOf(c)[0].ref;
      const g = grupoDe(data, ref);
      if (!mapa.has(g)) mapa.set(g, { grupo: g, posicoes: 0, estruturas: new Set(), itens: new Set() });
      const e = mapa.get(g);
      e.posicoes++;
      e.estruturas.add(p.id);
      for (const m of mixOf(c)) e.itens.add(m.ref);
    }
  }
  return [...mapa.values()]
    .map((e) => ({ grupo: e.grupo, posicoes: e.posicoes, nEstruturas: e.estruturas.size, estruturas: [...e.estruturas], itens: [...e.itens] }))
    .sort((a, b) => b.posicoes - a.posicoes || a.grupo.localeCompare(b.grupo));
}

/** Itens de um grupo que podem ser o substituto da operação em lote (RF-040). */
export function itensDoGrupo(data, grupo) {
  const insumos = (data.insumos || [])
    .filter((i) => (i.grupo || '—') === grupo)
    .map((i) => ({
      ref: i.id, nome: i.nome, codigo: i.codigo || i.id, tipo: 'MP',
      classSim: i.classSim, classeLabel: CLASSES[i.classSim] ? CLASSES[i.classSim].curto : '—',
      custoFCI: custoFCI(i, data.cambio), ci: nodeInfo(i).ci,
      fornecedor: (fornecedorDe(data, i) || {}).nome || '—',
    }));
  const intermediarios = (data.produtos || [])
    .filter((p) => p.tipo === 'PI' && (p.grupo || 'Intermediário') === grupo)
    .map((p) => ({
      ref: p.id, nome: p.nome, codigo: p.sku || p.id, tipo: 'PI',
      classeLabel: 'Intermediário', custoFCI: computeNode(data, p.id, {}).custo, ci: computeNode(data, p.id, {}).ci,
      fornecedor: '—',
    }));
  return [...insumos, ...intermediarios].sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Posições da ficha técnica afetadas por uma operação em lote (RF-040 · RF-042).
 * Devolve cada estrutura (produto) e a posição do componente do grupo, com a
 * indicação de quais já usam o substituto — base para o RF-045.
 */
export function posicoesDoGrupo(data, grupo) {
  const out = [];
  for (const p of data.produtos || []) {
    for (let idx = 0; idx < (p.componentes || []).length; idx++) {
      const c = p.componentes[idx];
      const ref = mixOf(c)[0].ref;
      if (grupoDe(data, ref) !== grupo) continue;
      out.push({
        prodId: p.id, prodNome: p.nome, prodSku: p.sku || p.id, prodTipo: p.tipo || 'PA',
        idx, refAtual: ref, nomeAtual: nomeDe(data, ref),
        qtd: n(c.qtd), unidade: unidadeDe(data, ref),
        temMix: temSubstituicao(c),
        mix: mixOf(c).map((m) => ({ ref: m.ref, nome: nomeDe(data, m.ref), pct: n(m.pct) })),
      });
    }
  }
  return out;
}

/**
 * Prévia da alteração em massa (RF-043 · RF-045): mostra CI% antes e depois,
 * variação em p.p. e mudança de faixa de cada estrutura afetada, antes de
 * aplicar. `aplicavel` é falso quando o substituto já é o item de todas as
 * posições selecionadas — nesse caso não há substituição a realizar (RF-045).
 */
export function previaMassa(data, { grupo, refSubstituto, pct: pctSub = 100, prodIds = null }, base, params = {}) {
  const posicoes = posicoesDoGrupo(data, grupo)
    .filter((pos) => !prodIds || prodIds.includes(pos.prodId));

  const efetivas = posicoes.filter((pos) => pos.refAtual !== refSubstituto ||
    (temSubstituicao((acharProduto(data, pos.prodId).componentes || [])[pos.idx]) ));
  const semEfeito = posicoes.length > 0 && posicoes.every((pos) => {
    const comp = (acharProduto(data, pos.prodId).componentes || [])[pos.idx];
    const mix = mixOf(comp);
    return mix.length === 1 && mix[0].ref === refSubstituto;
  });

  let simulado = data;
  const aplicadas = [];
  for (const pos of posicoes) {
    const comp = (acharProduto(simulado, pos.prodId).componentes || [])[pos.idx];
    const refOriginal = mixOf(comp)[0].ref;
    if (refOriginal === refSubstituto) continue;    // RF-045 — nada a substituir nesta posição
    try {
      simulado = aplicarSubstituicao(simulado, pos.prodId, pos.idx, {
        refSubstituto, modo: n(pctSub) >= 100 ? 'integral' : 'parcial', pct: pctSub,
      });
      aplicadas.push(pos);
    } catch { /* posição incompatível (ex.: PI × MP) é ignorada na prévia */ }
  }

  // Produtos acabados impactados — direta ou indiretamente, via intermediário
  const pasAfetados = new Set();
  for (const pos of aplicadas) {
    if (pos.prodTipo === 'PA') pasAfetados.add(pos.prodId);
    else {
      for (const p of (data.produtos || []).filter((x) => (x.tipo || 'PA') === 'PA')) {
        const usa = (p.componentes || []).some((c) => mixOf(c).some((m) => m.ref === pos.prodId));
        if (usa) pasAfetados.add(p.id);
      }
    }
  }

  const impactos = [...pasAfetados].map((pid) => {
    const antes = resultadoProduto(data, pid, base, params);
    const depois = resultadoProduto(simulado, pid, base, params);
    return {
      prodId: pid, nome: antes.produto.nome, sku: antes.produto.sku || pid,
      ciAntes: antes.ci, ciDepois: depois.ci, deltaPp: depois.ci - antes.ci,
      faixaAntes: antes.faixa, faixaDepois: depois.faixa,
      mudaFaixa: antes.faixa.key !== depois.faixa.key,
      custoAntes: antes.custo, custoDepois: depois.custo,
    };
  }).sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));

  return {
    grupo, refSubstituto, nomeSubstituto: nomeDe(data, refSubstituto), pct: n(pctSub),
    posicoes, aplicadas, nPosicoes: posicoes.length, nAplicadas: aplicadas.length,
    estruturas: [...new Set(posicoes.map((p) => p.prodId))],
    impactos,
    semEfeito,
    aplicavel: aplicadas.length > 0 && !semEfeito,
    motivoIndisponivel: semEfeito
      ? 'O item substituto já é o componente original de todas as estruturas selecionadas — não há substituição a realizar (RF-045).'
      : (aplicadas.length === 0 ? 'Nenhuma posição elegível na seleção atual.' : null),
    dadosSimulados: simulado,
  };
}

/**
 * Aplica a alteração em massa somente às estruturas selecionadas (RF-041 ·
 * RF-042). A substituição individual por SKU permanece disponível na estrutura
 * depois da operação em lote (RF-044) — nada é bloqueado por esta ação.
 */
export function aplicarMassa(data, opcoes, base, params = {}) {
  const previa = previaMassa(data, opcoes, base, params);
  if (!previa.aplicavel) {
    const e = new Error(previa.motivoIndisponivel || 'Operação em lote sem efeito.');
    e.status = 422; throw e;
  }
  return { dados: previa.dadosSimulados, previa };
}

// ---------------------------------------------------------------------------
// Validadores da estrutura (RF-025 a RF-033 · RN-09)
// ---------------------------------------------------------------------------

const TOL_PCT = 0.01;   // tolerância da soma de proporções, em pontos percentuais

/**
 * Diagnóstico consolidado do cenário (RF-032).
 * Devolve a lista completa de ocorrências, cada uma com:
 *   sev    → 'erro' (bloqueia consolidar/congelar) ou 'aviso' (não bloqueia)
 *   tipo   → obrigatorio | quantidade | proporcao | distribuicao | especificacao |
 *            referencia | custo | ci | cst | ciclo | overhead
 *   origem → 'estrutura' (produto/componente) ou 'cadastro' (insumo do cenário)
 * A tela distingue erros de avisos e informa o produto ou o cadastro de
 * origem de cada ocorrência (critério de aceite do RF-032).
 */
export function validar(data, opcoes = {}) {
  const out = [];
  // No MODO AVANÇADO a alteração da receita é deliberada e autorizada (RF-011 ·
  // RF-034): a divergência contra a receita padrão deixa de bloquear e passa a
  // ser AVISO, porque a governança desse desvio é a validação técnica
  // (RF-036 · RF-037 · RF-038 · RN-11). A ausência de grupo obrigatório
  // permanece erro em qualquer modo — estrutura incompleta nunca é consolidável.
  const avancado = (opcoes.modo || data.modo) === 'avancado';
  const add = (o) => out.push({
    sev: 'erro', origem: 'estrutura', prodId: null, idx: null, insumoId: null, campo: null, ...o,
  });

  for (const p of data.produtos || []) {
    const rotuloProd = `${p.nome} (${p.sku || p.id})`;

    // RF-026 / RF-027 — componentes obrigatórios e quantidade por grupo
    for (const o of p.obrig || []) {
      let soma = 0, achou = false, idxRef = null;
      (p.componentes || []).forEach((c, idx) => {
        const pertence = mixOf(c).some((m) => grupoDe(data, m.ref) === o.grupo);
        if (pertence) { achou = true; soma += n(c.qtd); if (idxRef == null) idxRef = idx; }
      });
      if (!achou) {
        add({
          tipo: 'obrigatorio', prodId: p.id, campo: 'obrig',
          msg: `${rotuloProd}: componente obrigatório ausente — grupo «${o.grupo}», quantidade esperada ${num(o.qtd, 3)} ${o.unidade || ''}.`.trim(),
        });
        continue;
      }
      const tol = n(o.tol);
      if (Math.abs(soma - n(o.qtd)) > tol + EPS) {
        const sentido = soma > n(o.qtd) ? 'acima' : 'abaixo';
        add({
          sev: avancado ? 'aviso' : 'erro',
          tipo: 'quantidade', prodId: p.id, idx: idxRef, campo: 'qtd',
          msg: `${rotuloProd}: grupo «${o.grupo}» com quantidade ${sentido} da receita padrão — informado ${num(soma, 3)}, esperado ${num(o.qtd, 3)}${tol > 0 ? ` (tolerância ± ${num(tol, 3)})` : ''}.`
            + (avancado ? ' Alteração deliberada em modo avançado: depende de validação técnica antes da consolidação (RF-038).' : ''),
        });
      }
    }

    // Componentes: proporções, quantidades e referências
    (p.componentes || []).forEach((c, idx) => {
      const mix = mixOf(c);
      const nomeComp = nomeDe(data, mix[0].ref);

      if (mix.length > 1) {
        // RF-028 — soma das proporções exatamente 100% (RN-09)
        const total = mix.reduce((a, m) => a + n(m.pct), 0);
        if (Math.abs(total - 100) > TOL_PCT) {
          const verbo = total > 100 ? 'excede' : 'fica abaixo de';
          add({
            tipo: 'proporcao', prodId: p.id, idx, campo: 'mix',
            msg: `${rotuloProd}: a soma das proporções do componente «${nomeComp}» ${verbo} 100% (informado ${num(total, 2)}%). Ajuste ou normalize as alternativas.`,
          });
          // RF-029 — distribuição × quantidade original da receita
          const qtdDistribuida = n(c.qtd) * total / 100;
          const sentido = total > 100 ? 'acima' : 'abaixo';
          add({
            tipo: 'distribuicao', prodId: p.id, idx, campo: 'mix',
            msg: `${rotuloProd}: a distribuição entre as alternativas de «${nomeComp}» ficou ${sentido} da quantidade original da receita — distribuído ${num(qtdDistribuida, 4)}, referência ${num(c.qtd, 4)} ${unidadeDe(data, mix[0].ref)}.`,
          });
        }
        for (const m of mix) {
          if (n(m.pct) < 0) {
            add({ tipo: 'proporcao', prodId: p.id, idx, campo: 'mix',
              msg: `${rotuloProd}: proporção negativa em «${nomeDe(data, m.ref)}».` });
          }
        }
      }

      if (!(n(c.qtd) > 0)) {
        add({ tipo: 'quantidade_invalida', prodId: p.id, idx, campo: 'qtd',
          msg: `${rotuloProd}: componente «${nomeComp}» com quantidade zero ou inválida.` });
      }

      for (const m of mix) {
        if (!acharInsumo(data, m.ref) && !acharProduto(data, m.ref)) {
          add({ tipo: 'referencia', prodId: p.id, idx, campo: 'ref',
            msg: `${rotuloProd}: referência inexistente na estrutura — «${m.ref}».` });
        }
      }
    });

    if (!(n(p.overhead) >= 0)) {
      add({ tipo: 'overhead', prodId: p.id, campo: 'overhead',
        msg: `${rotuloProd}: custo industrial (overhead) inválido.` });
    }

    // RF-030 / RF-014 — integridade técnica: volume envasado × especificação do SKU.
    // A conferência é dirigida pela UNIDADE dos componentes (litros/mililitros),
    // e não por nomes de grupo, para valer em qualquer ficha técnica.
    if (p.espec && n(p.espec.volume) > 0 && (p.tipo || 'PA') === 'PA') {
      const litros = p.espec.unidVol === 'ml' ? n(p.espec.volume) / 1000 : n(p.espec.volume);
      const emLitros = (unidade, qtd) => {
        const u = String(unidade || '').trim().toLowerCase();
        if (u === 'l' || u === 'lt' || u === 'litro') return n(qtd);
        if (u === 'ml') return n(qtd) / 1000;
        return null;   // unidade que não expressa volume não entra na conferência
      };
      let somaVol = 0, achouVol = false;
      for (const c of p.componentes || []) {
        const ref = mixOf(c)[0].ref;
        const v = emLitros(unidadeDe(data, ref), c.qtd);
        if (v != null) { somaVol += v; achouVol = true; }
      }
      if (achouVol) {
        const tolVol = Math.max(0.002, litros * 0.01);
        if (Math.abs(somaVol - litros) > tolVol) {
          add({
            sev: 'aviso', tipo: 'especificacao', prodId: p.id, campo: 'espec',
            msg: `${rotuloProd}: volume envasado (${num(somaVol, 3)} L) divergente da especificação técnica do SKU (${num(litros, 3)} L) — verifique antes de consolidar.`,
          });
        }
      }
    }

    // Estrutura cíclica
    const raiz = computeNode(data, p.id, {});
    if (raiz.ciclico || (raiz.children || []).some((c) => c.parts.some((x) => x.node.ciclico))) {
      add({ tipo: 'ciclo', prodId: p.id, msg: `${rotuloProd}: estrutura cíclica detectada — um componente referencia o próprio produto.` });
    }
  }

  // Coerência de cadastro do cenário (origem 'cadastro')
  for (const i of data.insumos || []) {
    const cls = i.classSim || 'nacional';
    const C = CLASSES[cls];
    const rotulo = `«${i.nome}» (${i.codigo || i.id})`;

    if (cls === 'nacional_ci' && i.ciModo === 'pct' && !(n(i.ciPct) > 0)) {
      add({ tipo: 'ci', origem: 'cadastro', insumoId: i.id, campo: 'ciPct',
        msg: `${rotulo}: classificado como nacional com conteúdo de importação, mas com percentual zerado — informe o CI% ou altere a classificação.` });
    }
    if (cls === 'nacional_ci' && i.ciModo === 'pct' && n(i.ciPct) > 100) {
      add({ tipo: 'ci', origem: 'cadastro', insumoId: i.id, campo: 'ciPct',
        msg: `${rotulo}: conteúdo de importação acima de 100%.` });
    }
    if (cls === 'nacional' && n(i.ciPct) > 0) {
      add({ sev: 'aviso', tipo: 'ci', origem: 'cadastro', insumoId: i.id, campo: 'ciPct',
        msg: `${rotulo}: item nacional com percentual de conteúdo informado — o valor é ignorado no cálculo (RF-049).` });
    }
    // RF-033 — coerência fiscal: CST informado × CST sugerido
    if (C) {
      const sugerido = cstSugerido(cls, i.ciFaixa, i.ciPct, i.ciModo);
      const informado = String(i.cstOrigem == null ? '' : i.cstOrigem).trim();
      if (informado && informado !== sugerido) {
        add({ sev: 'aviso', tipo: 'cst', origem: 'cadastro', insumoId: i.id, campo: 'cstOrigem',
          msg: `${rotulo}: CST de origem informado (${informado}) difere do sugerido (${sugerido}) para a classificação «${C.label}» adotada — valor esperado ${sugerido}.` });
      }
    }
    if (cls === 'importado_direto' && !(n(i.fob) > 0)) {
      add({ tipo: 'custo', origem: 'cadastro', insumoId: i.id, campo: 'fob',
        msg: `${rotulo}: insumo importado sem valor FOB informado — o valor aduaneiro não pode ser composto (RF-059).` });
    }
    if (cls !== 'importado_direto' && !(n(i.precoNacional) > 0)) {
      add({ tipo: 'custo', origem: 'cadastro', insumoId: i.id, campo: 'precoNacional',
        msg: `${rotulo}: sem preço de entrada informado — custo FCI indeterminado (RF-058).` });
    }
    if (cls !== 'importado_direto' && custoFCI(i, data.cambio) < 0) {
      add({ tipo: 'custo', origem: 'cadastro', insumoId: i.id, campo: 'icms',
        msg: `${rotulo}: ICMS e IPI deduzidos superam o valor de entrada — custo FCI negativo.` });
    }
  }

  return out;
}

/** Agrupa o diagnóstico para o painel consolidado (RF-032). */
export function diagnostico(data, opcoes = {}) {
  const itens = validar(data, opcoes);
  const erros = itens.filter((i) => i.sev === 'erro');
  const avisos = itens.filter((i) => i.sev === 'aviso');
  const porProduto = new Map();
  for (const i of itens) {
    const chave = i.origem === 'cadastro' ? '__cadastro__' : (i.prodId || '__geral__');
    if (!porProduto.has(chave)) porProduto.set(chave, []);
    porProduto.get(chave).push(i);
  }
  return {
    itens, erros, avisos,
    nErros: erros.length, nAvisos: avisos.length,
    bloqueado: erros.length > 0,
    // RF-025 — motivo declarado quando as ações ficam indisponíveis
    motivo: erros.length > 0
      ? `Cenário com ${erros.length} erro(s) de validação de estrutura — consolidar e congelar ficam indisponíveis até a correção (RF-025).`
      : null,
    grupos: [...porProduto.entries()].map(([chave, lista]) => ({
      chave,
      rotulo: chave === '__cadastro__' ? 'Cadastro de insumos do cenário'
            : chave === '__geral__' ? 'Cenário'
            : (acharProduto(data, chave) || {}).nome || chave,
      itens: lista,
      nErros: lista.filter((x) => x.sev === 'erro').length,
      nAvisos: lista.filter((x) => x.sev === 'aviso').length,
    })),
  };
}

/** Atalho: o cenário possui erro que bloqueia consolidação/congelamento? (RF-025) */
export function temErros(data, opcoes = {}) { return validar(data, opcoes).some((i) => i.sev === 'erro'); }

/**
 * Confronto imediato após uma edição (RF-031): compara o diagnóstico antes e
 * depois da alteração e devolve apenas as inconsistências NOVAS, para que a
 * tela possa oferecer desfazer ou manter e corrigir.
 */
export function confrontarEdicao(dadosAntes, dadosDepois, opcoes = {}) {
  const chave = (i) => `${i.tipo}|${i.prodId}|${i.idx}|${i.insumoId}|${i.msg}`;
  const antes = new Set(validar(dadosAntes, opcoes).filter((i) => i.sev === 'erro').map(chave));
  const depois = validar(dadosDepois, opcoes).filter((i) => i.sev === 'erro');
  const novos = depois.filter((i) => !antes.has(chave(i)));
  return { novos, total: novos.length, houveRegressao: novos.length > 0 };
}

// ---------------------------------------------------------------------------
// Rastreabilidade das alterações (RF-006 · RF-036 · RNF-04)
// ---------------------------------------------------------------------------

/**
 * Pontos alterados em relação à estrutura/cadastro de origem (RF-036):
 * cada ponto lista o valor padrão (carga do ERP) e o valor no cenário — é a
 * base da submissão à validação técnica e do histórico de rastreabilidade.
 */
export function diffs(data) {
  const out = [];
  for (const p of data.produtos || []) {
    const rotuloProd = `${p.nome} (${p.sku || p.id})`;
    (p.componentes || []).forEach((c, idx) => {
      const mix = mixOf(c);
      const nomeComp = nomeDe(data, mix[0].ref);
      if (c.qtdPadrao != null && Math.abs(n(c.qtd) - n(c.qtdPadrao)) > EPS) {
        out.push({
          tipo: 'quantidade', grave: true, rotulo: 'Quantidade da receita alterada',
          produto: rotuloProd, prodId: p.id, idx, item: nomeComp,
          de: num(c.qtdPadrao, 4), para: num(c.qtd, 4),
          exigeValidacao: true,
        });
      }
      if (mix.length > 1) {
        out.push({
          tipo: 'substituicao', grave: false, rotulo: 'Substituição de componente',
          produto: rotuloProd, prodId: p.id, idx, item: nomeComp,
          de: `${nomeDe(data, mix[0].ref)} 100%`,
          para: mix.map((m) => `${nomeDe(data, m.ref)} ${num(m.pct, 0)}%`).join(' · '),
          exigeValidacao: false,
        });
      }
    });
    if (p.overheadPadrao != null && Math.abs(n(p.overhead) - n(p.overheadPadrao)) > EPS) {
      out.push({
        tipo: 'overhead', grave: true, rotulo: 'Custo industrial alterado',
        produto: rotuloProd, prodId: p.id, idx: null, item: 'Overhead industrial',
        de: num(p.overheadPadrao, 4), para: num(p.overhead, 4),
        exigeValidacao: true,
      });
    }
    (p.saidas || []).forEach((s) => {
      if (s.volumePadrao != null && Math.abs(n(s.volume) - n(s.volumePadrao)) > EPS) {
        out.push({ tipo: 'volume', grave: false, rotulo: 'Volume de saída alterado',
          produto: rotuloProd, prodId: p.id, idx: null, item: `Volume ${s.uf}`,
          de: num(s.volumePadrao, 0), para: num(s.volume, 0), exigeValidacao: false });
      }
      if (s.precoPadrao != null && Math.abs(n(s.preco) - n(s.precoPadrao)) > EPS) {
        out.push({ tipo: 'preco', grave: false, rotulo: 'Preço de saída alterado',
          produto: rotuloProd, prodId: p.id, idx: null, item: `Preço ${s.uf}`,
          de: num(s.precoPadrao, 4), para: num(s.preco, 4), exigeValidacao: false });
      }
    });
  }

  for (const [moeda, cot] of Object.entries(data.cambio || {})) {
    const padrao = (data.cambioPadrao || {})[moeda];
    if (padrao != null && Math.abs(n(cot) - n(padrao)) > EPS) {
      out.push({ tipo: 'cambio', grave: false, rotulo: 'Premissa cambial alterada',
        produto: '— cenário —', prodId: null, idx: null, item: `Cotação ${moeda}`,
        de: num(padrao, 4), para: num(cot, 4), exigeValidacao: false });
    }
  }

  for (const i of data.insumos || []) {
    if (i.alt) {
      out.push({ tipo: 'insumo', grave: false, rotulo: 'Alternativa cadastral criada no cenário',
        produto: '— cadastro do cenário —', prodId: null, idx: null, item: i.nome,
        de: '—', para: `${CLASSES[i.classSim] ? CLASSES[i.classSim].curto : i.classSim} · ${i.moeda || 'BRL'}`,
        exigeValidacao: false });
    }
    if (i.ciPadrao != null && Math.abs(n(i.ciPct) - n(i.ciPadrao)) > EPS) {
      out.push({ tipo: 'conteudo', grave: false, rotulo: 'Conteúdo de importação do insumo alterado',
        produto: '— cadastro do cenário —', prodId: null, idx: null, item: i.nome,
        de: pct(i.ciPadrao), para: pct(i.ciPct), exigeValidacao: false });
    }
    if (i.classPadrao && i.classPadrao !== i.classSim) {
      out.push({ tipo: 'classificacao', grave: false, rotulo: 'Classificação de origem alterada',
        produto: '— cadastro do cenário —', prodId: null, idx: null, item: i.nome,
        de: (CLASSES[i.classPadrao] || {}).curto || i.classPadrao,
        para: (CLASSES[i.classSim] || {}).curto || i.classSim, exigeValidacao: false });
    }
  }

  return out;
}

/** Há alteração de receita que exige validação técnica antes de consolidar? (RN-11 · RF-038) */
export function exigeValidacaoTecnica(data) {
  return diffs(data).some((d) => d.exigeValidacao);
}

// ---------------------------------------------------------------------------
// Alertas (RF-083 a RF-086 · RN-08)
// ---------------------------------------------------------------------------

/**
 * Alertas do cenário, cada um com a área responsável pelo tratamento (RF-086):
 *   RF-083 mudança de faixa de enquadramento vs FCI vigente
 *   RF-084 reemissão da FCI quando a variação supera o gatilho parametrizado
 *   RF-085 risco fiscal de CI% acima de 40%, com base legal e efeito tributário
 */
export function alertas(data, gatilhoPp = 5, base, params = {}) {
  const out = [];
  const gatilho = n(gatilhoPp, 5);

  for (const p of (data.produtos || []).filter((x) => (x.tipo || 'PA') === 'PA')) {
    const r = resultadoProduto(data, p.id, base, params);
    const vigente = n(p.fciVigente);
    const delta = r.ci - vigente;
    const fxAtual = faixaDe(r.ci);
    const fxVigente = faixaDe(vigente);
    const rotulo = `${p.nome} (${p.sku || p.id})`;

    // RF-083 — mudança de faixa
    if (fxAtual.key !== fxVigente.key) {
      out.push({
        tipo: 'faixa', sev: 'aviso', area: 'Fiscal/Tributário',
        prodId: p.id, produto: rotulo, ci: r.ci, vigente, deltaPp: delta,
        titulo: 'Mudança de faixa de enquadramento',
        msg: `${rotulo}: o cenário migra de «${fxVigente.label}» (${pct(vigente)}) para «${fxAtual.label}» (${pct(r.ci)}) em relação à FCI vigente — variação de ${pp(delta)}.`,
        faixaAnterior: fxVigente, faixaNova: fxAtual,
        acao: 'Avaliar reflexo no enquadramento e na alíquota praticada.',
      });
    }

    // RF-084 — reemissão da FCI (RN-08)
    if (Math.abs(delta) > gatilho + EPS) {
      out.push({
        tipo: 'reemissao', sev: 'erro', area: 'Fiscal/Tributário',
        prodId: p.id, produto: rotulo, ci: r.ci, vigente, deltaPp: delta,
        titulo: 'Reemissão da FCI exigida',
        msg: `${rotulo}: variação de ${pp(delta)} em relação à ficha vigente (${pct(vigente)} → ${pct(r.ci)}) supera o gatilho parametrizado de ${num(gatilho, 1)} p.p. — reemissão da FCI exigida (RN-08).`,
        gatilho,
        acao: 'Programar a reemissão da Ficha de Conteúdo de Importação do produto.',
      });
    }

    // RF-085 — risco fiscal acima de 40%
    if (r.ci > 40) {
      out.push({
        tipo: 'risco', sev: 'aviso', area: 'Fiscal/Tributário',
        prodId: p.id, produto: rotulo, ci: r.ci, vigente, deltaPp: delta,
        titulo: 'Risco fiscal — CI% acima de 40%',
        msg: `${rotulo}: CI% de ${pct(r.ci)} acima de 40% resulta em alíquota interestadual de 4% (Resolução SF 13/2012), reduzindo o crédito de ICMS apropriável pelo cliente e deslocando carga para o ICMS-ST do destino.`,
        baseLegal: 'Resolução SF 13/2012 · Convênio ICMS 38/2013',
        acao: 'Avaliar com Pricing e Fiscal o efeito no preço líquido e no crédito do cliente.',
      });
    }

    if (vigente === 0 && r.ci > 0) {
      out.push({
        tipo: 'obrigatoriedade', sev: 'aviso', area: 'Fiscal/Tributário',
        prodId: p.id, produto: rotulo, ci: r.ci, vigente, deltaPp: delta,
        titulo: 'FCI passa a ser obrigatória',
        msg: `${rotulo}: produto sem conteúdo importado na ficha vigente passa a apresentar CI% de ${pct(r.ci)} — a FCI torna-se obrigatória (RN-06).`,
        acao: 'Providenciar a emissão da FCI para o produto.',
      });
    }
  }

  const ordem = { erro: 0, aviso: 1 };
  return out.sort((a, b) => ordem[a.sev] - ordem[b.sev] || Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
}

// ---------------------------------------------------------------------------
// Comparação de cenários (RF-073 a RF-079)
// ---------------------------------------------------------------------------

export const LIMITE_COMPARACAO = 10;   // RF-073 · decisão E-13

/**
 * Matriz de CI% por produto e cenário (RF-074).
 * Cada célula traz o CI%, a faixa (cor) e o enquadramento; cada linha traz a
 * amplitude em pontos percentuais entre o maior e o menor CI% dos cenários.
 */
export function matrizComparativa(cenarios, base, params = {}) {
  const lista = (cenarios || []).slice(0, LIMITE_COMPARACAO);
  const skus = new Map();
  for (const c of lista) {
    for (const p of (c.dados.produtos || []).filter((x) => (x.tipo || 'PA') === 'PA')) {
      if (!skus.has(p.id)) skus.set(p.id, { prodId: p.id, nome: p.nome, sku: p.sku || p.id, fciVigente: n(p.fciVigente) });
    }
  }

  const linhas = [...skus.values()].map((s) => {
    const celulas = lista.map((c) => {
      const existe = acharProduto(c.dados, s.prodId);
      if (!existe) return { cenarioId: c.id, ausente: true };
      const r = resultadoProduto(c.dados, s.prodId, base || c.base_calculo, params);
      return {
        cenarioId: c.id, codigo: c.codigo, ausente: false,
        ci: r.ci, faixa: r.faixa, aliquota: r.enquadramento.aliquota,
        custo: r.custo, parcela: r.parcela, denominador: r.denominador,
        baseUsada: r.baseUsada, deltaVigente: r.deltaVigente,
      };
    });
    const valores = celulas.filter((x) => !x.ausente).map((x) => x.ci);
    const max = valores.length ? Math.max(...valores) : 0;
    const min = valores.length ? Math.min(...valores) : 0;
    return {
      ...s, celulas,
      amplitudePp: max - min, maiorCi: max, menorCi: min,
      idxMaior: celulas.findIndex((x) => !x.ausente && x.ci === max),
      idxMenor: celulas.findIndex((x) => !x.ausente && x.ci === min),
      mudaFaixa: new Set(celulas.filter((x) => !x.ausente).map((x) => x.faixa.key)).size > 1,
    };
  }).sort((a, b) => b.amplitudePp - a.amplitudePp || a.nome.localeCompare(b.nome));

  return {
    cenarios: lista.map((c) => ({
      id: c.id, codigo: c.codigo, nome: c.nome, versao: c.versao, status: c.status,
      autor: c.autor_nome, ciclo: c.ciclo, base: base || c.base_calculo || 'saida',
    })),
    linhas,
    limite: LIMITE_COMPARACAO,
    base: base || 'saida',
  };
}

/**
 * Drill-down do produto até o insumo (RF-075 · RF-076).
 * No nível do PRODUTO, a contribuição de cada componente é expressa em pontos
 * percentuais do CI% e a soma das contribuições é exatamente o CI% apresentado.
 * No nível do INTERMEDIÁRIO, a base passa a ser o próprio intermediário — a
 * ressalva é declarada em cada nó (critério de aceite do RF-076).
 * `expansivel` é falso para itens sem nível inferior (RF-075).
 */
export function drillDown(data, prodId, base, params = {}) {
  const r = resultadoProduto(data, prodId, base, params);
  const denominador = r.denominador;

  const montarNivel = (node, baseDivisao, nivel, contexto) => {
    return (node.children || []).map((c) => {
      const contribPp = baseDivisao > 0 ? c.contrib / baseDivisao * 100 : 0;
      const filhoProd = c.parts.find((p) => p.node.kind === 'prod');
      const temFilhos = !!filhoProd && (filhoProd.node.children || []).length > 0;
      return {
        nivel, idx: c.idx, ref: c.ref, nome: c.node.nome,
        tipo: c.node.kind === 'prod' ? (c.node.tipo || 'PI') : 'MP',
        grupo: c.grupo, qtd: c.qtd, unidade: c.unidade,
        custoUnit: c.node.custo, custoTot: c.custoTot,
        ciNo: c.node.ci, fator: c.fator, contrib: c.contrib,
        contribPp,
        baseDivisao, contexto,
        hasMix: c.hasMix,
        alternativas: c.hasMix ? c.parts.map((p) => ({
          ref: p.ref, nome: p.node.nome, pct: p.pct, qtd: p.qtd,
          custoTot: p.custoTot, fator: p.fator, contrib: p.contrib,
          papel: p.origem, naoUtilizado: p.pct === 0,
        })) : null,
        expansivel: temFilhos,                     // RF-075
        filhos: temFilhos
          ? montarNivel(filhoProd.node, filhoProd.node.custo, nivel + 1,
              `base: intermediário ${filhoProd.node.nome}`)
          : [],
        ressalva: nivel > 0
          ? 'Contribuições deste nível têm como base o próprio intermediário, não o produto acabado (RF-076).'
          : null,
      };
    }).sort((a, b) => b.contrib - a.contrib);
  };

  const niveis = montarNivel(r.node, denominador, 0, 'base: denominador do produto');
  const somaPp = niveis.reduce((a, x) => a + x.contribPp, 0);
  return {
    resultado: r,
    produto: r.produto,
    ci: r.ci,
    denominador,
    niveis,
    somaContribuicoesPp: somaPp,
    conferencia: Math.abs(somaPp - r.ci) < 0.01,   // RF-076 — contribuições somam o CI%
    notaBase: `No nível do produto a base é o denominador vigente (${r.baseLabel}); nos níveis inferiores a base é o próprio intermediário (RF-076).`,
  };
}

/** Série comparativa do produto em foco entre os cenários (RF-077). */
export function serieComparativa(cenarios, prodId, base, params = {}) {
  const pontos = (cenarios || []).slice(0, LIMITE_COMPARACAO).map((c) => {
    const existe = acharProduto(c.dados, prodId);
    if (!existe) return { cenarioId: c.id, codigo: c.codigo, nome: c.nome, ausente: true, ci: 0 };
    const r = resultadoProduto(c.dados, prodId, base || c.base_calculo, params);
    return {
      cenarioId: c.id, codigo: c.codigo, nome: c.nome, versao: c.versao, ausente: false,
      ci: r.ci, faixa: r.faixa, aliquota: r.enquadramento.aliquota,
      custo: r.custo, parcela: r.parcela, denominador: r.denominador,
      fciVigente: r.fciVigente, deltaVigente: r.deltaVigente,
    };
  });
  const validos = pontos.filter((p) => !p.ausente);
  return {
    prodId,
    nome: validos.length ? nomeDe(cenarios[0].dados, prodId) : prodId,
    pontos,
    maximo: validos.length ? Math.max(...validos.map((p) => p.ci)) : 0,
    minimo: validos.length ? Math.min(...validos.map((p) => p.ci)) : 0,
    amplitudePp: validos.length ? Math.max(...validos.map((p) => p.ci)) - Math.min(...validos.map((p) => p.ci)) : 0,
  };
}

// ---------------------------------------------------------------------------
// Caminho para enquadramento e sensibilidade cambial (apoio ao RF-081)
// ---------------------------------------------------------------------------

/**
 * Caminho para ficar abaixo de 40% (RF-081): avalia, em ordem de contribuição,
 * o efeito de nacionalizar cada componente (fator de faixa zero) e devolve o
 * conjunto mínimo de trocas que leva o CI% ao enquadramento desejado.
 */
export function caminhoAbaixoDe(data, prodId, alvo = 40, base, params = {}) {
  const r = resultadoProduto(data, prodId, base, params);
  if (r.ci <= alvo) {
    return { jaEnquadrado: true, ci: r.ci, alvo, passos: [], ciFinal: r.ci, atingiu: true };
  }
  const candidatos = maioresContribuicoes(r, 50);
  const passos = [];
  let parcela = r.parcela;
  let ciAtual = r.ci;

  for (const c of candidatos) {
    if (ciAtual <= alvo) break;
    if (c.contrib <= 0) continue;
    parcela -= c.contrib;
    const ciNovo = r.denominador > 0 ? parcela / r.denominador * 100 : 0;
    passos.push({
      ref: c.ref, nome: c.nome, grupo: c.grupo,
      contrib: c.contrib,
      impactoPp: ciAtual - ciNovo,
      ciDepois: ciNovo,
      acao: `Substituir «${c.nome}» por alternativa nacional do grupo «${c.grupo}» (ou reduzir o conteúdo importado do item).`,
    });
    ciAtual = ciNovo;
  }

  return {
    jaEnquadrado: false, ci: r.ci, alvo, passos,
    ciFinal: ciAtual, atingiu: ciAtual <= alvo,
    nPassos: passos.length,
    nota: ciAtual <= alvo
      ? `Nacionalizando ${passos.length} componente(s) o CI% cai de ${pct(r.ci)} para ${pct(ciAtual)}, abaixo do limite de ${num(alvo, 0)}%.`
      : `Mesmo nacionalizando todos os componentes importados o CI% permanece em ${pct(ciAtual)} — reveja o denominador ou a composição do produto.`,
  };
}

/** Sensibilidade cambial: efeito de uma variação percentual em cada moeda (RF-081). */
export function sensibilidadeCambial(data, prodId, variacaoPct = 10, base, params = {}) {
  const atual = resultadoProduto(data, prodId, base, params);
  const moedas = [...new Set((data.insumos || [])
    .filter((i) => i.classSim === 'importado_direto' && i.moeda && i.moeda !== 'BRL')
    .map((i) => i.moeda))];

  const linhas = moedas.map((m) => {
    const copia = clonar(data);
    copia.cambio[m] = n(copia.cambio[m]) * (1 + n(variacaoPct) / 100);
    const sim = resultadoProduto(copia, prodId, base, params);
    const vinculados = (data.insumos || []).filter((i) => i.moeda === m && i.classSim === 'importado_direto');
    return {
      moeda: m, nome: (MOEDAS[m] || {}).nome || m,
      cotacaoAtual: n(data.cambio[m]), cotacaoSimulada: n(data.cambio[m]) * (1 + n(variacaoPct) / 100),
      variacaoPct: n(variacaoPct),
      ciAtual: atual.ci, ciSimulado: sim.ci, deltaPp: sim.ci - atual.ci,
      custoAtual: atual.custo, custoSimulado: sim.custo,
      nInsumos: vinculados.length,
      insumos: vinculados.map((i) => i.nome),
      mudaFaixa: faixaDe(sim.ci).key !== faixaDe(atual.ci).key,
    };
  }).sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));

  return { prodId, variacaoPct: n(variacaoPct), ciAtual: atual.ci, linhas };
}

/** Insumos vinculados a cada moeda — painel de câmbio (RF-053). */
export function insumosPorMoeda(data) {
  const mapa = new Map();
  for (const m of Object.keys(data.cambio || {})) mapa.set(m, []);
  for (const i of data.insumos || []) {
    const m = i.moeda || 'BRL';
    if (m === 'BRL') continue;
    if (!mapa.has(m)) mapa.set(m, []);
    mapa.get(m).push({
      ref: i.id, nome: i.nome, codigo: i.codigo || i.id,
      classSim: i.classSim, importado: i.classSim === 'importado_direto',
      custoFCI: custoFCI(i, data.cambio), fob: n(i.fob),
      fornecedor: (fornecedorDe(data, i) || {}).nome || '—',
    });
  }
  return [...mapa.entries()].map(([moeda, insumos]) => ({
    moeda,
    nome: (MOEDAS[moeda] || {}).nome || moeda,
    simbolo: (MOEDAS[moeda] || {}).simbolo || '',
    cotacao: n((data.cambio || {})[moeda]),
    cotacaoPadrao: n((data.cambioPadrao || {})[moeda]),
    variacaoPct: n((data.cambioPadrao || {})[moeda]) > 0
      ? (n((data.cambio || {})[moeda]) / n((data.cambioPadrao || {})[moeda]) - 1) * 100 : 0,
    insumos,
    nInsumos: insumos.length,
  })).sort((a, b) => b.nInsumos - a.nInsumos || a.moeda.localeCompare(b.moeda));
}

// ---------------------------------------------------------------------------
// Relatório executivo consolidado (RF-087 · RF-088)
// ---------------------------------------------------------------------------

/**
 * Relatório executivo do cenário (RF-087): por produto, apresenta CI%,
 * enquadramento, alíquota, variação vs FCI vigente e obrigatoriedade da FCI,
 * identificando cenário, ciclo, versão, autor, status, base de cálculo e
 * câmbio adotado. Inclui os direcionamentos por área (RF-088 · RF-009).
 */
export function relatorioExecutivo(cenario, params = {}) {
  const data = cenario.dados || {};
  const base = params.base || cenario.base_calculo || data.base || 'saida';
  const gatilho = n(params.gatilho, 5);
  const resumo = resumoCenario(data, base, params);
  const listaAlertas = alertas(data, gatilho, base, params);
  const diag = diagnostico(data);

  const produtos = resumo.porProduto.map(({ produto, resultado }) => {
    const st = icmsST(resultado.precoMedio || resultado.custo, resultado.ci, params.st || {});
    return {
      prodId: produto.id, sku: produto.sku || produto.id, nome: produto.nome,
      ci: resultado.ci,
      enquadramento: resultado.enquadramento.label,
      faixa: resultado.faixa,
      aliquota: resultado.enquadramento.aliquota,
      fciVigente: resultado.fciVigente,
      deltaVigente: resultado.deltaVigente,
      fciObrigatoria: resultado.enquadramento.fciObrigatoria,
      exigeReemissao: Math.abs(resultado.deltaVigente) > gatilho + EPS,
      custo: resultado.custo,
      parcela: resultado.parcela,
      denominador: resultado.denominador,
      baseUsada: resultado.baseUsada,
      precoMedio: resultado.precoMedio,
      icmsST: { aliqResultante: st.aliqResultante, difST: st.difST, difCarga: st.difCarga },
      maiores: maioresContribuicoes(resultado, 3).map((m) => ({ nome: m.nome, participacao: m.participacao })),
    };
  });

  return {
    cabecalho: {
      cenario: cenario.nome, codigo: cenario.codigo, versao: cenario.versao,
      ciclo: cenario.ciclo, tipo: cenario.tipo, status: cenario.status,
      autor: cenario.autor_nome,
      criadoEm: cenario.criado_em, atualizadoEm: cenario.atualizado_em,
      consolidadoEm: cenario.consolidado_em || null,
      origemDados: cenario.origem_dados,
      baseCalculo: base,
      baseCalculoLabel: base === 'saida'
        ? 'Média ponderada global das saídas interestaduais (RN-02)'
        : 'Custo total da mercadoria (alternativa · RF-060)',
      versaoFormula: params.versaoFormula || data.versaoFormula || VERSAO_FORMULA_PADRAO,
      cambio: data.cambio || {},
      gatilhoReemissao: gatilho,
      modo: cenario.modo || 'padrao',
    },
    indicadores: {
      ciMedio: resumo.ciMedio, nProdutos: resumo.nProdutos,
      acima40: resumo.acima40, dist: resumo.dist,
      nAlertas: listaAlertas.length,
      nReemissao: listaAlertas.filter((a) => a.tipo === 'reemissao').length,
      nErros: diag.nErros, nAvisos: diag.nAvisos,
    },
    produtos,
    alertas: listaAlertas,
    diagnostico: { nErros: diag.nErros, nAvisos: diag.nAvisos, itens: diag.itens.slice(0, 50) },
    direcionamentos: direcionamentosPorArea(data, listaAlertas, base, params),
    ressalva: RESSALVA_GERENCIAL,
  };
}

/**
 * Direcionamentos para decisão segmentados por área (RF-088 · RF-009):
 * blocos distintos para Compras, Pricing e Fiscal/Tributário, derivados do
 * resultado do cenário e dos alertas gerados.
 */
export function direcionamentosPorArea(data, listaAlertas, base, params = {}) {
  const resumo = resumoCenario(data, base, params);
  const blocos = {
    'Compras': [], 'Pricing': [], 'Fiscal/Tributário': [],
  };

  for (const { produto, resultado } of resumo.porProduto) {
    const rotulo = `${produto.nome} (${produto.sku || produto.id})`;
    if (resultado.ci > 40) {
      const maiores = maioresContribuicoes(resultado, 2);
      if (maiores.length) {
        blocos['Compras'].push({
          produto: rotulo, prioridade: 'alta',
          texto: `Avaliar alternativa nacional ou renegociação para ${maiores.map((m) => `«${m.nome}» (${pct(m.participacao)} da parcela importada)`).join(' e ')} — maior contribuição no CI% de ${pct(resultado.ci)}.`,
        });
      }
      blocos['Pricing'].push({
        produto: rotulo, prioridade: 'alta',
        texto: `Alíquota interestadual de 4% (CI% ${pct(resultado.ci)}): revisar preço líquido por UF e o efeito no crédito de ICMS do cliente.`,
      });
      blocos['Fiscal/Tributário'].push({
        produto: rotulo, prioridade: 'alta',
        texto: `Enquadramento «${resultado.enquadramento.label}» — confirmar CST, base legal (Resolução SF 13/2012) e necessidade de reemissão da FCI.`,
      });
    } else if (resultado.ci > 0) {
      blocos['Fiscal/Tributário'].push({
        produto: rotulo, prioridade: 'media',
        texto: `CI% de ${pct(resultado.ci)} mantém o produto na faixa «${resultado.enquadramento.label}» com alíquota de ${num(resultado.enquadramento.aliquota, 0)}% — FCI obrigatória.`,
      });
    }
  }

  for (const a of listaAlertas || []) {
    const area = a.area === 'Fiscal/Tributário' ? 'Fiscal/Tributário' : a.area;
    if (!blocos[area]) blocos[area] = [];
    if (a.tipo === 'reemissao') {
      blocos[area].push({ produto: a.produto, prioridade: 'alta', texto: a.acao + ` Variação de ${pp(a.deltaPp)} vs ficha vigente.` });
    }
  }

  // Sensibilidade cambial agregada → Compras
  const moedas = insumosPorMoeda(data).filter((m) => m.nInsumos > 0);
  if (moedas.length) {
    const principal = moedas[0];
    blocos['Compras'].push({
      produto: '— cenário —', prioridade: 'media',
      texto: `${principal.nInsumos} insumo(s) vinculados ao ${principal.nome} (cotação ${num(principal.cotacao, 4)}): avaliar travamento cambial ou contrato de fornecimento.`,
    });
  }

  return Object.entries(blocos).map(([area, itens]) => ({ area, itens, total: itens.length }));
}

// ---------------------------------------------------------------------------
// Análise assistida dos cenários (RF-080 · RF-081 · RF-082)
// ---------------------------------------------------------------------------
// Recurso de conversa iterativa sobre os cenários selecionados. As respostas
// são produzidas deterministicamente a partir dos dados do contexto — citam
// sempre produtos, cenários e valores existentes na simulação — e trazem a
// ressalva de uso gerencial (RF-082). O histórico da conversa é mantido pela
// camada de serviço (tabela fci.analise_mensagens).

/** Catálogo das análises padrão solicitáveis (RF-081). */
export function analisesPadrao() {
  return [
    { id: 'divergencia',  titulo: 'Divergência de CI% entre cenários',  descricao: 'Produtos com maior amplitude de CI% entre os cenários selecionados.', palavras: ['diverg', 'diferen', 'compar', 'amplitude', 'entre cenários'] },
    { id: 'impacto',      titulo: 'Insumos de maior impacto',           descricao: 'Componentes que mais contribuem para a parcela importada.', palavras: ['insumo', 'impacto', 'contribu', 'maior', 'component'] },
    { id: 'risco',        titulo: 'Risco fiscal e reemissão',           descricao: 'Produtos acima de 40% e variações que exigem reemissão da FCI.', palavras: ['risco', 'fiscal', 'reemiss', 'alerta', '40', 'gatilho'] },
    { id: 'cambial',      titulo: 'Sensibilidade cambial',              descricao: 'Efeito no CI% de uma variação nas cotações das moedas.', palavras: ['cambi', 'moeda', 'dólar', 'dolar', 'euro', 'cotaç', 'libra', 'franco'] },
    { id: 'caminho',      titulo: 'Caminho para ficar abaixo de 40%',   descricao: 'Trocas mínimas necessárias para reenquadrar o produto abaixo de 40%.', palavras: ['caminho', 'abaixo', 'reduzir', 'baixar', 'enquadr', 'sair'] },
    { id: 'precoMix',     titulo: 'Efeito de preço e mix de UF',        descricao: 'Peso de cada UF e efeito de variações de preço no denominador.', palavras: ['preç', 'preco', 'mix', 'uf', 'destino', 'volume', 'denominador'] },
    { id: 'recomendacao', titulo: 'Recomendação executiva',             descricao: 'Síntese para decisão, com direcionamentos por área.', palavras: ['recomend', 'executiv', 'decis', 'resumo', 'síntese', 'sintese', 'conclus'] },
  ];
}

function blocoTexto(texto) { return { tipo: 'texto', texto }; }
function blocoLista(itens) { return { tipo: 'lista', itens }; }
function blocoTabela(colunas, linhas) { return { tipo: 'tabela', colunas, linhas }; }

/**
 * Responde a uma solicitação de análise (RF-080 · RF-081).
 * @param ctx {{ cenarios: Array<{id,codigo,nome,versao,dados,base_calculo}>, prodId?, base?, params? }}
 * @param pedido {{ analise?: string, pergunta?: string }}
 * Devolve blocos renderizáveis, as citações usadas e a ressalva (RF-082).
 */
export function responderAnalise(ctx, pedido = {}) {
  const cenarios = (ctx.cenarios || []).slice(0, LIMITE_COMPARACAO);
  const base = ctx.base || 'saida';
  const params = ctx.params || {};
  const gatilho = n(params.gatilho, 5);
  const pergunta = String(pedido.pergunta || '').trim();
  const catalogo = analisesPadrao();

  if (!cenarios.length) {
    return {
      analise: null, titulo: 'Contexto vazio',
      blocos: [blocoTexto('Selecione ao menos um cenário para que a análise seja produzida sobre dados reais da simulação.')],
      citacoes: [], ressalva: RESSALVA_GERENCIAL, sugestoes: catalogo,
    };
  }

  // Resolução da intenção: identificador explícito ou palavras-chave da pergunta
  let analise = pedido.analise && catalogo.find((a) => a.id === pedido.analise);
  if (!analise && pergunta) {
    const p = pergunta.toLowerCase();
    let melhor = null, melhorPontos = 0;
    for (const a of catalogo) {
      const pontos = a.palavras.reduce((acc, w) => acc + (p.includes(w) ? 1 : 0), 0);
      if (pontos > melhorPontos) { melhor = a; melhorPontos = pontos; }
    }
    analise = melhor;
  }
  if (!analise) analise = catalogo.find((a) => a.id === 'recomendacao');

  // Produto em foco: o solicitado, o citado na pergunta, ou o de maior CI%
  const principal = cenarios[0];
  const pasPrincipal = (principal.dados.produtos || []).filter((p) => (p.tipo || 'PA') === 'PA');
  let prodId = ctx.prodId;
  if (pergunta) {
    const achado = pasPrincipal.find((p) =>
      pergunta.toLowerCase().includes(String(p.nome).toLowerCase()) ||
      pergunta.toLowerCase().includes(String(p.sku || '').toLowerCase()));
    if (achado) prodId = achado.id;
  }
  if (!prodId || !acharProduto(principal.dados, prodId)) {
    const resumo = resumoCenario(principal.dados, base, params);
    prodId = resumo.porProduto.length ? resumo.porProduto[0].produto.id : (pasPrincipal[0] || {}).id;
  }

  const citacoes = [];
  const citar = (tipo, chave, valor) => { citacoes.push({ tipo, chave, valor }); };
  const blocos = [];
  let titulo = analise.titulo;

  // ---- 1. Divergência de CI% entre cenários (RF-081)
  if (analise.id === 'divergencia') {
    if (cenarios.length < 2) {
      blocos.push(blocoTexto(`Apenas o cenário ${principal.codigo} · ${principal.nome} está selecionado. Selecione ao menos dois cenários para comparar a divergência de CI% (RF-073).`));
    } else {
      const matriz = matrizComparativa(cenarios, base, params);
      const top = matriz.linhas.slice(0, 8);
      blocos.push(blocoTexto(
        `Comparando ${cenarios.length} cenários (${cenarios.map((c) => c.codigo).join(', ')}), ` +
        `o produto com maior divergência é «${top[0].nome}», com amplitude de ${num(top[0].amplitudePp, 1)} p.p. ` +
        `entre ${pct(top[0].menorCi)} e ${pct(top[0].maiorCi)}.`));
      blocos.push(blocoTabela(
        ['Produto', ...matriz.cenarios.map((c) => c.codigo), 'Amplitude'],
        top.map((l) => [
          `${l.nome} (${l.sku})`,
          ...l.celulas.map((c) => c.ausente ? '—' : pct(c.ci)),
          num(l.amplitudePp, 1) + ' p.p.',
        ])));
      const mudam = matriz.linhas.filter((l) => l.mudaFaixa);
      if (mudam.length) {
        blocos.push(blocoTexto(`${mudam.length} produto(s) mudam de faixa de enquadramento conforme o cenário: ${mudam.slice(0, 5).map((m) => m.nome).join(', ')}.`));
      }
      top.forEach((l) => citar('produto', l.nome, pct(l.maiorCi)));
      cenarios.forEach((c) => citar('cenario', c.codigo, c.nome));
    }
  }

  // ---- 2. Insumos de maior impacto (RF-081)
  else if (analise.id === 'impacto') {
    const r = resultadoProduto(principal.dados, prodId, base, params);
    const maiores = maioresContribuicoes(r, 8);
    titulo = `Insumos de maior impacto · ${r.produto.nome}`;
    blocos.push(blocoTexto(
      `No cenário ${principal.codigo} · ${principal.nome}, o produto «${r.produto.nome}» apresenta CI% de ${pct(r.ci)} ` +
      `(${r.enquadramento.label}), com parcela importada de ${brl(r.parcela)} sobre denominador de ${brl(r.denominador)}.`));
    blocos.push(blocoTabela(
      ['Componente', 'Grupo', 'Custo no produto', 'Fator', 'Parcela importada', '% da parcela'],
      maiores.map((m) => [m.nome, m.grupo, brl(m.custoTot), num(m.fator, 2), brl(m.contrib), pct(m.participacao)])));
    if (maiores.length) {
      blocos.push(blocoTexto(
        `O componente «${maiores[0].nome}» concentra ${pct(maiores[0].participacao)} da parcela importada — ` +
        `é a troca de maior efeito isolado sobre o CI% deste produto.`));
      maiores.slice(0, 3).forEach((m) => citar('insumo', m.nome, pct(m.participacao)));
    }
    citar('produto', r.produto.nome, pct(r.ci));
    citar('cenario', principal.codigo, principal.nome);
  }

  // ---- 3. Risco fiscal e reemissão (RF-081)
  else if (analise.id === 'risco') {
    const lista = alertas(principal.dados, gatilho, base, params);
    const resumo = resumoCenario(principal.dados, base, params);
    blocos.push(blocoTexto(
      `No cenário ${principal.codigo} · ${principal.nome}: ${resumo.acima40} de ${resumo.nProdutos} produto(s) ` +
      `apresentam CI% acima de 40% (alíquota interestadual de 4%, Resolução SF 13/2012). ` +
      `O gatilho de reemissão vigente é de ${num(gatilho, 1)} p.p. (RN-08).`));
    const reemissao = lista.filter((a) => a.tipo === 'reemissao');
    if (reemissao.length) {
      blocos.push(blocoTabela(
        ['Produto', 'FCI vigente', 'CI% simulado', 'Variação'],
        reemissao.map((a) => [a.produto, pct(a.vigente), pct(a.ci), pp(a.deltaPp)])));
      blocos.push(blocoTexto(`${reemissao.length} produto(s) exigem reemissão da FCI por ultrapassar o gatilho parametrizado.`));
      reemissao.forEach((a) => citar('produto', a.produto, pp(a.deltaPp)));
    } else {
      blocos.push(blocoTexto('Nenhum produto ultrapassa o gatilho de reemissão no cenário selecionado.'));
    }
    const risco = lista.filter((a) => a.tipo === 'risco');
    if (risco.length) blocos.push(blocoLista(risco.map((a) => a.msg)));
  }

  // ---- 4. Sensibilidade cambial (RF-081)
  else if (analise.id === 'cambial') {
    const variacao = n(ctx.variacaoCambial, 10);
    const sens = sensibilidadeCambial(principal.dados, prodId, variacao, base, params);
    const r = resultadoProduto(principal.dados, prodId, base, params);
    titulo = `Sensibilidade cambial · ${r.produto.nome}`;
    if (!sens.linhas.length) {
      blocos.push(blocoTexto(`O produto «${r.produto.nome}» não possui insumos importados diretamente com moeda estrangeira — não há exposição cambial direta no cenário ${principal.codigo}.`));
    } else {
      blocos.push(blocoTexto(
        `Efeito de uma valorização de ${num(variacao, 0)}% em cada moeda sobre o CI% de «${r.produto.nome}» ` +
        `(atual ${pct(sens.ciAtual)}) no cenário ${principal.codigo}:`));
      blocos.push(blocoTabela(
        ['Moeda', 'Cotação atual', 'Cotação simulada', 'Insumos', 'CI% simulado', 'Variação'],
        sens.linhas.map((l) => [
          `${l.moeda} (${l.nome})`, num(l.cotacaoAtual, 4), num(l.cotacaoSimulada, 4),
          String(l.nInsumos), pct(l.ciSimulado), pp(l.deltaPp)])));
      const maior = sens.linhas[0];
      blocos.push(blocoTexto(
        `A maior exposição é ao ${maior.nome}: ${maior.nInsumos} insumo(s) vinculados — ` +
        `${maior.insumos.slice(0, 3).join(', ')}${maior.insumos.length > 3 ? '…' : ''} — ` +
        `com efeito de ${pp(maior.deltaPp)} no CI%${maior.mudaFaixa ? ', com mudança de faixa de enquadramento' : ''}.`));
      sens.linhas.forEach((l) => citar('moeda', l.moeda, pp(l.deltaPp)));
    }
  }

  // ---- 5. Caminho para ficar abaixo de 40% (RF-081)
  else if (analise.id === 'caminho') {
    const caminho = caminhoAbaixoDe(principal.dados, prodId, n(ctx.alvo, 40), base, params);
    const r = resultadoProduto(principal.dados, prodId, base, params);
    titulo = `Caminho para ficar abaixo de ${num(caminho.alvo, 0)}% · ${r.produto.nome}`;
    if (caminho.jaEnquadrado) {
      blocos.push(blocoTexto(
        `«${r.produto.nome}» já está enquadrado: CI% de ${pct(caminho.ci)}, abaixo do limite de ${num(caminho.alvo, 0)}% ` +
        `(${r.enquadramento.label}, alíquota de ${num(r.enquadramento.aliquota, 0)}%).`));
    } else {
      blocos.push(blocoTexto(
        `«${r.produto.nome}» está em ${pct(caminho.ci)} no cenário ${principal.codigo}. ` +
        `Nacionalizando os componentes abaixo, na ordem de contribuição, o CI% chega a ${pct(caminho.ciFinal)}:`));
      blocos.push(blocoTabela(
        ['Ordem', 'Componente', 'Grupo', 'Efeito', 'CI% após a troca'],
        caminho.passos.map((p, i) => [String(i + 1), p.nome, p.grupo, pp(-p.impactoPp), pct(p.ciDepois)])));
      blocos.push(blocoTexto(caminho.nota));
      caminho.passos.slice(0, 3).forEach((p) => citar('insumo', p.nome, pp(-p.impactoPp)));
    }
    citar('produto', r.produto.nome, pct(r.ci));
  }

  // ---- 6. Efeito de preço e mix de UF (RF-081)
  else if (analise.id === 'precoMix') {
    const r = resultadoProduto(principal.dados, prodId, base, params);
    const pesos = pesosUF(r.produto);
    const sens = sensibilidadeUF(principal.dados, prodId, n(ctx.variacaoPreco, 5), base, params);
    titulo = `Efeito de preço e mix de UF · ${r.produto.nome}`;
    if (!pesos.length) {
      blocos.push(blocoTexto(`O produto «${r.produto.nome}» não possui volumes e preços por UF carregados — o CI% está sendo calculado sobre ${r.baseLabel}.`));
    } else {
      blocos.push(blocoTexto(
        `O denominador de «${r.produto.nome}» é a média ponderada global das saídas interestaduais, ` +
        `hoje em ${brl(r.denominador)} (CI% de ${pct(r.ci)}). Mix de destinos:`));
      blocos.push(blocoTabela(
        ['UF', 'Volume', 'Peso no volume', 'Preço', 'Efeito no CI% de +' + num(n(ctx.variacaoPreco, 5), 0) + '% no preço'],
        pesos.map((p) => {
          const s = sens.find((x) => x.uf === p.uf);
          return [p.uf, num(p.volume, 0), pct(p.pesoVolume), brl(p.preco), s ? pp(s.deltaPp) : '—'];
        })));
      if (sens.length) {
        blocos.push(blocoTexto(
          `A UF mais sensível é ${sens[0].uf}: um aumento de ${num(n(ctx.variacaoPreco, 5), 0)}% no preço daquele destino move o CI% em ${pp(sens[0].deltaPp)}` +
          `${sens[0].mudaFaixa ? ', alterando a faixa de enquadramento' : ''}. ` +
          `Preço maior eleva o denominador e reduz o CI%; o resultado oficial não é segmentado por UF (RF-069).`));
        sens.slice(0, 3).forEach((s) => citar('uf', s.uf, pp(s.deltaPp)));
      }
    }
  }

  // ---- 7. Recomendação executiva (RF-081)
  else {
    const resumo = resumoCenario(principal.dados, base, params);
    const lista = alertas(principal.dados, gatilho, base, params);
    const diag = diagnostico(principal.dados);
    titulo = `Recomendação executiva · ${principal.codigo} ${principal.nome}`;
    blocos.push(blocoTexto(
      `Cenário ${principal.codigo} · ${principal.nome} (v${principal.versao}, ${principal.status}): ` +
      `CI% médio ponderado de ${pct(resumo.ciMedio)} sobre ${resumo.nProdutos} produto(s) acabado(s), ` +
      `${resumo.acima40} acima de 40%. Base de cálculo: ${base === 'saida' ? 'média ponderada das saídas interestaduais' : 'custo total'}.`));

    const criticos = resumo.porProduto.filter((x) => x.resultado.ci > 40).slice(0, 5);
    if (criticos.length) {
      blocos.push(blocoTabela(
        ['Produto', 'CI%', 'Enquadramento', 'Alíquota', 'vs FCI vigente'],
        criticos.map(({ produto, resultado }) => [
          `${produto.nome} (${produto.sku || produto.id})`, pct(resultado.ci),
          resultado.enquadramento.label, num(resultado.enquadramento.aliquota, 0) + '%',
          pp(resultado.deltaVigente)])));
      criticos.forEach(({ produto, resultado }) => citar('produto', produto.nome, pct(resultado.ci)));
    } else {
      blocos.push(blocoTexto('Nenhum produto do cenário ultrapassa 40% de conteúdo de importação.'));
    }

    const dirs = direcionamentosPorArea(principal.dados, lista, base, params).filter((d) => d.total > 0);
    for (const d of dirs) {
      blocos.push(blocoTexto(`Direcionamentos — ${d.area}:`));
      blocos.push(blocoLista(d.itens.slice(0, 4).map((i) => `${i.produto}: ${i.texto}`)));
    }
    if (diag.nErros > 0) {
      blocos.push(blocoTexto(`Atenção: o cenário possui ${diag.nErros} erro(s) de validação de estrutura e não pode ser consolidado até a correção (RF-025).`));
    }
    citar('cenario', principal.codigo, principal.nome);
  }

  if (pergunta) {
    blocos.unshift(blocoTexto(`Pergunta analisada: «${pergunta}» — resposta produzida sobre o contexto selecionado (${cenarios.map((c) => c.codigo).join(', ')}).`));
  }

  return {
    analise: analise.id, titulo, blocos, citacoes,
    contexto: {
      cenarios: cenarios.map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome })),
      prodId, base, gatilho,
    },
    sugestoes: catalogo.filter((a) => a.id !== analise.id),
    ressalva: RESSALVA_GERENCIAL,   // RF-082
  };
}

// ---------------------------------------------------------------------------
// Matriz de permissões apresentada ao usuário (RF-039)
// ---------------------------------------------------------------------------

/** Colunas da matriz de permissões por área e perfil (RF-039). */
export const CAPACIDADES_MATRIZ = [
  { chave: 'abrir',          rotulo: 'Abrir cenário' },
  { chave: 'criarCenario',   rotulo: 'Criar / duplicar' },
  { chave: 'editarPremissas',rotulo: 'Editar premissas' },
  { chave: 'editarEstrutura',rotulo: 'Alterar estrutura' },
  { chave: 'modoAvancado',   rotulo: 'Modo avançado' },
  { chave: 'massa',          rotulo: 'Alteração em lote' },
  { chave: 'validarTecnico', rotulo: 'Validação técnica' },
  { chave: 'congelar',       rotulo: 'Congelar premissas' },
  { chave: 'consolidar',     rotulo: 'Consolidar' },
  { chave: 'aprovar',        rotulo: 'Aprovar' },
  { chave: 'integracoes',    rotulo: 'Integrações' },
  { chave: 'parametros',     rotulo: 'Parâmetros mestres' },
];
