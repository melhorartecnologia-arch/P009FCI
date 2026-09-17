'use strict';
/**
 * Testes de fumaça da Semana 1 — executados contra o PostgreSQL configurado
 * no .env (npm run setup antes). Cobrem os critérios de aceite:
 * RF-001, RF-002, RF-003, RF-007, RF-090..RF-097, RF-099, RF-100, RNF-05.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { criarApp } = require('../server/app');
const { pool } = require('../server/db');

let server, base;

before(async () => {
  const app = criarApp();
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

async function chamada(metodo, caminho, corpo, token) {
  const opts = { method: metodo, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(corpo);
  }
  const resp = await fetch(base + '/api' + caminho, opts);
  let json = null;
  try { json = await resp.json(); } catch { /* vazio */ }
  return { status: resp.status, json };
}

async function login(email) {
  const r = await chamada('POST', '/auth/login', { email, senha: process.env.SEED_SENHA || 'cci@2026' });
  assert.strictEqual(r.status, 200, `login ${email}: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

test('login inválido é recusado', async () => {
  const r = await chamada('POST', '/auth/login', { email: 'ti@cci.local', senha: 'errada' });
  assert.strictEqual(r.status, 401);
});

test('RF-090/RNF-05 · fontes listadas sem credencial em texto claro', async () => {
  const token = await login('ti@cci.local');
  const r = await chamada('GET', '/fontes', undefined, token);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.fontes.length >= 5, 'seed deve ter 5 fontes');
  for (const f of r.json.fontes) {
    assert.strictEqual(typeof f.possuiCredencial, 'boolean');
    assert.ok(!('credencial' in f) && !('credencial_enc' in f), 'credencial nunca deve sair da API');
    if (f.possuiCredencial) assert.strictEqual(f.credencialMascarada, '••••••••');
  }
});

test('RF-100 · perfil não administrador tem apenas consulta em integrações/parâmetros', async () => {
  const token = await login('custos@cci.local');
  const leitura = await chamada('GET', '/fontes', undefined, token);
  assert.strictEqual(leitura.status, 200);
  assert.strictEqual(leitura.json.somenteLeitura, true, 'consulta deve indicar a restrição');
  const escrita = await chamada('POST', '/fontes/1/testar', undefined, token);
  assert.strictEqual(escrita.status, 403);
  assert.match(escrita.json.erro, /Administrador/);
  const param = await chamada('PUT', '/parametros/gatilho_reemissao', { valor: { pp: 9 } }, token);
  assert.strictEqual(param.status, 403);
});

test('RF-092 · teste de conexão altera status e registra o momento', async () => {
  const token = await login('ti@cci.local');
  const r = await chamada('POST', '/fontes/1/testar', undefined, token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.ok(r.json.testadoEm);
  const lista = await chamada('GET', '/fontes', undefined, token);
  const fonte = lista.json.fontes.find((f) => f.id === 1);
  assert.strictEqual(fonte.status, 'conectado');
  assert.ok(fonte.testadoEm, 'momento da verificação registrado');
});

test('RF-093/094 · sincronização manual carrega staging e registra execução', async () => {
  const token = await login('ti@cci.local');
  const r = await chamada('POST', '/fontes/1/sincronizar', undefined, token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.registros > 0);
  const exec = await chamada('GET', '/fontes/1/execucoes', undefined, token);
  assert.ok(exec.json.execucoes.length >= 1);
  assert.strictEqual(exec.json.execucoes[0].status, 'ok');
  const resumo = await chamada('GET', '/fontes/staging/resumo', undefined, token);
  const entidades = new Set(resumo.json.resumo.map((x) => x.entidade));
  for (const e of ['produto', 'estrutura', 'cst']) assert.ok(entidades.has(e), `staging deve ter ${e}`);
});

test('RF-091 · mapeamento rejeita variável fora do catálogo', async () => {
  const token = await login('ti@cci.local');
  const r = await chamada('PUT', '/fontes/1/mapeamentos', {
    mapeamentos: [{ variavel: 'inexistente.campo', tabela: 'X', campo: 'Y' }],
  }, token);
  assert.strictEqual(r.status, 422);
});

test('RF-095 · falha de integração não derruba a operação nem apaga a última carga', async () => {
  const token = await login('ti@cci.local');
  // Fonte quebrada de propósito (porta errada)
  const criada = await chamada('POST', '/fontes', {
    nome: 'Fonte Quebrada (teste)', conector: 'postgres',
    host: '127.0.0.1', porta: 59999, base: 'nao_existe', usuario: 'x', credencial: 'y',
  }, token);
  assert.strictEqual(criada.status, 201);
  const id = criada.json.fonte.id;
  await chamada('PUT', `/fontes/${id}/mapeamentos`, {
    mapeamentos: [{ variavel: 'cambio.moeda', tabela: 'nada', campo: 'nada' }],
  }, token);
  const syncRuim = await chamada('POST', `/fontes/${id}/sincronizar`, undefined, token);
  assert.strictEqual(syncRuim.status, 502);
  const lista = await chamada('GET', '/fontes', undefined, token);
  const quebrada = lista.json.fontes.find((f) => f.id === id);
  assert.strictEqual(quebrada.status, 'erro');
  assert.ok(quebrada.lastError, 'erro destacado na integração');
  // staging das demais fontes permanece e o cenário continua operável
  const resumo = await chamada('GET', '/fontes/staging/resumo', undefined, token);
  assert.ok(resumo.json.resumo.length > 0, 'última carga válida preservada');
  const cen = await chamada('POST', '/cenarios', { nome: 'Cenário pós-falha (teste RF-095)' }, token);
  assert.strictEqual(cen.status, 201);
  assert.ok(cen.json.cenario.dados.produtos.length > 0, 'cenário abre com os dados já carregados');
  await chamada('DELETE', `/fontes/${id}`, undefined, token);
});

test('RF-001/RF-002 · cenário nasce com id único, v1, rascunho, autor e estrutura integrada', async () => {
  const token = await login('custos@cci.local');
  const r = await chamada('POST', '/cenarios', { nome: 'Orçamento Teste', tipo: 'orcamento', ciclo: '2027' }, token);
  assert.strictEqual(r.status, 201);
  const c = r.json.cenario;
  assert.match(c.codigo, /^CEN-\d{3,}$/);
  assert.strictEqual(c.versao, 1);
  assert.strictEqual(c.status, 'rascunho');
  assert.strictEqual(c.autor_nome, 'Ana Ribeiro');
  assert.ok(c.criado_em);
  // RF-002: estrutura carregada sem digitação manual
  assert.ok(c.dados.produtos.length >= 7, 'produtos PA/PI carregados');
  assert.ok(c.dados.insumos.length >= 20, 'insumos carregados');
  const pa = c.dados.produtos.find((p) => p.id === 'PA-9002');
  assert.ok(pa && pa.componentes.length === 5, 'lista técnica do PA presente');
  assert.ok(pa.saidas.length >= 3, 'saídas por UF carregadas');
  const importado = c.dados.insumos.find((i) => i.id === 'MP-1002');
  assert.strictEqual(importado.classSim, 'importado_direto', 'origem 1 → importado (E-04)');
  const lata = c.dados.insumos.find((i) => i.id === 'MP-3002');
  assert.strictEqual(lata.classSim, 'nacional_ci');
  assert.strictEqual(lata.ciPct, 50, 'origem 3 → CI 50% (E-04)');
});

test('RF-007 · isolamento: editar um cenário não altera outro', async () => {
  const token = await login('controladoria@cci.local');
  const a = (await chamada('POST', '/cenarios', { nome: 'Isolamento A' }, token)).json.cenario;
  const b = (await chamada('POST', '/cenarios', { nome: 'Isolamento B' }, token)).json.cenario;
  const dadosA = a.dados;
  dadosA.cambio.USD = 9.99;
  const upd = await chamada('PUT', `/cenarios/${a.id}/dados`, { dados: dadosA, resumo: 'câmbio de teste' }, token);
  assert.strictEqual(upd.status, 200);
  const bDepois = (await chamada('GET', `/cenarios/${b.id}`, undefined, token)).json.cenario;
  assert.notStrictEqual(bDepois.dados.cambio.USD, 9.99, 'cenário B não pode ser afetado');
  const eventos = await chamada('GET', `/cenarios/${a.id}/eventos`, undefined, token);
  assert.ok(eventos.json.eventos.find((e) => e.tipo === 'edicao'), 'trilha de auditoria registrada');
});

test('RN-10 · cenário congelado bloqueia edição e exige nova versão', async () => {
  const token = await login('controladoria@cci.local');
  const c = (await chamada('POST', '/cenarios', { nome: 'Congelado Teste' }, token)).json.cenario;
  await chamada('PUT', `/cenarios/${c.id}/status`, { status: 'congelado' }, token);
  const upd = await chamada('PUT', `/cenarios/${c.id}/dados`, { dados: c.dados }, token);
  assert.strictEqual(upd.status, 409);
  const dup = await chamada('POST', `/cenarios/${c.id}/duplicar`, {}, token);
  assert.strictEqual(dup.status, 201);
  assert.strictEqual(dup.json.cenario.versao, c.versao + 1, 'duplicação incrementa versão (RF-003)');
});

test('RF-096/097/099 · parâmetros editáveis, persistidos e com histórico', async () => {
  const token = await login('ti@cci.local');
  const gat = await chamada('PUT', '/parametros/gatilho_reemissao', { valor: { pp: 6 } }, token);
  assert.strictEqual(gat.status, 200);
  const invalido = await chamada('PUT', '/parametros/gatilho_reemissao', { valor: { pp: -1 } }, token);
  assert.strictEqual(invalido.status, 422);
  const aliq = await chamada('PUT', '/parametros/aliquotas', { valor: { lista: [4, 6, 7, 11, 12, 18, 23, 25] } }, token);
  assert.strictEqual(aliq.status, 200);
  const lidos = await chamada('GET', '/parametros', undefined, token);
  assert.strictEqual(lidos.json.parametros.gatilho_reemissao.valor.pp, 6);
  const hist = await chamada('GET', '/parametros/gatilho_reemissao/historico', undefined, token);
  assert.ok(hist.json.historico.length >= 1, 'histórico de alteração registrado');
  // volta ao padrão
  await chamada('PUT', '/parametros/gatilho_reemissao', { valor: { pp: 5 } }, token);
});
