import { api, guardarSessao } from '../api.js';
import { esc } from '../format.js';

export function telaLogin(el, ctx) {
  el.innerHTML = `
  <div class="login-tela">
    <div class="login-card">
      <div class="logo">
        <div class="cubo">CCI</div>
        <div>
          <h1>Simulador FCI</h1>
          <div class="sub">Cervejaria Cidade Imperial · Frutal-MG</div>
        </div>
      </div>
      <form id="form-login">
        <div id="login-erro"></div>
        <div class="campo"><span>E-MAIL CORPORATIVO</span><input type="email" id="login-email" autocomplete="username" required placeholder="area@cci.local"></div>
        <div class="campo"><span>SENHA</span><input type="password" id="login-senha" autocomplete="current-password" required placeholder="••••••••"></div>
        <button class="btn btn-ouro" type="submit" style="justify-content:center;padding:12px;">Entrar</button>
      </form>
      <div class="login-nota">
        Ambiente de simulação gerencial — sem validade fiscal: não substitui a FCI oficial
        nem gera transmissão à SEFAZ (RN-12). Acesso por perfil de área (RF-100).
      </div>
    </div>
  </div>`;

  const form = el.querySelector('#form-login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = el.querySelector('#login-erro');
    erroEl.innerHTML = '';
    const botao = form.querySelector('button');
    botao.disabled = true;
    try {
      const r = await api.post('/auth/login', {
        email: el.querySelector('#login-email').value.trim(),
        senha: el.querySelector('#login-senha').value,
      });
      guardarSessao(r.token, r.usuario);
      ctx.navegar('#/cenarios');
    } catch (err) {
      erroEl.innerHTML = `<div class="login-erro">${esc(err.message)}</div>`;
    } finally {
      botao.disabled = false;
    }
  });
}
