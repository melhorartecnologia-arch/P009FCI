'use strict';
/**
 * Conector REST/JSON genérico (ex.: API de Compras/Contratos, BACEN PTAX).
 * `tabela` do mapeamento é o caminho do recurso (ex.: /fornecedores) e o
 * `campo` é a chave no objeto JSON retornado. Autenticação por opções:
 *   opcoes.authTipo: 'bearer' | 'apikey' | 'basic' | 'nenhum'
 *   opcoes.authHeader: nome do header quando apikey (padrão X-API-Key)
 *   opcoes.caminhoLista: caminho do array na resposta (ex.: "value" p/ OData)
 */

function urlBase(cfg) {
  let host = String(cfg.host || '').trim();
  if (!/^https?:\/\//i.test(host)) {
    host = (cfg.porta === 80 ? 'http://' : 'https://') + host;
  }
  const u = new URL(host);
  if (cfg.porta && ![80, 443].includes(cfg.porta)) u.port = String(cfg.porta);
  return u;
}

function headers(cfg) {
  const h = { Accept: 'application/json' };
  const op = cfg.opcoes || {};
  const tipo = op.authTipo || (cfg.senha ? 'bearer' : 'nenhum');
  if (tipo === 'bearer' && cfg.senha) h.Authorization = `Bearer ${cfg.senha}`;
  if (tipo === 'apikey' && cfg.senha) h[op.authHeader || 'X-API-Key'] = cfg.senha;
  if (tipo === 'basic' && cfg.usuario) {
    h.Authorization = 'Basic ' + Buffer.from(`${cfg.usuario}:${cfg.senha || ''}`).toString('base64');
  }
  return Object.assign(h, op.headers || {});
}

async function chamar(cfg, caminho) {
  const base = urlBase(cfg);
  const path = String(caminho || '').replace(/^GET\s+/i, '').trim();
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, { headers: headers(cfg), signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ao consultar ${url.pathname}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function extrairLista(json, cfg) {
  const caminho = cfg.opcoes && cfg.opcoes.caminhoLista;
  let dados = json;
  if (caminho) for (const p of String(caminho).split('.')) dados = dados ? dados[p] : undefined;
  if (Array.isArray(dados)) return dados;
  if (dados && Array.isArray(dados.value)) return dados.value;   // OData (BACEN PTAX)
  if (dados && Array.isArray(dados.items)) return dados.items;
  if (dados && Array.isArray(dados.data)) return dados.data;
  return dados == null ? [] : [dados];
}

async function test(cfg) {
  const caminho = (cfg.opcoes && cfg.opcoes.caminhoTeste) || cfg.base || '/';
  await chamar(cfg, caminho === '—' ? '/' : caminho);
  return { ok: true, mensagem: `Endpoint respondeu com sucesso (${urlBase(cfg).host})` };
}

async function fetchRows(cfg, { tabela, campos }) {
  const json = await chamar(cfg, tabela);
  const lista = extrairLista(json, cfg);
  return lista.map((item) => {
    const linha = {};
    for (const [variavel, campo] of Object.entries(campos)) {
      let v = item;
      for (const p of String(campo).split('.')) v = v ? v[p] : undefined;
      linha[variavel] = v;
    }
    return linha;
  });
}

module.exports = { tipo: 'rest', rotulo: 'REST API (JSON)', test, fetchRows };
