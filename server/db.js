'use strict';
const { Pool } = require('pg');
const { config } = require('./config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  options: '-c search_path=fci,public',
});

async function query(text, params) {
  return pool.query(text, params);
}

/** Executa fn dentro de uma transação com o mesmo client. */
async function transacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transacao };
