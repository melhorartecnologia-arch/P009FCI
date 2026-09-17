'use strict';
/** Aplica os arquivos sql/*.sql em ordem no banco configurado no .env. */
const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db');

async function main() {
  const dir = path.join(__dirname, '..', 'sql');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');
    process.stdout.write(`Aplicando ${arquivo}… `);
    await pool.query(sql);
    console.log('ok');
  }
  await pool.end();
  console.log('Migração concluída.');
}

main().catch((err) => { console.error('Falha na migração:', err.message); process.exit(1); });
