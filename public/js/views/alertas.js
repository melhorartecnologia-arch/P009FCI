/**
 * Central de alertas do cenário — Simulador FCI.
 *
 *   RF-083  alerta de mudança de faixa de enquadramento frente à FCI vigente
 *   RF-084  alerta de reemissão da FCI quando a variação supera o gatilho
 *   RF-085  alerta de risco fiscal de CI% acima de 40%, com a base legal
 *   RF-086  área responsável pelo tratamento em destaque em cada alerta
 *   RF-099  gatilho de reemissão vigente, com atalho para os parâmetros
 *   RF-035  ações sem capacidade ficam desabilitadas, com o motivo no title
 *   RN-08 · RN-12  gatilho parametrizado · leitura gerencial sem validade fiscal
 *
 * Nenhuma regra de cálculo é reimplementada: os alertas vêm prontos de
 * GET /cenarios/:id/alertas, produzidos pelo motor compartilhado (RNF-10).
 */
import { esc, dataHora } from '../format.js';
import * as E from '/shared/engine.mjs';

/* ------------------------------------------------------------- constantes */

/** Tipos de alerta do escopo, na ordem de leitura do filtro. */
const TIPOS = [
  { chave: 'reemissao',       rotulo: 'Reemissão da FCI',        icone: '🔁', req: 'RF-084' },
  { chave: 'faixa',           rotulo: 'Mudança de faixa',        icone: '⇅',  req: 'RF-083' },
  { chave: 'risco',           rotulo: 'Risco fiscal',            icone: '⚖',  req: 'RF-085' },
  { chave: 'obrigatoriedade', rotulo: 'Obrigatoriedade da FCI',  icone: '📄', req: 'RN-06' },
];
const TIPO_INFO = TIPOS.reduce((m, t) => { m[t.chave] = t; return m; }, {});

/** Cor e papel de cada área responsável pelo tratamento (RF-086). */
const AREAS = {
  'Compras':           { cor: '#5b4a86', papel: 'Alternativa de fornecimento, nacionalização e renegociação do insumo' },
  'Pricing':           { cor: '#2f6b46', papel: 'Preço líquido por UF e efeito da alíquota no crédito do cliente' },
  'Fiscal/Tributário': { cor: '#a03d2c', papel: 'Enquadramento, CST, base legal e emissão/reemissão da FCI' },
  'Controladoria':     { cor: '#3d4c7a', papel: 'Custo-padrão, margem e reflexo no resultado' },
  'Industrial/PCP':    { cor: '#8a5e12', papel: 'Formulação, rendimento e viabilidade técnica da troca' },
};
const AREA_PADRAO = { cor: '#5c5854', papel: 'Área responsável pelo tratamento do alerta' };

const ST = {
  rascunho:    { label: 'Rascunho',    bg: '#efeae0', fg: '#8b8681' },
  calculado:   { label: 'Calculado',   bg: '#e9f1eb', fg: '#2f6b46' },
  congelado:   { label: 'Congelado',   bg: '#f4ecdd', fg: '#8a5e12' },
  consolidado: { label: 'Consolidado', bg: '#e6e9f2', fg: '#3d4c7a' },
};

/** Preferências de filtro preservadas enquanto a sessão continua na tela. */
const estado = {
  cenarioId: null,
  tipo: 'todos',
  area: 'todas',
};

/* ------------------------------------------------------- utilidades de UI */

function chip(texto, bg, fg, titulo) {
  return `<span class="chip" style="background:${bg};color:${fg};"${titulo ? ` title="${esc(titulo)}"` : ''}>${esc(texto)}</span>`;
}

/** Capacidade do perfil com motivo declarado — nunca esconder, sempre explicar (RF-035). */
function cap(ctx, acao, finalidade) {
  const ok = ctx.pode(acao);
  return {
    ok,
    motivo: ok ? '' : `Ação indisponível para o seu perfil: é necessária a capacidade «${acao}» para ${finalidade} (RF-035 · RF-100). Consulte a matriz de permissões.`,
  };
}

function attrs(p, tituloQuandoLiberado) {
  return `${p.ok ? '' : 'disabled '}title="${esc(p.ok ? (tituloQuandoLiberado || '') : p.motivo)}"`;
}

/** Normaliza as respostas possíveis da rota de alertas. */
function listaDe(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.alertas)) return resp.alertas;
  if (Array.isArray(resp.lista)) return resp.lista;
  return [];
}

/* -------------------------------------------------------------- tela raiz */

export async function telaAlertas(el, ctx) {
  ctx.definirTopo(
    'Central de alertas',
    'RF-083 mudança de faixa · RF-084 reemissão da FCI · RF-085 risco fiscal · RF-086 área responsável pelo tratamento'
  );

  /* ---- cenários disponíveis e gatilho parametrizado (RF-099) */
  let cenarios = [];
  let gatilhoParam = 5;
  try {
    const [rc, rp] = await Promise.all([
      ctx.api.get('/cenarios'),
      ctx.api.get('/parametros').catch(() => null),
    ]);
    cenarios = (rc && rc.cenarios) || [];
    if (rp && rp.parametros && rp.parametros.gatilho_reemissao) {
      gatilhoParam = E.n(rp.parametros.gatilho_reemissao.valor.pp, 5);
    }
  } catch (err) {
    ctx.toast(err.message, 'erro');
  }

  if (!cenarios.length) {
    ctx.definirAlertas(0);
    el.innerHTML = `
    <div class="pagina" style="max-width:1000px;">
      <div class="aviso-info">Nenhum cenário de simulação disponível. Crie um cenário em
        <a href="#/cenarios">Cenários de simulação</a> (RF-001) — os alertas são apurados sobre o resultado do cenário.</div>
    </div>`;
    return;
  }

  /* ---- cenário corrente (mantém a escolha anterior se ainda existir) */
  if (!estado.cenarioId || !cenarios.some((c) => String(c.id) === String(estado.cenarioId))) {
    estado.cenarioId = String(cenarios[0].id);
  }

  const S = { el, ctx, cenarios, gatilhoParam, alertas: [], gatilho: gatilhoParam, cenario: null, erro: '' };

  /* ---- carga dos alertas do cenário escolhido (RF-083 a RF-086) */
  S.carregar = async () => {
    S.cenario = S.cenarios.find((c) => String(c.id) === String(estado.cenarioId)) || null;
    S.erro = '';
    try {
      const resp = await ctx.api.get(`/cenarios/${encodeURIComponent(estado.cenarioId)}/alertas`);
      S.alertas = listaDe(resp);
      const g = resp && (resp.gatilho != null ? resp.gatilho : (resp.gatilhoPp != null ? resp.gatilhoPp : resp.gatilhoReemissao));
      S.gatilho = E.n(g == null ? S.gatilhoParam : g, S.gatilhoParam);
    } catch (err) {
      S.alertas = [];
      S.gatilho = S.gatilhoParam;
      S.erro = err.message;
      ctx.toast(err.message, 'erro');
    }
    // RF-086 — o contador do sino acompanha o cenário em leitura.
    ctx.definirAlertas(S.alertas.length);
  };

  await S.carregar();
  desenhar(S);
}

/* ---------------------------------------------------------------- desenho */

function desenhar(S) {
  const { el, ctx } = S;
  const cen = S.cenario || {};
  const st = ST[cen.status] || { label: cen.status || '—', bg: 'var(--line-2)', fg: 'var(--ink-3)' };

  const porTipo = (t) => S.alertas.filter((a) => a.tipo === t).length;
  const areasPresentes = [...new Set(S.alertas.map((a) => a.area).filter(Boolean))]
    .sort((a, b) => Object.keys(AREAS).indexOf(a) - Object.keys(AREAS).indexOf(b));

  const nErro = S.alertas.filter((a) => a.sev === 'erro').length;
  const pParam = cap(ctx, 'parametros', 'alterar o gatilho de reemissão');

  el.innerHTML = `
  <div class="pagina" style="max-width:1340px;">

    <!-- indicadores da central -->
    <div class="grid-kpi" style="margin-bottom:15px;">
      <div class="kpi" title="Total de alertas apurados no cenário em leitura (RF-083 a RF-086)">
        <div class="rotulo">ALERTAS NO CENÁRIO</div>
        <div class="valor" style="color:${S.alertas.length ? (nErro ? 'var(--err)' : 'var(--warn)') : 'var(--ink)'};">${esc(S.alertas.length)}</div>
        <div class="hint">${esc(nErro)} crítico(s) · ${esc(S.alertas.length - nErro)} de atenção</div>
      </div>
      <div class="kpi" title="Variação do CI% superior ao gatilho — reemissão da FCI exigida (RF-084 · RN-08)">
        <div class="rotulo">REEMISSÕES EXIGIDAS</div>
        <div class="valor" style="color:${porTipo('reemissao') ? 'var(--err)' : 'var(--ink)'};">${esc(porTipo('reemissao'))}</div>
        <div class="hint">gatilho vigente de ${esc(E.num(S.gatilho, 1))} p.p.</div>
      </div>
      <div class="kpi" title="Produtos que migram de faixa de enquadramento frente à FCI vigente (RF-083)">
        <div class="rotulo">MUDANÇAS DE FAIXA</div>
        <div class="valor" style="color:${porTipo('faixa') ? 'var(--warn)' : 'var(--ink)'};">${esc(porTipo('faixa'))}</div>
        <div class="hint">enquadramento diferente do registrado na ficha</div>
      </div>
      <div class="kpi" title="CI% acima de 40% implica alíquota interestadual de 4% (RF-085 · Resolução SF 13/2012)">
        <div class="rotulo">RISCOS FISCAIS</div>
        <div class="valor" style="color:${porTipo('risco') ? 'var(--err)' : 'var(--ink)'};">${esc(porTipo('risco'))}</div>
        <div class="hint">CI% acima de 40% · alíquota de 4%</div>
      </div>
    </div>

    <!-- seletor de cenário e filtros -->
    <div class="card card-pad" style="margin-bottom:15px;">
      <div class="linha-flex" style="align-items:flex-end;">
        <div class="campo" style="min-width:340px;">
          <span>CENÁRIO</span>
          <select id="al-cenario" title="Alertas apurados sobre o resultado do cenário escolhido (RF-004)">
            ${S.cenarios.map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(estado.cenarioId) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nome)} · v${esc(c.versao == null ? '—' : c.versao)}</option>`).join('')}
          </select>
        </div>
        <div class="campo" style="min-width:230px;">
          <span>TIPO DE ALERTA</span>
          <select id="al-tipo" title="Filtra por mudança de faixa, reemissão, risco fiscal ou obrigatoriedade da FCI">
            <option value="todos" ${estado.tipo === 'todos' ? 'selected' : ''}>Todos os tipos (${esc(S.alertas.length)})</option>
            ${TIPOS.map((t) => `<option value="${t.chave}" ${estado.tipo === t.chave ? 'selected' : ''}>${t.icone} ${esc(t.rotulo)} (${esc(porTipo(t.chave))}) · ${t.req}</option>`).join('')}
          </select>
        </div>
        <div class="campo" style="min-width:220px;">
          <span>ÁREA RESPONSÁVEL (RF-086)</span>
          <select id="al-area" title="Filtra pela área responsável pelo tratamento do alerta">
            <option value="todas" ${estado.area === 'todas' ? 'selected' : ''}>Todas as áreas</option>
            ${areasPresentes.map((a) => `<option value="${esc(a)}" ${estado.area === a ? 'selected' : ''}>${esc(a)} (${esc(S.alertas.filter((x) => x.area === a).length)})</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;"></div>
        <div style="text-align:right;">
          <div class="texto-mini">GATILHO DE REEMISSÃO VIGENTE (RF-099)</div>
          <div class="linha-flex" style="justify-content:flex-end;gap:8px;margin-top:3px;">
            <b class="mono" style="font-size:16px;" title="Variação de CI% a partir da qual a reemissão da FCI é exigida (RN-08)">${esc(E.num(S.gatilho, 1))} p.p.</b>
            <button class="btn btn-borda btn-mini" id="al-param" ${attrs(pParam, 'Abrir os parâmetros mestres e ajustar o gatilho de reemissão (RF-099)')}>⚙ Ajustar nos parâmetros</button>
          </div>
        </div>
      </div>
      <div class="sep" style="margin:12px 0;"></div>
      <div class="linha-flex">
        ${chip(st.label, st.bg, st.fg, 'Status do cenário no fluxo de governança (RF-005 · RF-008)')}
        <span class="texto-mini">${esc(cen.ciclo || '')}${cen.tipo ? ' · ' + esc(cen.tipo) : ''}${cen.autor_nome ? ' · autor ' + esc(cen.autor_nome) : ''}${cen.atualizado_em ? ' · atualizado em ' + esc(dataHora(cen.atualizado_em)) : ''}</span>
        <div style="flex:1;"></div>
        <button class="btn btn-borda btn-mini" id="al-relatorio" title="Abrir o relatório executivo deste cenário, com os direcionamentos por área (RF-087 · RF-088)">📄 Relatório executivo</button>
        <button class="btn btn-borda btn-mini" id="al-sim" title="Abrir a simulação deste cenário na aba de cálculo (RF-056 a RF-065)">⚗ Abrir simulação</button>
      </div>
    </div>

    ${S.erro ? `<div class="aviso-erro" style="margin-bottom:14px;"><span>✕</span>
      <div><b>Não foi possível apurar os alertas deste cenário.</b> ${esc(S.erro)}</div></div>` : ''}

    <div id="al-lista" class="pilha"></div>

    <div class="nota-rodape">
      Os alertas são recalculados a cada leitura sobre o resultado vigente do cenário e comparados à FCI registrada em cada produto (RF-083).
      A reemissão é exigida quando a variação do CI% supera o gatilho parametrizado de ${esc(E.num(S.gatilho, 1))} p.p. (RF-084 · RN-08 · RF-099).<br>
      ${esc(E.RESSALVA_GERENCIAL)}
    </div>
  </div>`;

  pintarLista(S);

  /* ------------------------------------------------------------ ligações */

  el.querySelector('#al-cenario')?.addEventListener('change', async (ev) => {
    estado.cenarioId = String(ev.target.value);
    el.querySelector('#al-lista').innerHTML = '<div class="carregando">Apurando os alertas do cenário</div>';
    await S.carregar();
    desenhar(S);
  });

  el.querySelector('#al-tipo')?.addEventListener('change', (ev) => {
    estado.tipo = ev.target.value;
    pintarLista(S);
  });

  el.querySelector('#al-area')?.addEventListener('change', (ev) => {
    estado.area = ev.target.value;
    pintarLista(S);
  });

  const btnParam = el.querySelector('#al-param');
  if (btnParam && pParam.ok) btnParam.addEventListener('click', () => ctx.navegar('#/parametros'));

  el.querySelector('#al-relatorio')?.addEventListener('click', () => ctx.navegar(`#/relatorio/${estado.cenarioId}`));
  el.querySelector('#al-sim')?.addEventListener('click', () => ctx.navegar(`#/sim/${estado.cenarioId}/calculo`));
}

/* ----------------------------------------------------------- lista de cartões */

function pintarLista(S) {
  const host = S.el.querySelector('#al-lista');
  if (!host) return;

  const visiveis = S.alertas
    .filter((a) => estado.tipo === 'todos' || a.tipo === estado.tipo)
    .filter((a) => estado.area === 'todas' || a.area === estado.area)
    // RF-084 — os alertas de reemissão (severidade de erro) vêm primeiro.
    .sort((a, b) => {
      const sa = a.sev === 'erro' ? 0 : 1;
      const sb = b.sev === 'erro' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return Math.abs(E.n(b.deltaPp)) - Math.abs(E.n(a.deltaPp));
    });

  if (!visiveis.length) {
    host.innerHTML = S.alertas.length
      ? `<div class="aviso-info">Nenhum alerta corresponde ao filtro aplicado — ${esc(S.alertas.length)} alerta(s) no cenário.
          <button class="btn btn-borda btn-mini" id="al-limpar" style="margin-left:10px;">Limpar filtros</button></div>`
      : `<div class="aviso-info" style="color:var(--ok-fg);"><b>Nenhum alerta neste cenário.</b>
          Não há mudança de faixa de enquadramento, exigência de reemissão da FCI nem CI% acima de 40% para o gatilho vigente de
          ${esc(E.num(S.gatilho, 1))} p.p. (RF-083 a RF-085).</div>`;
    host.querySelector('#al-limpar')?.addEventListener('click', () => {
      estado.tipo = 'todos';
      estado.area = 'todas';
      desenhar(S);
    });
    return;
  }

  host.innerHTML = visiveis.map((a) => cartaoAlerta(a, S)).join('');

  host.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => {
    S.ctx.navegar(b.dataset.sim);
  }));
  host.querySelectorAll('[data-param]').forEach((b) => b.addEventListener('click', () => {
    S.ctx.navegar('#/parametros');
  }));
}

/** Cartão de um alerta, com área responsável em destaque (RF-086). */
function cartaoAlerta(a, S) {
  const t = TIPO_INFO[a.tipo] || { rotulo: a.tipo || 'Alerta', icone: '•', req: 'RF-083' };
  const area = AREAS[a.area] || AREA_PADRAO;
  const erro = a.sev === 'erro';
  const cor = erro
    ? { bg: 'var(--err-bg)', fg: 'var(--err-fg)', bd: '#e0a898', barra: 'var(--err)' }
    : { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', bd: '#e3cfa4', barra: 'var(--warn)' };

  const delta = E.n(a.deltaPp);
  const fxA = a.faixaAnterior || E.faixaDe(a.vigente);
  const fxN = a.faixaNova || E.faixaDe(a.ci);
  const superaGatilho = Math.abs(delta) > E.n(S.gatilho, 5);

  return `
  <div style="background:${cor.bg};border:1px solid ${cor.bd};border-left:4px solid ${cor.barra};border-radius:10px;padding:13px 16px;display:flex;gap:13px;align-items:flex-start;">
    <span style="font-size:19px;line-height:1;" title="${esc(t.rotulo)} (${esc(t.req)})">${t.icone}</span>
    <div style="flex:1;min-width:0;">

      <div class="linha-flex" style="gap:9px;">
        <b style="font-size:13px;color:${cor.fg};">${esc(a.titulo || t.rotulo)}</b>
        ${chip(erro ? 'CRÍTICO' : 'ATENÇÃO', erro ? '#f0d2ca' : '#eddfbe', cor.fg, erro ? 'Alerta crítico: exige providência registrada' : 'Alerta de atenção: exige avaliação da área responsável')}
        ${chip(t.rotulo, 'var(--panel)', cor.fg, `${t.rotulo} — ${t.req}`)}
        <div style="flex:1;"></div>
        <span class="texto-mini" style="color:${cor.fg};opacity:.85;">${esc(t.req)}</span>
      </div>

      <div style="font-size:12.5px;font-weight:600;color:var(--ink);margin-top:5px;">${esc(a.produto || '—')}</div>
      <div style="font-size:12px;color:${cor.fg};margin-top:4px;line-height:1.55;">${esc(a.msg)}</div>

      <!-- CI% atual × FCI vigente e variação em p.p. -->
      <div class="linha-flex" style="gap:0;margin-top:10px;background:var(--panel);border:1px solid ${cor.bd};border-radius:8px;overflow:hidden;">
        ${celula('CI% SIMULADO', E.pct(a.ci), fxN.fg, 'Conteúdo de importação apurado no cenário (RN-01)')}
        ${celula('FCI VIGENTE', E.pct(a.vigente), 'var(--ink-2)', 'CI% registrado na Ficha de Conteúdo de Importação vigente do produto (RF-083)')}
        ${celula('VARIAÇÃO', E.pp(delta), superaGatilho ? 'var(--err)' : 'var(--ink-2)', `Variação do CI% contra a ficha vigente; gatilho de ${E.num(S.gatilho, 1)} p.p. (RF-084 · RN-08)`)}
        ${celula('GATILHO VIGENTE', `${E.num(S.gatilho, 1)} p.p.`, 'var(--ink-3)', 'Gatilho de reemissão parametrizado (RF-099)')}
        <div style="flex:1;padding:8px 12px;border-left:1px solid var(--line-2);">
          <div class="texto-mini">ENQUADRAMENTO</div>
          <div class="linha-flex" style="gap:6px;margin-top:3px;">
            ${chip(fxA.label, fxA.bg, fxA.fg, `Faixa da ficha vigente · ${fxA.range}`)}
            <span style="color:var(--ink-3);">→</span>
            ${chip(fxN.label, fxN.bg, fxN.fg, `Faixa apurada no cenário · ${fxN.range}`)}
          </div>
        </div>
      </div>

      <!-- RF-086 — área responsável pelo tratamento, em destaque -->
      <div class="linha-flex" style="margin-top:10px;gap:10px;">
        <span style="display:inline-flex;align-items:center;gap:8px;background:${area.cor};color:#fff;border-radius:7px;padding:5px 11px;font-size:11.5px;font-weight:600;"
          title="Área responsável pelo tratamento deste alerta (RF-086)">
          Tratamento: ${esc(a.area || '—')}
        </span>
        <span class="texto-mini" style="flex:1;min-width:140px;">${esc(area.papel)}</span>
      </div>

      ${a.acao ? `<div style="font-size:12px;color:var(--ink-2);margin-top:7px;">
        <b>Ação sugerida:</b> ${esc(a.acao)}</div>` : ''}

      ${a.baseLegal ? `<div class="texto-mini" style="margin-top:5px;" title="Base legal do risco fiscal apontado (RF-085)">
        <b>Base legal:</b> ${esc(a.baseLegal)}</div>` : ''}

      ${a.tipo === 'reemissao' ? `<div class="texto-mini" style="margin-top:5px;">
        Reemissão exigida porque a variação de <b class="mono">${esc(E.pp(delta))}</b> supera o gatilho parametrizado de
        <b class="mono">${esc(E.num(a.gatilho == null ? S.gatilho : a.gatilho, 1))} p.p.</b> (RN-08 · RF-099).</div>` : ''}

      <div class="linha-flex" style="margin-top:11px;gap:8px;">
        <button class="btn btn-escuro btn-mini" data-sim="#/sim/${esc(estado.cenarioId)}/calculo"
          title="Abrir a simulação na aba de cálculo e selecionar «${esc(a.produto || '')}» para ver a memória de cálculo e tratar o alerta (RF-064)">⚗ Abrir simulação do produto</button>
        <button class="btn btn-borda btn-mini" data-sim="#/relatorio/${esc(estado.cenarioId)}"
          title="Ver este alerta no relatório executivo, junto dos direcionamentos por área (RF-087 · RF-088)">📄 Ver no relatório</button>
        <button class="btn btn-borda btn-mini" data-param="1"
          title="Abrir os parâmetros mestres e rever o gatilho de reemissão (RF-099)">⚙ Rever gatilho</button>
      </div>
    </div>
  </div>`;
}

function celula(rotulo, valor, cor, titulo) {
  return `
  <div style="padding:8px 12px;border-right:1px solid var(--line-2);min-width:118px;" title="${esc(titulo)}">
    <div class="texto-mini">${esc(rotulo)}</div>
    <div class="mono" style="font-size:14px;font-weight:700;color:${cor};margin-top:2px;">${esc(valor)}</div>
  </div>`;
}
