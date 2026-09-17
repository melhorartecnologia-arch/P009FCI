'use strict';
/**
 * Administração de usuários e perfis (apoio ao RF-100 · RNF-09).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { exigirLogin, exigirAcao } = require('../auth');
const { AREAS, permissoesDe } = require('../permissions');

const router = express.Router();
router.use(exigirLogin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, nome, email, area, perfil, is_admin, ativo, criado_em FROM usuarios ORDER BY nome'
    );
    res.json({ usuarios: rows, areas: AREAS });
  } catch (err) { next(err); }
});

router.post('/', exigirAcao('usuarios'), async (req, res, next) => {
  try {
    const { nome, email, senha, area, is_admin } = req.body || {};
    if (!nome || !email || !senha) return res.status(422).json({ erro: 'Nome, e-mail e senha são obrigatórios.' });
    if (!AREAS.includes(area)) return res.status(422).json({ erro: `Área inválida. Use: ${AREAS.join(', ')}` });
    const hash = await bcrypt.hash(String(senha), 10);
    const { rows } = await query(
      `INSERT INTO usuarios (nome, email, senha_hash, area, perfil, is_admin)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nome, email, area, perfil, is_admin, ativo`,
      [nome, email, hash, area, permissoesDe(area).perfil, !!is_admin || area === 'TI']
    );
    res.status(201).json({ usuario: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'Já existe usuário com esse e-mail.' });
    next(err);
  }
});

router.put('/:id', exigirAcao('usuarios'), async (req, res, next) => {
  try {
    const { nome, area, ativo, senha, is_admin } = req.body || {};
    const atual = await query('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
    if (!atual.rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const u = atual.rows[0];
    const novaArea = area && AREAS.includes(area) ? area : u.area;
    const hash = senha ? await bcrypt.hash(String(senha), 10) : u.senha_hash;
    const { rows } = await query(
      `UPDATE usuarios SET nome=$2, area=$3, perfil=$4, ativo=$5, senha_hash=$6, is_admin=$7, atualizado_em=now()
       WHERE id=$1 RETURNING id, nome, email, area, perfil, is_admin, ativo`,
      [u.id, nome || u.nome, novaArea, permissoesDe(novaArea).perfil,
       ativo != null ? !!ativo : u.ativo, hash,
       is_admin != null ? !!is_admin : u.is_admin]
    );
    res.json({ usuario: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
