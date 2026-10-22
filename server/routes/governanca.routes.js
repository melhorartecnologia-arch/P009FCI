'use strict';
/**
 * Governança do cenário — seção 4.3 do contrato interno.
 *
 *   router  (governanca) → montado em /api/cenarios/:id/gov
 *   validacoes           → montado em /api/validacoes
 *
 * Requisitos atendidos: RF-005 congelamento · RF-008/RF-038 consolidação ·
 * RF-060 base do denominador · RF-036/RF-037 validação técnica ·
 * RF-009/RF-088 direcionamentos às áreas · RN-10/RN-11.
 *
 * As rotas apenas orquestram: validam o corpo mínimo, chamam o serviço e
 * devolvem o payload. Impedimentos de perfil vêm de exigirAcao (RF-035/RF-100)
 * e os erros de regra trafegam por err.status até o tratamento central.
 */
const express = require('express');
const { exigirLogin, exigirAcao } = require('../auth');
const gov = require('../services/governanca.service');

// mergeParams: o :id do cenário vem do caminho do montador
const router = express.Router({ mergeParams: true });
router.use(exigirLogin);

// ---------------------------------------------------------------------------
// Congelamento e consolidação
// ---------------------------------------------------------------------------

/** RF-005 · RN-10 — congela as premissas do cenário (bloqueado por RF-025). */
router.post('/congelar', exigirAcao('congelar'), async (req, res, next) => {
  try {
    res.json(await gov.congelarCenario(req.params.id, req.usuario));
  } catch (err) { next(err); }
});

/** RF-008 · RF-038 · RN-11 — consolida o cenário para decisão. */
router.post('/consolidar', exigirAcao('consolidar'), async (req, res, next) => {
  try {
    res.json(await gov.consolidarCenario(req.params.id, req.usuario));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Base de cálculo do denominador (RF-060)
// ---------------------------------------------------------------------------

/** RF-060 — define o denominador do CI%: saídas interestaduais ou custo. */
router.put('/base', exigirAcao('baseCalculo'), async (req, res, next) => {
  try {
    const { base } = req.body || {};
    res.json(await gov.definirBase(req.params.id, base, req.usuario));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Validação técnica (RF-036 · RF-037 · RF-038 · RN-11)
// ---------------------------------------------------------------------------

/** RF-036 — submete os pontos alterados (valor padrão × valor no cenário). */
router.post('/validacao/submeter', exigirAcao('submeterValidacao'), async (req, res, next) => {
  try {
    const { notas } = req.body || {};
    const saida = await gov.submeterValidacao(req.params.id, req.usuario, notas);
    res.status(201).json(saida);
  } catch (err) { next(err); }
});

/** RF-037 — histórico das validações do cenário, mais recente primeiro. */
router.get('/validacao/historico', async (req, res, next) => {
  try {
    res.json(await gov.historicoValidacoes(req.params.id));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Direcionamentos às áreas (RF-009 · RF-088)
// ---------------------------------------------------------------------------

/** RF-009 · RF-088 — manuais (tabela) e automáticos (motor), por área. */
router.get('/direcionamentos', async (req, res, next) => {
  try {
    res.json(await gov.listarDirecionamentos(req.params.id));
  } catch (err) { next(err); }
});

/** RF-009 — registra direcionamento manual à área responsável. */
router.post('/direcionamentos', exigirAcao('consolidar'), async (req, res, next) => {
  try {
    const { area, produto, texto, prioridade } = req.body || {};
    const saida = await gov.criarDirecionamento(
      req.params.id, { area, produto, texto, prioridade }, req.usuario
    );
    res.status(201).json(saida);
  } catch (err) { next(err); }
});

/** RF-009 — remove direcionamento manual do cenário. */
router.delete('/direcionamentos/:did', exigirAcao('consolidar'), async (req, res, next) => {
  try {
    res.json(await gov.removerDirecionamento(req.params.id, req.params.did, req.usuario));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Decisão da validação técnica — /api/validacoes (RF-037 · RF-038)
// ---------------------------------------------------------------------------

const validacoes = express.Router();
validacoes.use(exigirLogin);

/** RF-037 — aprova ou reprova, registrando responsável, área e data. */
validacoes.post('/:vid/decidir', exigirAcao('validarTecnico'), async (req, res, next) => {
  try {
    const { decisao, notas } = req.body || {};
    res.json(await gov.decidirValidacao(req.params.vid, { decisao, notas }, req.usuario));
  } catch (err) { next(err); }
});

// Exportação dupla: o router de governança é o módulo (app.use direto) e
// também fica acessível por nome, junto do router de /api/validacoes.
module.exports = router;
module.exports.governanca = router;
module.exports.validacoes = validacoes;
