'use strict';
/**
 * Análise assistida — seção 4.5 do contrato interno.
 * Montado em /api/analise.
 *
 * Requisitos atendidos: RF-080 conversação iterativa sobre os cenários
 * selecionados, com histórico mantido · RF-081 análises padrão solicitáveis ·
 * RF-082 ressalva de caráter gerencial, sem validade fiscal, apresentada junto
 * ao recurso — presente em TODA resposta deste domínio.
 *
 * O recurso é de leitura e análise: não altera cenário algum, portanto não
 * exige capacidade da matriz de permissões além do login (RF-035). As rotas
 * apenas orquestram e os erros de regra trafegam por err.status até o
 * tratamento central do app.js, sempre em português (RNF-03).
 */
const express = require('express');
const { exigirLogin } = require('../auth');
const analise = require('../services/analise.service');

const router = express.Router();
router.use(exigirLogin);

/** RF-081 · RF-082 — catálogo das análises padrão e ressalva de uso. */
router.get('/padrao', async (req, res, next) => {
  try {
    res.json(analise.analisesPadrao());
  } catch (err) { next(err); }
});

/**
 * RF-080 · RF-081 · RF-082 — responde à pergunta ou à análise padrão pedida
 * sobre o contexto selecionado e registra a conversa.
 */
router.post('/', async (req, res, next) => {
  try {
    const { cenarioIds, prodId, analise: analisePedida, pergunta, base,
            variacaoCambial, variacaoPreco, alvo } = req.body || {};
    if (cenarioIds === undefined) {
      return res.status(422).json({ erro: 'Envie «cenarioIds» com os cenários do contexto da análise (RF-080).' });
    }
    res.json(await analise.responder(req.usuario, {
      cenarioIds, prodId, analise: analisePedida, pergunta, base,
      variacaoCambial, variacaoPreco, alvo,
    }));
  } catch (err) { next(err); }
});

/** RF-080 — histórico da conversa do contexto, em ordem cronológica. */
router.get('/historico', async (req, res, next) => {
  try {
    if (!req.query.contexto) {
      return res.status(422).json({
        erro: 'Informe «contexto» com os identificadores dos cenários unidos por hífen — por exemplo «1-3» (RF-080).',
      });
    }
    res.json(await analise.historico(req.usuario, req.query.contexto));
  } catch (err) { next(err); }
});

/** RF-080 — limpa a conversa do contexto para o usuário autenticado. */
router.delete('/historico', async (req, res, next) => {
  try {
    if (!req.query.contexto) {
      return res.status(422).json({
        erro: 'Informe «contexto» com os identificadores dos cenários unidos por hífen — por exemplo «1-3» (RF-080).',
      });
    }
    res.json(await analise.limparHistorico(req.usuario, req.query.contexto));
  } catch (err) { next(err); }
});

module.exports = router;
