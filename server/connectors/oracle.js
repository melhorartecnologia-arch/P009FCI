'use strict';
const { identificador, requireOpcional } = require('./base');

function citarOra(nome) {
  return identificador(nome, 'Identificador')
    .split('.')
    .map((p) => `"${p.replace(/"/g, '').toUpperCase()}"`)
    .join('.');
}

async function conectar(cfg) {
  const oracledb = requireOpcional('oracledb', 'Oracle');
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  // Modo thin (100% JavaScript) — não requer Oracle Instant Client.
  const connectString = (cfg.opcoes && cfg.opcoes.connectString) ||
    `${cfg.host}:${cfg.porta || 1521}/${cfg.base}`;
  return oracledb.getConnection({
    user: cfg.usuario,
    password: cfg.senha || '',
    connectString,
  });
}

async function test(cfg) {
  const conn = await conectar(cfg);
  try {
    const r = await conn.execute("SELECT banner AS \"v\" FROM v$version WHERE ROWNUM = 1");
    const v = (r.rows && r.rows[0] && r.rows[0].v) || 'Oracle';
    return { ok: true, mensagem: `Conexão estabelecida · ${v}` };
  } finally {
    await conn.close().catch(() => {});
  }
}

async function fetchRows(cfg, { tabela, campos }) {
  const conn = await conectar(cfg);
  try {
    const cols = Object.entries(campos)
      .map(([variavel, campo]) => `${citarOra(campo)} AS "${variavel}"`)
      .join(', ');
    const r = await conn.execute(`SELECT ${cols} FROM ${citarOra(tabela)}`);
    return r.rows;
  } finally {
    await conn.close().catch(() => {});
  }
}

module.exports = { tipo: 'oracle', rotulo: 'Oracle (Protheus)', test, fetchRows };
