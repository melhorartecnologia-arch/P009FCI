'use strict';
/**
 * Simulação e estrutura — /api/cenarios/:id/sim (seção 4.2 do contrato).
 *
 * Substituição controlada de componentes (RF-015 a RF-024), modo avançado
 * (RF-011 · RF-012 · RF-034 · RF-035), premissas de origem, conteúdo, custo e
 * câmbio do insumo (RF-046 a RF-055 · RF-059), volumes e destinos de saída
 * (RF-066 a RF-071) e alterações em massa por grupo de insumo (RF-040 a RF-045).
 *
 * A rota valida a entrada e a autorização; a orquestração fica no serviço e a
 * regra de cálculo no motor compartilhado (RNF-10). Toda rota que altera o
 * cenário responde { cenario, validacao, confronto } (RF-031 · RF-032).
 *
 * Montado com mergeParams porque recebe :id do roteador de cenários.
 */
const express = require('express');
const { exigirLogin, exigirAcao, exigirAlguma } = require('../auth');
const sim = require('../services/simulacao.service');

const router = express.Router({ mergeParams: true });
router.use(exigirLogin);

// ---------------------------------------------------------------------------
// Validação de entrada (mensagens em português — RNF-03)
// ---------------------------------------------------------------------------

function recusar(res, mensagem) {
  return res.status(422).json({ erro: mensagem });
}

/** Identificador do cenário recebido do roteador pai. */
function cenarioId(req) {
  return req.params.id;
}

/** Referência textual obrigatória (produto, insumo, grupo). */
function texto(valor) {
  const v = valor == null ? '' : String(valor).trim();
  return v === '' ? null : v;
}

/** Índice de posição da ficha técnica: inteiro maior ou igual a zero. */
function indice(valor) {
  if (valor == null || valor === '') return null;
  const i = Number(valor);
  return Number.isInteger(i) && i >= 0 ? i : null;
}

/** Número decimal aceito também no formato pt-BR (vírgula decimal). */
function numero(valor) {
  if (valor == null || valor === '') return null;
  const x = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

/** Lista opcional de produtos selecionados para a operação em lote (RF-042). */
function listaProdutos(valor) {
  if (valor == null) return null;
  if (!Array.isArray(valor)) return undefined;              // undefined = entrada inválida
  const ids = valor.map((v) => texto(v)).filter(Boolean);
  return ids.length ? ids : null;
}

// ===========================================================================
// Substituição controlada de componentes (RF-015 a RF-024)
// ===========================================================================

/** RF-020 — alternativas elegíveis, mesmo grupo de insumo em primeiro lugar. */
router.get('/substituicao/opcoes', async (req, res, next) => {
  try {
    const prodId = texto(req.query.prodId);
    const idx = indice(req.query.idx);
    if (!prodId) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (idx == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    res.json(await sim.opcoesSubstituicao(cenarioId(req), prodId, idx));
  } catch (err) { next(err); }
});

/** RF-022 — prévia do efeito antes da confirmação; não grava nada. */
router.post('/substituicao/previa', async (req, res, next) => {
  try {
    const { prodId, idx, refSubstituto, modo, pct } = req.body || {};
    const prod = texto(prodId);
    const i = indice(idx);
    const sub = texto(refSubstituto);
    if (!prod) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (i == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    if (!sub) return recusar(res, 'Informe o item substituto (refSubstituto).');
    if (modo != null && modo !== 'integral' && modo !== 'parcial') {
      return recusar(res, 'Modo de substituição inválido: use «integral» (substituto assume 100%) ou «parcial» (proporção informada) — RF-016 · RF-017.');
    }
    const p = modo === 'parcial' ? numero(pct) : 100;
    if (modo === 'parcial' && (p == null || p < 0 || p > 100)) {
      return recusar(res, 'Na substituição parcial, informe a proporção do substituto entre 0 e 100 — a do item original é complementada automaticamente (RF-017).');
    }
    res.json(await sim.previaSubstituicao(cenarioId(req), {
      prodId: prod, idx: i, refSubstituto: sub, modo: modo || 'integral', pct: p,
    }));
  } catch (err) { next(err); }
});

/** RF-015 a RF-018 · RF-021 — aplica a substituição e grava o cenário. */
router.post('/substituicao', exigirAcao('substituir'), async (req, res, next) => {
  try {
    const { prodId, idx, refSubstituto, modo, pct } = req.body || {};
    const prod = texto(prodId);
    const i = indice(idx);
    const sub = texto(refSubstituto);
    if (!prod) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (i == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    if (!sub) return recusar(res, 'Informe o item substituto (refSubstituto).');
    if (modo != null && modo !== 'integral' && modo !== 'parcial') {
      return recusar(res, 'Modo de substituição inválido: use «integral» (substituto assume 100%) ou «parcial» (proporção informada) — RF-016 · RF-017.');
    }
    const p = modo === 'parcial' ? numero(pct) : 100;
    if (modo === 'parcial' && (p == null || p < 0 || p > 100)) {
      return recusar(res, 'Na substituição parcial, informe a proporção do substituto entre 0 e 100 — a do item original é complementada automaticamente (RF-017).');
    }
    res.json(await sim.aplicarSubstituicao(cenarioId(req), {
      prodId: prod, idx: i, refSubstituto: sub, modo: modo || 'integral', pct: p,
    }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-017 · RF-023 — ajuste da proporção diretamente na estrutura. */
router.put('/substituicao/proporcao', exigirAcao('substituir'), async (req, res, next) => {
  try {
    const { prodId, idx, mi, pct } = req.body || {};
    const prod = texto(prodId);
    const i = indice(idx);
    const m = indice(mi);
    const p = numero(pct);
    if (!prod) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (i == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    if (m == null) return recusar(res, 'Informe qual alternativa será ajustada (mi) como um número inteiro igual ou maior que zero.');
    if (p == null || p < 0 || p > 100) return recusar(res, 'Informe a proporção entre 0 e 100 (RF-017 · RF-023).');
    res.json(await sim.ajustarProporcao(cenarioId(req), { prodId: prod, idx: i, mi: m, pct: p }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-023 — normalização das proporções para 100%. */
router.post('/substituicao/normalizar', exigirAcao('substituir'), async (req, res, next) => {
  try {
    const { prodId, idx } = req.body || {};
    const prod = texto(prodId);
    const i = indice(idx);
    if (!prod) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (i == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    res.json(await sim.normalizarProporcoes(cenarioId(req), { prodId: prod, idx: i }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-024 — reversão da substituição, restabelecendo o componente original. */
router.delete('/substituicao', exigirAcao('substituir'), async (req, res, next) => {
  try {
    const corpo = Object.keys(req.body || {}).length ? req.body : req.query;
    const prod = texto(corpo.prodId);
    const i = indice(corpo.idx);
    if (!prod) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (i == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    res.json(await sim.reverterSubstituicao(cenarioId(req), { prodId: prod, idx: i }, req.usuario));
  } catch (err) { next(err); }
});

// ===========================================================================
// Modo avançado (RF-011 · RF-012 · RF-034 · RF-035)
// ===========================================================================

/** RF-011 — quantidade da receita, liberada apenas no modo avançado. */
router.put('/componente/qtd', exigirAcao('modoAvancado'), async (req, res, next) => {
  try {
    const { prodId, idx, qtd } = req.body || {};
    const prod = texto(prodId);
    const i = indice(idx);
    const q = numero(qtd);
    if (!prod) return recusar(res, 'Informe o produto (prodId) da estrutura.');
    if (i == null) return recusar(res, 'Informe a posição do componente (idx) como um número inteiro igual ou maior que zero.');
    if (q == null) return recusar(res, 'Informe a quantidade (qtd) do componente como um número maior que zero.');
    res.json(await sim.alterarQtdComponente(cenarioId(req), { prodId: prod, idx: i, qtd: q }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-012 — custo industrial (overhead) do produto, no modo avançado. */
router.put('/produto/overhead', exigirAcao('modoAvancado'), async (req, res, next) => {
  try {
    const { prodId, overhead } = req.body || {};
    const prod = texto(prodId);
    const o = numero(overhead);
    if (!prod) return recusar(res, 'Informe o produto (prodId).');
    if (o == null) return recusar(res, 'Informe o custo industrial (overhead) como um número igual ou maior que zero.');
    res.json(await sim.alterarOverhead(cenarioId(req), { prodId: prod, overhead: o }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-034 · RF-035 — alternância explícita entre modo padrão e avançado. */
router.put('/modo', exigirAcao('modoAvancado'), async (req, res, next) => {
  try {
    const modo = texto((req.body || {}).modo);
    if (modo !== 'padrao' && modo !== 'avancado') {
      return recusar(res, 'Informe o modo do cenário: «padrao» (receita protegida) ou «avancado» (receita editável) — RF-034.');
    }
    res.json(await sim.alternarModo(cenarioId(req), { modo }, req.usuario));
  } catch (err) { next(err); }
});

// ===========================================================================
// Premissas do insumo e câmbio (RF-046 a RF-055 · RF-058 · RF-059)
// ===========================================================================

/**
 * RF-046 a RF-051 · RF-058 · RF-059 — premissas do insumo no cenário.
 * Habilitado para quem mantém a classificação fiscal (Origem, CST e conteúdo)
 * ou o cadastro de compras (fornecedor, FOB e câmbio).
 */
router.put('/insumo', exigirAlguma('editarFiscal', 'editarFornecedor'), async (req, res, next) => {
  try {
    const { ref, campos } = req.body || {};
    const r = texto(ref);
    if (!r) return recusar(res, 'Informe o insumo (ref) a atualizar.');
    if (!campos || typeof campos !== 'object' || Array.isArray(campos)) {
      return recusar(res, 'Envie «campos» como um objeto com as premissas a atualizar — por exemplo { "ciPct": 55 }.');
    }
    if (!Object.keys(campos).length) return recusar(res, 'Informe ao menos um campo a atualizar no insumo.');
    res.json(await sim.atualizarInsumo(cenarioId(req), { ref: r, campos }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-055 — alternativa cadastral do cenário (novo fornecedor, nova moeda). */
router.post('/insumo/alternativa', exigirAcao('editarFornecedor'), async (req, res, next) => {
  try {
    const corpo = req.body || {};
    const base = texto(corpo.base);
    const nome = texto(corpo.nome);
    if (!base) return recusar(res, 'Informe o insumo de referência (base) da alternativa cadastral.');
    if (!nome) return recusar(res, 'Informe o nome da alternativa cadastral (RF-055).');
    res.json(await sim.criarAlternativaInsumo(cenarioId(req), { ...corpo, base, nome }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-052 · RF-053 · RF-054 — cotação da moeda e recálculo em lote dos insumos. */
router.put('/cambio', exigirAcao('editarFornecedor'), async (req, res, next) => {
  try {
    const { moeda, cotacao } = req.body || {};
    const m = texto(moeda);
    const c = numero(cotacao);
    if (!m) return recusar(res, 'Informe a moeda (por exemplo, USD) — RF-052.');
    if (c == null || c <= 0) return recusar(res, 'Informe a cotação da moeda como um número maior que zero.');
    res.json(await sim.atualizarCambio(cenarioId(req), { moeda: m, cotacao: c }, req.usuario));
  } catch (err) { next(err); }
});

// ===========================================================================
// Volumes, preços e destinos (RF-066 a RF-072)
// ===========================================================================

/** RF-066 · RF-068 — ajuste de volumes e preços por UF dentro do cenário. */
router.put('/saidas', exigirAcao('editarSaida'), async (req, res, next) => {
  try {
    const { prodId, saidas } = req.body || {};
    const prod = texto(prodId);
    if (!prod) return recusar(res, 'Informe o produto (prodId).');
    if (!Array.isArray(saidas)) {
      return recusar(res, 'Envie «saidas» como uma lista de { uf, volume, preco } — RF-066.');
    }
    res.json(await sim.atualizarSaidas(cenarioId(req), { prodId: prod, saidas }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-067 — carga do Sistema de Preços: substituir a base ou complementar UFs. */
router.post('/saidas/carga', exigirAcao('editarSaida'), async (req, res, next) => {
  try {
    const { prodId, modo } = req.body || {};
    const prod = texto(prodId);
    const m = texto(modo);
    if (!prod) return recusar(res, 'Informe o produto (prodId).');
    if (m !== 'substituir' && m !== 'complementar') {
      return recusar(res, 'Informe o modo da carga: «substituir» (troca toda a base de saídas) ou «complementar» (apenas as UFs ausentes) — RF-067.');
    }
    res.json(await sim.cargaSaidas(cenarioId(req), { prodId: prod, modo: m }, req.usuario));
  } catch (err) { next(err); }
});

/** RF-071 — sensibilidade do CI% a uma variação de preço por UF. */
router.get('/sensibilidade/uf', async (req, res, next) => {
  try {
    const prodId = texto(req.query.prodId);
    if (!prodId) return recusar(res, 'Informe o produto (prodId).');
    const v = req.query.variacao == null || req.query.variacao === '' ? 5 : numero(req.query.variacao);
    if (v == null) return recusar(res, 'Informe a variação percentual de preço a simular (por exemplo, 5 para +5%) — RF-071.');
    res.json(await sim.sensibilidadeUF(cenarioId(req), prodId, v));
  } catch (err) { next(err); }
});

// ===========================================================================
// Alterações em massa por grupo de insumo (RF-040 a RF-045)
// ===========================================================================

/** RF-040 — grupos de insumo, itens elegíveis e posições da ficha técnica. */
router.get('/massa/grupos', async (req, res, next) => {
  try {
    res.json(await sim.gruposMassa(cenarioId(req)));
  } catch (err) { next(err); }
});

/** RF-043 · RF-045 — prévia do lote, com impacto estimado no CI%. */
router.post('/massa/previa', exigirAcao('massa'), async (req, res, next) => {
  try {
    const { grupo, refSubstituto, pct, prodIds } = req.body || {};
    const g = texto(grupo);
    const sub = texto(refSubstituto);
    if (!g) return recusar(res, 'Informe o grupo de insumo (grupo) da operação em lote — RF-040.');
    if (!sub) return recusar(res, 'Informe o item substituto (refSubstituto).');
    const p = pct == null || pct === '' ? 100 : numero(pct);
    if (p == null || p < 0 || p > 100) {
      return recusar(res, 'Informe a proporção do substituto entre 0 e 100 — a do item original é complementada automaticamente (RF-041).');
    }
    const ids = listaProdutos(prodIds);
    if (ids === undefined) return recusar(res, 'Envie «prodIds» como uma lista de produtos selecionados — RF-042.');
    res.json(await sim.previaMassa(cenarioId(req), { grupo: g, refSubstituto: sub, pct: p, prodIds: ids }));
  } catch (err) { next(err); }
});

/** RF-041 · RF-042 — aplica o lote somente às estruturas selecionadas. */
router.post('/massa/aplicar', exigirAcao('massa'), async (req, res, next) => {
  try {
    const { grupo, refSubstituto, pct, prodIds } = req.body || {};
    const g = texto(grupo);
    const sub = texto(refSubstituto);
    if (!g) return recusar(res, 'Informe o grupo de insumo (grupo) da operação em lote — RF-040.');
    if (!sub) return recusar(res, 'Informe o item substituto (refSubstituto).');
    const p = pct == null || pct === '' ? 100 : numero(pct);
    if (p == null || p < 0 || p > 100) {
      return recusar(res, 'Informe a proporção do substituto entre 0 e 100 — a do item original é complementada automaticamente (RF-041).');
    }
    const ids = listaProdutos(prodIds);
    if (ids === undefined) return recusar(res, 'Envie «prodIds» como uma lista de produtos selecionados — RF-042.');
    res.json(await sim.aplicarMassa(cenarioId(req), { grupo: g, refSubstituto: sub, pct: p, prodIds: ids }, req.usuario));
  } catch (err) { next(err); }
});

module.exports = router;
