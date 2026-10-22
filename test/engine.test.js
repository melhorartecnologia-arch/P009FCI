'use strict';
/**
 * Testes das regras de negócio do motor (RN-01 a RN-12) e dos requisitos
 * funcionais que dependem de cálculo, substituição ou validação.
 * Independentes de banco: usam um cenário sintético controlado.
 */
const { test, before } = require('node:test');
const assert = require('node:assert');

let E;
before(async () => { E = await import('../shared/engine.mjs'); });

/* ------------------------------------------------------------------ fixture */
// Produto acabado "PA-TESTE": 1 intermediário + 2 insumos diretos.
// Valores escolhidos para que o CI% caia exatamente em pontos conhecidos.
function cenario() {
  return {
    base: 'saida',
    cambio: { USD: 5, EUR: 6, GBP: 7, CHF: 6 },
    cambioPadrao: { USD: 5, EUR: 6, GBP: 7, CHF: 6 },
    fornecedores: [
      { id: 'F1', nome: 'Fornecedor Nacional', pais: 'BR' },
      { id: 'F2', nome: 'Fornecedor Importador', pais: 'DE' },
    ],
    insumos: [
      // Importado direto: valor aduaneiro = 2*5 + 1 + 0,5 + 2 + 1 + 0,5 = 15
      { id: 'MP-IMP', codigo: 'MP-IMP', nome: 'Insumo Importado', unidade: 'kg', grupo: 'Grao',
        classSim: 'importado_direto', classPadrao: 'importado_direto', moeda: 'USD', fornecedorId: 'F2',
        fob: 2, freteInt: 1, seguroInt: 0.5, ii: 2, ipiImp: 1, pisCofinsImp: 0.5,
        precoNacional: 0, icms: 0, ipi: 0, ciModo: 'pct', ciPct: 0, ciPadrao: 0, cstOrigem: '1', alt: false },
      // Nacional: custo FCI = 10 - 2 - 1 = 7 (PIS/COFINS não deduzem)
      { id: 'MP-NAC', codigo: 'MP-NAC', nome: 'Insumo Nacional', unidade: 'kg', grupo: 'Grao',
        classSim: 'nacional', classPadrao: 'nacional', moeda: 'BRL', fornecedorId: 'F1',
        precoNacional: 10, icms: 2, ipi: 1, ciModo: 'pct', ciPct: 0, ciPadrao: 0, cstOrigem: '0', alt: false },
      // Nacional com CI de 50% → fator 0,5
      { id: 'MP-CI', codigo: 'MP-CI', nome: 'Insumo Nacional com CI', unidade: 'un', grupo: 'Embalagem',
        classSim: 'nacional_ci', classPadrao: 'nacional_ci', moeda: 'BRL', fornecedorId: 'F1',
        precoNacional: 4, icms: 0, ipi: 0, ciModo: 'pct', ciPct: 50, ciPadrao: 50, cstOrigem: '3', alt: false },
      // Alternativa do mesmo grupo, nacional integral
      { id: 'MP-CI-NAC', codigo: 'MP-CI-NAC', nome: 'Embalagem Nacional', unidade: 'un', grupo: 'Embalagem',
        classSim: 'nacional', classPadrao: 'nacional', moeda: 'BRL', fornecedorId: 'F1',
        precoNacional: 4, icms: 0, ipi: 0, ciModo: 'pct', ciPct: 0, ciPadrao: 0, cstOrigem: '0', alt: false },
      // Estrangeiro adquirido no mercado interno → conteúdo integral (RN-04)
      { id: 'MP-EMI', codigo: 'MP-EMI', nome: 'Estrangeiro no mercado interno', unidade: 'kg', grupo: 'Grao',
        classSim: 'estrangeiro_mi', classPadrao: 'estrangeiro_mi', moeda: 'BRL', fornecedorId: 'F1',
        precoNacional: 20, icms: 0, ipi: 0, ciModo: 'pct', ciPct: 0, ciPadrao: 0, cstOrigem: '2', alt: false },
    ],
    produtos: [
      { id: 'PI-TESTE', sku: 'PI-TESTE', nome: 'Intermediario', tipo: 'PI', grupo: 'Intermediario',
        unidade: 'L', overhead: 0, overheadPadrao: 0, espec: null,
        obrig: [{ grupo: 'Grao', qtd: 2, unidade: 'kg', tol: 0.01 }],
        componentes: [
          { ref: 'MP-IMP', qtd: 1, qtdPadrao: 1 },
          { ref: 'MP-NAC', qtd: 1, qtdPadrao: 1 },
        ], saidas: [], fciVigente: 0 },
      { id: 'PA-TESTE', sku: 'PA-TESTE', nome: 'Produto Acabado', tipo: 'PA', grupo: '',
        unidade: 'un', overhead: 2, overheadPadrao: 2,
        espec: { descr: 'Lata 1 L', volume: 1000, unidVol: 'ml' },
        obrig: [
          { grupo: 'Intermediario', qtd: 1, unidade: 'L', tol: 0.001 },
          { grupo: 'Embalagem', qtd: 1, unidade: 'un', tol: 0 },
        ],
        componentes: [
          { ref: 'PI-TESTE', qtd: 1, qtdPadrao: 1 },
          { ref: 'MP-CI', qtd: 1, qtdPadrao: 1 },
        ],
        saidas: [
          { uf: 'SP', volume: 100, preco: 50, volumePadrao: 100, precoPadrao: 50 },
          { uf: 'RJ', volume: 100, preco: 70, volumePadrao: 100, precoPadrao: 70 },
        ],
        fciVigente: 20 },
    ],
  };
}

/* ====================================================== Custo e valor aduaneiro */

test('RN-03 · RF-058 — custo FCI nacional deduz ICMS e IPI, mas não PIS/COFINS', () => {
  const d = cenario();
  const nac = d.insumos.find((i) => i.id === 'MP-NAC');
  assert.strictEqual(E.custoFCI(nac, d.cambio), 7, 'esperado 10 - 2 - 1 = 7');
  const mem = E.memoriaCustoFCI(nac, d.cambio);
  assert.match(mem.nota, /PIS e COFINS n[aã]o deduzem/i);
});

test('RF-059 — valor aduaneiro soma FOB convertido, frete, seguro, II, IPI e PIS/COFINS', () => {
  const d = cenario();
  const imp = d.insumos.find((i) => i.id === 'MP-IMP');
  const va = E.valorAduaneiro(imp, d.cambio);
  assert.strictEqual(va.itens.length, 6, 'os seis componentes devem ser editáveis/exibíveis');
  assert.strictEqual(va.fobBRL, 10, 'FOB 2 × câmbio 5');
  assert.strictEqual(va.total, 15);
  assert.strictEqual(E.custoFCI(imp, d.cambio), 15);
});

test('RF-054 — alterar a cotação recalcula em lote todos os insumos da moeda', () => {
  const d = cenario();
  const antes = E.custoFCI(d.insumos[0], d.cambio);
  d.cambio.USD = 10;
  const depois = E.custoFCI(d.insumos[0], d.cambio);
  assert.strictEqual(antes, 15);
  assert.strictEqual(depois, 25, 'FOB 2 × 10 = 20, mais 5 de frete/seguro/tributos');
});

/* ================================================== Conteúdo, faixas e cascata */

test('RN-04 — importado direto e estrangeiro no mercado interno têm conteúdo integral', () => {
  const d = cenario();
  assert.strictEqual(E.nodeInfo(d.insumos.find((i) => i.id === 'MP-IMP')).ci, 100);
  assert.strictEqual(E.nodeInfo(d.insumos.find((i) => i.id === 'MP-EMI')).ci, 100);
  assert.strictEqual(E.nodeInfo(d.insumos.find((i) => i.id === 'MP-EMI')).fator, 1);
});

test('RN-05 — fatores de faixa na cascata são 0, 0,5 e 1', () => {
  assert.strictEqual(E.fator(39.9), 0);
  assert.strictEqual(E.fator(40), 0, 'limite inferior fechado: 40% ainda é fator 0');
  assert.strictEqual(E.fator(40.1), 0.5);
  assert.strictEqual(E.fator(70), 0.5, 'limite 70% ainda é fator 0,5');
  assert.strictEqual(E.fator(70.1), 1);
});

test('RF-057 · RF-013 — cascata MP→PI→PA e soma das parcelas igual à do produto', () => {
  const d = cenario();
  const pi = E.computeNode(d, 'PI-TESTE', {});
  // PI: custo = 15 + 7 = 22; parcela = 15 × 1 (fator 1) = 15
  assert.strictEqual(pi.custo, 22);
  assert.strictEqual(pi.parcela, 15);
  assert.ok(Math.abs(pi.ci - (15 / 22 * 100)) < 1e-9);

  const pa = E.computeNode(d, 'PA-TESTE', {});
  // PI entra com CI 68,18% → fator 0,5 → contribuição 22 × 0,5 = 11
  // MP-CI: custo 4, CI 50% → fator 0,5 → contribuição 2
  // custo total = 22 + 4 + overhead 2 = 28; parcela = 13
  assert.strictEqual(pa.custo, 28);
  assert.strictEqual(pa.parcela, 13);
  const somaFilhos = pa.children.reduce((a, c) => a + c.contrib, 0);
  assert.ok(Math.abs(somaFilhos - pa.parcela) < 1e-9, 'soma das parcelas dos componentes = parcela do produto');
});

test('RF-012 — overhead compõe o custo total e não integra a parcela importada', () => {
  const d = cenario();
  const comOverhead = E.computeNode(d, 'PA-TESTE', {});
  d.produtos.find((p) => p.id === 'PA-TESTE').overhead = 0;
  const semOverhead = E.computeNode(d, 'PA-TESTE', {});
  assert.strictEqual(comOverhead.custo - semOverhead.custo, 2);
  assert.strictEqual(comOverhead.parcela, semOverhead.parcela, 'a parcela importada não muda');
});

/* ========================================== Denominador, CI%, enquadramento e ST */

test('RN-01 · RN-02 · RF-060 — CI% sobre a média ponderada das saídas e alternativa por custo', () => {
  const d = cenario();
  // média ponderada = (100×50 + 100×70) / 200 = 60
  const r = E.resultadoProduto(d, 'PA-TESTE', 'saida');
  assert.strictEqual(r.denominador, 60);
  assert.strictEqual(r.baseUsada, 'saida');
  assert.ok(Math.abs(r.ci - (13 / 60 * 100)) < 1e-9);

  const rc = E.resultadoProduto(d, 'PA-TESTE', 'custo');
  assert.strictEqual(rc.denominador, 28);
  assert.ok(Math.abs(rc.ci - (13 / 28 * 100)) < 1e-9);
  assert.notStrictEqual(r.ci, rc.ci, 'a alternância de base recalcula o CI%');
});

test('RF-060 — sem saídas carregadas a base recai no custo e a tela identifica isso', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').saidas = [];
  const r = E.resultadoProduto(d, 'PA-TESTE', 'saida');
  assert.strictEqual(r.baseSolicitada, 'saida');
  assert.strictEqual(r.baseUsada, 'custo');
  assert.match(r.baseLabel, /sem sa[ií]das carregadas/i);
});

test('RN-06 · RF-061 — enquadramento nas quatro situações legais', () => {
  assert.strictEqual(E.faixaDe(0).key, 'nacional');
  assert.strictEqual(E.faixaDe(0).label, '100% nacional');
  assert.strictEqual(E.faixaDe(25).key, 'baixo');
  assert.strictEqual(E.faixaDe(40).key, 'baixo', '40% ainda é nacional com conteúdo');
  assert.strictEqual(E.faixaDe(55).key, 'medio');
  assert.strictEqual(E.faixaDe(70).key, 'medio', '70% ainda é a faixa intermediária');
  assert.strictEqual(E.faixaDe(85).key, 'alto');
  assert.strictEqual(E.enquadramento(0).fciObrigatoria, false, 'CI% zero dispensa a FCI');
  assert.strictEqual(E.enquadramento(10).fciObrigatoria, true);
});

test('RN-07 · RF-061 — CI% acima de 40% resulta em alíquota de 4%', () => {
  assert.strictEqual(E.aliqInter(40, 12), 12);
  assert.strictEqual(E.aliqInter(40.01, 12), 4);
  assert.strictEqual(E.aliqInter(80, 7), 4);
  assert.strictEqual(E.aliqInter(10, 7), 7, 'abaixo de 40% mantém a alíquota do destino');
  assert.match(E.enquadramento(50).baseLegal, /13\/2012/);
});

test('RF-062 — ICMS-ST compara as duas alíquotas com MVA e alíquota interna', () => {
  const st = E.icmsST(100, 50, { mva: 40, aliqInterna: 18, aliqNormal: 12 });
  assert.strictEqual(st.aliqResultante, 4);
  assert.strictEqual(st.comCI.icmsProprio, 4);
  assert.strictEqual(st.semCI.icmsProprio, 12);
  assert.strictEqual(st.comCI.baseST, 140);
  assert.ok(Math.abs(st.comCI.st - (140 * 0.18 - 4)) < 1e-9);
  assert.ok(st.difST > 0, 'com CI acima de 40% o ICMS-ST do destino aumenta');
  assert.ok(st.aplicavel);
});

test('RF-065 — componentes ordenados por contribuição, com o maior em primeiro', () => {
  const d = cenario();
  const r = E.resultadoProduto(d, 'PA-TESTE');
  const maiores = E.maioresContribuicoes(r);
  assert.strictEqual(maiores[0].nome, 'Intermediario');
  assert.ok(maiores[0].contrib >= maiores[1].contrib);
  const soma = maiores.reduce((a, m) => a + m.participacao, 0);
  assert.ok(Math.abs(soma - 100) < 0.01, 'as participações somam 100% da parcela importada');
});

/* ============================================= Volumes, pesos e sensibilidade */

test('RF-070 — pesos por UF totalizam 100%', () => {
  const d = cenario();
  const pesos = E.pesosUF(d.produtos.find((p) => p.id === 'PA-TESTE'));
  assert.strictEqual(pesos.length, 2);
  assert.ok(Math.abs(pesos.reduce((a, p) => a + p.pesoVolume, 0) - 100) < 1e-9);
});

test('RF-071 — sensibilidade por UF mede o efeito de uma variação de preço no CI%', () => {
  const d = cenario();
  const sens = E.sensibilidadeUF(d, 'PA-TESTE', 10);
  assert.strictEqual(sens.length, 2);
  for (const s of sens) {
    assert.ok(s.deltaPp < 0, 'preço maior eleva o denominador e reduz o CI%');
    assert.ok(s.precoSimulado > s.precoAtual);
  }
});

test('RF-068 — editar volume ou preço recalcula imediatamente o denominador e o CI%', () => {
  const d = cenario();
  const antes = E.resultadoProduto(d, 'PA-TESTE');
  d.produtos.find((p) => p.id === 'PA-TESTE').saidas[0].preco = 100;
  const depois = E.resultadoProduto(d, 'PA-TESTE');
  assert.notStrictEqual(antes.denominador, depois.denominador);
  assert.ok(depois.ci < antes.ci);
});

/* ================================================== Substituição de componentes */

test('RF-016 · RF-019 — substituição integral mantém o original listado com proporção zero', () => {
  const d = cenario();
  const idx = 1; // MP-CI
  const novo = E.aplicarSubstituicao(d, 'PA-TESTE', idx, { refSubstituto: 'MP-CI-NAC', modo: 'integral' });
  const mix = novo.produtos.find((p) => p.id === 'PA-TESTE').componentes[idx].mix;
  assert.strictEqual(mix.length, 2);
  assert.strictEqual(mix[0].ref, 'MP-CI');
  assert.strictEqual(mix[0].pct, 0, 'o item original permanece com proporção zero');
  assert.strictEqual(mix[1].pct, 100);
  const r = E.resultadoProduto(novo, 'PA-TESTE');
  assert.ok(r.ci < E.resultadoProduto(d, 'PA-TESTE').ci, 'trocar por nacional reduz o CI%');
});

test('RF-017 — na substituição parcial a proporção do outro item é complementada a 100%', () => {
  const d = cenario();
  const novo = E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'parcial', pct: 30 });
  const mix = novo.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].mix;
  assert.strictEqual(mix[0].pct, 70);
  assert.strictEqual(mix[1].pct, 30);
  const ajustado = E.ajustarProporcao(novo, 'PA-TESTE', 1, 1, 80);
  const mix2 = ajustado.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].mix;
  assert.strictEqual(mix2[1].pct, 80);
  assert.strictEqual(mix2[0].pct, 20, 'o complemento é automático');
});

test('RF-018 — a soma das quantidades das alternativas é a quantidade original da receita', () => {
  const d = cenario();
  const previa = E.previaSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'parcial', pct: 40 });
  const soma = previa.quantidades.reduce((a, q) => a + q.qtd, 0);
  assert.ok(Math.abs(soma - previa.qtdOriginalReceita) < 1e-9);
  assert.strictEqual(previa.quantidades[0].pct, 60);
  assert.strictEqual(previa.quantidades[1].pct, 40);
});

test('RF-020 — alternativas do mesmo grupo vêm primeiro e a natureza da troca é sinalizada', () => {
  const d = cenario();
  const op = E.opcoesSubstituicao(d, 'PA-TESTE', 1);
  assert.ok(op.mesmoGrupo.length >= 1);
  assert.ok(op.mesmoGrupo.every((o) => o.mesmoGrupo === true));
  assert.ok(op.mesmoGrupo[0].naturezas.length >= 1);
  assert.ok(op.outros.every((o) => o.mesmoGrupo === false));
  assert.strictEqual(op.atual.ref, 'MP-CI');
});

test('RF-021 — intermediário só pode ser substituído por outro intermediário', () => {
  const d = cenario();
  assert.throws(
    () => E.aplicarSubstituicao(d, 'PA-TESTE', 0, { refSubstituto: 'MP-NAC', modo: 'integral' }),
    /intermedi[áa]rio/i,
    'trocar PI por MP deve ser recusado'
  );
});

test('RF-022 — prévia traz CI% atual, simulado, faixa resultante e variação em p.p.', () => {
  const d = cenario();
  const p = E.previaSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'integral' });
  assert.ok(p.aplicavel);
  assert.ok(typeof p.ciAtual === 'number' && typeof p.ciSimulado === 'number');
  assert.ok(Math.abs(p.deltaPp - (p.ciSimulado - p.ciAtual)) < 1e-9);
  assert.ok(p.faixaSimulada && p.faixaSimulada.label);
  assert.ok(typeof p.mudaFaixa === 'boolean');
});

test('RF-023 — normalização redistribui proporcionalmente até 100%', () => {
  const d = cenario();
  let novo = E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'parcial', pct: 30 });
  novo.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].mix = [
    { ref: 'MP-CI', pct: 30 }, { ref: 'MP-CI-NAC', pct: 30 },
  ];
  const norm = E.normalizarProporcoes(novo, 'PA-TESTE', 1);
  const mix = norm.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].mix;
  assert.ok(Math.abs(mix.reduce((a, m) => a + m.pct, 0) - 100) < 1e-9);
  assert.ok(Math.abs(mix[0].pct - 50) < 1e-9, 'proporções iguais permanecem iguais após normalizar');
});

test('RF-024 — reversão devolve o componente original a 100% sem alternativas residuais', () => {
  const d = cenario();
  const sub = E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'integral' });
  const rev = E.reverterSubstituicao(sub, 'PA-TESTE', 1);
  const comp = rev.produtos.find((p) => p.id === 'PA-TESTE').componentes[1];
  assert.strictEqual(comp.mix, undefined, 'sem alternativas residuais');
  assert.strictEqual(comp.ref, 'MP-CI');
  assert.strictEqual(E.resultadoProduto(rev, 'PA-TESTE').ci, E.resultadoProduto(d, 'PA-TESTE').ci);
});

test('RF-045 — substituir por item igual ao original é recusado', () => {
  const d = cenario();
  assert.throws(
    () => E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI', modo: 'integral' }),
    /n[aã]o h[áa] substitui[çc][ãa]o/i
  );
});

/* ============================================================ Validadores */

test('RF-026 — ausência de grupo obrigatório nomeia o grupo e a quantidade esperada', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').componentes.splice(1, 1); // remove a embalagem
  const erros = E.validar(d).filter((v) => v.sev === 'erro' && v.tipo === 'obrigatorio');
  assert.strictEqual(erros.length, 1);
  assert.match(erros[0].msg, /Embalagem/);
  assert.match(erros[0].msg, /quantidade esperada/i);
});

test('RF-027 — quantidade por grupo obrigatório respeita a tolerância (12 tampas ≠ 11)', () => {
  const d = cenario();
  const pa = d.produtos.find((p) => p.id === 'PA-TESTE');
  pa.obrig = [{ grupo: 'Embalagem', qtd: 12, unidade: 'un', tol: 0 }];
  pa.componentes = [{ ref: 'MP-CI', qtd: 11, qtdPadrao: 12 }];
  const erros = E.validar(d).filter((v) => v.tipo === 'quantidade' && v.sev === 'erro');
  assert.ok(erros.length >= 1);
  assert.match(erros[0].msg, /abaixo/);
  assert.match(erros[0].msg, /informado 11/);
  assert.match(erros[0].msg, /esperado 12/);
});

test('RN-09 · RF-028 · RF-029 — soma ≠ 100% gera erro de proporção e de distribuição', () => {
  const d = cenario();
  const sub = E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'parcial', pct: 30 });
  sub.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].mix = [
    { ref: 'MP-CI', pct: 70 }, { ref: 'MP-CI-NAC', pct: 60 },
  ];
  const itens = E.validar(sub).filter((v) => v.sev === 'erro');
  const prop = itens.find((v) => v.tipo === 'proporcao');
  const dist = itens.find((v) => v.tipo === 'distribuicao');
  assert.ok(prop, 'erro de proporção');
  assert.match(prop.msg, /excede 100%/);
  assert.ok(dist, 'erro de distribuição vs quantidade original');
  assert.match(dist.msg, /acima/);
  assert.match(dist.msg, /refer[êe]ncia/i);
  assert.ok(E.temErros(sub), 'erro bloqueia consolidação (RF-025)');
});

test('RF-030 · RF-014 — divergência de volume envasado × especificação do SKU gera aviso', () => {
  const d = cenario();
  const pa = d.produtos.find((p) => p.id === 'PA-TESTE');
  pa.obrig.push({ grupo: 'Agua', qtd: 1, unidade: 'L', tol: 0.001 });
  pa.componentes = pa.componentes.filter((c) => c.ref !== 'PI-TESTE');  // intermediário é medido em litros
  d.insumos.push({ id: 'MP-AGUA', codigo: 'MP-AGUA', nome: 'Agua', unidade: 'L', grupo: 'Agua',
    classSim: 'nacional', precoNacional: 1, icms: 0, ipi: 0, ciModo: 'pct', ciPct: 0, cstOrigem: '0' });
  pa.componentes.push({ ref: 'MP-AGUA', qtd: 0.5, qtdPadrao: 0.5 });  // espec pede 1 L
  const avisos = E.validar(d).filter((v) => v.sev === 'aviso' && v.tipo === 'especificacao');
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].msg, /volume envasado/i);
  assert.match(avisos[0].msg, /especifica[çc][ãa]o t[ée]cnica/i);
});

test('RF-031 — confronto imediato devolve apenas as inconsistências novas da edição', () => {
  const d = cenario();
  const depois = E.clonar(d);
  depois.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].qtd = 0;
  const conf = E.confrontarEdicao(d, depois);
  assert.ok(conf.houveRegressao);
  assert.ok(conf.novos.length >= 1);
  assert.strictEqual(E.confrontarEdicao(d, E.clonar(d)).total, 0, 'sem alteração, nada novo');
});

test('RF-032 — diagnóstico separa erros de avisos e informa a origem', () => {
  const d = cenario();
  d.insumos.find((i) => i.id === 'MP-CI').cstOrigem = '9';   // divergente do sugerido
  const diag = E.diagnostico(d);
  assert.ok(diag.nAvisos >= 1);
  const cst = diag.avisos.find((a) => a.tipo === 'cst');
  assert.ok(cst, 'aviso de coerência fiscal (RF-033)');
  assert.strictEqual(cst.origem, 'cadastro');
  assert.match(cst.msg, /valor esperado/i);
  assert.ok(diag.grupos.some((g) => g.chave === '__cadastro__'));
});

test('RF-033 · RF-050 — CST sugerido acompanha a classificação e a faixa adotadas', () => {
  assert.strictEqual(E.cstSugerido('nacional', null, 0, 'pct'), '0');
  assert.strictEqual(E.cstSugerido('importado_direto', null, 0, 'pct'), '1');
  assert.strictEqual(E.cstSugerido('estrangeiro_mi', null, 0, 'pct'), '2');
  assert.strictEqual(E.cstSugerido('nacional_ci', null, 30, 'pct'), '5');
  assert.strictEqual(E.cstSugerido('nacional_ci', null, 55, 'pct'), '3');
  assert.strictEqual(E.cstSugerido('nacional_ci', null, 85, 'pct'), '8');
});

test('RF-025 — cenário sem erro não bloqueia; com erro bloqueia e declara o motivo', () => {
  const d = cenario();
  assert.strictEqual(E.diagnostico(d).bloqueado, false);
  d.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].qtd = 0;
  const diag = E.diagnostico(d);
  assert.strictEqual(diag.bloqueado, true);
  assert.match(diag.motivo, /consolidar e congelar/i);
});

/* ======================================================= Origem e classificação */

test('E-04 · RF-047 — conversão da origem do cadastro para conteúdo importado', () => {
  assert.deepStrictEqual(E.classificacaoPorOrigem('0'), { classSim: 'nacional', ciPct: 0 });
  assert.deepStrictEqual(E.classificacaoPorOrigem('1'), { classSim: 'importado_direto', ciPct: 100 });
  assert.deepStrictEqual(E.classificacaoPorOrigem('2'), { classSim: 'estrangeiro_mi', ciPct: 100 });
  assert.deepStrictEqual(E.classificacaoPorOrigem('3'), { classSim: 'nacional_ci', ciPct: 50 });
  assert.deepStrictEqual(E.classificacaoPorOrigem('5'), { classSim: 'nacional', ciPct: 0 });
  assert.deepStrictEqual(E.classificacaoPorOrigem('8'), { classSim: 'nacional_ci', ciPct: 100 });
});

test('RF-048 — conteúdo por percentual informado ou por faixa aplicável', () => {
  const porPct = E.nodeInfo({ classSim: 'nacional_ci', ciModo: 'pct', ciPct: 62 });
  assert.strictEqual(porPct.ci, 62);
  assert.strictEqual(porPct.fator, 0.5);
  const porFaixa = E.nodeInfo({ classSim: 'nacional_ci', ciModo: 'faixa', ciFaixa: 'acima70' });
  assert.strictEqual(porFaixa.modo, 'faixa');
  assert.strictEqual(porFaixa.fator, 1);
});

test('RF-049 — item nacional não contribui com conteúdo mesmo com CI informado', () => {
  const d = cenario();
  const nac = d.insumos.find((i) => i.id === 'MP-NAC');
  nac.ciPct = 90;
  assert.strictEqual(E.nodeInfo(nac).ci, 0, 'o valor é ignorado no cálculo');
  const avisos = E.validar(d).filter((v) => v.tipo === 'ci' && v.sev === 'aviso');
  assert.ok(avisos.some((a) => /ignorado no c[áa]lculo/i.test(a.msg)));
});

/* ============================================================ Massa e grupos */

test('RF-040 · RF-042 — lote por grupo relaciona as posições e respeita a seleção', () => {
  const d = cenario();
  const grupos = E.gruposDeInsumo(d);
  const embalagem = grupos.find((g) => g.grupo === 'Embalagem');
  assert.ok(embalagem && embalagem.posicoes >= 1);
  const posicoes = E.posicoesDoGrupo(d, 'Embalagem');
  assert.ok(posicoes.every((p) => p.prodId && typeof p.idx === 'number'));

  const previaTudo = E.previaMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI-NAC', pct: 100 });
  assert.ok(previaTudo.aplicavel);
  const previaFiltrada = E.previaMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI-NAC', pct: 100, prodIds: ['PI-TESTE'] });
  assert.strictEqual(previaFiltrada.nPosicoes, 0, 'estrutura não selecionada permanece intacta');
});

test('RF-043 — prévia do lote mostra CI% antes e depois, variação e mudança de faixa', () => {
  const d = cenario();
  const p = E.previaMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI-NAC', pct: 100 });
  assert.ok(p.impactos.length >= 1);
  const i = p.impactos[0];
  assert.ok(typeof i.ciAntes === 'number' && typeof i.ciDepois === 'number');
  assert.ok(Math.abs(i.deltaPp - (i.ciDepois - i.ciAntes)) < 1e-9);
  assert.ok(i.faixaAntes && i.faixaDepois && typeof i.mudaFaixa === 'boolean');
});

test('RF-045 — operação em lote sem efeito fica indisponível com o motivo', () => {
  const d = cenario();
  const p = E.previaMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI', pct: 100 });
  assert.strictEqual(p.aplicavel, false);
  assert.strictEqual(p.semEfeito, true);
  assert.match(p.motivoIndisponivel, /n[aã]o h[áa] substitui[çc][ãa]o a realizar/i);
  assert.throws(() => E.aplicarMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI', pct: 100 }));
});

test('RF-041 — a proporção informada é aplicada uniformemente às estruturas selecionadas', () => {
  const d = cenario();
  const { dados } = E.aplicarMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI-NAC', pct: 60 });
  for (const pos of E.posicoesDoGrupo(dados, 'Embalagem')) {
    if (!pos.temMix) continue;
    const sub = pos.mix.find((m) => m.ref === 'MP-CI-NAC');
    assert.strictEqual(sub.pct, 60);
  }
});

/* ======================================================= Rastreabilidade (RF-036) */

test('RF-036 — diffs listam cada ponto alterado com valor padrão e valor no cenário', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].qtd = 3;   // receita alterada
  d.produtos.find((p) => p.id === 'PA-TESTE').overhead = 5;             // overhead alterado
  d.cambio.USD = 7;                                                      // câmbio alterado
  const lista = E.diffs(d);
  const qtd = lista.find((x) => x.tipo === 'quantidade');
  assert.ok(qtd && qtd.de === '1,0000' && qtd.para === '3,0000');
  assert.strictEqual(qtd.exigeValidacao, true, 'alteração de receita exige validação (RN-11)');
  assert.ok(lista.find((x) => x.tipo === 'overhead' && x.exigeValidacao === true));
  assert.ok(lista.find((x) => x.tipo === 'cambio' && x.exigeValidacao === false));
  assert.strictEqual(E.exigeValidacaoTecnica(d), true);
});

test('RN-11 · RF-038 — cenário sem alteração de receita não exige validação técnica', () => {
  const d = cenario();
  d.cambio.USD = 9;
  assert.strictEqual(E.exigeValidacaoTecnica(d), false);
});

/* =================================================================== Alertas */

test('RF-083 — alerta de mudança de faixa informa a faixa anterior e a nova', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').fciVigente = 0;   // era 100% nacional
  const as = E.alertas(d, 5);
  const faixa = as.find((a) => a.tipo === 'faixa');
  assert.ok(faixa);
  assert.ok(faixa.faixaAnterior && faixa.faixaNova);
  assert.match(faixa.msg, /migra de/);
});

test('RN-08 · RF-084 — reemissão quando a variação supera o gatilho parametrizado', () => {
  const d = cenario();           // CI% ≈ 21,67 e FCI vigente 20 → variação ≈ 1,67 p.p.
  assert.strictEqual(E.alertas(d, 5).filter((a) => a.tipo === 'reemissao').length, 0);
  assert.strictEqual(E.alertas(d, 1).filter((a) => a.tipo === 'reemissao').length, 1,
    'com gatilho de 1 p.p. a reemissão é exigida');
  const a = E.alertas(d, 1).find((x) => x.tipo === 'reemissao');
  assert.strictEqual(a.sev, 'erro');
  assert.match(a.msg, /gatilho parametrizado de 1,0 p\.p\./);
});

test('RF-085 · RF-086 — risco fiscal cita base legal e todo alerta traz a área responsável', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').saidas = [{ uf: 'SP', volume: 100, preco: 20 }];
  const as = E.alertas(d, 5);
  const risco = as.find((a) => a.tipo === 'risco');
  assert.ok(risco, 'CI% acima de 40% gera alerta de risco');
  assert.match(risco.msg, /13\/2012/);
  assert.match(risco.msg, /cr[ée]dito/i);
  assert.ok(as.every((a) => a.area && a.area.length > 0), 'toda ocorrência indica a área de encaminhamento');
});

/* ============================================================== Comparação */

test('RF-073 — a comparação respeita o limite de dez cenários simultâneos', () => {
  assert.strictEqual(E.LIMITE_COMPARACAO, 10);
  const lista = Array.from({ length: 14 }, (_, i) => ({
    id: i + 1, codigo: 'CEN-' + (i + 1), nome: 'C' + i, versao: 1, dados: cenario(),
  }));
  assert.strictEqual(E.matrizComparativa(lista).cenarios.length, 10);
});

test('RF-074 — matriz traz faixa por cor e amplitude da linha em p.p.', () => {
  const a = cenario();
  const b = cenario();
  b.produtos.find((p) => p.id === 'PA-TESTE').saidas = [{ uf: 'SP', volume: 100, preco: 20 }];
  const m = E.matrizComparativa([
    { id: 1, codigo: 'CEN-001', nome: 'Base', versao: 1, dados: a },
    { id: 2, codigo: 'CEN-002', nome: 'Estresse', versao: 1, dados: b },
  ]);
  const linha = m.linhas.find((l) => l.prodId === 'PA-TESTE');
  assert.strictEqual(linha.celulas.length, 2);
  assert.ok(linha.celulas.every((c) => c.faixa && c.faixa.bg && c.faixa.fg));
  assert.ok(Math.abs(linha.amplitudePp - (linha.maiorCi - linha.menorCi)) < 1e-9);
  assert.strictEqual(linha.mudaFaixa, true);
});

test('RF-075 · RF-076 — drill-down expansível e contribuições que somam o CI%', () => {
  const d = cenario();
  const dd = E.drillDown(d, 'PA-TESTE');
  assert.ok(Math.abs(dd.somaContribuicoesPp - dd.ci) < 0.01);
  assert.strictEqual(dd.conferencia, true);
  const pi = dd.niveis.find((x) => x.ref === 'PI-TESTE');
  assert.strictEqual(pi.expansivel, true, 'intermediário é expansível');
  assert.ok(pi.filhos.length >= 1);
  assert.ok(pi.filhos[0].ressalva, 'nível inferior declara a ressalva de base');
  const folha = dd.niveis.find((x) => x.ref === 'MP-CI');
  assert.strictEqual(folha.expansivel, false, 'item sem nível inferior não é expansível');
});

test('RF-077 — série comparativa do produto em foco entre cenários', () => {
  const a = cenario(); const b = cenario();
  b.cambio.USD = 10;
  const s = E.serieComparativa([
    { id: 1, codigo: 'CEN-001', nome: 'Base', versao: 1, dados: a },
    { id: 2, codigo: 'CEN-002', nome: 'Câmbio alto', versao: 1, dados: b },
  ], 'PA-TESTE');
  assert.strictEqual(s.pontos.length, 2);
  assert.ok(s.pontos[1].ci > s.pontos[0].ci, 'câmbio maior eleva o CI%');
  assert.ok(s.amplitudePp > 0);
});

/* ======================================================== Análise assistida */

test('RF-081 — as sete análises padrão estão disponíveis', () => {
  const ids = E.analisesPadrao().map((a) => a.id);
  for (const esperado of ['divergencia', 'impacto', 'risco', 'cambial', 'caminho', 'precoMix', 'recomendacao']) {
    assert.ok(ids.includes(esperado), 'falta a análise ' + esperado);
  }
});

test('RF-080 · RF-082 — resposta cita produtos e valores do contexto e traz a ressalva', () => {
  const d = cenario();
  const ctx = { cenarios: [{ id: 1, codigo: 'CEN-001', nome: 'Base', versao: 1, dados: d }] };
  for (const a of E.analisesPadrao()) {
    const r = E.responderAnalise(ctx, { analise: a.id });
    assert.ok(r.blocos.length >= 1, 'análise ' + a.id + ' sem conteúdo');
    assert.strictEqual(r.ressalva, E.RESSALVA_GERENCIAL);
    assert.ok(r.contexto.cenarios[0].codigo === 'CEN-001');
  }
  const livre = E.responderAnalise(ctx, { pergunta: 'qual o efeito do dólar no resultado?' });
  assert.strictEqual(livre.analise, 'cambial', 'pergunta livre é roteada por palavras-chave');
  assert.ok(livre.blocos.some((b) => b.tipo === 'texto' && /Pergunta analisada/.test(b.texto)));
});

test('RF-081 — caminho para ficar abaixo de 40% devolve as trocas necessárias', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').saidas = [{ uf: 'SP', volume: 100, preco: 20 }];
  const c = E.caminhoAbaixoDe(d, 'PA-TESTE', 40);
  assert.strictEqual(c.jaEnquadrado, false);
  assert.ok(c.passos.length >= 1);
  assert.ok(c.passos[0].impactoPp > 0);
  assert.ok(c.ciFinal < c.ci);
  const ok = E.caminhoAbaixoDe(cenario(), 'PA-TESTE', 40);
  assert.strictEqual(ok.jaEnquadrado, true);
});

/* ============================================================== Relatório */

test('RF-087 · RF-088 — relatório traz identificação completa e blocos por área', () => {
  const d = cenario();
  const rel = E.relatorioExecutivo({
    id: 1, codigo: 'CEN-001', nome: 'Orçamento', versao: 2, ciclo: '2027', tipo: 'orcamento',
    status: 'consolidado', autor_nome: 'Ana', origem_dados: 'ERP Protheus', base_calculo: 'saida',
    criado_em: new Date().toISOString(), dados: d,
  }, { gatilho: 5, st: { mva: 30, aliqInterna: 18, aliqNormal: 12 } });

  for (const campo of ['cenario', 'codigo', 'versao', 'ciclo', 'status', 'autor', 'baseCalculo', 'versaoFormula', 'cambio', 'origemDados']) {
    assert.ok(rel.cabecalho[campo] !== undefined, 'cabeçalho sem ' + campo);
  }
  assert.ok(rel.produtos.length >= 1);
  const p = rel.produtos[0];
  for (const campo of ['ci', 'enquadramento', 'aliquota', 'fciVigente', 'deltaVigente', 'fciObrigatoria', 'exigeReemissao']) {
    assert.ok(p[campo] !== undefined, 'produto sem ' + campo);
  }
  const areas = rel.direcionamentos.map((x) => x.area);
  for (const a of ['Compras', 'Pricing', 'Fiscal/Tributário']) {
    assert.ok(areas.includes(a), 'falta bloco de ' + a);
  }
  assert.strictEqual(rel.ressalva, E.RESSALVA_GERENCIAL);
});

/* ====================================================== Isolamento (RF-007) */

test('RF-007 — operações do motor nunca mutam o cenário de origem', () => {
  const d = cenario();
  const copia = JSON.stringify(d);
  E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-CI-NAC', modo: 'integral' });
  E.normalizarProporcoes(d, 'PA-TESTE', 1);
  E.previaMassa(d, { grupo: 'Embalagem', refSubstituto: 'MP-CI-NAC', pct: 50 });
  E.sensibilidadeUF(d, 'PA-TESTE', 10);
  E.sensibilidadeCambial(d, 'PA-TESTE', 10);
  assert.strictEqual(JSON.stringify(d), copia, 'o cenário de entrada permanece intacto');
});

test('RNF-03 — formatadores produzem números no padrão pt-BR', () => {
  assert.strictEqual(E.num(1234.5, 2), '1.234,50');
  assert.strictEqual(E.pct(45.678), '45,7%');
  assert.strictEqual(E.pp(2.5), '+2,5 p.p.');
  assert.ok(E.brl(1234.5).startsWith('R$'));
});

test('RF-011 · RF-027 · RF-038 — no modo avançado a divergência de receita vira aviso, não erro', () => {
  const d = cenario();
  const pa = d.produtos.find((p) => p.id === 'PA-TESTE');
  pa.obrig = [{ grupo: 'Embalagem', qtd: 12, unidade: 'un', tol: 0 }];
  pa.componentes = [{ ref: 'MP-CI', qtd: 11, qtdPadrao: 12 }];

  // Modo padrão: a receita é protegida — desvio bloqueia (RF-027)
  const padrao = E.diagnostico(d, { modo: 'padrao' });
  assert.ok(padrao.erros.some((v) => v.tipo === 'quantidade'));
  assert.strictEqual(padrao.bloqueado, true);

  // Modo avançado: a alteração é deliberada e autorizada; o desvio passa a
  // aviso porque a governança dele é a validação técnica (RF-038 · RN-11)
  const avancado = E.diagnostico(d, { modo: 'avancado' });
  assert.ok(avancado.avisos.some((v) => v.tipo === 'quantidade'));
  assert.strictEqual(avancado.erros.filter((v) => v.tipo === 'quantidade').length, 0);
  assert.match(avancado.avisos.find((v) => v.tipo === 'quantidade').msg, /valida[çc][ãa]o t[ée]cnica/i);
  assert.strictEqual(avancado.bloqueado, false, 'cenário avançado pode seguir para a validação técnica');
});

test('RF-026 — ausência de grupo obrigatório bloqueia em qualquer modo', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').componentes.splice(1, 1);
  for (const modo of ['padrao', 'avancado']) {
    const diag = E.diagnostico(d, { modo });
    assert.ok(diag.erros.some((v) => v.tipo === 'obrigatorio'),
      `estrutura incompleta deve bloquear também no modo ${modo}`);
  }
});

test('RF-025 — quantidade zero ou negativa bloqueia mesmo no modo avançado', () => {
  const d = cenario();
  d.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].qtd = 0;
  const diag = E.diagnostico(d, { modo: 'avancado' });
  assert.ok(diag.erros.some((v) => v.tipo === 'quantidade_invalida'));
  assert.strictEqual(diag.bloqueado, true);
});

/* ------------------------- grupo obrigatório × proporção do mix (RF-026/027) */

test('RF-026 — substituição integral por outro grupo não mascara o grupo obrigatório ausente', () => {
  const d = cenario();
  // MP-CI (grupo «Embalagem», obrigatório 1 un) é trocado integralmente por
  // MP-NAC (grupo «Grao»). A substituição integral preserva o original no mix
  // com pct 0 (RF-016 · RF-019) — esse resíduo não pode valer como presença.
  const sub = E.aplicarSubstituicao(d, 'PA-TESTE', 1, { refSubstituto: 'MP-NAC', modo: 'integral' });
  const mix = sub.produtos.find((p) => p.id === 'PA-TESTE').componentes[1].mix;
  assert.strictEqual(mix.find((m) => m.ref === 'MP-CI').pct, 0, 'o original permanece no mix em 0%');

  for (const modo of ['padrao', 'avancado']) {
    const diag = E.diagnostico(sub, { modo });
    const ausente = diag.erros.find((v) => v.tipo === 'obrigatorio' && /Embalagem/.test(v.msg));
    assert.ok(ausente, `grupo obrigatório sem nenhuma proporção efetiva deve acusar ausência (modo ${modo})`);
    assert.strictEqual(diag.bloqueado, true, `estrutura incompleta nunca é consolidável (modo ${modo})`);
  }
});

test('RF-027 — a quantidade do grupo é ponderada pela proporção de cada alternativa', () => {
  const d = cenario();
  const pa = d.produtos.find((p) => p.id === 'PA-TESTE');
  // Além da embalagem, o PA passa a exigir 1 kg do grupo «Grao» por uma posição
  // própria, para conferir os dois lados da troca na mesma validação.
  // Os dois grupos são medidos na MESMA unidade, para isolar a ponderação pela
  // proporção da conferência de unidade (coberta no teste seguinte).
  d.insumos.find((i) => i.id === 'MP-NAC').unidade = 'un';
  pa.obrig = [
    { grupo: 'Embalagem', qtd: 1, unidade: 'un', tol: 0 },
    { grupo: 'Grao', qtd: 1, unidade: 'un', tol: 0 },
  ];
  pa.componentes = [
    { ref: 'MP-CI', qtd: 1, qtdPadrao: 1, unidade: 'un' },
    { ref: 'MP-NAC', qtd: 1, qtdPadrao: 1, unidade: 'un' },
  ];
  // 50% da posição da embalagem passa para a alternativa do mesmo grupo:
  // Embalagem continua somando 1 un (0,5 + 0,5) e não deve acusar nada.
  const mesmoGrupo = E.aplicarSubstituicao(d, 'PA-TESTE', 0, { refSubstituto: 'MP-CI-NAC', modo: 'parcial', pct: 50 });
  const semAchado = E.validar(mesmoGrupo).filter((v) => v.tipo === 'quantidade' && /Embalagem/.test(v.msg));
  assert.strictEqual(semAchado.length, 0, 'troca dentro do mesmo grupo preserva a quantidade do grupo');

  // 50% da posição da embalagem passa para MP-NAC, de OUTRO grupo:
  // Embalagem cai a 0,5 un (erro) e Grao sobe a 1,5 kg (erro, com o número real).
  const outroGrupo = E.aplicarSubstituicao(d, 'PA-TESTE', 0, { refSubstituto: 'MP-NAC', modo: 'parcial', pct: 50 });
  const achados = E.validar(outroGrupo).filter((v) => v.tipo === 'quantidade');

  const emb = achados.find((v) => /Embalagem/.test(v.msg));
  assert.ok(emb, 'o grupo que cedeu proporção precisa ser conferido');
  assert.match(emb.msg, /abaixo/);
  assert.match(emb.msg, /informado 0,500/);

  const grao = achados.find((v) => /Grao/.test(v.msg));
  assert.ok(grao, 'o grupo que recebeu proporção precisa ser conferido');
  assert.match(grao.msg, /acima/);
  assert.match(grao.msg, /informado 1,500/, 'a quantidade informada é a real, não a da posição inteira');
});

test('RF-026 · RF-027 — quantidades de unidades distintas não são somadas no mesmo grupo', () => {
  const d = cenario();
  const pa = d.produtos.find((p) => p.id === 'PA-TESTE');
  pa.obrig = [{ grupo: 'Grao', qtd: 1, unidade: 'kg', tol: 0 }];
  pa.componentes = [
    { ref: 'MP-NAC', qtd: 1, qtdPadrao: 1, unidade: 'kg' },
    { ref: 'MP-IMP', qtd: 3, qtdPadrao: 3, unidade: 'un' },   // mesmo grupo, outra unidade
  ];
  const itens = E.validar(d);
  const unidade = itens.find((v) => v.tipo === 'unidade');
  assert.ok(unidade, 'a incompatibilidade de unidade é declarada');
  assert.match(unidade.msg, /kg/);
  assert.match(unidade.msg, /unidades incompat/i);
  // a posição em «un» não entra na soma: o grupo fecha 1 kg e não acusa quantidade
  assert.strictEqual(itens.filter((v) => v.tipo === 'quantidade' && /Grao/.test(v.msg)).length, 0);
});

test('RF-026 — grupo obrigatório com quantidade zero não acusa ausência', () => {
  // A receita carregada do ERP deriva os grupos obrigatórios somando as
  // quantidades; uma linha zerada produziria um grupo exigido em 0. Acusar
  // ausência nesse caso seria falso positivo — não há nada a exigir.
  const d = cenario();
  const pa = d.produtos.find((p) => p.id === 'PA-TESTE');
  pa.obrig = [{ grupo: 'Embalagem', qtd: 0, unidade: 'un', tol: 0 }];
  pa.componentes = [{ ref: 'MP-CI', qtd: 0, qtdPadrao: 0, unidade: 'un' }];
  const itens = E.validar(d);
  assert.strictEqual(itens.filter((v) => v.tipo === 'obrigatorio').length, 0);

  // mas a ausência real — quantidade exigida maior que zero — segue bloqueando
  pa.obrig = [{ grupo: 'Embalagem', qtd: 1, unidade: 'un', tol: 0 }];
  pa.componentes = [{ ref: 'MP-NAC', qtd: 1, qtdPadrao: 1, unidade: 'kg' }];
  const comFalta = E.validar(d).filter((v) => v.tipo === 'obrigatorio');
  assert.strictEqual(comFalta.length, 1);
  assert.match(comFalta[0].msg, /Embalagem/);
});
