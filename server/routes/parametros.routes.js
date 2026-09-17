'use strict';
/**
 * Parâmetros mestres do motor de apuração (RF-096 MV_FCI/CFOP · RF-097
 * alíquotas · RF-098 faixas legais · RF-099 gatilho de reemissão · RF-100).
 * Consulta liberada; edição restrita ao Administrador (TI), com histórico.
 */
const express = require('express');
const { query } = require('../db');
const { exigirLogin, exigirAcao } = require('../auth');
const { pode } = require('../permissions');
const { historicoParametro } = require('../audit');

const router = express.Router();
router.use(exigirLogin);

const CHAVES = ['motor', 'aliquotas', 'faixas', 'gatilho_reemissao', 'moedas', 'st'];

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT chave, valor, atualizado_em FROM parametros ORDER BY chave');
    const parametros = {};
    for (const r of rows) parametros[r.chave] = { valor: r.valor, atualizadoEm: r.atualizado_em };
    res.json({ parametros, somenteLeitura: !pode(req.usuario, 'parametros') });
  } catch (err) { next(err); }
});

function validar(chave, valor) {
  if (chave === 'gatilho_reemissao') {
    const pp = Number(valor && valor.pp);
    if (!(pp > 0 && pp <= 100)) return 'Gatilho de reemissão deve ser um número de p.p. entre 0 e 100 (padrão 5).';
  }
  if (chave === 'aliquotas') {
    const lista = valor && valor.lista;
    if (!Array.isArray(lista) || !lista.length) return 'Informe ao menos uma alíquota.';
    for (const a of lista) {
      const n = Number(a);
      if (!Number.isFinite(n) || n < 0 || n > 100) return `Alíquota inválida: ${a}`;
    }
  }
  if (chave === 'faixas') {
    const lista = valor && valor.lista;
    if (!Array.isArray(lista) || lista.length !== 3) return 'As três faixas legais são obrigatórias (RF-098).';
    for (const f of lista) {
      if (![0, 0.5, 1].includes(Number(f.fator))) return 'Fator de cascata deve ser 0, 0,5 ou 1 (RN-05).';
      if (!f.lim || !f.classe || f.aliq == null) return 'Cada faixa exige limite, classe e alíquota associada.';
    }
  }
  if (chave === 'motor') {
    if (!Array.isArray(valor && valor.mv)) return 'Estrutura inválida dos parâmetros MV_FCI.';
    for (const m of valor.mv) if (!m.id) return 'Parâmetro MV sem identificador.';
  }
  if (chave === 'moedas') {
    const lista = valor && valor.lista;
    if (!Array.isArray(lista) || !lista.length) return 'Informe as moedas parametrizáveis.';
  }
  return null;
}

router.put('/:chave', exigirAcao('parametros'), async (req, res, next) => {
  try {
    const chave = req.params.chave;
    if (!CHAVES.includes(chave)) return res.status(404).json({ erro: `Parâmetro desconhecido: ${chave}` });
    const valor = req.body && req.body.valor;
    if (valor == null) return res.status(422).json({ erro: 'Envie o campo "valor".' });
    const problema = validar(chave, valor);
    if (problema) return res.status(422).json({ erro: problema });

    const antes = await query('SELECT valor FROM parametros WHERE chave = $1', [chave]);
    const { rows } = await query(
      `INSERT INTO parametros (chave, valor, atualizado_em, atualizado_por)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = now(), atualizado_por = $3
       RETURNING chave, valor, atualizado_em`,
      [chave, JSON.stringify(valor), req.usuario.id]
    );
    await historicoParametro(chave, antes.rows[0] ? antes.rows[0].valor : null, valor, req.usuario);
    res.json({ parametro: rows[0] });
  } catch (err) { next(err); }
});

router.get('/:chave/historico', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT h.valor_antes, h.valor_depois, h.registrado_em, u.nome AS usuario
         FROM parametros_hist h LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.chave = $1 ORDER BY h.id DESC LIMIT 50`,
      [req.params.chave]
    );
    res.json({ historico: rows });
  } catch (err) { next(err); }
});

module.exports = router;
