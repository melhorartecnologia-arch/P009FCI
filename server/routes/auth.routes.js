'use strict';
const express = require('express');
const { autenticar, gerarToken, exigirLogin } = require('../auth');
const { permissoesDe, AREAS } = require('../permissions');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) return res.status(422).json({ erro: 'Informe e-mail e senha.' });
    const usuario = await autenticar(email, senha);
    if (!usuario) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    const token = gerarToken(usuario);
    res.json({
      token,
      usuario: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        area: usuario.area, perfil: permissoesDe(usuario.area).perfil,
        is_admin: usuario.is_admin,
        acoes: permissoesDe(usuario.area).acoes,
      },
    });
  } catch (err) { next(err); }
});

router.get('/me', exigirLogin, (req, res) => {
  const p = permissoesDe(req.usuario.area);
  res.json({
    usuario: {
      id: req.usuario.id, nome: req.usuario.nome, area: req.usuario.area,
      perfil: p.perfil, is_admin: req.usuario.is_admin, acoes: p.acoes,
    },
    areas: AREAS,
  });
});

module.exports = router;
