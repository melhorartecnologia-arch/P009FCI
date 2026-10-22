/**
 * Simulador FCI — SPA em JavaScript puro (ESM, sem build).
 * Casca da aplicação: navegação, contexto compartilhado e utilidades de tela.
 */
import { api, usuarioAtual, limparSessao } from './api.js';
import { esc, iniciais } from './format.js';
import { telaLogin } from './views/login.js';
import { telaCenarios } from './views/cenarios.js';
import { telaSimulacao } from './views/simulacao.js';
import { telaComparacao } from './views/comparacao.js';
import { telaAlertas } from './views/alertas.js';
import { telaRelatorio } from './views/relatorio.js';
import { telaIntegracoes } from './views/integracoes.js';
import { telaParametros } from './views/parametros.js';
import { telaUsuarios } from './views/usuarios.js';
import { telaPermissoes } from './views/permissoes.js';

const appEl = document.getElementById('app');

const ROTAS = [
  { padrao: /^#\/cenarios$/,                vista: telaCenarios,    nav: 'cenarios' },
  { padrao: /^#\/sim\/([^/]+)(?:\/([^/]+))?$/, vista: telaSimulacao, nav: 'sim' },
  { padrao: /^#\/comparar$/,                vista: telaComparacao,  nav: 'comparar' },
  { padrao: /^#\/alertas$/,                 vista: telaAlertas,     nav: 'alertas' },
  { padrao: /^#\/relatorio\/([^/]+)$/,      vista: telaRelatorio,   nav: 'relatorio' },
  { padrao: /^#\/integracoes$/,             vista: telaIntegracoes, nav: 'integracoes' },
  { padrao: /^#\/parametros$/,              vista: telaParametros,  nav: 'parametros' },
  { padrao: /^#\/permissoes$/,              vista: telaPermissoes,  nav: 'permissoes' },
  { padrao: /^#\/usuarios$/,                vista: telaUsuarios,    nav: 'usuarios' },
];

/* ---------------------------------------------------------------- toasts */
export function toast(mensagem, tipo = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = mensagem;
  box.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 8000 : 4500);
}

/* ---------------------------------------------------------------- modais */
export function abrirModal(html, opcoes = {}) {
  fecharModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-fundo';
  wrap.id = 'modal-ativo';
  wrap.innerHTML = `<div class="modal ${opcoes.largo ? 'largo' : ''}">${html}</div>`;
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && !opcoes.fixo) fecharModal(); });
  document.body.appendChild(wrap);
  document.addEventListener('keydown', escFecha);
  return wrap;
}
function escFecha(e) { if (e.key === 'Escape') fecharModal(); }
export function fecharModal() {
  const m = document.getElementById('modal-ativo');
  if (m) m.remove();
  document.removeEventListener('keydown', escFecha);
}

/* -------------------------------------------------------- painel lateral */
export function abrirPainel(html) {
  fecharPainel();
  const el = document.createElement('aside');
  el.className = 'painel-lateral';
  el.id = 'painel-ativo';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}
export function fecharPainel() {
  const p = document.getElementById('painel-ativo');
  if (p) p.remove();
}

/* ------------------------------------------------------------- navegação */
/**
 * Atribuir ao hash o valor que ele já tem não dispara `hashchange` — e esse
 * evento é o único gatilho de re-renderização. Sem o desvio abaixo, entrar pela
 * raiz da aplicação (onde o bootstrap já fixa «#/cenarios») e autenticar
 * deixaria o usuário parado no formulário de login, com a sessão gravada e sem
 * mensagem de erro, até recarregar a página.
 */
function navegar(hash) {
  if ((window.location.hash || '') === hash) renderizar();
  else window.location.hash = hash;
}

function shell(usuario, navAtiva, alertCount) {
  const admin = usuario.is_admin;
  const item = (nav, hash, icone, rotulo, badge = '') => `
    <button class="nav-item ${navAtiva === nav ? 'ativo' : ''}" data-hash="${hash}">
      <span class="icone">${icone}</span><span class="rotulo">${rotulo}</span>${badge}
    </button>`;
  return `
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="cubo">CCI</div>
        <div>
          <div class="t1">Simulador FCI</div>
          <div class="t2">Cidade Imperial · Frutal-MG</div>
        </div>
      </div>
      <nav>
        <div class="nav-secao">SIMULAÇÃO</div>
        ${item('cenarios', '#/cenarios', '▦', 'Cenários')}
        ${item('sim', '#/cenarios', '⚗', 'Simulação')}
        ${item('comparar', '#/comparar', '⇆', 'Comparação')}
        ${item('alertas', '#/alertas', '🔔', 'Alertas', alertCount ? `<span class="badge err">${alertCount}</span>` : '')}
        ${item('relatorio', '#/cenarios', '📄', 'Relatório')}
        <div class="nav-secao">DADOS MESTRES</div>
        ${item('integracoes', '#/integracoes', '🗄', 'Integrações')}
        ${item('parametros', '#/parametros', '⚙', 'Parâmetros')}
        ${item('permissoes', '#/permissoes', '🔑', 'Permissões')}
        ${admin ? item('usuarios', '#/usuarios', '👥', 'Usuários') : ''}
      </nav>
      <div class="sidebar-rodape">
        <div class="titulo">PERFIL ATIVO</div>
        <div class="perfil-card">
          <div class="avatar">${esc(iniciais(usuario.nome))}</div>
          <div style="line-height:1.2;flex:1;min-width:0;">
            <div class="nome">${esc(usuario.nome)}</div>
            <div class="area">${esc(usuario.area)} · ${esc(usuario.perfil || '')}</div>
          </div>
        </div>
        <button class="btn-sair" id="btn-sair">Encerrar sessão</button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div style="flex:1;min-width:0;">
          <div class="contexto" id="topo-titulo"><h1>…</h1></div>
          <div class="sub" id="topo-sub"></div>
        </div>
        <button class="sino" data-hash="#/alertas" title="Alertas">🔔${alertCount ? `<span class="badge">${alertCount}</span>` : ''}</button>
      </header>
      <div class="conteudo" id="conteudo"></div>
    </main>
  </div>`;
}

function definirTopo(titulo, sub = '', contextoHtml = '') {
  const t = document.getElementById('topo-titulo');
  const s = document.getElementById('topo-sub');
  if (t) t.innerHTML = `<h1>${titulo}</h1>${contextoHtml}`;
  if (s) s.innerHTML = sub;
}

let alertCountCache = 0;
export function definirAlertas(n) {
  if (n === alertCountCache) return;
  alertCountCache = n;
  const sino = document.querySelector('.sino');
  const navBadge = document.querySelector('.nav-item.ativo .badge, .nav-item .badge.err');
  if (sino) sino.innerHTML = '🔔' + (n ? `<span class="badge">${n}</span>` : '');
  if (navBadge) { if (n) navBadge.textContent = n; else navBadge.remove(); }
}

/** Capacidade do perfil ativo na matriz de permissões (RF-035 · RF-039). */
function pode(acao) {
  const u = usuarioAtual();
  if (!u) return false;
  if (u.is_admin && ['integracoes', 'parametros', 'usuarios'].includes(acao)) return true;
  return (u.acoes || []).includes(acao);
}

const ctx = {
  api, navegar, toast, abrirModal, fecharModal, abrirPainel, fecharPainel,
  definirTopo, definirAlertas, pode,
  get usuario() { return usuarioAtual(); },
};

async function renderizar() {
  const usuario = usuarioAtual();
  const hash = window.location.hash || '#/cenarios';

  if (!usuario || hash === '#/login') {
    appEl.innerHTML = '';
    telaLogin(appEl, ctx);
    return;
  }

  const rota = ROTAS.find((r) => r.padrao.test(hash)) || ROTAS[0];
  const params = (hash.match(rota.padrao) || []).slice(1);

  appEl.innerHTML = shell(usuario, rota.nav, alertCountCache);
  appEl.querySelectorAll('[data-hash]').forEach((el) => {
    el.addEventListener('click', () => navegar(el.dataset.hash));
  });
  document.getElementById('btn-sair').addEventListener('click', () => {
    limparSessao();
    navegar('#/login');
  });

  const conteudo = document.getElementById('conteudo');
  conteudo.innerHTML = '<div class="carregando">Carregando</div>';
  try {
    await rota.vista(conteudo, ctx, params);
  } catch (err) {
    console.error(err);
    conteudo.innerHTML = `<div class="pagina"><div class="aviso-erro"><span>✕</span>
      <div><b>Não foi possível carregar a tela.</b> ${esc(err.message)}</div></div></div>`;
  }
}

window.addEventListener('hashchange', () => { fecharPainel(); fecharModal(); renderizar(); });
if (!window.location.hash) window.location.hash = '#/cenarios';
renderizar();
