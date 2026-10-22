'use strict';
/**
 * Comparação de cenários — seção 4.4 do contrato interno.
 * Montado em /api/comparacao.
 *
 * Requisitos atendidos: RF-073 seleção de até dez cenários · RF-074 matriz de
 * CI% por produto e cenário · RF-075 drill-down até os insumos dos
 * intermediários · RF-076 grau de impacto em pontos percentuais com a base de
 * cada nível declarada · RF-077 série comparativa do produto em foco ·
 * RF-078 painel lateral de edição sem sair da tela · RF-079 recálculo imediato
 * da matriz.
 *
 * As rotas apenas orquestram: validam o corpo mínimo, chamam o serviço e
 * devolvem o payload. Os erros de regra trafegam por err.status até o
 * tratamento central do app.js, sempre em português (RNF-03).
 */
const express = require('express');
const { exigirLogin, montarImpedimento } = require('../auth');
const { pode, rotuloAcao } = require('../permissions');
const comparacao = require('../services/comparacao.service');

const router = express.Router();
router.use(exigirLogin);

/**
 * Seleção vigente do usuário e matriz correspondente.
 * Sem seleção gravada, a tela abre com os cenários mais recentes (RF-073).
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(await comparacao.visaoAtual(req.usuario, {
      ids: req.query.ids,
      base: req.query.base,
      prodFoco: req.query.prodFoco,
    }));
  } catch (err) { next(err); }
});

/**
 * RF-073 — grava a seleção de cenários do usuário. A inclusão e a exclusão são
 * imediatas: a resposta já traz a matriz da nova seleção. Acima do limite de
 * dez cenários a requisição é recusada com 422.
 */
router.put('/selecao', async (req, res, next) => {
  try {
    const { cenarioIds, prodFoco, base } = req.body || {};
    if (cenarioIds === undefined) {
      return res.status(422).json({ erro: 'Envie «cenarioIds» com os cenários da comparação (RF-073).' });
    }
    res.json(await comparacao.salvarSelecao(req.usuario, { cenarioIds, prodFoco, base }));
  } catch (err) { next(err); }
});

/** RF-074 — matriz de CI% por produto e cenário, com faixa e amplitude. */
router.get('/matriz', async (req, res, next) => {
  try {
    res.json(await comparacao.matriz(req.usuario, {
      ids: req.query.ids,
      base: req.query.base,
      prodFoco: req.query.prodFoco,
    }));
  } catch (err) { next(err); }
});

/** RF-075 · RF-076 — drill-down do produto até os insumos, com a base de cada nível. */
router.get('/drill', async (req, res, next) => {
  try {
    if (!req.query.cenarioId) {
      return res.status(422).json({ erro: 'Informe «cenarioId» para o detalhamento do produto (RF-075).' });
    }
    res.json(await comparacao.drill(req.usuario, {
      cenarioId: req.query.cenarioId,
      prodId: req.query.prodId,
      base: req.query.base,
    }));
  } catch (err) { next(err); }
});

/** RF-077 — série comparativa do CI% do produto em foco entre os cenários. */
router.get('/serie', async (req, res, next) => {
  try {
    res.json(await comparacao.serie(req.usuario, {
      ids: req.query.ids,
      prodId: req.query.prodId,
      base: req.query.base,
    }));
  } catch (err) { next(err); }
});

/**
 * RF-078 · RF-079 — altera um parâmetro do cenário pelo painel lateral e
 * devolve a matriz recalculada, sem sair da comparação.
 *
 * A capacidade exigida depende do tipo da alteração (RF-035 · RF-039 · RF-100),
 * por isso o impedimento é verificado aqui e não por um middleware fixo:
 *   cambio     → editarFornecedor
 *   insumo     → editarFiscal
 *   preco      → editarSaida
 *   proporcao  → substituir
 */
router.put('/painel', async (req, res, next) => {
  try {
    const { cenarioId, alteracao, ids, base, prodFoco } = req.body || {};
    if (!cenarioId) {
      return res.status(422).json({ erro: 'Informe «cenarioId» do cenário a alterar pelo painel (RF-078).' });
    }
    if (!alteracao || typeof alteracao !== 'object' || Array.isArray(alteracao)) {
      return res.status(422).json({ erro: 'Envie «alteracao» com o tipo e os campos da edição do painel (RF-078).' });
    }

    const capacidade = comparacao.capacidadeDoTipo(alteracao.tipo);
    if (!pode(req.usuario, capacidade)) {
      return res.status(403).json({
        erro: montarImpedimento(req.usuario, capacidade),
        acao: capacidade,
        rotulo: rotuloAcao(capacidade),
        perfil: req.usuario.perfil,
        somenteLeitura: true,
      });
    }

    res.json(await comparacao.painel(req.usuario, { cenarioId, alteracao, ids, base, prodFoco }));
  } catch (err) { next(err); }
});

module.exports = router;
