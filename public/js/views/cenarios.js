import { esc, num, pct, dataHora } from '../format.js';
import { resumoCenario, alertasCenario } from '../engine.js';

const ST = {
  rascunho:    { label: 'Rascunho',    bg: '#efeae0', fg: '#8b8681' },
  calculado:   { label: 'Calculado',   bg: '#e9f1eb', fg: '#2f6b46' },
  congelado:   { label: 'Congelado',   bg: '#f4ecdd', fg: '#8a5e12' },
  consolidado: { label: 'Consolidado', bg: '#e6e9f2', fg: '#3d4c7a' },
};

export async function telaCenarios(el, ctx) {
  ctx.definirTopo('Cenários de simulação', 'RF-001 · RF-002 · RF-007 — criação, isolamento e carga integrada da estrutura');

  const [{ cenarios }, { parametros }] = await Promise.all([
    ctx.api.get('/cenarios'),
    ctx.api.get('/parametros'),
  ]);
  const gatilho = (parametros.gatilho_reemissao && parametros.gatilho_reemissao.valor.pp) || 5;
  const podeCriar = (ctx.usuario.acoes || []).includes('criarCenario');

  const resumos = cenarios.map((c) => {
    try { return resumoCenario(c.dados || {}); }
    catch { return { ciMedio: 0, nProdutos: 0, acima40: 0, dist: { baixo: 0, medio: 0, alto: 0 } }; }
  });
  const totalAlertas = cenarios.length
    ? alertasCenario(cenarios[0].dados || {}, gatilho).filter((a) => a.tipo === 'reemissao').length
    : 0;
  ctx.definirAlertas(cenarios.length ? alertasCenario(cenarios[0].dados || {}, gatilho).length : 0);

  const ultimo = resumos[0] || { ciMedio: 0, nProdutos: 0, acima40: 0 };
  const corCi = ultimo.ciMedio > 40 ? 'var(--err)' : ultimo.ciMedio > 0 ? 'var(--ok-fg)' : 'var(--ink)';

  el.innerHTML = `
  <div class="pagina" style="max-width:1500px;">
    <div class="grid-kpi">
      <div class="kpi"><div class="rotulo">CENÁRIOS DE SIMULAÇÃO</div><div class="valor">${cenarios.length}</div><div class="hint">isolados entre si e do cadastro oficial (RF-007)</div></div>
      <div class="kpi"><div class="rotulo">CI% MÉDIO · CENÁRIO MAIS RECENTE</div><div class="valor" style="color:${corCi};">${pct(ultimo.ciMedio)}</div><div class="hint">média ponderada pelos volumes por UF</div></div>
      <div class="kpi"><div class="rotulo">PRODUTOS ACIMA DE 40%</div><div class="valor" style="color:${ultimo.acima40 ? 'var(--err)' : 'var(--ink)'};">${ultimo.acima40}</div><div class="hint">alíquota interestadual de 4% (RN-07)</div></div>
      <div class="kpi"><div class="rotulo">ALERTAS DE REEMISSÃO</div><div class="valor" style="color:${totalAlertas ? 'var(--err)' : 'var(--ink)'};">${totalAlertas}</div><div class="hint">gatilho parametrizado: ${num(gatilho, 1)} p.p. (RF-099)</div></div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:14px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0;font-size:15px;font-weight:600;">Cenários de simulação</h2>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;">Ambiente sem validade fiscal — não substitui a FCI oficial nem gera transmissão à SEFAZ.</div>
      </div>
      <button class="btn btn-ouro" id="btn-novo" ${podeCriar ? '' : 'disabled title="Perfil sem permissão para criar cenários"'}>＋ Novo cenário</button>
    </div>

    ${cenarios.length ? `<div class="grid-cenarios">${cenarios.map((c, i) => cartao(c, resumos[i])).join('')}</div>` : `
      <div class="roadmap-box">
        <div class="titulo">Nenhum cenário criado ainda</div>
        Crie o primeiro cenário — a estrutura de produtos e insumos é carregada automaticamente das fontes de dados integradas (RF-002).
      </div>`}
  </div>`;

  el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => ctx.navegar(`#/sim/${b.dataset.abrir}`)));
  el.querySelectorAll('[data-duplicar]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await ctx.api.post(`/cenarios/${b.dataset.duplicar}/duplicar`, {});
      ctx.toast(`Cenário duplicado como ${r.cenario.codigo} (v${r.cenario.versao}) — o cenário de origem permanece intacto.`, 'ok');
      telaCenarios(el, ctx);
    } catch (err) { ctx.toast(err.message, 'erro'); b.disabled = false; }
  }));
  const btnNovo = el.querySelector('#btn-novo');
  if (btnNovo && podeCriar) btnNovo.addEventListener('click', () => modalNovo(ctx, () => telaCenarios(el, ctx)));
}

function cartao(c, r) {
  const st = ST[c.status] || ST.rascunho;
  const corCi = r.ciMedio > 40 ? '#a03d2c' : r.ciMedio > 0 ? '#2f6b46' : 'var(--ink)';
  const tot = Math.max(1, r.dist.baixo + r.dist.medio + r.dist.alto);
  const origem = c.origem_dados ? `<div style="font-size:10px;color:var(--ink-3);margin-top:6px;">⬇ Carga integrada: ${esc(c.origem_dados)}</div>` : '';
  return `
  <div class="cenario-card">
    <div class="cabeca">
      <div style="min-width:0;">
        <div class="nome">${esc(c.nome)}</div>
        <div class="meta"><span class="mono">${esc(c.codigo)}</span> · ${c.tipo === 'orcamento' ? 'Orçamento' : 'Revisão'} ${esc(c.ciclo || '')} · v${c.versao}</div>
      </div>
      <span class="chip" style="background:${st.bg};color:${st.fg};">${st.label}</span>
    </div>
    <div class="corpo">
      <div class="metricas">
        <div><div class="r">CI% MÉDIO PONDERADO</div><div class="v" style="color:${corCi};">${pct(r.ciMedio)}</div></div>
        <div><div class="r">PRODUTOS</div><div class="v">${r.nProdutos}</div></div>
        <div><div class="r">&gt; 40%</div><div class="v" style="color:${r.acima40 ? '#a03d2c' : 'inherit'};">${r.acima40}</div></div>
      </div>
      <div class="barra-faixas">
        <div style="width:${r.dist.baixo / tot * 100}%;background:#3f7d54;"></div>
        <div style="width:${r.dist.medio / tot * 100}%;background:#b07d1e;"></div>
        <div style="width:${r.dist.alto / tot * 100}%;background:#a03d2c;"></div>
      </div>
      <div class="autor">Autor: ${esc(c.autor_nome)}<br>Atualizado ${dataHora(c.atualizado_em)}</div>
      ${origem}
    </div>
    <div class="acoes">
      <button class="btn btn-escuro" style="flex:1;" data-abrir="${c.id}">Abrir simulação →</button>
      <button class="btn btn-borda" style="width:38px;padding:0;justify-content:center;" title="Duplicar como nova versão (RF-003)" data-duplicar="${c.id}">⎘</button>
    </div>
  </div>`;
}

function modalNovo(ctx, aoCriar) {
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;color:var(--gold-d);">▦</div>
      <div style="flex:1;">
        <h2>Novo cenário de simulação</h2>
        <div class="sub">Identificador único, versão 1, status Rascunho, autor e data (RF-001). A estrutura é carregada das fontes integradas, sem digitação manual (RF-002).</div>
      </div>
      <button class="fechar" id="m-fechar">×</button>
    </div>
    <div class="corpo">
      <div class="campo"><span>NOME DO CENÁRIO</span><input id="m-nome" placeholder="ex.: Orçamento Anual 2027" autofocus></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="campo"><span>TIPO</span>
          <select id="m-tipo"><option value="orcamento">Orçamento anual</option><option value="revisao" selected>Revisão mensal / what-if</option></select>
        </div>
        <div class="campo"><span>CICLO</span><input id="m-ciclo" placeholder="ex.: 2027 ou Set/2026"></div>
      </div>
      <div class="aviso-info">O cenário nasce isolado: alterações nele não afetam outros cenários nem o cadastro oficial de origem (RF-007 · RNF-06).</div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" id="m-cancelar">Cancelar</button>
      <button class="btn btn-ouro" id="m-criar">Criar cenário</button>
    </div>`);
  wrap.querySelector('#m-fechar').onclick = ctx.fecharModal;
  wrap.querySelector('#m-cancelar').onclick = ctx.fecharModal;
  wrap.querySelector('#m-criar').onclick = async () => {
    const nome = wrap.querySelector('#m-nome').value.trim();
    if (!nome) { ctx.toast('Informe o nome do cenário.', 'erro'); return; }
    const botao = wrap.querySelector('#m-criar');
    botao.disabled = true;
    try {
      const r = await ctx.api.post('/cenarios', {
        nome,
        tipo: wrap.querySelector('#m-tipo').value,
        ciclo: wrap.querySelector('#m-ciclo').value.trim(),
      });
      ctx.fecharModal();
      ctx.toast(`Cenário ${r.cenario.codigo} criado com estrutura integrada (${(r.cenario.dados.produtos || []).length} produtos · ${(r.cenario.dados.insumos || []).length} insumos).`, 'ok');
      ctx.navegar(`#/sim/${r.cenario.id}`);
      if (aoCriar) aoCriar();
    } catch (err) {
      ctx.toast(err.message, 'erro');
      botao.disabled = false;
    }
  };
}
