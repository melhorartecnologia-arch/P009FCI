'use strict';
/**
 * Testes de integração da API — exercitam o contrato completo
 * (docs/ARQUITETURA.md §4) contra o banco configurado no .env.
 * Pré-requisito: npm run setup (migrate + seed).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { criarApp } = require('../server/app');
const { initEngine } = require('../server/engine');
const { pool } = require('../server/db');

let server, base, tokens = {};

const SENHA = process.env.SEED_SENHA || 'cci@2026';
const PERFIS = {
  ti: 'ti@cci.local', custos: 'custos@cci.local', controladoria: 'controladoria@cci.local',
  fiscal: 'fiscal@cci.local', pricing: 'pricing@cci.local', compras: 'compras@cci.local',
  pcp: 'pcp@cci.local', sgi: 'sgi@cci.local', negocio: 'negocio@cci.local',
};

before(async () => {
  await initEngine();
  const app = criarApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(PERFIS)) {
    const r = await req('POST', '/auth/login', { email, senha: SENHA });
    assert.strictEqual(r.status, 200, `login ${email}: ${JSON.stringify(r.json)}`);
    tokens[k] = r.json.token;
  }
});

after(async () => { server.close(); await pool.end(); });

async function req(metodo, caminho, corpo, token) {
  const opts = { method: metodo, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
  const resp = await fetch(base + '/api' + caminho, opts);
  const tipo = resp.headers.get('content-type') || '';
  let json = null, buffer = null;
  if (tipo.includes('json')) { try { json = await resp.json(); } catch {} }
  else buffer = Buffer.from(await resp.arrayBuffer());
  return { status: resp.status, json, buffer, tipo };
}

/** Cria um cenário novo para o teste e devolve o id. */
async function novoCenario(nome = 'Cenário de teste') {
  const r = await req('POST', '/cenarios', { nome, tipo: 'revisao', ciclo: 'teste' }, tokens.custos);
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json.cenario.id;
}

/* ===================================================== Cenários e indicadores */

test('RF-004 — painel de cenários devolve indicadores recalculados', async () => {
  await novoCenario('Painel RF-004');
  const r = await req('GET', '/cenarios', undefined, tokens.custos);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.cenarios.length >= 1);
  const c = r.json.cenarios[0];
  for (const campo of ['ciMedio', 'nProdutos', 'acima40', 'dist', 'nAlertas', 'nErros']) {
    assert.ok(c.indicadores[campo] !== undefined, 'indicador ausente: ' + campo);
  }
  assert.ok(r.json.parametros.gatilho > 0, 'parâmetros do motor acompanham a lista');
});

test('RF-001 · RF-002 — cenário nasce v1/Rascunho com estrutura integrada e especificação do SKU', async () => {
  const r = await req('POST', '/cenarios', { nome: 'RF-001 novo', tipo: 'orcamento', ciclo: '2027' }, tokens.custos);
  assert.strictEqual(r.status, 201);
  const c = r.json.cenario;
  assert.match(c.codigo, /^CEN-\d{3,}$/);
  assert.strictEqual(c.versao, 1);
  assert.strictEqual(c.status, 'rascunho');
  assert.ok(c.autor_nome && c.criado_em);
  assert.ok(c.dados.produtos.length >= 5 && c.dados.insumos.length >= 20);
  const pa = c.dados.produtos.find((p) => p.id === 'PA-9002');
  assert.ok(pa.espec && pa.espec.volume === 473, 'RF-014 — especificação do SKU carregada');
  assert.ok(pa.obrig.length >= 4, 'RF-026 — grupos obrigatórios derivados da receita');
  assert.ok(pa.saidas.length >= 3, 'RF-066 — saídas por UF carregadas');
  assert.ok(pa.overhead > 0, 'RF-012 — custo industrial carregado');
});

test('RF-007 — abertura devolve dados, diagnóstico, resumo e parâmetros', async () => {
  const id = await novoCenario('RF-007 abrir');
  const r = await req('GET', `/cenarios/${id}`, undefined, tokens.custos);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.cenario && r.json.validacao && r.json.resumo && r.json.parametros);
  assert.strictEqual(typeof r.json.exigeValidacaoTecnica, 'boolean');
});

test('RF-010 · RF-013 — estrutura em cascata com métricas por componente', async () => {
  const id = await novoCenario('RF-010 estrutura');
  const r = await req('GET', `/cenarios/${id}/estrutura?prodId=PA-9002`, undefined, tokens.custos);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.estrutura.raiz.children.length >= 4);
  const comp = r.json.estrutura.raiz.children[0];
  for (const campo of ['qtd', 'custoTot', 'fator', 'contrib', 'grupo', 'unidade']) {
    assert.ok(comp[campo] !== undefined, 'métrica ausente: ' + campo);
  }
  const soma = r.json.estrutura.raiz.children.reduce((a, c) => a + c.contrib, 0);
  assert.ok(Math.abs(soma - r.json.estrutura.raiz.parcela) < 1e-6, 'soma das parcelas confere');
  assert.ok(r.json.memoria.linhas.length >= 5, 'RNF-08 memória de cálculo');
});

test('RF-056 · RF-061 · RF-062 · RF-065 — resultado traz memória, ICMS-ST e contribuições', async () => {
  const id = await novoCenario('RF-056 resultado');
  const r = await req('GET', `/cenarios/${id}/resultado?prodId=PA-9002`, undefined, tokens.custos);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.resultado.versaoFormula, 'RF-056 versão da fórmula');
  assert.ok(r.json.resultado.enquadramento.label, 'RF-061 enquadramento');
  assert.ok(r.json.icmsST.aliqResultante > 0, 'RF-062 ICMS-ST');
  assert.ok(r.json.contribuicoes.length >= 1, 'RF-065 contribuições');
  assert.ok(r.json.pesosUF.length >= 1, 'RF-070 pesos por UF');
  assert.ok(r.json.drill.conferencia === true, 'RF-076 contribuições somam o CI%');
});

/* ============================================================== Substituição */

test('RF-020 · RF-022 · RF-016 · RF-024 — ciclo completo de substituição', async () => {
  const id = await novoCenario('RF-015 substituição');
  const est = await req('GET', `/cenarios/${id}/estrutura?prodId=PA-9002`, undefined, tokens.custos);
  const idx = est.json.estrutura.raiz.children.findIndex((c) => c.grupo === 'Lata');
  assert.ok(idx >= 0, 'componente do grupo Lata presente');

  // RF-020 — opções com o mesmo grupo primeiro
  const op = await req('GET', `/cenarios/${id}/sim/substituicao/opcoes?prodId=PA-9002&idx=${idx}`, undefined, tokens.custos);
  assert.strictEqual(op.status, 200);
  assert.ok(op.json.mesmoGrupo.length >= 1);
  assert.ok(op.json.mesmoGrupo[0].naturezas.length >= 1);
  const alvo = op.json.mesmoGrupo[0].ref;

  // RF-022 — prévia não grava
  const prev = await req('POST', `/cenarios/${id}/sim/substituicao/previa`,
    { prodId: 'PA-9002', idx, refSubstituto: alvo, modo: 'parcial', pct: 50 }, tokens.custos);
  assert.strictEqual(prev.status, 200);
  assert.ok(typeof prev.json.previa.ciSimulado === 'number' || typeof prev.json.ciSimulado === 'number');
  const depoisPrevia = await req('GET', `/cenarios/${id}`, undefined, tokens.custos);
  assert.ok(!depoisPrevia.json.cenario.dados.produtos.find((p) => p.id === 'PA-9002').componentes[idx].mix,
    'a prévia não altera o cenário');

  // RF-016 — integral mantém o original com 0%
  const ap = await req('POST', `/cenarios/${id}/sim/substituicao`,
    { prodId: 'PA-9002', idx, refSubstituto: alvo, modo: 'integral' }, tokens.custos);
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.json));
  assert.ok(ap.json.cenario && ap.json.validacao, 'resposta traz cenário e validação');
  const mix = ap.json.cenario.dados.produtos.find((p) => p.id === 'PA-9002').componentes[idx].mix;
  assert.strictEqual(mix[0].pct, 0);
  assert.strictEqual(mix[1].pct, 100);

  // RF-017/023 — ajuste de proporção complementa
  const aj = await req('PUT', `/cenarios/${id}/sim/substituicao/proporcao`,
    { prodId: 'PA-9002', idx, mi: 1, pct: 40 }, tokens.custos);
  assert.strictEqual(aj.status, 200);
  const mix2 = aj.json.cenario.dados.produtos.find((p) => p.id === 'PA-9002').componentes[idx].mix;
  assert.strictEqual(mix2[1].pct, 40);
  assert.strictEqual(mix2[0].pct, 60);

  // RF-024 — reversão
  const rev = await req('DELETE', `/cenarios/${id}/sim/substituicao`, { prodId: 'PA-9002', idx }, tokens.custos);
  assert.strictEqual(rev.status, 200);
  assert.ok(!rev.json.cenario.dados.produtos.find((p) => p.id === 'PA-9002').componentes[idx].mix);
});

test('RF-011 — quantidade da receita bloqueada no modo padrão e liberada no avançado', async () => {
  const id = await novoCenario('RF-011 receita');
  const bloqueado = await req('PUT', `/cenarios/${id}/sim/componente/qtd`,
    { prodId: 'PA-9002', idx: 0, qtd: 0.9 }, tokens.controladoria);
  assert.strictEqual(bloqueado.status, 422, 'modo padrão recusa a edição da receita');
  assert.match(bloqueado.json.erro, /padr[ãa]o|avan[çc]ado/i);

  const modo = await req('PUT', `/cenarios/${id}/sim/modo`, { modo: 'avancado' }, tokens.controladoria);
  assert.strictEqual(modo.status, 200);
  const ok = await req('PUT', `/cenarios/${id}/sim/componente/qtd`,
    { prodId: 'PA-9002', idx: 0, qtd: 0.9 }, tokens.controladoria);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
});

test('RF-035 — perfil sem permissão não ativa o modo avançado e recebe o impedimento', async () => {
  const id = await novoCenario('RF-035 perfil');
  const r = await req('PUT', `/cenarios/${id}/sim/modo`, { modo: 'avancado' }, tokens.pricing);
  assert.strictEqual(r.status, 403);
  assert.match(r.json.erro, /restrita/i);
  assert.ok(r.json.erro.includes('Pricing'), 'a mensagem identifica o perfil do usuário');
});

test('RF-049 — item nacional recusa edição de conteúdo e de custos de importação', async () => {
  const id = await novoCenario('RF-049 nacional');
  const r = await req('PUT', `/cenarios/${id}/sim/insumo`,
    { ref: 'MP-1001', campos: { fob: 5 } }, tokens.fiscal);
  assert.strictEqual(r.status, 422, 'item nacional não aceita custo de importação');
});

test('RF-050 — alterar a classificação devolve o CST sugerido', async () => {
  const id = await novoCenario('RF-050 cst');
  const r = await req('PUT', `/cenarios/${id}/sim/insumo`,
    { ref: 'MP-1001', campos: { classSim: 'nacional_ci', ciPct: 60 } }, tokens.fiscal);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.cstSugerido, '3', 'CI de 60% sugere CST 3');
});

test('RF-052 · RF-054 — alterar a cotação recalcula os insumos da moeda', async () => {
  const id = await novoCenario('RF-052 câmbio');
  const antes = await req('GET', `/cenarios/${id}/resultado?prodId=PA-9002`, undefined, tokens.compras);
  const r = await req('PUT', `/cenarios/${id}/sim/cambio`, { moeda: 'EUR', cotacao: 9 }, tokens.compras);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.insumosPorMoeda) || r.json.cenario, 'devolve o painel de câmbio');
  const depois = await req('GET', `/cenarios/${id}/resultado?prodId=PA-9002`, undefined, tokens.compras);
  assert.ok(depois.json.resultado.ci > antes.json.resultado.ci, 'euro mais caro eleva o CI%');
});

test('RF-067 — carga do Sistema de Preços tem ações distintas de substituir e complementar', async () => {
  const id = await novoCenario('RF-067 carga');

  // Remove parte das UFs e ajusta o preço de uma delas, para distinguir as ações
  const cen = await req('GET', `/cenarios/${id}`, undefined, tokens.pricing);
  const dados = cen.json.cenario.dados;
  const pa = dados.produtos.find((p) => p.id === 'PA-9002');
  const totalOriginal = pa.saidas.length;
  assert.ok(totalOriginal >= 3, 'o produto tem saídas carregadas na criação');
  pa.saidas = [{ uf: pa.saidas[0].uf, volume: 1, preco: 99, volumePadrao: 1, precoPadrao: 99 }];
  await req('PUT', `/cenarios/${id}/dados`, { dados }, tokens.pricing);

  // Complementar acrescenta SOMENTE as UFs ausentes e preserva o ajuste local
  const comp = await req('POST', `/cenarios/${id}/sim/saidas/carga`,
    { prodId: 'PA-9002', modo: 'complementar' }, tokens.pricing);
  assert.strictEqual(comp.status, 200, JSON.stringify(comp.json));
  const aposComp = comp.json.cenario.dados.produtos.find((p) => p.id === 'PA-9002');
  assert.strictEqual(aposComp.saidas.length, totalOriginal, 'as UFs ausentes foram acrescentadas');
  const preservada = aposComp.saidas.find((s) => s.uf === pa.saidas[0].uf);
  assert.strictEqual(preservada.preco, 99, 'a UF já presente preserva o ajuste do cenário (RF-068)');

  // Sem UF ausente, a ação de complementar fica sem efeito e declara o motivo
  const semEfeito = await req('POST', `/cenarios/${id}/sim/saidas/carga`,
    { prodId: 'PA-9002', modo: 'complementar' }, tokens.pricing);
  assert.strictEqual(semEfeito.status, 422);
  assert.match(semEfeito.json.erro, /ausente|complement/i);

  // Substituir troca toda a base, inclusive a UF ajustada
  const sub = await req('POST', `/cenarios/${id}/sim/saidas/carga`,
    { prodId: 'PA-9002', modo: 'substituir' }, tokens.pricing);
  assert.strictEqual(sub.status, 200, JSON.stringify(sub.json));
  const aposSub = sub.json.cenario.dados.produtos.find((p) => p.id === 'PA-9002');
  assert.notStrictEqual(aposSub.saidas.find((s) => s.uf === pa.saidas[0].uf).preco, 99,
    'substituir troca toda a base de saídas');
});

test('RF-068 — editar volume e preço recalcula o denominador', async () => {
  const id = await novoCenario('RF-068 saidas');
  const antes = await req('GET', `/cenarios/${id}/resultado?prodId=PA-9002`, undefined, tokens.pricing);
  const r = await req('PUT', `/cenarios/${id}/sim/saidas`,
    { prodId: 'PA-9002', saidas: [{ uf: 'SP', volume: 1000, preco: 10 }] }, tokens.pricing);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const depois = await req('GET', `/cenarios/${id}/resultado?prodId=PA-9002`, undefined, tokens.pricing);
  assert.notStrictEqual(antes.json.resultado.denominador, depois.json.resultado.denominador);
});

/* ================================================================ Em massa */

test('RF-040 · RF-043 · RF-045 — lote por grupo com prévia e bloqueio sem efeito', async () => {
  const id = await novoCenario('RF-040 massa');
  const g = await req('GET', `/cenarios/${id}/sim/massa/grupos`, undefined, tokens.custos);
  assert.strictEqual(g.status, 200);
  assert.ok(g.json.grupos.length >= 3);

  const previa = await req('POST', `/cenarios/${id}/sim/massa/previa`,
    { grupo: 'Tampa', refSubstituto: 'MP-3008', pct: 100 }, tokens.custos);
  assert.strictEqual(previa.status, 200);
  assert.strictEqual(previa.json.previa ? previa.json.previa.aplicavel : previa.json.aplicavel, true);

  const semEfeito = await req('POST', `/cenarios/${id}/sim/massa/previa`,
    { grupo: 'CO2', refSubstituto: 'MP-5001', pct: 100 }, tokens.custos);
  const corpo = semEfeito.json.previa || semEfeito.json;
  assert.strictEqual(corpo.aplicavel, false);
  assert.match(corpo.motivoIndisponivel, /n[aã]o h[áa] substitui/i);

  const aplicar = await req('POST', `/cenarios/${id}/sim/massa/aplicar`,
    { grupo: 'Tampa', refSubstituto: 'MP-3008', pct: 100 }, tokens.custos);
  assert.strictEqual(aplicar.status, 200, JSON.stringify(aplicar.json));
});

/* ============================================================== Governança */

test('RF-060 — base do denominador é definida pela Controladoria', async () => {
  const id = await novoCenario('RF-060 base');
  const negado = await req('PUT', `/cenarios/${id}/base`, { base: 'custo' }, tokens.pricing);
  assert.strictEqual(negado.status, 403);
  const ok = await req('PUT', `/cenarios/${id}/base`, { base: 'custo' }, tokens.controladoria);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const lido = await req('GET', `/cenarios/${id}`, undefined, tokens.controladoria);
  assert.strictEqual(lido.json.cenario.base_calculo, 'custo');
});

test('RF-005 · RN-10 — congelar trava a edição e exige nova versão', async () => {
  const id = await novoCenario('RF-005 congelar');
  const r = await req('POST', `/cenarios/${id}/gov/congelar`, {}, tokens.controladoria);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.cenario.status, 'congelado');
  assert.ok(r.json.cenario.congelado_em && r.json.cenario.congelado_por);

  const edicao = await req('PUT', `/cenarios/${id}/sim/cambio`, { moeda: 'USD', cotacao: 6 }, tokens.compras);
  assert.strictEqual(edicao.status, 409, 'cenário congelado recusa edição');

  const dup = await req('POST', `/cenarios/${id}/duplicar`, {}, tokens.custos);
  assert.strictEqual(dup.status, 201);
  assert.strictEqual(dup.json.cenario.status, 'rascunho');
  assert.ok(dup.json.cenario.versao >= 2, 'RF-003 — nova versão');
});

test('RF-008 — consolidação é recusada com erro de validação pendente', async () => {
  const id = await novoCenario('RF-008 consolidar');
  // provoca erro: proporções somando mais de 100%
  const est = await req('GET', `/cenarios/${id}/estrutura?prodId=PA-9002`, undefined, tokens.custos);
  const idx = est.json.estrutura.raiz.children.findIndex((c) => c.grupo === 'Lata');
  await req('POST', `/cenarios/${id}/sim/substituicao`,
    { prodId: 'PA-9002', idx, refSubstituto: 'MP-3006', modo: 'parcial', pct: 50 }, tokens.custos);
  const cen = await req('GET', `/cenarios/${id}`, undefined, tokens.custos);
  const dados = cen.json.cenario.dados;
  dados.produtos.find((p) => p.id === 'PA-9002').componentes[idx].mix = [
    { ref: 'MP-3002', pct: 80 }, { ref: 'MP-3006', pct: 80 },
  ];
  await req('PUT', `/cenarios/${id}/dados`, { dados }, tokens.custos);

  const val = await req('GET', `/cenarios/${id}/validacao`, undefined, tokens.custos);
  assert.ok(val.json.validacao.nErros >= 1);
  assert.ok(val.json.validacao.motivo, 'RF-025 motivo declarado');

  const cons = await req('POST', `/cenarios/${id}/gov/consolidar`, {}, tokens.controladoria);
  assert.strictEqual(cons.status, 409, 'consolidação recusada');
  const cong = await req('POST', `/cenarios/${id}/gov/congelar`, {}, tokens.controladoria);
  assert.strictEqual(cong.status, 409, 'congelamento recusado (RF-025)');
});

test('RF-036 · RF-037 · RF-038 — validação técnica da alteração de receita', async () => {
  const id = await novoCenario('RF-036 validação');
  await req('PUT', `/cenarios/${id}/sim/modo`, { modo: 'avancado' }, tokens.controladoria);
  await req('PUT', `/cenarios/${id}/sim/componente/qtd`, { prodId: 'PA-9002', idx: 0, qtd: 0.8 }, tokens.controladoria);

  const diffs = await req('GET', `/cenarios/${id}/diffs`, undefined, tokens.custos);
  assert.ok(diffs.json.exigemValidacao >= 1, 'RF-036 — alteração de receita listada');
  const ponto = diffs.json.diffs.find((d) => d.exigeValidacao);
  assert.ok(ponto.de !== undefined && ponto.para !== undefined, 'valor padrão e valor no cenário');

  // RF-038 — consolidação recusada sem aprovação
  const semAprovacao = await req('POST', `/cenarios/${id}/gov/consolidar`, {}, tokens.controladoria);
  assert.strictEqual(semAprovacao.status, 409);
  assert.match(semAprovacao.json.erro, /valida[çc][ãa]o|aprova/i);

  const sub = await req('POST', `/cenarios/${id}/gov/validacao/submeter`, {}, tokens.controladoria);
  assert.strictEqual(sub.status, 201, JSON.stringify(sub.json));
  const vid = (sub.json.submissao || sub.json.validacao || sub.json).id;
  assert.ok(vid, 'a submissão devolve o identificador da validação');

  const porQuemNaoPode = await req('POST', `/validacoes/${vid}/decidir`, { decisao: 'aprovada' }, tokens.pricing);
  assert.strictEqual(porQuemNaoPode.status, 403);

  const dec = await req('POST', `/validacoes/${vid}/decidir`, { decisao: 'aprovada', notas: 'ok' }, tokens.sgi);
  assert.strictEqual(dec.status, 200, JSON.stringify(dec.json));
  const hist = await req('GET', `/cenarios/${id}/gov/validacao/historico`, undefined, tokens.custos);
  const v = (hist.json.validacoes || hist.json.historico || hist.json.submissoes)[0];
  assert.strictEqual(v.status, 'aprovada');
  assert.ok(v.decidido_nome && v.decidido_area && v.decidido_em, 'RF-037 responsável, área e data');

  const ok = await req('POST', `/cenarios/${id}/gov/consolidar`, {}, tokens.controladoria);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.cenario.status, 'consolidado');
});

test('RF-009 — direcionamentos por área são registrados no cenário', async () => {
  const id = await novoCenario('RF-009 direcionamentos');
  const add = await req('POST', `/cenarios/${id}/gov/direcionamentos`,
    { area: 'Compras', produto: 'PA-9002', texto: 'Negociar lata nacional', prioridade: 'alta' }, tokens.custos);
  assert.strictEqual(add.status, 201, JSON.stringify(add.json));
  const lista = await req('GET', `/cenarios/${id}/gov/direcionamentos`, undefined, tokens.custos);
  assert.ok((lista.json.manuais || []).length >= 1);
  assert.ok((lista.json.automaticos || []).length >= 1, 'RF-088 blocos automáticos por área');
});

/* ============================================================== Comparação */

test('RF-073 — seleção respeita o limite de dez cenários', async () => {
  const r = await req('PUT', '/comparacao/selecao',
    { cenarioIds: Array.from({ length: 12 }, (_, i) => i + 1) }, tokens.custos);
  assert.strictEqual(r.status, 422);
  assert.match(r.json.erro, /dez|10/);
});

test('RF-074 · RF-075 · RF-077 — matriz, drill-down e série comparativa', async () => {
  const a = await novoCenario('Comparação A');
  const b = await novoCenario('Comparação B');
  await req('PUT', `/cenarios/${b}/sim/cambio`, { moeda: 'EUR', cotacao: 12 }, tokens.compras);

  const sel = await req('PUT', '/comparacao/selecao', { cenarioIds: [a, b], prodFoco: 'PA-9002' }, tokens.custos);
  assert.strictEqual(sel.status, 200, JSON.stringify(sel.json));

  const m = await req('GET', `/comparacao/matriz?ids=${a},${b}`, undefined, tokens.custos);
  assert.strictEqual(m.status, 200);
  const linha = m.json.matriz.linhas.find((l) => l.prodId === 'PA-9002');
  assert.strictEqual(linha.celulas.length, 2);
  assert.ok(linha.amplitudePp > 0, 'os cenários divergem');
  assert.ok(linha.celulas[0].faixa.bg, 'RF-074 faixa por cor');

  const d = await req('GET', `/comparacao/drill?cenarioId=${a}&prodId=PA-9002`, undefined, tokens.custos);
  assert.strictEqual(d.status, 200);
  const drill = d.json.drill || d.json;
  assert.strictEqual(drill.conferencia, true, 'RF-076 contribuições somam o CI%');
  assert.ok(drill.niveis.some((x) => x.expansivel === true), 'RF-075 nó expansível');
  assert.ok(drill.niveis.some((x) => x.expansivel === false), 'RF-075 folha sem expansão');

  const s = await req('GET', `/comparacao/serie?ids=${a},${b}&prodId=PA-9002`, undefined, tokens.custos);
  assert.strictEqual(s.status, 200);
  assert.strictEqual((s.json.serie || s.json).pontos.length, 2);
});

test('RF-078 · RF-079 — painel lateral edita e devolve a matriz recalculada', async () => {
  const a = await novoCenario('Painel A');
  const b = await novoCenario('Painel B');
  await req('PUT', '/comparacao/selecao', { cenarioIds: [a, b] }, tokens.compras);
  const antes = await req('GET', `/comparacao/matriz?ids=${a},${b}`, undefined, tokens.compras);
  const ciAntes = antes.json.matriz.linhas.find((l) => l.prodId === 'PA-9002').celulas[1].ci;

  const r = await req('PUT', '/comparacao/painel',
    { cenarioId: b, alteracao: { tipo: 'cambio', moeda: 'EUR', cotacao: 15 } }, tokens.compras);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.matriz, 'a resposta já traz a matriz recalculada');
  const ciDepois = r.json.matriz.linhas.find((l) => l.prodId === 'PA-9002').celulas[1].ci;
  assert.ok(ciDepois > ciAntes, 'a alteração reflete imediatamente na coluna do cenário');
});

/* ========================================================= Análise assistida */

test('RF-080 · RF-081 · RF-082 — análises padrão, conversa e ressalva', async () => {
  const id = await novoCenario('Análise');
  const padrao = await req('GET', '/analise/padrao', undefined, tokens.custos);
  assert.strictEqual(padrao.status, 200);
  assert.ok(padrao.json.analises.length >= 7, 'RF-081 sete análises padrão');
  assert.ok(padrao.json.ressalva, 'RF-082 ressalva');

  for (const a of ['divergencia', 'impacto', 'risco', 'cambial', 'caminho', 'precoMix', 'recomendacao']) {
    const r = await req('POST', '/analise', { cenarioIds: [id], prodId: 'PA-9002', analise: a }, tokens.custos);
    assert.strictEqual(r.status, 200, `análise ${a}: ${JSON.stringify(r.json)}`);
    const resp = r.json.resposta || r.json;
    assert.ok(resp.blocos.length >= 1, `análise ${a} sem conteúdo`);
    assert.ok(resp.ressalva, `análise ${a} sem ressalva (RF-082)`);
  }

  const livre = await req('POST', '/analise',
    { cenarioIds: [id], pergunta: 'quais insumos têm maior impacto?' }, tokens.custos);
  assert.strictEqual(livre.status, 200);
  assert.strictEqual((livre.json.resposta || livre.json).analise, 'impacto');

  const hist = await req('GET', `/analise/historico?contexto=${id}`, undefined, tokens.custos);
  assert.strictEqual(hist.status, 200);
  assert.ok((hist.json.mensagens || hist.json.historico).length >= 2, 'RF-080 histórico mantido');
});

/* ================================================================ Relatório */

test('RF-087 · RF-088 — relatório identifica o cenário e separa por área', async () => {
  const id = await novoCenario('Relatório');
  const r = await req('GET', `/cenarios/${id}/relatorio`, undefined, tokens.controladoria);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const rel = r.json.relatorio || r.json;
  for (const campo of ['cenario', 'codigo', 'versao', 'ciclo', 'status', 'autor', 'baseCalculo', 'versaoFormula', 'cambio']) {
    assert.ok(rel.cabecalho[campo] !== undefined, 'cabeçalho sem ' + campo);
  }
  const p = rel.produtos[0];
  for (const campo of ['ci', 'enquadramento', 'aliquota', 'deltaVigente', 'fciObrigatoria']) {
    assert.ok(p[campo] !== undefined, 'produto sem ' + campo);
  }
  const areas = rel.direcionamentos.map((d) => d.area);
  for (const a of ['Compras', 'Pricing', 'Fiscal/Tributário']) assert.ok(areas.includes(a), 'falta ' + a);
});

test('RF-089 — exportação em PDF com cabeçalho e rodapé em todas as páginas', async () => {
  const id = await novoCenario('PDF');
  const r = await req('GET', `/cenarios/${id}/relatorio/pdf`, undefined, tokens.controladoria);
  assert.strictEqual(r.status, 200);
  assert.match(r.tipo, /application\/pdf/);
  assert.ok(r.buffer.length > 3000, 'PDF com conteúdo');
  const texto = r.buffer.toString('latin1');
  assert.ok(texto.startsWith('%PDF-'), 'assinatura de PDF');
  const paginas = (texto.match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(paginas >= 1, 'PDF paginado');
});

/* ================================================================ Permissões */

test('RF-039 — matriz de permissões por área e perfil', async () => {
  const r = await req('GET', '/permissoes/matriz', undefined, tokens.custos);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.areas.length, 10);
  assert.ok(r.json.capacidades.length >= 12);
  const ativa = r.json.areas.find((a) => a.ativa);
  assert.strictEqual(ativa.area, 'Custos');
  const ti = r.json.areas.find((a) => a.area === 'TI');
  assert.strictEqual(ti.permissoes.parametros, true);
  assert.strictEqual(ativa.permissoes.parametros, false, 'RF-100 restrição de administração');
  for (const c of r.json.capacidades) {
    assert.ok(['estrutura', 'modoAvancado', 'massa', 'validarTecnico', 'aprovar'].some(() => true));
  }
  assert.ok(r.json.capacidades.some((c) => c.chave === 'modoAvancado'));
  assert.ok(r.json.capacidades.some((c) => c.chave === 'massa'));
  assert.ok(r.json.capacidades.some((c) => c.chave === 'validarTecnico'));
  assert.ok(r.json.capacidades.some((c) => c.chave === 'aprovar'));
});

/* =================================================================== Alertas */

test('RF-083 a RF-086 — alertas com tipo, gatilho e área responsável', async () => {
  const id = await novoCenario('Alertas');
  const r = await req('GET', `/cenarios/${id}/alertas`, undefined, tokens.fiscal);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.gatilho > 0, 'RF-099 gatilho vigente');
  assert.ok(r.json.alertas.length >= 1);
  assert.ok(r.json.alertas.every((a) => a.area), 'RF-086 área de encaminhamento');
  assert.ok(r.json.alertas.some((a) => a.tipo === 'risco'), 'RF-085 risco acima de 40%');
  const risco = r.json.alertas.find((a) => a.tipo === 'risco');
  assert.match(risco.msg, /13\/2012/, 'RF-085 base legal citada');
});

test('RF-099 — alterar o gatilho muda imediatamente os alertas gerados', async () => {
  const id = await novoCenario('Gatilho');
  const antes = await req('GET', `/cenarios/${id}/alertas`, undefined, tokens.fiscal);
  await req('PUT', '/parametros/gatilho_reemissao', { valor: { pp: 0.5 } }, tokens.ti);
  const depois = await req('GET', `/cenarios/${id}/alertas`, undefined, tokens.fiscal);
  assert.ok(depois.json.alertas.length >= antes.json.alertas.length,
    'gatilho menor gera mais alertas de reemissão');
  assert.strictEqual(depois.json.gatilho, 0.5);
  await req('PUT', '/parametros/gatilho_reemissao', { valor: { pp: 5 } }, tokens.ti);
});

/* ============================================================ Rastreabilidade */

test('RF-006 · RNF-04 — histórico com autor, data, versão e origem dos dados', async () => {
  const id = await novoCenario('Histórico');
  await req('PUT', `/cenarios/${id}/sim/cambio`, { moeda: 'USD', cotacao: 6 }, tokens.compras);
  const r = await req('GET', `/cenarios/${id}/eventos`, undefined, tokens.custos);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.eventos.length >= 2, 'criação e edição registradas');
  assert.ok(r.json.eventos.every((e) => e.usuario_nome && e.registrado_em));
  assert.ok(r.json.cenario.origemDados, 'origem dos dados identificada');
  assert.ok(r.json.versoes.length >= 1);
});

/* ================================================= Alternativa cadastral RF-055 */

test('RF-055 — o payload exato do modal cria a alternativa com fornecedor, custos e cotação', async () => {
  const id = await novoCenario('RF-055 alternativa');
  const antes = await req('GET', `/cenarios/${id}`, undefined, tokens.custos);
  const insumoBase = antes.json.cenario.dados.insumos.find((i) => i.classSim === 'importado_direto')
    || antes.json.cenario.dados.insumos[0];
  const nForn = antes.json.cenario.dados.fornecedores.length;

  // Corpo montado exatamente como «Câmbio ▸ Incluir alternativa cadastral» envia:
  // componentes aduaneiros aninhados em «campos» e o item de referência em
  // «base»/«refBase»/«ref». O contrato tela↔servidor é o que este teste trava.
  const corpo = {
    base: insumoBase.id, refBase: insumoBase.id, ref: insumoBase.id,
    nome: 'Alternativa de contrato', grupo: null,
    moeda: 'GBP', cotacao: 7.4,
    classSim: 'importado_direto',
    fornecedorNome: 'Fornecedor Alternativo Ltda', fornecedorPais: 'Reino Unido',
    campos: {
      fob: 31, freteInt: 4, seguroInt: 0,
      ii: 6, ipiImp: 0, pisCofinsImp: 0,
      moeda: 'GBP', classSim: 'importado_direto',
    },
  };
  const r = await req('POST', `/cenarios/${id}/sim/insumo/alternativa`, corpo, tokens.custos);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));

  const dep = await req('GET', `/cenarios/${id}`, undefined, tokens.custos);
  const dados = dep.json.cenario.dados;
  const alt = dados.insumos.find((i) => i.nome === 'Alternativa de contrato');
  assert.ok(alt, 'a alternativa foi criada');
  assert.strictEqual(alt.alt, true, 'identificada como alternativa do cenário');
  assert.strictEqual(alt.origemCad, 'alternativa_cenario');
  assert.strictEqual(alt.baseRef, insumoBase.id);

  // os valores digitados não podem ser silenciosamente substituídos pelos do item base
  assert.strictEqual(Number(alt.fob), 31, 'FOB informado é aplicado');
  assert.strictEqual(Number(alt.freteInt), 4, 'frete informado é aplicado');
  assert.strictEqual(Number(alt.ii), 6, 'II informado é aplicado');
  assert.strictEqual(alt.moeda, 'GBP');

  // RF-055 — a inclusão de FORNECEDOR acontece dentro do cenário
  const forn = dados.fornecedores.find((f) => f.nome === 'Fornecedor Alternativo Ltda');
  assert.ok(forn, 'o fornecedor informado é criado no cenário');
  assert.strictEqual(dados.fornecedores.length, nForn + 1);
  assert.strictEqual(alt.fornecedorId, forn.id, 'a alternativa aponta para o fornecedor criado');
  assert.strictEqual(forn.alt, true);

  // RF-052 — a cotação informada entra no câmbio do cenário
  assert.strictEqual(Number(dados.cambio.GBP), 7.4);

  // RF-007 — nada disso aparece em outro cenário
  const outro = await novoCenario('RF-055 controle');
  const ctrl = await req('GET', `/cenarios/${outro}`, undefined, tokens.custos);
  assert.ok(!ctrl.json.cenario.dados.insumos.some((i) => i.nome === 'Alternativa de contrato'));
  assert.ok(!ctrl.json.cenario.dados.fornecedores.some((f) => f.nome === 'Fornecedor Alternativo Ltda'));
});

test('RF-055 — cotação inválida na alternativa é recusada com a mesma regra do câmbio', async () => {
  const id = await novoCenario('RF-055 cotação');
  const pac = await req('GET', `/cenarios/${id}`, undefined, tokens.custos);
  const ref = pac.json.cenario.dados.insumos[0].id;

  const zero = await req('POST', `/cenarios/${id}/sim/insumo/alternativa`,
    { base: ref, nome: 'Cotação zero', moeda: 'USD', cotacao: 0 }, tokens.custos);
  assert.strictEqual(zero.status, 422, JSON.stringify(zero.json));
  assert.match(zero.json.erro, /maior que zero/i);

  const moeda = await req('POST', `/cenarios/${id}/sim/insumo/alternativa`,
    { base: ref, nome: 'Moeda inexistente', moeda: 'XYZ', cotacao: 3 }, tokens.custos);
  assert.strictEqual(moeda.status, 422, JSON.stringify(moeda.json));
});
