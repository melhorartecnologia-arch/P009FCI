'use strict';
/**
 * Cenários de simulação — núcleo (RF-001 a RF-008 · RF-056 · RF-064 ·
 * RF-083 a RF-086 · RNF-04).
 * Rotas de estrutura e premissas ficam em simulacao.routes.js (/sim);
 * governança em governanca.routes.js (/gov); relatório em relatorio.routes.js.
 */
const express = require('express');
const { exigirLogin, exigirAcao } = require('../auth');
const { engine } = require('../engine');
const cenarioService = require('../services/cenario.service');

const router = express.Router();
router.use(exigirLogin);

/** Parâmetros mestres usados pelo motor (gatilho, ICMS-ST, versão da fórmula). */
async function carregarParametros() {
  const { query } = require('../db');
  const { rows } = await query('SELECT chave, valor FROM parametros');
  const p = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  return {
    gatilho: p.gatilho_reemissao ? Number(p.gatilho_reemissao.pp) : 5,
    st: p.st || { mva: 30, aliqInterna: 18, aliqNormal: 12 },
    aliqNormal: p.st ? Number(p.st.aliqNormal) : 12,
    versaoFormula: p.motor ? p.motor.versaoFormula : undefined,
    faixas: p.faixas, aliquotas: p.aliquotas, moedas: p.moedas,
  };
}
router.carregarParametros = carregarParametros;

/** RF-004 — painel de cenários com indicadores recalculados. */
router.get('/', async (req, res, next) => {
  try {
    const E = engine();
    const params = await carregarParametros();
    const cenarios = await cenarioService.listarCenarios();
    const comIndicadores = cenarios.map((c) => {
      let resumo = { ciMedio: 0, nProdutos: 0, acima40: 0, dist: {}, porProduto: [] };
      let nAlertas = 0, nErros = 0;
      try {
        resumo = E.resumoCenario(c.dados || {}, c.base_calculo, params);
        nAlertas = E.alertas(c.dados || {}, params.gatilho, c.base_calculo, params).length;
        nErros = E.validar(c.dados || {}, { modo: c.modo }).filter((v) => v.sev === 'erro').length;
      } catch (err) { /* cenário sem carga ainda */ }
      return {
        ...c,
        dados: undefined,                    // o payload completo vem em GET /:id
        indicadores: {
          ciMedio: resumo.ciMedio, nProdutos: resumo.nProdutos,
          acima40: resumo.acima40, dist: resumo.dist,
          nAlertas, nErros,
          nInsumos: (c.dados && c.dados.insumos || []).length,
        },
      };
    });
    res.json({ cenarios: comIndicadores, parametros: params });
  } catch (err) { next(err); }
});

/** RF-001 — identificador único, versão 1, status Rascunho, autor e data. */
router.post('/', exigirAcao('criarCenario'), async (req, res, next) => {
  try {
    const { nome, tipo, ciclo } = req.body || {};
    if (!nome || !String(nome).trim()) return res.status(422).json({ erro: 'Informe o nome do cenário.' });
    const cenario = await cenarioService.criarCenario({ nome: String(nome).trim(), tipo, ciclo }, req.usuario);
    res.status(201).json({ cenario });
  } catch (err) { next(err); }
});

/** Abertura do cenário: dados completos + diagnóstico + parâmetros. */
router.get('/:id', async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.obterCenario(req.params.id);
    const params = await carregarParametros();
    const dados = cenario.dados || {};
    // RF-038 — a situação da validação técnica acompanha o pacote do cenário
    // para que a tela decida o bloqueio da consolidação pelo mesmo critério do
    // servidor, sem depender de uma segunda chamada.
    const gov = require('../services/governanca.service');
    const situacao = await gov.situacaoValidacao(cenario);
    res.json({
      cenario,
      parametros: params,
      validacao: E.diagnostico(dados, { modo: cenario.modo }),
      resumo: E.resumoCenario(dados, cenario.base_calculo, params),
      exigeValidacaoTecnica: E.exigeValidacaoTecnica(dados),
      governanca: {
        exigeValidacao: situacao.exigeValidacao,
        liberaConsolidacao: situacao.liberaConsolidacao,
        aprovadaVigente: situacao.aprovadaVigente,
        pendente: situacao.pendente,
      },
    });
  } catch (err) { next(err); }
});

/** RF-007 — edição isolada dos dados do cenário. */
router.put('/:id/dados', exigirAcao('salvar'), async (req, res, next) => {
  try {
    const E = engine();
    const { dados, resumo } = req.body || {};
    if (!dados || typeof dados !== 'object') return res.status(422).json({ erro: 'Envie o campo "dados".' });
    const antes = (await cenarioService.obterCenario(req.params.id)).dados || {};
    const cenario = await cenarioService.salvarDados(req.params.id, dados, req.usuario, resumo);
    res.json({
      cenario,
      validacao: E.diagnostico(cenario.dados, { modo: cenario.modo }),
      confronto: E.confrontarEdicao(antes, cenario.dados, { modo: cenario.modo }),   // RF-031
    });
  } catch (err) { next(err); }
});

/** RF-002 — recarregar a estrutura integrada do staging. */
router.post('/:id/recarregar', exigirAcao('salvar'), async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.recarregarEstrutura(req.params.id, req.usuario);
    res.json({ cenario, validacao: E.diagnostico(cenario.dados, { modo: cenario.modo }) });
  } catch (err) { next(err); }
});

/** RF-003 — duplicar como nova versão, preservando o cenário de origem. */
router.post('/:id/duplicar', exigirAcao('criarCenario'), async (req, res, next) => {
  try {
    const corpo = req.body || {};
    const cenario = await cenarioService.duplicarCenario(req.params.id, req.usuario, corpo.nome, corpo.resumo);
    res.status(201).json({ cenario });
  } catch (err) { next(err); }
});

/**
 * RF-060 — base de cálculo do denominador no nível do cenário.
 * A regra vive em governanca.service; esta rota é o caminho previsto no
 * contrato (PUT /api/cenarios/:id/base), além do equivalente em /gov/base.
 */
router.put('/:id/base', exigirAcao('baseCalculo'), async (req, res, next) => {
  try {
    const gov = require('../services/governanca.service');
    const { base } = req.body || {};
    res.json(await gov.definirBase(req.params.id, base, req.usuario));
  } catch (err) { next(err); }
});

/**
 * RF-005 · RN-10 — congelamento das premissas no nível do cenário.
 * A regra vive em governanca.service; esta rota é o caminho previsto no
 * contrato (POST /api/cenarios/:id/congelar), além do equivalente /gov/congelar.
 */
router.post('/:id/congelar', exigirAcao('congelar'), async (req, res, next) => {
  try {
    const gov = require('../services/governanca.service');
    res.json(await gov.congelarCenario(req.params.id, req.usuario));
  } catch (err) { next(err); }
});

/**
 * RF-008 · RF-038 · RN-11 — consolidação para decisão no nível do cenário.
 * Caminho previsto no contrato (POST /api/cenarios/:id/consolidar), além do
 * equivalente em /gov/consolidar.
 */
router.post('/:id/consolidar', exigirAcao('consolidar'), async (req, res, next) => {
  try {
    const gov = require('../services/governanca.service');
    res.json(await gov.consolidarCenario(req.params.id, req.usuario));
  } catch (err) { next(err); }
});

/** RF-006 — histórico com autor, data, versão, status e origem dos dados. */
router.get('/:id/eventos', async (req, res, next) => {
  try {
    const cenario = await cenarioService.obterCenario(req.params.id);
    const eventos = await cenarioService.eventosDe(req.params.id);
    const { query } = require('../db');
    const versoes = await query(
      `SELECT id, codigo, nome, versao, status, autor_nome, criado_em, origem_id
         FROM cenarios
        WHERE id = $1 OR origem_id = $1 OR id = (SELECT origem_id FROM cenarios WHERE id = $1)
        ORDER BY versao, id`,
      [req.params.id]
    );
    res.json({
      eventos,
      versoes: versoes.rows,
      cenario: {
        codigo: cenario.codigo, versao: cenario.versao, status: cenario.status,
        autor: cenario.autor_nome, origemDados: cenario.origem_dados,
        criadoEm: cenario.criado_em, congeladoEm: cenario.congelado_em,
        consolidadoEm: cenario.consolidado_em,
      },
    });
  } catch (err) { next(err); }
});

/** RF-025 · RF-032 — diagnóstico consolidado de erros e avisos. */
router.get('/:id/validacao', async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.obterCenario(req.params.id);
    res.json({ validacao: E.diagnostico(cenario.dados || {}, { modo: cenario.modo }) });
  } catch (err) { next(err); }
});

/** RF-036 — pontos alterados em relação à carga de origem. */
router.get('/:id/diffs', async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.obterCenario(req.params.id);
    const lista = E.diffs(cenario.dados || {});
    res.json({
      diffs: lista,
      total: lista.length,
      exigemValidacao: lista.filter((d) => d.exigeValidacao).length,
    });
  } catch (err) { next(err); }
});

/** RF-083 a RF-086 — alertas de faixa, reemissão e risco fiscal. */
router.get('/:id/alertas', async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.obterCenario(req.params.id);
    const params = await carregarParametros();
    const lista = E.alertas(cenario.dados || {}, params.gatilho, cenario.base_calculo, params);
    res.json({
      alertas: lista,
      gatilho: params.gatilho,
      porTipo: {
        faixa: lista.filter((a) => a.tipo === 'faixa').length,
        reemissao: lista.filter((a) => a.tipo === 'reemissao').length,
        risco: lista.filter((a) => a.tipo === 'risco').length,
        obrigatoriedade: lista.filter((a) => a.tipo === 'obrigatoriedade').length,
      },
    });
  } catch (err) { next(err); }
});

/** RF-010 · RF-013 — estrutura em cascata com métricas por componente. */
router.get('/:id/estrutura', async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.obterCenario(req.params.id);
    const dados = cenario.dados || {};
    const params = await carregarParametros();
    const prodId = req.query.prodId || ((dados.produtos || []).find((p) => (p.tipo || 'PA') === 'PA') || {}).id;
    if (!prodId) return res.status(422).json({ erro: 'Cenário sem produtos carregados. Recarregue a estrutura do ERP (RF-002).' });
    const base = req.query.base || cenario.base_calculo;
    res.json({
      prodId,
      estrutura: E.achatarEstrutura(dados, prodId, base),
      resultado: E.resultadoProduto(dados, prodId, base, params),
      memoria: E.memoriaCalculo(dados, prodId, base, params),
      produtos: (dados.produtos || []).map((p) => ({ id: p.id, sku: p.sku, nome: p.nome, tipo: p.tipo })),
    });
  } catch (err) { next(err); }
});

/** RF-056 · RF-061 · RF-062 · RF-064 · RF-065 — resultado e memória de cálculo. */
router.get('/:id/resultado', async (req, res, next) => {
  try {
    const E = engine();
    const cenario = await cenarioService.obterCenario(req.params.id);
    const dados = cenario.dados || {};
    const params = await carregarParametros();
    const prodId = req.query.prodId || ((dados.produtos || []).find((p) => (p.tipo || 'PA') === 'PA') || {}).id;
    if (!prodId) return res.status(422).json({ erro: 'Cenário sem produtos carregados.' });
    const base = req.query.base || cenario.base_calculo;
    const r = E.resultadoProduto(dados, prodId, base, params);
    res.json({
      resultado: r,
      memoria: E.memoriaCalculo(dados, prodId, base, params),
      contribuicoes: E.maioresContribuicoes(r, 10),
      icmsST: E.icmsST(r.precoMedio || r.custo, r.ci, params.st),
      pesosUF: E.pesosUF(r.produto),
      drill: E.drillDown(dados, prodId, base, params),
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.carregarParametros = carregarParametros;
