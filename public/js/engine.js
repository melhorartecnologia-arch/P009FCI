/**
 * Motor de cálculo do CI% — portado do protótipo aprovado no discovery.
 * CI% = parcela importada ÷ denominador × 100 (RN-01 · Convênio ICMS 38/2013)
 * Denominador padrão: média ponderada global das saídas interestaduais (RN-02);
 * alternativa por custo total (RF-060 · entrega S3).
 * Custo FCI do insumo = valor total de entrada − ICMS − IPI (RN-03).
 * Cascata MP → PI → PA com fatores de faixa 0 / 0,5 / 1 (RN-05).
 */

export const CLASSES = {
  nacional:         { label: 'Nacional', curto: 'Nacional', bg: '#e9f1eb', fg: '#2f6b46', cst: '0', desc: 'Produzido no país, sem conteúdo de importação' },
  importado_direto: { label: 'Importado diretamente', curto: 'Import. direto', bg: '#f5e5e0', fg: '#a03d2c', cst: '1', desc: 'Importação própria · valor aduaneiro (CI 100%)' },
  estrangeiro_mi:   { label: 'Estrangeiro adq. no mercado interno', curto: 'Estrang. merc. int.', bg: '#f6e3ea', fg: '#8e2f56', cst: '2', desc: 'Item estrangeiro comprado de terceiro no Brasil (CI 100%)' },
  nacional_ci:      { label: 'Nacional com conteúdo de importação', curto: 'Nacional c/ CI', bg: '#f6ecd6', fg: '#8a5e12', cst: '3/5/8', desc: 'Produzido no país com insumos importados · CI informado' },
};

export const FAIXAS = {
  ate40:   { label: '≤ 40%',     ci: 40, fator: 0,   cst: '5', fg: '#2f6b46', bg: '#e9f1eb' },
  de40a70: { label: '40% – 70%', ci: 55, fator: 0.5, cst: '3', fg: '#8a5e12', bg: '#f6ecd6' },
  acima70: { label: '> 70%',     ci: 85, fator: 1,   cst: '8', fg: '#a03d2c', bg: '#f5e5e0' },
};

export const MOEDAS = {
  BRL: { nome: 'Real', simb: 'R$' },
  USD: { nome: 'Dólar americano', simb: 'US$' },
  EUR: { nome: 'Euro', simb: '€' },
  GBP: { nome: 'Libra esterlina', simb: '£' },
  CHF: { nome: 'Franco suíço', simb: 'CHF' },
};

export function fator(ci) { if (ci > 70) return 1; if (ci > 40) return 0.5; return 0; }

export function cstSugerido(cls, faixa, ciPct, ciModo) {
  if (cls === 'importado_direto') return '1';
  if (cls === 'estrangeiro_mi') return '2';
  if (cls === 'nacional_ci') {
    const f = (ciModo === 'faixa') ? faixa : (ciPct > 70 ? 'acima70' : ciPct > 40 ? 'de40a70' : 'ate40');
    return FAIXAS[f].cst;
  }
  return '0';
}

export function nodeInfo(ins) {
  const cls = ins.classSim || 'nacional';
  if (cls === 'importado_direto' || cls === 'estrangeiro_mi') return { ci: 100, fator: 1, ciLabel: '100%' };
  if (cls === 'nacional_ci') {
    if (ins.ciModo === 'faixa') { const f = FAIXAS[ins.ciFaixa || 'ate40']; return { ci: f.ci, fator: f.fator, ciLabel: f.label, porFaixa: true }; }
    const p = ins.ciPct || 0;
    return { ci: p, fator: fator(p), ciLabel: p.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' };
  }
  return { ci: 0, fator: 0, ciLabel: '0%' };
}

/** Custo FCI do insumo: importado = valor aduaneiro; nacional = entrada − ICMS − IPI. */
export function custoFCI(ins, cambio) {
  if (ins.classSim === 'importado_direto') {
    const r = (cambio && cambio[ins.moeda]) || 1;
    return (ins.fob || 0) * r + (ins.freteInt || 0) + (ins.seguroInt || 0) + (ins.ii || 0) + (ins.ipiImp || 0) + (ins.pisCofinsImp || 0);
  }
  return (ins.precoNacional || 0) - (ins.icms || 0) - (ins.ipi || 0);
}

export function mixOf(comp) { return (comp.mix && comp.mix.length) ? comp.mix : [{ ref: comp.ref, pct: 100 }]; }

/** Cálculo em cascata MP → PI → PA (memoizado). */
export function computeNode(data, id, memo) {
  memo = memo || {};
  if (memo[id]) return memo[id];
  const prod = data.produtos.find((p) => p.id === id);
  if (prod) {
    let custo = prod.overhead || 0, parcela = 0;
    const children = [];
    for (let idx = 0; idx < prod.componentes.length; idx++) {
      const c = prod.componentes[idx];
      const mix = mixOf(c);
      let cTot = 0, cb = 0;
      const parts = [];
      for (let mi = 0; mi < mix.length; mi++) {
        const m = mix[mi];
        const ch = computeNode(data, m.ref, memo);
        const q = c.qtd * ((m.pct || 0) / 100);
        const ct = ch.custo * q;
        const f = (ch.fator != null ? ch.fator : fator(ch.ci));
        const cbi = ct * f;
        cTot += ct; cb += cbi;
        parts.push({ mi, ref: m.ref, pct: m.pct || 0, qtd: q, node: ch, custoTot: ct, fator: f, contrib: cbi });
      }
      custo += cTot; parcela += cb;
      children.push({
        ref: mix[0].ref, idx, qtd: c.qtd, node: parts[0].node, parts,
        hasMix: mix.length > 1, custoTot: cTot,
        fator: (cTot > 0 ? cb / cTot : 0), contrib: cb,
        pctTotal: mix.reduce((a, b) => a + (b.pct || 0), 0),
      });
    }
    const ci = custo > 0 ? parcela / custo * 100 : 0;
    const r = { kind: 'prod', id, nome: prod.nome, custo, parcela, ci, fator: fator(ci), children, prod };
    memo[id] = r;
    return r;
  }
  const ins = data.insumos.find((i) => i.id === id);
  if (!ins) {
    const r = { kind: 'mp', id, nome: '(insumo não encontrado)', custo: 0, ci: 0, fator: 0, ciLabel: '—', parcela: 0, missing: true };
    memo[id] = r;
    return r;
  }
  const custo = custoFCI(ins, data.cambio);
  const ni = nodeInfo(ins);
  const r = { kind: 'mp', id, nome: ins.nome, custo, ci: ni.ci, fator: ni.fator, ciLabel: ni.ciLabel, porFaixa: !!ni.porFaixa, parcela: custo * ni.fator, ins };
  memo[id] = r;
  return r;
}

/** Preço médio ponderado das saídas por UF (denominador padrão · RN-02). */
export function precoMedio(prod) {
  let v = 0, q = 0;
  (prod.saidas || []).forEach((s) => { v += s.volume * s.preco; q += s.volume; });
  return q > 0 ? v / q : 0;
}

/**
 * Resultado do produto com o denominador vigente:
 * base 'saida' (padrão · RN-02) quando houver saídas; senão custo total.
 */
export function resultadoProduto(data, prodId, basis = 'saida') {
  const node = computeNode(data, prodId, {});
  const pm = node.prod ? precoMedio(node.prod) : 0;
  const usaSaida = basis === 'saida' && pm > 0;
  const denominador = usaSaida ? pm : node.custo;
  const ci = denominador > 0 ? node.parcela / denominador * 100 : 0;
  return {
    node,
    denominador,
    basisUsada: usaSaida ? 'saida' : 'custo',
    basisLabel: usaSaida ? 'média ponderada das saídas interestaduais' : 'custo total (alternativa)',
    ci,
    ciCusto: node.ci,
    faixa: faixaDe(ci),
  };
}

export function faixaDe(ci) {
  if (ci > 70) return { key: 'alto', label: 'Equiparado a importado', range: 'CI% > 70%', fg: '#a03d2c', bg: '#f5e5e0', chip: '#e79b86' };
  if (ci > 40) return { key: 'medio', label: 'Nacional c/ CI > 40%', range: '40% < CI% ≤ 70%', fg: '#8a5e12', bg: '#f6ecd6', chip: '#e0b866' };
  if (ci > 0) return { key: 'baixo', label: 'Nacional c/ Conteúdo Import.', range: '0% < CI% ≤ 40%', fg: '#2f6b46', bg: '#e9f1eb', chip: '#7fb193' };
  return { key: 'nacional', label: '100% Nacional', range: 'CI% = 0%', fg: '#2f6b46', bg: '#e9f1eb', chip: '#7fb193' };
}

/** Alíquota interestadual resultante (RN-07 · Res. SF 13/2012). */
export function aliqInter(ci, normal = 12) { return ci > 40 ? 4 : normal; }

/** Painel do cenário: CI% médio ponderado e distribuição por faixa. */
export function resumoCenario(dados, basis = 'saida') {
  const pas = (dados.produtos || []).filter((p) => p.tipo === 'PA');
  let somaCiPeso = 0, somaPeso = 0, acima40 = 0;
  const dist = { baixo: 0, medio: 0, alto: 0 };
  const porProduto = [];
  for (const p of pas) {
    const r = resultadoProduto(dados, p.id, basis);
    const volume = (p.saidas || []).reduce((a, s) => a + s.volume, 0) || 1;
    somaCiPeso += r.ci * volume; somaPeso += volume;
    if (r.ci > 40) acima40++;
    if (r.ci > 70) dist.alto++; else if (r.ci > 40) dist.medio++; else dist.baixo++;
    porProduto.push({ produto: p, resultado: r });
  }
  return {
    ciMedio: somaPeso > 0 ? somaCiPeso / somaPeso : 0,
    nProdutos: pas.length,
    acima40,
    dist,
    porProduto,
  };
}

/** Alertas: mudança de faixa, reemissão (gatilho p.p.) e risco fiscal. */
export function alertasCenario(dados, gatilhoPp = 5, basis = 'saida') {
  const alertas = [];
  for (const p of (dados.produtos || []).filter((x) => x.tipo === 'PA')) {
    const r = resultadoProduto(dados, p.id, basis);
    const vig = p.fciVigente || 0;
    const delta = r.ci - vig;
    const fxAtual = faixaDe(r.ci), fxVig = faixaDe(vig);
    if (fxAtual.key !== fxVig.key) {
      alertas.push({
        tipo: 'faixa', produto: p, sev: 'aviso', area: 'Fiscal',
        msg: `Mudança de faixa: ${fxVig.label} (${vig.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%) → ${fxAtual.label} (${r.ci.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%) em relação à FCI vigente.`,
      });
    }
    if (Math.abs(delta) > gatilhoPp) {
      alertas.push({
        tipo: 'reemissao', produto: p, sev: 'erro', area: 'Fiscal',
        msg: `Reemissão da FCI: variação de ${delta > 0 ? '+' : ''}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p. vs FCI vigente supera o gatilho de ${gatilhoPp} p.p. (RN-08).`,
      });
    }
    if (r.ci > 40) {
      alertas.push({
        tipo: 'risco', produto: p, sev: 'aviso', area: 'Fiscal/Tributário',
        msg: `CI% acima de 40% — alíquota interestadual de 4% (Res. SF 13/2012) e impacto no crédito do cliente.`,
      });
    }
  }
  return alertas;
}
