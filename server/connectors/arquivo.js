'use strict';
/**
 * Conector de arquivo local (carga complementar / contingência — risco R-03).
 * Lê JSON (array de objetos) ou CSV (primeira linha = cabeçalho) do diretório
 * `dados/` da aplicação. `tabela` do mapeamento é o nome do arquivo.
 */
const fs = require('fs');
const path = require('path');

function dirDados(cfg) {
  const dir = (cfg.opcoes && cfg.opcoes.diretorio) || path.join(process.cwd(), 'dados');
  return path.resolve(dir);
}

function caminhoSeguro(cfg, arquivo) {
  const base = dirDados(cfg);
  const alvo = path.resolve(base, String(arquivo || ''));
  if (!alvo.startsWith(base + path.sep) && alvo !== base) {
    throw new Error('Caminho de arquivo fora do diretório de dados da aplicação.');
  }
  return alvo;
}

function lerCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!linhas.length) return [];
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].split(sep).map((c) => c.trim());
  return linhas.slice(1).map((l) => {
    const cols = l.split(sep);
    const obj = {};
    cab.forEach((c, i) => { obj[c] = (cols[i] == null ? '' : cols[i].trim()); });
    return obj;
  });
}

function lerArquivo(cfg, arquivo) {
  const alvo = caminhoSeguro(cfg, arquivo);
  if (!fs.existsSync(alvo)) throw new Error(`Arquivo não encontrado: ${path.basename(alvo)} (diretório dados/).`);
  const texto = fs.readFileSync(alvo, 'utf8');
  if (alvo.toLowerCase().endsWith('.json')) {
    const json = JSON.parse(texto);
    return Array.isArray(json) ? json : [json];
  }
  return lerCsv(texto);
}

async function test(cfg) {
  const dir = dirDados(cfg);
  if (!fs.existsSync(dir)) throw new Error(`Diretório de dados inexistente: ${dir}`);
  const arquivos = fs.readdirSync(dir).filter((f) => /\.(json|csv)$/i.test(f));
  return { ok: true, mensagem: `Diretório acessível · ${arquivos.length} arquivo(s) de dados disponível(is)` };
}

async function fetchRows(cfg, { tabela, campos }) {
  const linhas = lerArquivo(cfg, tabela);
  return linhas.map((item) => {
    const out = {};
    for (const [variavel, campo] of Object.entries(campos)) out[variavel] = item[campo];
    return out;
  });
}

module.exports = { tipo: 'arquivo', rotulo: 'Arquivo local (JSON/CSV)', test, fetchRows };
