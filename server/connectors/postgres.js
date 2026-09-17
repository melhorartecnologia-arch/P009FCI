'use strict';
const { Client } = require('pg');
const { montarSelect } = require('./base');

function cliente(cfg) {
  return new Client({
    host: cfg.host,
    port: cfg.porta || 5432,
    database: cfg.base,
    user: cfg.usuario,
    password: cfg.senha || '',
    ssl: cfg.opcoes && cfg.opcoes.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
    query_timeout: 30000,
  });
}

async function test(cfg) {
  const c = cliente(cfg);
  try {
    await c.connect();
    const r = await c.query('SELECT version() AS v');
    return { ok: true, mensagem: `Conexão estabelecida · ${String(r.rows[0].v).split(',')[0]}` };
  } finally {
    await c.end().catch(() => {});
  }
}

async function fetchRows(cfg, { tabela, campos }) {
  const c = cliente(cfg);
  try {
    await c.connect();
    const sql = montarSelect({ tabela, campos, aspas: '"' });
    const r = await c.query(sql);
    return r.rows;
  } finally {
    await c.end().catch(() => {});
  }
}

module.exports = { tipo: 'postgres', rotulo: 'PostgreSQL', test, fetchRows };
