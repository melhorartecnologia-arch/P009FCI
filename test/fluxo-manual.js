/**
 * Percorre o fluxo de 11 etapas que o manual ensina (seção 4), na ordem e com
 * os perfis indicados, pela interface. O manual é o documento entregue ao
 * usuário: se o roteiro dele não fecha, o documento está errado.
 */
// playwright-core é ferramenta de verificação, não dependência da aplicação.
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('Percurso indisponível: playwright-core não está instalado.');
  console.error('Instale com:  npm install --no-save playwright-core');
  process.exit(2);
}
const BASE = process.env.FCI_URL || 'http://127.0.0.1:3000';
const J = { 'Content-Type': 'application/json' };
const SENHA = process.env.SEED_SENHA || 'cci@2026';
const login = async (e) => (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: J,
  body: JSON.stringify({ email: e, senha: SENHA }) })).json()).token;

const falhas = [];
const etapa = (n, texto, ok, detalhe = '') => {
  if (!ok) falhas.push(`etapa ${n}: ${texto}`);
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${String(n).padStart(2)} · ${texto}${detalhe ? ' — ' + detalhe : ''}`);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.FCI_CHROMIUM || '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 1480, height: 950 } });
  const errosJs = [];
  p.on('pageerror', (e) => errosJs.push(e.message));
  p.on('dialog', (d) => d.accept());

  const entrar = async (email) => {
    await p.goto('about:blank');
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => localStorage.clear());
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#login-email');
    await p.fill('#login-email', email);
    await p.fill('#login-senha', SENHA);
    await p.click('#form-login button[type=submit]');
    await p.waitForSelector('.sidebar', { timeout: 10000 });
  };
  const ir = async (hash, sel) => {
    await p.goto('about:blank');
    await p.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
    if (sel) await p.waitForSelector(sel, { timeout: 10000 });
    await p.waitForTimeout(1700);
  };
  const texto = () => p.evaluate(() => document.querySelector('.conteudo').innerText);

  // 1 · abrir o cenário — Custos
  await entrar('custos@cci.local');
  await ir('#/cenarios', '.cenario-card');
  await p.click('#btn-novo');
  await p.waitForSelector('#m-nome', { timeout: 8000 });
  await p.fill('#m-nome', 'Roteiro do manual');
  await p.fill('#m-ciclo', '2027');
  await p.click('#m-criar');
  await p.waitForSelector('.sim-abas, .subabas, [data-aba]', { timeout: 12000 });
  await p.waitForTimeout(2200);
  const id = await p.evaluate(() => (window.location.hash.match(/#\/sim\/(\d+)/) || [])[1]);
  etapa(1, 'Cenários ▸ ＋ Novo cenário (Custos)', !!id, 'cenário ' + id);

  // 2 e 3 · estrutura carregada do ERP, decomposta por SKU
  await ir(`#/sim/${id}/estrutura`, '.pagina');
  const estrutura = await texto();
  etapa(2, 'Simulação ▸ Estrutura mostra a carga do ERP', /MP-|PI-|PA-/.test(estrutura));
  etapa(3, 'estrutura decomposta com insumos por SKU', (estrutura.match(/MP-\d+/g) || []).length >= 3);

  // 4 · classificar origem e conteúdo — Fiscal
  await entrar('fiscal@cci.local');
  await ir(`#/sim/${id}/origem`, '.pagina');
  const origem = await p.evaluate(() => ({
    txt: document.querySelector('.conteudo').innerText,
    editaveis: [...document.querySelectorAll('.conteudo select, .conteudo input')].filter((e) => !e.disabled).length,
  }));
  etapa(4, 'Origem e conteúdo editável pelo Fiscal', origem.editaveis > 0, `${origem.editaveis} campos`);

  // 5 · câmbio — Compras
  await entrar('compras@cci.local');
  await ir(`#/sim/${id}/cambio`, '.pagina');
  const cot = await p.$('input[data-cotacao="USD"]');
  const cotLivre = cot && await cot.evaluate((e) => !e.disabled);
  if (cotLivre) { await cot.fill('6.4'); await cot.dispatchEvent('change'); await p.waitForTimeout(2300); }
  etapa(5, 'Câmbio editável por Compras e cotação aplicada', !!cotLivre);

  // 6 · volumes e preços — Pricing
  await entrar('pricing@cci.local');
  await ir(`#/sim/${id}/volumes`, '.pagina');
  const vol = await p.$('#vol-corpo input[data-saida]');
  const volLivre = vol && await vol.evaluate((e) => !e.disabled);
  if (volLivre) { await vol.fill('1500'); await vol.dispatchEvent('change'); await p.waitForTimeout(2300); }
  etapa(6, 'Volumes e preços editáveis por Pricing', !!volLivre);

  // 7 e 8 · cálculo do CI% e enquadramento
  await entrar('custos@cci.local');
  await ir(`#/sim/${id}/calculo`, '.pagina');
  const calc = await texto();
  etapa(7, 'Cálculo apresenta o CI% em cascata', /CI%/.test(calc) && /%/.test(calc));
  etapa(8, 'enquadramento e alíquota declarados', /nacional|importado/i.test(calc) && /4%|7%|12%/.test(calc));

  // 9 · alertas
  await ir('#/alertas', '.pagina');
  const alertas = await texto();
  etapa(9, 'Alertas abre com gatilho e área responsável', /gatilho/i.test(alertas) && /(alerta|Nenhum alerta)/i.test(alertas));

  // 10 · consolidar — Controladoria
  await entrar('controladoria@cci.local');
  await ir(`#/sim/${id}/governanca`, '#gov-consolidar');
  const btn = await p.$('#gov-consolidar');
  const livre = await btn.evaluate((e) => !e.disabled);
  if (livre) { await btn.click(); await p.waitForTimeout(2800); }
  const st = await (await fetch(`${BASE}/api/cenarios/${id}`, { headers: { Authorization: 'Bearer ' + await login('custos@cci.local') } })).json();
  etapa(10, 'Governança consolida o cenário', st.cenario.status === 'consolidado', 'status ' + st.cenario.status);

  // 11 · encaminhar às áreas — Relatório ▸ Direcionamentos
  await ir(`#/relatorio/${id}`, '.pagina');
  const rel = await texto();
  etapa(11, 'Relatório traz direcionamentos por área', /Direcionamentos/i.test(rel) && /(Compras|Pricing|Fiscal)/.test(rel));

  await b.close();
  if (errosJs.length) falhas.push('erros JS: ' + [...new Set(errosJs)].join(' | '));
  console.log('');
  console.log(falhas.length ? 'FALHAS:\n  ' + falhas.join('\n  ') : 'OK — o roteiro de 11 etapas do manual fecha na aplicação.');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
