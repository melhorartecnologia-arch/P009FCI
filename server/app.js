'use strict';
const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth.routes');
const fontesRoutes = require('./routes/fontes.routes');
const parametrosRoutes = require('./routes/parametros.routes');
const cenariosRoutes = require('./routes/cenarios.routes');
const usuariosRoutes = require('./routes/usuarios.routes');

function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  // API
  app.use('/api/auth', authRoutes);
  app.use('/api/fontes', fontesRoutes);
  app.use('/api/parametros', parametrosRoutes);
  app.use('/api/cenarios', cenariosRoutes);
  app.use('/api/usuarios', usuariosRoutes);

  app.get('/api/saude', (req, res) => {
    res.json({ ok: true, aplicacao: 'Simulador FCI', versao: '0.1.0 · Semana 1' });
  });

  // Front-end estático (SPA em JavaScript puro)
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // Tratamento central de erros — mensagens em português (RNF-03)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[erro]', err);
    res.status(status).json({
      erro: err.message || 'Erro interno do servidor.',
      ...(err.parcial ? { parcial: err.parcial } : {}),
    });
  });

  return app;
}

module.exports = { criarApp };
