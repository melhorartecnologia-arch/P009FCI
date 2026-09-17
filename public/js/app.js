/**
 * Simulador FCI — SPA em JavaScript puro (sem build).
 * Shell + roteador; telas em /js/views.
 */
import { api, usuarioAtual, limparSessao } from './api.js';
import { esc, iniciais } from './format.js';
import { telaLogin } from './views/login.js';
import { telaCenarios } from './views/cenarios.js';
import { telaSimulacao } from './views/simulacao.js';
import { telaIntegracoes } from './views/integracoes.js';
import { telaParametros } from './views/parametros.js';
import { telaAlertas } from './views/alertas.js';
import { telaComparacao } from './views/comparacao.js';
import { telaUsuarios } from './views/usuarios.js';

const appEl = document.getElementById('app');

const ROTAS = [
  { padrao: /^#\/cenarios$/,        vista: telaCenarios,   nav: 'cenarios' },
  { padrao: /^#\/sim\/([^/]+)$/,    vista: telaSimulacao,  nav: 'sim' },
  { padrao: /^#\/comparar$/,        vista: telaComparacao, nav: 'comparar' },
  { padrao: /^#\/alertas$/,         vista: telaAlertas,    nav: 'alertas' },
  { padrao: /^#\/integracoes$/,     vista: telaIntegracoes,nav: 'integracoes' },
  { padrao: /^#\/parametros$/,      vista: telaParametros, nav: 'parametros' },
  { padrao: /^#\/usuarios$/,        vista: telaUsuarios,   nav: 'usuarios' },
];

export function toast(mensagem, tipo = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = mensagem;
  box.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 4200);
}

export function abrirModal(html) {
  fecharModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-fundo';
  wrap.id = 'modal-ativo';
  wrap.innerHTML = `<div class="modal">${html}</div>`;
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) fecharModal(); });
  document.body.appendChild(wrap);
  return wrap;
}
export function fecharModal() {
  const m = document.getElementById('modal-ativo');
  if (m) m.remove();
}

function navegar(hash) { window.location.hash = hash; }

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
        <div class="nav-secao">DADOS MESTRES</div>
        ${item('integracoes', '#/integracoes', '🗄', 'Integrações')}
        ${item('parametros', '#/parametros', '⚙', 'Parâmetros')}
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
  renderizar();
}

const ctx = {
  api, navegar, toast, abrirModal, fecharModal, definirTopo,
  get usuario() { return usuarioAtual(); },
  definirAlertas,
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
  const params = hash.match(rota.padrao) || [];

  appEl.innerHTML = shell(usuario, rota.nav, alertCountCache);
  appEl.querySelectorAll('[data-hash]').forEach((el) => {
    el.addEventListener('click', () => navegar(el.dataset.hash));
  });
  document.getElementById('btn-sair').addEventListener('click', () => {
    limparSessao();
    navegar('#/login');
  });

  const conteudo = document.getElementById('conteudo');
  try {
    await rota.vista(conteudo, ctx, params.slice(1));
  } catch (err) {
    conteudo.innerHTML = `<div class="pagina"><div class="aviso-erro"><span>✕</span><div><b>Não foi possível carregar a tela.</b> ${esc(err.message)}</div></div></div>`;
  }
}

window.addEventListener('hashchange', renderizar);
if (!window.location.hash) window.location.hash = '#/cenarios';
renderizar();
