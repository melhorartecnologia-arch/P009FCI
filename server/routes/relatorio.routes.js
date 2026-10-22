'use strict';
/**
 * Relatório executivo e exportação em PDF — seção 4.6 do contrato interno.
 *
 *   router → montado em /api/cenarios/:id/relatorio
 *
 *   GET /     RF-087 · RF-088  relatório consolidado (JSON) para a tela
 *   GET /pdf  RF-089           exportação em PDF com cabeçalho e rodapé de
 *                              identificação do cenário e da versão em todas
 *                              as páginas
 *
 * As rotas apenas orquestram: chamam o serviço, registram a emissão quando o
 * formato é PDF e devolvem o payload. Impedimentos de perfil vêm de
 * exigirAcao('relatorio') (RF-035 · RF-100) e os erros de regra trafegam por
 * err.status até o tratamento central em app.js (RNF-03).
 */
const express = require('express');
const PDFDocument = require('pdfkit');
const { exigirLogin, exigirAcao } = require('../auth');
const relatorioService = require('../services/relatorio.service');

// mergeParams: o :id do cenário vem do caminho do montador
const router = express.Router({ mergeParams: true });
router.use(exigirLogin);

/**
 * RF-087 · RF-088 — relatório executivo consolidado: identificação do cenário,
 * indicadores, resultado por produto, alertas por área responsável e
 * direcionamentos (automáticos do motor mesclados aos manuais registrados).
 * Consulta não registra emissão — o histórico é gravado apenas no PDF (RF-089).
 */
router.get('/', exigirAcao('relatorio'), async (req, res, next) => {
  try {
    const pacote = await relatorioService.montarRelatorio(req.params.id, {
      base: req.query.base,
      usuario: req.usuario,
    });
    res.json(pacote);
  } catch (err) { next(err); }
});

/**
 * RF-089 — exportação em PDF. A emissão é registrada em «relatorios» antes de
 * iniciar o fluxo (para que uma falha de banco devolva erro em JSON e não um
 * arquivo truncado) e o documento é transmitido por doc.pipe(res).
 */
router.get('/pdf', exigirAcao('relatorio'), async (req, res, next) => {
  let doc = null;
  try {
    const pacote = await relatorioService.montarRelatorio(req.params.id, {
      base: req.query.base,
      usuario: req.usuario,
    });
    await relatorioService.registrarEmissao(pacote, req.usuario, 'pdf');

    const meta = pacote.cenario;
    doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true,                 // exigido para o passe de cabeçalho/rodapé
      info: {
        Title: `Relatório Executivo FCI - ${meta.codigo} v${meta.versao}`,
        Author: 'Simulador FCI · Cervejaria Cidade Imperial',
        Subject: 'Conteúdo de importação por produto - documento gerencial sem validade fiscal (RN-12)',
        Keywords: 'FCI, conteúdo de importação, ICMS, simulação gerencial',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${relatorioService.nomeArquivo(pacote)}"`);
    res.setHeader('Cache-Control', 'no-store');

    // falha no transporte: encerra o fluxo sem tentar reescrever cabeçalhos
    doc.on('error', (erro) => {
      console.error('[relatorio] falha ao gerar o PDF', erro);
      if (!res.headersSent) res.status(500).json({ erro: 'Falha ao gerar o relatório em PDF.' });
      else res.destroy(erro);
    });

    doc.pipe(res);
    relatorioService.escreverPdf(doc, pacote);
    doc.end();
  } catch (err) {
    if (res.headersSent) {
      // o PDF já começou a ser transmitido: encerra para não entregar arquivo parcial
      console.error('[relatorio] erro após o início da transmissão do PDF', err);
      if (doc) doc.removeAllListeners('error');
      return res.destroy(err);
    }
    return next(err);
  }
});

module.exports = router;
