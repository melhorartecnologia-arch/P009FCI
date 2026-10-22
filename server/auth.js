'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { config } = require('./config');
const { query } = require('./db');
const { pode, permissoesDe, rotuloAcao, AREAS, PERMS, ACOES_ADMIN } = require('./permissions');

function gerarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, nome: usuario.nome, area: usuario.area, is_admin: usuario.is_admin },
    config.jwtSecret,
    { expiresIn: config.jwtExpira }
  );
}

async function autenticar(email, senha) {
  const { rows } = await query(
    'SELECT id, nome, email, senha_hash, area, perfil, is_admin, ativo FROM usuarios WHERE lower(email) = lower($1)',
    [email]
  );
  const u = rows[0];
  if (!u || !u.ativo) return null;
  const ok = await bcrypt.compare(String(senha || ''), u.senha_hash);
  if (!ok) return null;
  return u;
}

/** Middleware: exige JWT válido; popula req.usuario. */
function exigirLogin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Sessão não autenticada. Faça login.' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.usuario = {
      id: payload.sub,
      nome: payload.nome,
      area: payload.area,
      is_admin: !!payload.is_admin,
      perfil: permissoesDe(payload.area).perfil,
    };
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou inválida. Faça login novamente.' });
  }
}

/**
 * Mensagem de impedimento apresentada ao perfil sem permissão (RF-035 · RF-100).
 * Declara o perfil ativo, a ação restrita e quais áreas a executam.
 */
function montarImpedimento(usuario, acao) {
  const p = permissoesDe(usuario.area);
  const habilitadas = AREAS.filter((a) => PERMS[a] && PERMS[a].acoes.includes(acao));
  const quem = ACOES_ADMIN.includes(acao)
    ? 'o perfil Administrador (TI)'
    : (habilitadas.length ? habilitadas.join(', ') : 'nenhuma área configurada');
  return `Ação restrita: «${rotuloAcao(acao)}» não está habilitada para o perfil ${p.perfil} · ${usuario.area}. ` +
         `Esta ação pertence a: ${quem}. O acesso de consulta permanece liberado.`;
}

/**
 * Middleware: exige uma capacidade da matriz de permissões (RF-035 · RF-100).
 * A leitura (GET) permanece liberada nas rotas; a restrição informa o motivo.
 */
function exigirAcao(acao) {
  return (req, res, next) => {
    if (pode(req.usuario, acao)) return next();
    return res.status(403).json({
      erro: montarImpedimento(req.usuario, acao),
      acao,
      rotulo: rotuloAcao(acao),
      perfil: permissoesDe(req.usuario.area).perfil,
      somenteLeitura: true,
    });
  };
}

/** Exige qualquer uma das capacidades informadas. */
function exigirAlguma(...acoes) {
  return (req, res, next) => {
    if (acoes.some((a) => pode(req.usuario, a))) return next();
    return res.status(403).json({
      erro: montarImpedimento(req.usuario, acoes[0]),
      acao: acoes[0], somenteLeitura: true,
    });
  };
}

module.exports = { gerarToken, autenticar, exigirLogin, exigirAcao, exigirAlguma, montarImpedimento };
