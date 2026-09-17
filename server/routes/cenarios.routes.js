'use strict';
/**
 * Cenários de simulação (RF-001 · RF-002 · RF-003 · RF-007).
 */
const express = require('express');
const { exigirLogin, exigirAcao } = require('../auth');
const cenarioService = require('../services/cenario.service');

const router = express.Router();
router.use(exigirLogin);

router.get('/', async (req, res, next) => {
  try {
    const cenarios = await cenarioService.listarCenarios();
    res.json({ cenarios });
  } catch (err) { next(err); }
});

// RF-001 — identificador único, versão 1, status Rascunho, autor e data
router.post('/', exigirAcao('criarCenario'), async (req, res, next) => {
  try {
    const { nome, tipo, ciclo } = req.body || {};
    if (!nome || !String(nome).trim()) return res.status(422).json({ erro: 'Informe o nome do cenário.' });
    const cenario = await cenarioService.criarCenario({ nome: String(nome).trim(), tipo, ciclo }, req.usuario);
    res.status(201).json({ cenario });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const cenario = await cenarioService.obterCenario(req.params.id);
    res.json({ cenario });
  } catch (err) { next(err); }
});

// RF-007 — edição isolada dos dados do cenário
router.put('/:id/dados', exigirAcao('salvar'), async (req, res, next) => {
  try {
    const { dados, resumo } = req.body || {};
    if (!dados || typeof dados !== 'object') return res.status(422).json({ erro: 'Envie o campo "dados".' });
    const cenario = await cenarioService.salvarDados(req.params.id, dados, req.usuario, resumo);
    res.json({ cenario });
  } catch (err) { next(err); }
});

// RF-002 — recarregar a estrutura integrada do staging
router.post('/:id/recarregar', exigirAcao('salvar'), async (req, res, next) => {
  try {
    const cenario = await cenarioService.recarregarEstrutura(req.params.id, req.usuario);
    res.json({ cenario });
  } catch (err) { next(err); }
});

// RF-003 — duplicar como nova versão
router.post('/:id/duplicar', exigirAcao('criarCenario'), async (req, res, next) => {
  try {
    const cenario = await cenarioService.duplicarCenario(req.params.id, req.usuario, req.body && req.body.nome);
    res.status(201).json({ cenario });
  } catch (err) { next(err); }
});

router.put('/:id/status', exigirAcao('salvar'), async (req, res, next) => {
  try {
    const { status } = req.body || {};
    const cenario = await cenarioService.mudarStatus(req.params.id, status, req.usuario);
    res.json({ cenario });
  } catch (err) { next(err); }
});

// Rastreabilidade (RC-010/RNF-04)
router.get('/:id/eventos', async (req, res, next) => {
  try {
    const eventos = await cenarioService.eventosDe(req.params.id);
    res.json({ eventos });
  } catch (err) { next(err); }
});

module.exports = router;
