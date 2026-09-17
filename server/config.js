'use strict';
require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'production',
  porta: parseInt(process.env.PORT || '3000', 10),
  // Banco da aplicação — PostgreSQL na mesma instância (VPS AWS Ubuntu)
  db: {
    host: process.env.PGHOST || '127.0.0.1',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'fci_simulador',
    user: process.env.PGUSER || 'fci_app',
    password: process.env.PGPASSWORD || '',
    max: parseInt(process.env.PGPOOL_MAX || '10', 10),
  },
  // Chave-mestra para cifrar credenciais de integração (RNF-05).
  // Obrigatória em produção; gere com: openssl rand -hex 32
  secretKey: process.env.FCI_SECRET_KEY || '',
  jwtSecret: process.env.FCI_JWT_SECRET || '',
  jwtExpira: process.env.FCI_JWT_EXPIRA || '12h',
  // Sessões e agendador
  syncAgendadaAtiva: (process.env.FCI_SYNC_AGENDADA || 'true') !== 'false',
};

function exigirSegredos() {
  const faltando = [];
  if (!config.secretKey) faltando.push('FCI_SECRET_KEY');
  if (!config.jwtSecret) faltando.push('FCI_JWT_SECRET');
  if (faltando.length) {
    throw new Error(
      'Variáveis de ambiente obrigatórias ausentes: ' + faltando.join(', ') +
      '. Copie .env.example para .env e preencha (openssl rand -hex 32).'
    );
  }
}

module.exports = { config, exigirSegredos };
