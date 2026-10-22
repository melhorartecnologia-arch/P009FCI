'use strict';
/**
 * Matriz de permissões por área e perfil (RF-039 · RNF-09).
 * Apresenta, por área, as permissões de estrutura, modo avançado, lote,
 * validação e aprovação, destacando o perfil ativo do usuário.
 */
const express = require('express');
const { exigirLogin } = require('../auth');
const { matrizPermissoes, permissoesDe, CAPACIDADES } = require('../permissions');

const router = express.Router();
router.use(exigirLogin);

router.get('/matriz', (req, res) => {
  const minhas = permissoesDe(req.usuario.area);
  res.json({
    ...matrizPermissoes(req.usuario.area),
    usuario: {
      nome: req.usuario.nome, area: req.usuario.area,
      perfil: minhas.perfil, atribuicao: minhas.atribuicao,
      acoes: minhas.acoes,
      is_admin: req.usuario.is_admin,
    },
    grupos: [...new Set(CAPACIDADES.map((c) => c.grupo))],
  });
});

module.exports = router;
