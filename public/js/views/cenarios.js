/**
 * Painel de cenários (RF-001 a RF-008).
 *
 *   RF-001  criação com identificador único, versão, status, autor e data
 *   RF-002  carga automática da estrutura a partir das fontes integradas
 *   RF-003  duplicação de cenário como nova versão
 *   RF-004  painel com indicadores recalculados de cada cenário
 *   RF-005  recarga da estrutura a partir da origem, preservando premissas
 *   RF-006  histórico de alterações com autor, data, versão e status
 *   RF-007  isolamento: nada afeta outro cenário nem o cadastro oficial
 *   RF-008  linhagem de versões derivadas de um mesmo cenário de origem
 *
 * Os indicadores vêm calculados pelo servidor (motor único · RNF-10): a tela
 * não recalcula CI%, apenas apresenta.
 */
import { esc, num, pct, dataHora } from '../format.js';

const ST = {
  rascunho:    { label: 'Rascunho',    bg: '#efeae0', fg: '#8b8681' },
  calculado:   { label: 'Calculado',   bg: '#e9f1eb', fg: '#2f6b46' },
  congelado:   { label: 'Congelado',   bg: '#f4ecdd', fg: '#8a5e12' },
  consolidado: { label: 'Consolidado', bg: '#e6e9f2', fg: '#3d4c7a' },
};
const ROTULO_TIPO = { orcamento: 'Orçamento anual', revisao: 'Revisão mensal' };

export async function telaCenarios(el, ctx) {
  ctx.definirTopo(
    'Cenários de simulação',
    'RF-001 a RF-008 — criação, carga integrada, duplicação, recarga, indicadores, histórico e isolamento'
  );

  const { cenarios, parametros } = await ctx.api.get('/cenarios');
  const gatilho = parametros && parametros.gatilho != null ? parametros.gatilho : 5;

  const totais = cenarios.reduce((acc, c) => {
    const i = c.indicadores || {};
    acc.produtos += i.nProdutos || 0;
    acc.acima40 += i.acima40 || 0;
    acc.alertas += i.nAlertas || 0;
    acc.erros += i.nErros || 0;
    return acc;
  }, { produtos: 0, acima40: 0, alertas: 0, erros: 0 });

  ctx.definirAlertas(cenarios.length ? (cenarios[0].indicadores || {}).nAlertas || 0 : 0);

  const recente = cenarios[0] ? (cenarios[0].indicadores || {}) : { ciMedio: 0 };
  const corCi = recente.ciMedio > 40 ? 'var(--err)' : recente.ciMedio > 0 ? 'var(--ok-fg)' : 'var(--ink)';
  const podeCriar = ctx.pode('criarCenario');

  el.innerHTML = `
  <div class="pagina" style="max-width:1500px;">
    <div class="grid-kpi">
      <div class="kpi"><div class="rotulo">CENÁRIOS DE SIMULAÇÃO</div>
        <div class="valor">${cenarios.length}</div>
        <div class="hint">isolados entre si e do cadastro oficial (RF-007)</div></div>
      <div class="kpi"><div class="rotulo">CI% MÉDIO · CENÁRIO MAIS RECENTE</div>
        <div class="valor" style="color:${corCi};">${pct(recente.ciMedio)}</div>
        <div class="hint">média ponderada pelos volumes por UF (RN-02)</div></div>
      <div class="kpi"><div class="rotulo">PRODUTOS ACIMA DE 40%</div>
        <div class="valor" style="color:${totais.acima40 ? 'var(--err)' : 'var(--ink)'};">${totais.acima40}</div>
        <div class="hint">alíquota interestadual de 4% (RN-07) · todos os cenários</div></div>
      <div class="kpi"><div class="rotulo">ALERTAS ABERTOS</div>
        <div class="valor" style="color:${totais.alertas ? 'var(--err)' : 'var(--ink)'};">${totais.alertas}</div>
        <div class="hint">gatilho de reemissão: ${num(gatilho, 1)} p.p. (RF-099)</div></div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:14px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0;font-size:15px;font-weight:600;">Cenários de simulação</h2>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;">
          Ambiente analítico sem validade fiscal — não substitui a FCI oficial nem gera transmissão à SEFAZ (RN-12).
        </div>
      </div>
      <button class="btn btn-ouro" id="btn-novo"
        ${podeCriar ? '' : 'disabled title="Ação «criar e duplicar cenário» não habilitada para o seu perfil (RF-035) — a consulta permanece liberada"'}>
        ＋ Novo cenário</button>
    </div>

    ${cenarios.length
      ? `<div class="grid-cenarios">${cenarios.map((c) => cartao(c, gatilho, podeCriar, ctx)).join('')}</div>`
      : `<div class="roadmap-box">
           <div class="titulo">Nenhum cenário criado ainda</div>
           Crie o primeiro cenário — a estrutura de produtos e insumos é carregada automaticamente das
           fontes de dados integradas, sem digitação manual (RF-002). Configure as fontes em
           <a href="#/integracoes">Integrações</a>.
         </div>`}

    ${cenarios.length ? `<div class="nota-rodape">
      ${cenarios.length} cenário(s) · ${totais.produtos} produto(s) acabado(s) avaliado(s)
      ${totais.erros ? ` · <b style="color:var(--err-fg);">${totais.erros} erro(s) de estrutura abertos</b> (RF-033)` : ' · nenhuma pendência de estrutura'}.
      Duplicar gera uma nova versão com a mesma linhagem e premissas; o cenário de origem permanece
      intacto (RF-003 · RF-008).
    </div>` : ''}
  </div>`;

  el.querySelectorAll('[data-abrir]').forEach((b) => {
    b.onclick = () => ctx.navegar(`#/sim/${b.dataset.abrir}`);
  });
  el.querySelectorAll('[data-relatorio]').forEach((b) => {
    b.onclick = () => ctx.navegar(`#/relatorio/${b.dataset.relatorio}`);
  });
  el.querySelectorAll('[data-historico]').forEach((b) => {
    b.onclick = () => painelHistorico(b.dataset.historico, ctx);
  });
  el.querySelectorAll('[data-duplicar]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await ctx.api.post(`/cenarios/${b.dataset.duplicar}/duplicar`, {});
        ctx.toast(`Cenário duplicado como ${r.cenario.codigo} (v${r.cenario.versao}) — a origem permanece intacta (RF-003 · RF-007).`, 'ok');
        telaCenarios(el, ctx);
      } catch (err) { ctx.toast(err.message, 'erro'); b.disabled = false; }
    };
  });
  el.querySelectorAll('[data-recarregar]').forEach((b) => {
    b.onclick = () => confirmarRecarga(b.dataset.recarregar, ctx, () => telaCenarios(el, ctx));
  });

  const btnNovo = el.querySelector('#btn-novo');
  if (btnNovo && podeCriar) btnNovo.onclick = () => modalNovo(ctx, () => telaCenarios(el, ctx));
}

/* ------------------------------------------------------------------ cartão */

function cartao(c, gatilho, podeCriar, ctx) {
  const st = ST[c.status] || ST.rascunho;
  const i = c.indicadores || { ciMedio: 0, nProdutos: 0, acima40: 0, dist: { baixo: 0, medio: 0, alto: 0 }, nAlertas: 0, nErros: 0, nInsumos: 0 };
  const corCi = i.ciMedio > 70 ? '#a03d2c' : i.ciMedio > 40 ? '#b07d1e' : i.ciMedio > 0 ? '#2f6b46' : 'var(--ink)';
  const dist = i.dist || { baixo: 0, medio: 0, alto: 0 };
  const tot = Math.max(1, dist.baixo + dist.medio + dist.alto);
  const congelado = c.status === 'congelado' || c.status === 'consolidado';

  const selos = [
    c.modo === 'avancado' ? '<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);font-size:9px;">modo avançado</span>' : '',
    (c.base_calculo || 'saida') === 'custo' ? '<span class="chip" style="background:var(--line-2);color:var(--ink-3);font-size:9px;">base: custo</span>' : '',
    i.nErros ? `<span class="chip" style="background:var(--err-bg);color:var(--err-fg);font-size:9px;">${i.nErros} erro(s)</span>` : '',
    i.nAlertas ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);font-size:9px;">${i.nAlertas} alerta(s)</span>` : '',
  ].filter(Boolean).join(' ');

  return `
  <div class="cenario-card">
    <div class="cabeca">
      <div style="min-width:0;">
        <div class="nome">${esc(c.nome)}</div>
        <div class="meta"><span class="mono">${esc(c.codigo)}</span> ·
          ${esc(ROTULO_TIPO[c.tipo] || c.tipo)} ${esc(c.ciclo || '')} · v${c.versao}
          ${c.origem_id ? ' <span title="Derivado de outro cenário (RF-008)">⎘</span>' : ''}</div>
      </div>
      <span class="chip" style="background:${st.bg};color:${st.fg};">${st.label}</span>
    </div>
    <div class="corpo">
      <div class="metricas">
        <div><div class="r">CI% MÉDIO PONDERADO</div><div class="v" style="color:${corCi};">${pct(i.ciMedio)}</div></div>
        <div><div class="r">PRODUTOS · INSUMOS</div><div class="v">${i.nProdutos} · ${i.nInsumos}</div></div>
        <div><div class="r">&gt; 40%</div><div class="v" style="color:${i.acima40 ? '#a03d2c' : 'inherit'};">${i.acima40}</div></div>
      </div>
      <div class="barra-faixas" title="Distribuição por faixa: ${dist.baixo} até 40% · ${dist.medio} de 40% a 70% · ${dist.alto} acima de 70%">
        <div style="width:${dist.baixo / tot * 100}%;background:#3f7d54;"></div>
        <div style="width:${dist.medio / tot * 100}%;background:#b07d1e;"></div>
        <div style="width:${dist.alto / tot * 100}%;background:#a03d2c;"></div>
      </div>
      ${selos ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;">${selos}</div>` : ''}
      <div class="autor">Autor: ${esc(c.autor_nome)}<br>Atualizado ${dataHora(c.atualizado_em)}</div>
      ${c.origem_dados ? `<div style="font-size:10px;color:var(--ink-3);margin-top:6px;">⬇ Carga integrada: ${esc(c.origem_dados)}</div>` : ''}
    </div>
    <div class="acoes">
      <button class="btn btn-escuro" style="flex:1;" data-abrir="${c.id}">Abrir simulação →</button>
      <button class="btn btn-borda" style="width:36px;padding:0;justify-content:center;"
              title="Relatório executivo (RF-087)" data-relatorio="${c.id}">📄</button>
      <button class="btn btn-borda" style="width:36px;padding:0;justify-content:center;"
              title="Histórico de alterações e versões (RF-006 · RF-008)" data-historico="${c.id}">🕘</button>
      <button class="btn btn-borda" style="width:36px;padding:0;justify-content:center;"
              title="Recarregar estrutura da origem preservando premissas (RF-005)"
              data-recarregar="${c.id}"
              ${congelado ? 'disabled title="Cenário congelado: premissas e estrutura bloqueadas (RF-005)"' : ''}>⟳</button>
      <button class="btn btn-borda" style="width:36px;padding:0;justify-content:center;"
              title="Duplicar como nova versão (RF-003)" data-duplicar="${c.id}"
              ${podeCriar ? '' : 'disabled title="Ação não habilitada para o seu perfil (RF-035)"'}>⎘</button>
    </div>
  </div>`;
}

/* --------------------------------------------------------------- RF-001 */

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
          <select id="m-tipo">
            <option value="orcamento">Orçamento anual</option>
            <option value="revisao" selected>Revisão mensal / what-if</option>
          </select>
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
      const d = r.cenario.dados || {};
      ctx.toast(`Cenário ${r.cenario.codigo} criado com estrutura integrada (${(d.produtos || []).length} produtos · ${(d.insumos || []).length} insumos).`, 'ok');
      ctx.navegar(`#/sim/${r.cenario.id}`);
      if (aoCriar) aoCriar();
    } catch (err) { ctx.toast(err.message, 'erro'); botao.disabled = false; }
  };
}

/* --------------------------------------------------------------- RF-005 */

function confirmarRecarga(id, ctx, aoConcluir) {
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:17px;">⟳</div>
      <div style="flex:1;">
        <h2>Recarregar a estrutura a partir da origem</h2>
        <div class="sub">RF-005 — a estrutura e os dados mestres são relidos das fontes integradas; as premissas já informadas no cenário (câmbio, preços, volumes, origem e substituições) são preservadas.</div>
      </div>
      <button class="fechar" id="rc-fechar">×</button>
    </div>
    <div class="corpo">
      <div class="aviso-aten"><span>⚠</span><div>
        Itens que deixaram de existir na origem são apontados no diagnóstico da estrutura
        (RF-025 · RF-033) para tratamento antes do recálculo. Nada é gravado nos sistemas de
        origem — a leitura é unidirecional (RNF-06).
      </div></div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" id="rc-cancelar">Cancelar</button>
      <button class="btn btn-ouro" id="rc-ok">Recarregar da origem</button>
    </div>`);
  wrap.querySelector('#rc-fechar').onclick = ctx.fecharModal;
  wrap.querySelector('#rc-cancelar').onclick = ctx.fecharModal;
  wrap.querySelector('#rc-ok').onclick = async () => {
    const botao = wrap.querySelector('#rc-ok');
    botao.disabled = true;
    try {
      const r = await ctx.api.post(`/cenarios/${id}/recarregar`, {});
      ctx.fecharModal();
      const v = r.validacao || { nErros: 0, nAvisos: 0 };
      ctx.toast(`Estrutura recarregada de ${r.cenario.origem_dados || 'origem integrada'} — ${v.nErros} erro(s) e ${v.nAvisos} aviso(s) no diagnóstico.`,
        v.nErros ? 'erro' : 'ok');
      if (aoConcluir) aoConcluir();
    } catch (err) { ctx.toast(err.message, 'erro'); botao.disabled = false; }
  };
}

/* ------------------------------------------------------- RF-006 · RF-008 */

async function painelHistorico(id, ctx) {
  const painel = ctx.abrirPainel(`
    <header>
      <div style="flex:1;">
        <h2 style="margin:0;font-size:14px;font-weight:600;">Histórico e versões</h2>
        <div style="font-size:11px;color:var(--ink-3);margin-top:2px;">RF-006 · RF-008 · RNF-04</div>
      </div>
      <button class="fechar" id="h-fechar">×</button>
    </header>
    <div class="corpo"><div class="carregando">Carregando</div></div>`);
  painel.querySelector('#h-fechar').onclick = ctx.fecharPainel;

  try {
    const h = await ctx.api.get(`/cenarios/${id}/eventos`);
    painel.querySelector('.corpo').innerHTML = `
      <div class="painel-secao">
        <header>SITUAÇÃO ATUAL</header>
        <div class="conteudo" style="font-size:11.5px;">
          <div><b class="mono">${esc(h.cenario.codigo)}</b> · versão ${h.cenario.versao} · ${esc(ST[h.cenario.status] ? ST[h.cenario.status].label : h.cenario.status)}</div>
          <div style="color:var(--ink-3);">Autor: ${esc(h.cenario.autor)}</div>
          <div style="color:var(--ink-3);">Criado em ${dataHora(h.cenario.criadoEm)}</div>
          ${h.cenario.congeladoEm ? `<div style="color:var(--ink-3);">Congelado em ${dataHora(h.cenario.congeladoEm)}</div>` : ''}
          ${h.cenario.consolidadoEm ? `<div style="color:var(--ink-3);">Consolidado em ${dataHora(h.cenario.consolidadoEm)}</div>` : ''}
          ${h.cenario.origemDados ? `<div style="color:var(--ink-3);">Carga: ${esc(h.cenario.origemDados)}</div>` : ''}
        </div>
      </div>

      <div class="painel-secao">
        <header>LINHAGEM DE VERSÕES (RF-008) · ${h.versoes.length}</header>
        <div class="conteudo">
          ${h.versoes.map((v) => `
            <div style="display:flex;gap:9px;align-items:center;font-size:11.5px;${String(v.id) === String(id) ? 'font-weight:600;' : ''}">
              <span class="chip" style="background:${(ST[v.status] || ST.rascunho).bg};color:${(ST[v.status] || ST.rascunho).fg};font-size:9px;">v${v.versao}</span>
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v.nome)}</span>
              ${String(v.id) === String(id)
                ? '<span style="font-size:10px;color:var(--ink-3);">atual</span>'
                : `<a href="#/sim/${v.id}" style="font-size:10.5px;">abrir</a>`}
            </div>`).join('')}
        </div>
      </div>

      <div class="painel-secao">
        <header>EVENTOS REGISTRADOS (RF-006 · RNF-04) · ${h.eventos.length}</header>
        <div class="conteudo" style="gap:0;">
          ${h.eventos.length ? h.eventos.map((e) => `
            <div class="timeline-item">
              <div style="font-size:11.5px;font-weight:600;">${esc(e.acao)}</div>
              <div style="font-size:11px;color:var(--ink-2);line-height:1.5;margin-top:2px;">${esc(e.detalhe || '')}</div>
              <div style="font-size:10px;color:var(--ink-3);margin-top:3px;">
                ${esc(e.autor_nome || 'sistema')}${e.autor_area ? ` · ${esc(e.autor_area)}` : ''} · ${dataHora(e.criado_em)}
              </div>
            </div>`).join('') : '<div style="font-size:11.5px;color:var(--ink-3);">Nenhum evento registrado.</div>'}
        </div>
      </div>`;
  } catch (err) {
    painel.querySelector('.corpo').innerHTML = `<div class="aviso-erro"><span>✕</span><div>${esc(err.message)}</div></div>`;
  }
}
