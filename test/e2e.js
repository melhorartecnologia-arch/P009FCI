/**
 * Percurso end-to-end da aplicação: exercita todas as telas e captura as
 * imagens usadas no manual do usuário.
 * Uso: node e2e.js [--shots pasta] [--perfil email]
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FCI_URL || 'http://127.0.0.1:3010';
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1]
  : path.join(__dirname, 'shots-v2');
fs.mkdirSync(SHOTS, { recursive: true });

const erros = [];
const feitos = [];

async function tira(page, nome, descricao) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, nome + '.png') });
  feitos.push(`${nome} — ${descricao}`);
  console.log('  ✓', nome, '·', descricao);
}

async function entrar(page, email, senha = 'cci@2026') {
  // Entra pela RAIZ, não por #/login: é o caminho real do usuário e o único que
  // exercita a rota pós-autenticação quando o hash já vale «#/cenarios».
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 10000 });
  await page.fill('#login-email', email);
  await page.fill('#login-senha', senha);
  await page.click('#form-login button[type=submit]');
  await page.waitForSelector('.layout', { timeout: 10000 });
  await page.waitForSelector('.sidebar', { timeout: 10000 });
  if (await page.$('#form-login')) erros.push(`login por ${email} não trocou de tela (RF-004)`);
  await page.waitForTimeout(600);
}

async function irPara(page, hash, seletor) {
  await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
  if (seletor) {
    try { await page.waitForSelector(seletor, { timeout: 9000 }); }
    catch { erros.push(`seletor ausente em ${hash}: ${seletor}`); }
  }
  await page.waitForTimeout(550);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 950 } });
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('ERR_CERT') && !t.includes('favicon') && !t.includes('fonts.g')) {
      erros.push('console: ' + t.slice(0, 180));
    }
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) erros.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`);
  });

  console.log('== Login e painel de cenários ==');
  await page.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 10000 });
  await tira(page, '01-login', 'Tela de acesso por perfil de área');

  await entrar(page, 'custos@cci.local');
  await tira(page, '02-cenarios', 'Painel de cenários com indicadores');

  // garante ao menos um cenário
  if (!(await page.$('.cenario-card'))) {
    const btn = await page.$('#btn-novo');
    if (btn) {
      await btn.click();
      await page.waitForSelector('#m-nome', { timeout: 6000 });
      await page.fill('#m-nome', 'Orçamento Anual 2027');
      await page.fill('#m-ciclo', '2027');
      await page.click('#m-criar');
      await page.waitForTimeout(2500);
    }
  }

  const idCenario = await page.evaluate(async () => {
    const r = await fetch('/api/cenarios', { headers: { Authorization: 'Bearer ' + localStorage.getItem('fci.token') } });
    const j = await r.json();
    return j.cenarios && j.cenarios.length ? j.cenarios[0].id : null;
  });
  console.log('  cenário em uso:', idCenario);

  console.log('== Simulação (todas as abas) ==');
  const abas = [
    ['estrutura', '03-sim-estrutura', 'Estrutura em cascata MP → PI → PA'],
    ['origem', '04-sim-origem', 'Origem e conteúdo de importação'],
    ['cambio', '05-sim-cambio', 'Simulação cambial e valor aduaneiro'],
    ['volumes', '06-sim-volumes', 'Volumes, preços e destinos por UF'],
    ['calculo', '07-sim-calculo', 'Memória de cálculo, enquadramento e ICMS-ST'],
    ['validacao', '08-sim-validacao', 'Diagnóstico consolidado da estrutura'],
    ['massa', '09-sim-massa', 'Alterações em massa por grupo de insumo'],
    ['governanca', '10-sim-governanca', 'Governança: modo, validação, congelamento'],
  ];
  for (const [aba, nome, desc] of abas) {
    await irPara(page, `#/sim/${idCenario}/${aba}`, '.sim-topo, .pagina');
    await tira(page, nome, desc);
  }

  console.log('== Comparação, alertas e relatório ==');
  await irPara(page, '#/comparar', '.pagina');
  await tira(page, '11-comparacao', 'Matriz comparativa de CI% por produto e cenário');
  await irPara(page, '#/alertas', '.pagina');
  await tira(page, '12-alertas', 'Alertas de faixa, reemissão e risco fiscal');
  await irPara(page, `#/relatorio/${idCenario}`, '.pagina');
  await tira(page, '13-relatorio', 'Relatório executivo consolidado');

  console.log('== Dados mestres ==');
  await entrar(page, 'ti@cci.local');
  await irPara(page, '#/integracoes', '.int-card');
  await tira(page, '14-integracoes', 'Integrações e fontes de dados');
  await irPara(page, '#/parametros', '.faixa-card');
  await tira(page, '15-parametros', 'Parâmetros mestres do motor');
  await irPara(page, '#/permissoes', '.perm-tabela, .pagina');
  await tira(page, '16-permissoes', 'Matriz de permissões por área e perfil');
  await irPara(page, '#/usuarios', '.tabela');
  await tira(page, '17-usuarios', 'Administração de usuários e perfis');

  console.log('== Restrição por perfil ==');
  await entrar(page, 'pricing@cci.local');
  await irPara(page, '#/integracoes', '.pagina');
  await tira(page, '18-consulta', 'Perfil sem permissão em modo consulta');

  await browser.close();
  console.log('\n' + feitos.length + ' telas capturadas em ' + SHOTS);
  if (erros.length) {
    console.log('\nPROBLEMAS (' + erros.length + '):');
    [...new Set(erros)].slice(0, 25).forEach((e) => console.log('  ✗', e));
    process.exit(1);
  }
  console.log('Nenhum erro de console ou HTTP 5xx.');
})().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
