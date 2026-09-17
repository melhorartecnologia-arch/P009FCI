'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { config } = require('./config');
const { query } = require('./db');
const { pode, permissoesDe } = require('./permissions');

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
    };
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou inválida. Faça login novamente.' });
  }
}

/**
 * Middleware: exige uma ação da matriz de permissões (RF-100).
 * Leitura permanece liberada nas rotas GET — a restrição indica o motivo.
 */
function exigirAcao(acao) {
  return (req, res, next) => {
    if (pode(req.usuario, acao)) return next();
    return res.status(403).json({
      erro: `Ação restrita. Seu perfil (${permissoesDe(req.usuario.area).perfil} · ${req.usuario.area}) tem acesso de consulta; a edição de ${rotuloAcao(acao)} é do perfil Administrador (TI).`,
      acao,
      somenteLeitura: true,
    });
  };
}

function rotuloAcao(acao) {
  const mapa = {
    integracoes: 'integrações e fontes de dados',
    parametros: 'parâmetros mestres',
    usuarios: 'usuários e perfis',
    criarCenario: 'cenários',
    salvar: 'cenários',
    congelar: 'congelamento de cenários',
  };
  return mapa[acao] || acao;
}

module.exports = { gerarToken, autenticar, exigirLogin, exigirAcao };
