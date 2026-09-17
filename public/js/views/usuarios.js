import { esc } from '../format.js';

export async function telaUsuarios(el, ctx) {
  ctx.definirTopo('Usuários e perfis', 'Matriz de permissões por área (RF-100 · RNF-09) — administração restrita ao perfil TI');

  const { usuarios, areas } = await ctx.api.get('/usuarios');
  const podeEditar = ctx.usuario.is_admin;

  el.innerHTML = `
  <div class="pagina" style="max-width:1000px;">
    ${podeEditar ? '' : '<div class="aviso-restricao">🔒 Administração de usuários restrita ao perfil <b>Administrador (TI)</b>.</div>'}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div style="font-size:11.5px;color:var(--ink-3);">Perfis por área: Simulador · Validador · Especialista · Aprovador · Administrador. Integrações e parâmetros mestres são editáveis apenas pelo Administrador (TI); demais áreas em modo consulta.</div>
      ${podeEditar ? '<button class="btn btn-ouro" id="btn-novo-usuario">＋ Novo usuário</button>' : ''}
    </div>
    <div class="card" style="overflow:hidden;">
      <table class="tabela">
        <thead><tr><th>NOME</th><th>E-MAIL</th><th>ÁREA</th><th>PERFIL</th><th>SITUAÇÃO</th>${podeEditar ? '<th></th>' : ''}</tr></thead>
        <tbody>
        ${usuarios.map((u) => `
          <tr>
            <td><b>${esc(u.nome)}</b>${u.is_admin ? ' <span class="chip" style="background:var(--gold-soft);color:var(--gold-d);">ADMIN</span>' : ''}</td>
            <td class="mono" style="font-size:11px;">${esc(u.email)}</td>
            <td>${esc(u.area)}</td>
            <td>${esc(u.perfil)}</td>
            <td>${u.ativo ? '<span class="chip" style="background:var(--ok-bg);color:var(--ok-fg);">ATIVO</span>' : '<span class="chip" style="background:var(--line-2);color:var(--ink-3);">INATIVO</span>'}</td>
            ${podeEditar ? `<td><button class="btn btn-borda btn-mini" data-editar="${u.id}">Editar</button></td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

  if (!podeEditar) return;
  el.querySelector('#btn-novo-usuario')?.addEventListener('click', () => modalUsuario(ctx, areas, null, () => telaUsuarios(el, ctx)));
  el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
    const u = usuarios.find((x) => String(x.id) === b.dataset.editar);
    modalUsuario(ctx, areas, u, () => telaUsuarios(el, ctx));
  }));
}

function modalUsuario(ctx, areas, usuario, aoSalvar) {
  const u = usuario || {};
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:16px;">👥</div>
      <div style="flex:1;"><h2>${usuario ? 'Editar usuário' : 'Novo usuário'}</h2>
      <div class="sub">O perfil é derivado da área conforme a matriz de permissões (RF-100).</div></div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="campo"><span>NOME</span><input id="u-nome" value="${esc(u.nome || '')}"></div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px;">
        <div class="campo"><span>E-MAIL</span><input id="u-email" type="email" value="${esc(u.email || '')}" ${usuario ? 'disabled' : ''}></div>
        <div class="campo"><span>ÁREA</span><select id="u-area">${areas.map((a) => `<option ${a === u.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="campo"><span>${usuario ? 'NOVA SENHA (OPCIONAL)' : 'SENHA INICIAL'}</span><input id="u-senha" type="password" autocomplete="new-password"></div>
        <div class="campo"><span>SITUAÇÃO</span><select id="u-ativo"><option value="true" ${u.ativo !== false ? 'selected' : ''}>Ativo</option><option value="false" ${u.ativo === false ? 'selected' : ''}>Inativo</option></select></div>
      </div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="u-salvar">Salvar</button>
    </div>`);
  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => b.onclick = ctx.fecharModal);
  wrap.querySelector('#u-salvar').onclick = async () => {
    const corpo = {
      nome: wrap.querySelector('#u-nome').value.trim(),
      email: wrap.querySelector('#u-email').value.trim(),
      area: wrap.querySelector('#u-area').value,
      senha: wrap.querySelector('#u-senha').value || undefined,
      ativo: wrap.querySelector('#u-ativo').value === 'true',
    };
    try {
      if (usuario) await ctx.api.put(`/usuarios/${usuario.id}`, corpo);
      else await ctx.api.post('/usuarios', corpo);
      ctx.fecharModal();
      ctx.toast('Usuário salvo.', 'ok');
      aoSalvar();
    } catch (err) { ctx.toast(err.message, 'erro'); }
  };
}
