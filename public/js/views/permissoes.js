/**
 * Matriz de permissões por área e perfil (RF-035 · RF-039 · RF-100).
 *
 * Tela de consulta: mostra, para cada área da cervejaria, o perfil atribuído e
 * quais capacidades do simulador estão habilitadas. A linha da área do usuário
 * logado é destacada e o rodapé explica a regra de impedimento — nenhuma ação
 * restrita é oferecida sem permissão, mas a consulta permanece sempre liberada
 * (RF-100).
 */
import { esc } from '../format.js';

export async function telaPermissoes(el, ctx) {
  ctx.definirTopo(
    'Permissões por área e perfil',
    'RF-035 · RF-039 · RF-100 — capacidades habilitadas por área; a consulta permanece liberada a todos os perfis'
  );

  const m = await ctx.api.get('/permissoes/matriz');
  const grupos = m.grupos || [...new Set(m.capacidades.map((c) => c.grupo))];
  const minha = m.areas.find((a) => a.ativa) || null;

  const cabecaGrupos = grupos.map((g) => {
    const n = m.capacidades.filter((c) => c.grupo === g).length;
    return `<th colspan="${n}" style="border-left:1px solid var(--line);">${esc(g.toUpperCase())}</th>`;
  }).join('');

  const cabecaCaps = m.capacidades.map((c, i) => {
    const primeiraDoGrupo = i === 0 || m.capacidades[i - 1].grupo !== c.grupo;
    return `<th title="${esc(c.rotulo)}" style="${primeiraDoGrupo ? 'border-left:1px solid var(--line);' : ''}font-weight:500;color:var(--ink-3);">
      <div style="writing-mode:vertical-rl;transform:rotate(180deg);height:104px;margin:0 auto;white-space:nowrap;font-size:10px;">${esc(c.rotulo)}</div>
    </th>`;
  }).join('');

  const linhas = m.areas.map((a) => `
    <tr class="${a.ativa ? 'ativa' : ''}">
      <td class="area" title="${esc(a.atribuicao)}">
        ${esc(a.area)}${a.ativa ? ' <span class="chip" style="background:var(--gold);color:#272525;font-size:9px;">você</span>' : ''}
        <div style="font-weight:400;font-size:10px;color:var(--ink-3);margin-top:1px;">${esc(a.perfil)}</div>
      </td>
      ${m.capacidades.map((c, i) => {
        const primeiraDoGrupo = i === 0 || m.capacidades[i - 1].grupo !== c.grupo;
        const ok = a.permissoes[c.chave];
        return `<td style="${primeiraDoGrupo ? 'border-left:1px solid var(--line);' : ''}"
                   title="${esc(a.area)} · ${esc(c.rotulo)}: ${ok ? 'habilitado' : 'não habilitado'}"
                   class="${ok ? 'perm-sim' : 'perm-nao'}">${ok ? '●' : '○'}</td>`;
      }).join('')}
    </tr>`).join('');

  const minhasAcoes = (m.usuario.acoes || []);
  const chipsMinhas = m.capacidades.map((c) => {
    const ok = minhasAcoes.includes(c.chave) || (m.usuario.is_admin && ['integracoes', 'parametros', 'usuarios'].includes(c.chave));
    return `<span class="chip" style="background:${ok ? 'var(--ok-bg)' : 'var(--line-2)'};color:${ok ? 'var(--ok-fg)' : 'var(--ink-3)'};">
      ${ok ? '✓' : '—'} ${esc(c.rotulo)}</span>`;
  }).join('');

  el.innerHTML = `
  <div class="pagina" style="max-width:1500px;">
    <div class="rel-bloco">
      <header>
        <h3>Seu perfil ativo</h3>
        <span class="chip" style="background:var(--gold-soft);color:var(--gold-d);border:1px solid #e6d6b6;">${esc(m.usuario.perfil || '—')}</span>
      </header>
      <div class="rel-ident">
        <div class="campo-ident"><div class="rot">USUÁRIO</div><div class="val">${esc(m.usuario.nome)}</div></div>
        <div class="campo-ident"><div class="rot">ÁREA</div><div class="val">${esc(m.usuario.area)}</div></div>
        <div class="campo-ident"><div class="rot">PERFIL</div><div class="val">${esc(m.usuario.perfil || '—')}</div></div>
        <div class="campo-ident"><div class="rot">ADMINISTRADOR</div><div class="val">${m.usuario.is_admin ? 'Sim — dados mestres liberados' : 'Não'}</div></div>
      </div>
      <div style="padding:0 16px 14px;">
        <div style="font-size:11.5px;color:var(--ink-2);line-height:1.6;margin-bottom:10px;">
          <b>Atribuição:</b> ${esc(m.usuario.atribuicao || (minha && minha.atribuicao) || '—')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${chipsMinhas}</div>
      </div>
    </div>

    <div class="rel-bloco">
      <header><h3>Matriz de capacidades por área (RF-039)</h3>
        <span style="font-size:11px;color:var(--ink-3);">● habilitado · ○ não habilitado</span></header>
      <div style="overflow-x:auto;">
        <table class="perm-tabela">
          <thead>
            <tr><th class="area" rowspan="2">ÁREA · PERFIL</th>${cabecaGrupos}</tr>
            <tr>${cabecaCaps}</tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>

    <div class="aviso-info">
      <b>Regra de impedimento (RF-035 · RF-100).</b> Ações fora do perfil aparecem desabilitadas e, ao
      serem tentadas, o sistema devolve a mensagem indicando a ação, o perfil ativo e a área
      responsável — sem travar a navegação. A <b>consulta de cenários, cálculos, comparações,
      alertas e relatórios permanece liberada a todos os perfis</b>; o perfil restringe apenas a
      alteração e a decisão. O perfil de cada usuário é definido na tela <a href="#/usuarios">Usuários</a>
      pelo administrador de TI.
    </div>
    <div class="nota-rodape">
      A matriz é derivada da tabela de atores da especificação de requisitos — mesma fonte usada pelo
      servidor para autorizar cada chamada (RNF-09), de modo que a tela nunca oferece algo que a API
      recusaria.
    </div>
  </div>`;
}
