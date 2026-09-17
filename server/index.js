'use strict';
const { config, exigirSegredos } = require('./config');
const { criarApp } = require('./app');
const { pool } = require('./db');
const sync = require('./services/sync.service');

async function main() {
  exigirSegredos();
  await pool.query('SELECT 1'); // valida conexão com o PostgreSQL local

  const app = criarApp();
  const server = app.listen(config.porta, () => {
    console.log(`Simulador FCI no ar · http://127.0.0.1:${config.porta}`);
  });

  if (config.syncAgendadaAtiva) {
    const n = await sync.iniciarAgendador();
    console.log(`Sincronização agendada ativa para ${n} fonte(s) de dados.`);
  }

  const encerrar = async () => {
    console.log('Encerrando…');
    sync.pararAgendador();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

main().catch((err) => {
  console.error('Falha ao iniciar o Simulador FCI:', err.message);
  process.exit(1);
});
