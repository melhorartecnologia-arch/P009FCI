'use strict';
/**
 * Ponte CommonJS → motor compartilhado (shared/engine.mjs).
 *
 * O motor é um módulo ESM usado tanto pelo navegador quanto pelo servidor, de
 * modo que a prévia exibida na tela e a validação gravada no banco apliquem
 * exatamente a mesma regra (RNF-10). Aqui ele é carregado uma única vez no
 * start da aplicação e exposto de forma síncrona às rotas e serviços.
 */
const path = require('path');
const { pathToFileURL } = require('url');

let modulo = null;

async function initEngine() {
  if (!modulo) {
    const arquivo = path.join(__dirname, '..', 'shared', 'engine.mjs');
    modulo = await import(pathToFileURL(arquivo).href);
  }
  return modulo;
}

function engine() {
  if (!modulo) {
    throw new Error('Motor de cálculo não inicializado — chame initEngine() no start da aplicação.');
  }
  return modulo;
}

module.exports = { initEngine, engine };
