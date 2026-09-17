'use strict';
const { montarSelect, requireOpcional } = require('./base');

async function conectar(cfg) {
  const mysql = requireOpcional('mysql2/promise', 'MySQL/MariaDB');
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.porta || 3306,
    database: cfg.base,
    user: cfg.usuario,
    password: cfg.senha || '',
    connectTimeout: 8000,
  });
}

async function test(cfg) {
  const conn = await conectar(cfg);
  try {
    const [rows] = await conn.query('SELECT VERSION() AS v');
    return { ok: true, mensagem: `Conexão estabelecida · MySQL/MariaDB ${rows[0].v}` };
  } finally {
    await conn.end().catch(() => {});
  }
}

async function fetchRows(cfg, { tabela, campos }) {
  const conn = await conectar(cfg);
  try {
    const sql = montarSelect({ tabela, campos, aspas: '`' });
    const [rows] = await conn.query(sql);
    return rows;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = { tipo: 'mysql', rotulo: 'MySQL / MariaDB', test, fetchRows };
