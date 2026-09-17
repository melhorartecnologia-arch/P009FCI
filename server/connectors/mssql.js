'use strict';
const { identificador, citar, requireOpcional } = require('./base');

function citarMs(nome) {
  return identificador(nome, 'Identificador')
    .split('.')
    .map((p) => `[${p.replace(/[\[\]]/g, '')}]`)
    .join('.');
}

async function conectar(cfg) {
  const sql = requireOpcional('mssql', 'SQL Server');
  return sql.connect({
    server: cfg.host,
    port: cfg.porta || 1433,
    database: cfg.base,
    user: cfg.usuario,
    password: cfg.senha || '',
    options: { trustServerCertificate: true, encrypt: !!(cfg.opcoes && cfg.opcoes.ssl) },
    connectionTimeout: 8000,
    requestTimeout: 30000,
  });
}

async function test(cfg) {
  const pool = await conectar(cfg);
  try {
    const r = await pool.request().query('SELECT @@VERSION AS v');
    return { ok: true, mensagem: `Conexão estabelecida · ${String(r.recordset[0].v).split('\n')[0]}` };
  } finally {
    await pool.close().catch(() => {});
  }
}

async function fetchRows(cfg, { tabela, campos }) {
  const pool = await conectar(cfg);
  try {
    const cols = Object.entries(campos)
      .map(([variavel, campo]) => `${citarMs(campo)} AS [${variavel}]`)
      .join(', ');
    const r = await pool.request().query(`SELECT ${cols} FROM ${citarMs(tabela)}`);
    return r.recordset;
  } finally {
    await pool.close().catch(() => {});
  }
}

module.exports = { tipo: 'mssql', rotulo: 'SQL Server', test, fetchRows, citar };
