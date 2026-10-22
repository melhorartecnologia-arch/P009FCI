'use strict';
const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth.routes');
const fontesRoutes = require('./routes/fontes.routes');
const parametrosRoutes = require('./routes/parametros.routes');
const cenariosRoutes = require('./routes/cenarios.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const permissoesRoutes = require('./routes/permissoes.routes');
const simulacaoRoutes = require('./routes/simulacao.routes');
const governancaRoutes = require('./routes/governanca.routes');
const comparacaoRoutes = require('./routes/comparacao.routes');
const analiseRoutes = require('./routes/analise.routes');
const relatorioRoutes = require('./routes/relatorio.routes');

function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));

  // --- Sub-rotas do cenário (montadas antes do router do cenário para que os
  // caminhos específicos tenham precedência sobre /:id)
  cenariosRoutes.use('/:id/sim', simulacaoRoutes);
  cenariosRoutes.use('/:id/gov', governancaRoutes.governanca || governancaRoutes);
  cenariosRoutes.use('/:id/relatorio', relatorioRoutes);

  // --- API
  app.use('/api/auth', authRoutes);
  app.use('/api/fontes', fontesRoutes);
  app.use('/api/parametros', parametrosRoutes);
  app.use('/api/cenarios', cenariosRoutes);
  app.use('/api/usuarios', usuariosRoutes);
  app.use('/api/permissoes', permissoesRoutes);
  app.use('/api/comparacao', comparacaoRoutes);
  app.use('/api/analise', analiseRoutes);
  if (governancaRoutes.validacoes) app.use('/api/validacoes', governancaRoutes.validacoes);

  app.get('/api/saude', (req, res) => {
    res.json({
      ok: true,
      aplicacao: 'Simulador FCI',
      versao: '1.0.0',
      escopo: 'RF-001 a RF-100 · RN-01 a RN-12 · RNF-01 a RNF-10',
    });
  });

  // --- Front-end estático (SPA em JavaScript puro) + motor compartilhado
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // --- Tratamento central de erros, em português do Brasil (RNF-03)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[erro]', err);
    res.status(status).json({
      erro: err.message || 'Erro interno do servidor.',
      ...(err.detalhe ? { detalhe: err.detalhe } : {}),
      ...(err.parcial ? { parcial: err.parcial } : {}),
    });
  });

  return app;
}

module.exports = { criarApp };
