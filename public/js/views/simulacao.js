/**
 * Tela de simulação do cenário — núcleo do Simulador FCI.
 *
 * Reúne em um único espaço de trabalho, com o CI% do produto sempre visível
 * (RF-064), as oito frentes de simulação do escopo funcional:
 *   1 Estrutura ............ RF-010 · RF-013 · RF-015 a RF-024 · RF-011 · RF-012
 *   2 Origem e conteúdo .... RF-046 a RF-051 · RF-033 · RF-058
 *   3 Câmbio ............... RF-052 a RF-055 · RF-059
 *   4 Volumes e destinos ... RF-066 a RF-072
 *   5 Cálculo .............. RF-056 a RF-065
 *   6 Validação ............ RF-025 a RF-033
 *   7 Alterações em massa .. RF-040 a RF-045
 *   8 Governança ........... RF-005 · RF-006 · RF-008 · RF-009 · RF-034 a RF-038
 *
 * Toda regra de negócio vem do motor compartilhado; a tela orquestra e explica.
 */
import { esc, dataHora, rotuloEvento, resumoEvento, requisitoEvento } from '../format.js';
import * as E from '/shared/engine.mjs';

/* ---------------------------------------------------------------- estado */

const ABAS = [
  { chave: 'estrutura',  rotulo: 'Estrutura' },
  { chave: 'origem',     rotulo: 'Origem e conteúdo' },
  { chave: 'cambio',     rotulo: 'Câmbio' },
  { chave: 'volumes',    rotulo: 'Volumes e destinos' },
  { chave: 'calculo',    rotulo: 'Cálculo' },
  { chave: 'validacao',  rotulo: 'Validação' },
  { chave: 'massa',      rotulo: 'Alterações em massa' },
  { chave: 'governanca', rotulo: 'Governança' },
];

const ST = {
  rascunho:    { label: 'Rascunho',    bg: '#efeae0', fg: '#8b8681' },
  calculado:   { label: 'Calculado',   bg: '#e9f1eb', fg: '#2f6b46' },
  congelado:   { label: 'Congelado',   bg: '#f4ecdd', fg: '#8a5e12' },
  consolidado: { label: 'Consolidado', bg: '#e6e9f2', fg: '#3d4c7a' },
};

/** Preferências que sobrevivem à troca de aba (hash) dentro da sessão. */
const estado = {
  cenarioId: null,
  prodId: null,
  variacaoUf: 5,
  st: null,
  abertos: {},      // expansores (aduaneiro, custos de entrada)
  massa: null,      // rascunho da operação em lote
};

/* ------------------------------------------------------- utilidades de UI */

/** Capacidade do perfil + estado do cenário, com motivo declarado (RF-035). */
function capacidade(ctx, chaves, finalidade) {
  const lista = Array.isArray(chaves) ? chaves : [chaves];
  const ok = lista.some((c) => ctx.pode(c));
  return {
    ok,
    motivo: ok ? '' : `Ação indisponível para o seu perfil: é necessária a capacidade «${lista[0]}» para ${finalidade} (RF-035 · RF-100). Consulte a matriz de permissões.`,
  };
}

function permissao(S, chaves, finalidade) {
  if (S.congelado) {
    return {
      ok: false,
      motivo: `Cenário ${S.cenario.status} — as premissas estão travadas para rastreabilidade (RN-10). Crie uma nova versão para ${finalidade}.`,
    };
  }
  return capacidade(S.ctx, chaves, finalidade);
}

/** Atributos de um controle governado por permissão: nunca esconder, sempre explicar. */
function attrs(p, tituloQuandoLiberado) {
  return `${p.ok ? '' : 'disabled '}title="${esc(p.ok ? (tituloQuandoLiberado || '') : p.motivo)}"`;
}

function chip(texto, bg, fg, titulo) {
  return `<span class="chip" style="background:${bg};color:${fg};"${titulo ? ` title="${esc(titulo)}"` : ''}>${esc(texto)}</span>`;
}

function kpi(rotulo, valor, hint, cor) {
  return `<div class="kpi">
    <div class="rotulo">${esc(rotulo)}</div>
    <div class="valor"${cor ? ` style="color:${cor};"` : ''}>${valor}</div>
    <div class="hint">${hint || ''}</div>
  </div>`;
}

function corCi(ci) { return E.faixaDe(ci).fg; }

function setaDelta(pp) {
  const v = E.n(pp);
  if (Math.abs(v) < 0.05) return '<span style="color:var(--ink-3);">sem variação</span>';
  return `<span style="color:${v > 0 ? 'var(--err)' : 'var(--ok-fg)'};font-weight:600;">${v > 0 ? '▲' : '▼'} ${esc(E.pp(v))}</span>`;
}

function vazio(texto) {
  return `<div style="padding:18px;font-size:12px;color:var(--ink-3);">${esc(texto)}</div>`;
}

/** Lê os parâmetros mestres em qualquer um dos formatos devolvidos pela API. */
function lerParametros(p) {
  const raw = p || {};
  const no = (k) => {
    const x = raw[k];
    if (x == null) return null;
    return (typeof x === 'object' && 'valor' in x) ? x.valor : x;
  };
  const st = no('st') || {};
  const motor = no('motor') || {};
  const gat = no('gatilho_reemissao') || {};
  return {
    aliqNormal:   E.n(raw.aliqNormal  != null ? raw.aliqNormal  : st.aliqNormal, 12),
    aliqInterna:  E.n(raw.aliqInterna != null ? raw.aliqInterna : st.aliqInterna, 18),
    mva:          E.n(raw.mva         != null ? raw.mva         : st.mva, 30),
    gatilho:      E.n(raw.gatilho     != null ? raw.gatilho     : gat.pp, 5),
    versaoFormula: raw.versaoFormula || motor.versaoFormula || E.VERSAO_FORMULA_PADRAO,
  };
}

/** GET tolerante: usa a API e, se a rota falhar, recai sobre o motor local. */
async function lerApi(S, caminho, alternativa) {
  try {
    const r = await S.ctx.api.get(caminho);
    return { r, local: false };
  } catch (err) {
    if (typeof alternativa !== 'function') throw err;
    return { r: alternativa(), local: true, erro: err.message };
  }
}

/* -------------------------------------------------------------- tela raiz */

export async function telaSimulacao(el, ctx, params) {
  const id = params && params[0];
  const abaPedida = params && params[1];
  const aba = ABAS.some((a) => a.chave === abaPedida) ? abaPedida : 'estrutura';

  if (estado.cenarioId !== id) {       // troca de cenário reinicia preferências
    estado.cenarioId = id;
    estado.prodId = null;
    estado.abertos = {};
    estado.massa = null;
  }

  const S = { el, ctx, id, aba };

  /* ---- carga do cenário (cenario, parametros, validacao, resumo) */
  S.carregar = async () => {
    const pacote = await ctx.api.get(`/cenarios/${id}`);
    S.absorver(pacote, true);
  };

  /* ---- absorve qualquer resposta que traga o cenário atualizado */
  S.absorver = (resp, completo) => {
    if (!resp) return;
    if (resp.cenario) S.cenario = resp.cenario;
    if (resp.parametros || completo) S.parametros = lerParametros(resp.parametros || S.parametros);
    // o que a resposta não traz é recalculado pelo motor, nunca mantido obsoleto
    S.validacao = resp.validacao;
    S.resumo = resp.resumo;
    S.exigeValidacao = resp.exigeValidacaoTecnica;
    // RF-038 — só o pacote completo de GET /cenarios/:id traz a situação da
    // validação técnica; as respostas de edição não a recalculam, então o
    // último estado conhecido é preservado.
    if (resp.governanca) S.governanca = resp.governanca;
    S.derivar();
  };

  /* ---- grandezas derivadas, sempre pelo motor (RNF-10) */
  S.derivar = () => {
    S.dados = S.cenario.dados || { produtos: [], insumos: [], fornecedores: [], cambio: {} };
    S.base = S.cenario.base_calculo || S.dados.base || 'saida';
    S.congelado = S.cenario.status === 'congelado' || S.cenario.status === 'consolidado';
    S.modoAvancado = S.cenario.modo === 'avancado';
    S.pars = {
      aliqNormal: S.parametros.aliqNormal,
      versaoFormula: S.parametros.versaoFormula,
      st: { mva: S.parametros.mva, aliqInterna: S.parametros.aliqInterna, aliqNormal: S.parametros.aliqNormal },
    };
    // diagnóstico: usa o da API quando vier consolidado, senão recalcula
    S.diag = (S.validacao && Array.isArray(S.validacao.grupos)) ? S.validacao : E.diagnostico(S.dados);
    if (S.exigeValidacao === undefined || S.exigeValidacao === null) S.exigeValidacao = E.exigeValidacaoTecnica(S.dados);
    if (!S.resumo) { try { S.resumo = E.resumoCenario(S.dados, S.base, S.pars); } catch { S.resumo = null; } }
    S.pas = (S.dados.produtos || []).filter((p) => (p.tipo || 'PA') === 'PA');
    if (!estado.prodId || !S.pas.some((p) => p.id === estado.prodId)) {
      estado.prodId = S.pas.length ? S.pas[0].id : null;
    }
    S.prodId = estado.prodId;
    S.resultado = S.prodId ? E.resultadoProduto(S.dados, S.prodId, S.base, S.pars) : null;
    if (!estado.st) estado.st = { mva: S.parametros.mva, aliqInterna: S.parametros.aliqInterna };
    try { ctx.definirAlertas(E.alertas(S.dados, S.parametros.gatilho, S.base, S.pars).length); } catch { /* alertas não bloqueiam a tela */ }
  };

  /* ---- execução de uma alteração + confronto imediato (RF-031) */
  S.aplicar = async ({ chamada, ok, fecharModal }) => {
    const antes = E.clonar(S.dados);
    try {
      const resp = await chamada();
      if (fecharModal) ctx.fecharModal();
      S.absorver(resp);
      S.render();
      if (ok) ctx.toast(ok, 'ok');
      const conf = resp && resp.confronto;
      if (conf && conf.houveRegressao) modalConfronto(S, conf, antes);
      return resp;
    } catch (err) {
      ctx.toast(err.message, 'erro');
      return null;
    }
  };

  S.irPara = (chave) => {
    if (chave === S.aba) return;
    ctx.navegar(`#/sim/${id}/${chave}`);
  };

  S.render = () => render(S);

  el.innerHTML = '<div class="carregando">Carregando cenário</div>';
  await S.carregar();
  S.render();
}

/* --------------------------------------------------- moldura e topo fixo */

function render(S) {
  const c = S.cenario;
  const st = ST[c.status] || ST.rascunho;
  const r = S.resultado;

  S.ctx.definirTopo('Simulação', esc(c.origem_dados || 'Cenário de simulação'), `
    <span style="color:var(--ink-3);">·</span>
    <span style="font-size:13px;color:var(--ink-2);font-weight:500;">${esc(c.nome)}</span>
    ${chip(st.label, st.bg, st.fg)}
    <span class="mono" style="font-size:10.5px;color:var(--ink-3);">${esc(c.codigo || '')} · v${esc(c.versao == null ? 1 : c.versao)}</span>
    ${chip(S.modoAvancado ? 'MODO AVANÇADO' : 'MODO PADRÃO', S.modoAvancado ? '#f4ecdd' : 'var(--line-2)', S.modoAvancado ? '#8a5e12' : 'var(--ink-3)',
      S.modoAvancado ? 'Campos de quantidade da receita liberados (RF-034)' : 'Quantidades da receita bloqueadas (RF-011)')}`);

  S.el.innerHTML = `
  <div>
    ${topoFixo(S, r)}
    ${S.congelado ? bannerCongelado(S) : ''}
    ${S.diag.nErros ? bannerErros(S) : ''}
    <div id="fci-aba"></div>
  </div>`;

  /* seletor de produto acabado — visível em todas as abas (RF-064) */
  S.el.querySelector('#fci-produto')?.addEventListener('change', (ev) => {
    estado.prodId = ev.target.value;
    estado.massa = null;
    S.derivar();
    S.render();
  });
  S.el.querySelectorAll('[data-subaba]').forEach((b) => {
    b.addEventListener('click', () => S.irPara(b.dataset.subaba));
  });
  S.el.querySelector('#fci-nova-versao')?.addEventListener('click', () => novaVersao(S));
  S.el.querySelector('#fci-ir-validacao')?.addEventListener('click', () => S.irPara('validacao'));

  const host = S.el.querySelector('#fci-aba');
  if (!S.pas.length) {
    host.innerHTML = `<div class="pagina"><div class="roadmap-box">
      <div class="titulo">Cenário sem estrutura carregada</div>
      Sincronize as fontes em <a href="#/integracoes">Integrações</a> e use “Recarregar estrutura” no painel de cenários.
      A última carga válida permanece disponível mesmo com integração em erro (RF-095).
    </div></div>`;
    return;
  }

  const renderizadores = {
    estrutura: abaEstrutura,
    origem: abaOrigem,
    cambio: abaCambio,
    volumes: abaVolumes,
    calculo: abaCalculo,
    validacao: abaValidacao,
    massa: abaMassa,
    governanca: abaGovernanca,
  };
  (renderizadores[S.aba] || abaEstrutura)(S, host);
}

function topoFixo(S, r) {
  const enq = r ? r.enquadramento : null;
  return `
  <div class="sim-topo">
    <div class="linha1">
      <div style="font-size:11px;color:var(--ink-3);font-weight:600;letter-spacing:.4px;">PRODUTO ACABADO (SKU)</div>
      <select id="fci-produto" style="min-width:300px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-weight:500;font-size:13px;"
        title="O resultado do cenário é apurado por produto acabado; o CI% exibido acompanha todas as abas (RF-064).">
        ${S.pas.map((p) => `<option value="${esc(p.id)}" ${p.id === S.prodId ? 'selected' : ''}>${esc(p.sku || p.id)} · ${esc(p.nome)}</option>`).join('')}
      </select>
      ${S.resumo ? `<span class="texto-mini" title="Indicadores do cenário (RF-004)">CI% médio do cenário <b class="mono" style="color:var(--ink-2);">${esc(E.pct(S.resumo.ciMedio))}</b> · ${esc(E.n(S.resumo.acima40))} produto(s) acima de 40%</span>` : ''}
      <div style="flex:1;"></div>
      ${r ? `
      <div class="sim-ci-box" title="CI% = parcela importada ÷ denominador × 100 (RN-01) — base: ${esc(r.baseLabel)}">
        <div style="text-align:right;">
          <div style="font-size:9.5px;color:var(--ink-3);letter-spacing:.4px;">CI% DO PRODUTO</div>
          <div style="font-size:11px;color:var(--ink-3);">base ${esc(r.baseUsada === 'saida' ? 'média ponderada das saídas' : 'custo total')}</div>
        </div>
        <div class="grande" style="color:${r.faixa.fg};">${esc(E.pct(r.ci))}</div>
        <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;">
          ${chip(r.faixa.label, r.faixa.bg, r.faixa.fg, `${r.faixa.range} (RN-06)`)}
          ${chip(`Alíquota ${E.num(enq.aliquota, 0)}%`, enq.aliquota === 4 ? '#f5e5e0' : '#e9f1eb', enq.aliquota === 4 ? '#a03d2c' : '#2f6b46',
            enq.aliquota === 4 ? 'CI% acima de 40% → 4% (Resolução SF 13/2012 · RN-07)' : 'Alíquota interestadual normal do destino')}
        </div>
      </div>` : ''}
    </div>
    <div class="subabas">
      ${ABAS.map((a) => `<button class="subaba ${a.chave === S.aba ? 'ativa' : ''}" data-subaba="${a.chave}">${esc(a.rotulo)}${pino(S, a.chave)}</button>`).join('')}
    </div>
  </div>`;
}

/** Contador contextual de cada sub-aba. */
function pino(S, chave) {
  const marca = (n, tipo, titulo) => n ? `<span class="pino ${tipo}" title="${esc(titulo)}">${n}</span>` : '';
  if (chave === 'estrutura') {
    const n = (S.dados.produtos || []).reduce((a, p) => a + (p.componentes || []).filter((c) => E.temSubstituicao(c)).length, 0);
    return marca(n, 'warn', `${n} componente(s) com substituição aplicada (RF-015)`);
  }
  if (chave === 'origem') {
    const n = (S.dados.insumos || []).filter((i) => divergenciasInsumo(i).length).length;
    return marca(n, 'warn', `${n} insumo(s) com divergência de origem ou de CST (RF-047 · RF-050)`);
  }
  if (chave === 'cambio') {
    const n = Object.keys(S.dados.cambio || {}).filter((m) => {
      const padrao = E.n((S.dados.cambioPadrao || {})[m]);
      return padrao > 0 && Math.abs(E.n(S.dados.cambio[m]) - padrao) > 1e-9;
    }).length;
    return marca(n, 'warn', `${n} cotação(ões) alterada(s) em relação à carga (RF-052)`);
  }
  if (chave === 'volumes') {
    const p = E.acharProduto(S.dados, S.prodId);
    const n = ((p && p.saidas) || []).length;
    return marca(n, 'ok', `${n} UF(s) de destino carregada(s) (RF-066)`);
  }
  if (chave === 'validacao') {
    if (S.diag.nErros) return marca(S.diag.nErros, 'err', `${S.diag.nErros} erro(s) de validação — bloqueiam congelar e consolidar (RF-025)`);
    if (S.diag.nAvisos) return marca(S.diag.nAvisos, 'warn', `${S.diag.nAvisos} aviso(s) sem bloqueio (RF-032)`);
    return marca('✓', 'ok', 'Nenhuma inconsistência identificada');
  }
  if (chave === 'massa') {
    const n = E.gruposDeInsumo(S.dados).length;
    return marca(n, 'ok', `${n} grupo(s) de insumo na ficha técnica (RF-040)`);
  }
  if (chave === 'governanca') {
    const n = E.diffs(S.dados).length;
    return marca(n, S.exigeValidacao ? 'err' : 'warn', `${n} ponto(s) alterado(s) em relação ao padrão (RF-036)`);
  }
  return '';
}

function bannerCongelado(S) {
  const p = capacidade(S.ctx, ['criarCenario'], 'criar uma nova versão do cenário');
  return `
  <div style="margin:16px 26px 0;background:#f4ecdd;border:1px solid #e3cfa4;border-radius:9px;padding:11px 15px;display:flex;align-items:center;gap:11px;font-size:12.5px;color:#6d5320;">
    <span style="font-size:15px;">🔒</span>
    <div style="flex:1;">Cenário <b>${esc(S.cenario.status)}</b> — premissas travadas para rastreabilidade da decisão (RN-10).
    A edição exige uma nova versão; o histórico da versão atual permanece íntegro.</div>
    <button class="btn btn-ouro btn-mini" id="fci-nova-versao" ${attrs(p, 'Duplica o cenário em uma nova versão editável (RF-003)')}>Nova versão</button>
  </div>`;
}

function bannerErros(S) {
  return `
  <div style="margin:16px 26px 0;" class="aviso-erro">
    <span style="font-size:15px;">✕</span>
    <div style="flex:1;"><b>Consolidar e congelar indisponíveis.</b> ${esc(S.diag.motivo || `Cenário com ${S.diag.nErros} erro(s) de validação de estrutura (RF-025).`)}</div>
    <button class="btn btn-borda btn-mini" id="fci-ir-validacao">Ver diagnóstico</button>
  </div>`;
}

async function novaVersao(S) {
  try {
    const r = await S.ctx.api.post(`/cenarios/${S.id}/duplicar`, { resumo: 'Nova versão criada a partir de cenário congelado (RN-10)' });
    const novo = r.cenario || r;
    S.ctx.toast(`Nova versão criada: ${novo.codigo || ''} (v${novo.versao == null ? '' : novo.versao}).`, 'ok');
    S.ctx.navegar(`#/sim/${novo.id}/${S.aba}`);
  } catch (err) { S.ctx.toast(err.message, 'erro'); }
}

/** Confronto imediato das inconsistências NOVAS geradas pela edição (RF-031). */
function modalConfronto(S, confronto, dadosAntes) {
  const wrap = S.ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--err-bg);border:1px solid #e0a898;display:flex;align-items:center;justify-content:center;font-size:17px;">⚠</div>
      <div style="flex:1;">
        <h2>A alteração gerou ${confronto.total} inconsistência(s)</h2>
        <div class="sub">Confronto imediato da edição com os validadores da estrutura (RF-031). Você pode desfazer a alteração ou mantê-la e corrigir em seguida.</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="diag-grupo">
        <header><span style="color:var(--err-fg);">✕</span> Inconsistências novas</header>
        ${(confronto.novos || []).map((i) => `
          <div class="diag-item erro">
            <span class="marca">✕</span>
            <div><b>${esc(rotuloTipo(i.tipo))}</b> · ${esc(i.msg)}</div>
          </div>`).join('')}
      </div>
      <div class="aviso-info">Manter a alteração não impede o trabalho: enquanto houver erro, apenas <b>congelar</b> e <b>consolidar</b> ficam indisponíveis (RF-025).</div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" id="cf-desfazer">↺ Desfazer alteração</button>
      <button class="btn btn-ouro" id="cf-manter">Manter e corrigir</button>
    </div>`, { largo: true });

  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = S.ctx.fecharModal; });
  wrap.querySelector('#cf-desfazer').onclick = async () => {
    try {
      const resp = await S.ctx.api.put(`/cenarios/${S.id}/dados`, {
        dados: dadosAntes,
        resumo: 'Alteração desfeita após confronto imediato das inconsistências (RF-031)',
      });
      S.ctx.fecharModal();
      S.absorver(resp);
      S.render();
      S.ctx.toast('Alteração desfeita — o cenário voltou ao estado anterior.', 'ok');
    } catch (err) { S.ctx.toast(err.message, 'erro'); }
  };
  wrap.querySelector('#cf-manter').onclick = () => {
    S.ctx.fecharModal();
    S.irPara('validacao');
  };
}

function rotuloTipo(tipo) {
  const mapa = {
    obrigatorio: 'Componente obrigatório', quantidade: 'Quantidade da receita',
    proporcao: 'Soma das proporções', distribuicao: 'Distribuição × quantidade original',
    especificacao: 'Especificação técnica do SKU', referencia: 'Referência da estrutura',
    custo: 'Custo do insumo', ci: 'Conteúdo de importação', cst: 'Coerência fiscal (CST)',
    ciclo: 'Estrutura cíclica', overhead: 'Custo industrial',
  };
  return mapa[tipo] || 'Validação';
}

/** Divergências de cadastro de um insumo (RF-047 · RF-050). */
function divergenciasInsumo(ins) {
  const out = [];
  if (ins.origemErp != null && String(ins.origemErp) !== '') {
    const sugerida = E.classificacaoPorOrigem(ins.origemErp).classSim;
    if (sugerida !== (ins.classSim || 'nacional')) {
      out.push({
        tipo: 'origem',
        msg: `Origem do cadastro «${ins.origemErp}» corresponde a «${(E.CLASSES[sugerida] || {}).label || sugerida}», diferente da classificação adotada no cenário (RF-047).`,
      });
    }
  }
  const sugeridoCst = E.cstSugerido(ins.classSim, ins.ciFaixa, ins.ciPct, ins.ciModo);
  const informado = String(ins.cstOrigem == null ? (ins.cstErp == null ? '' : ins.cstErp) : ins.cstOrigem).trim();
  if (informado && informado !== sugeridoCst) {
    out.push({
      tipo: 'cst',
      msg: `CST informado (${informado}) difere do sugerido (${sugeridoCst}) para a classificação adotada — sinalizado sem bloqueio (RF-050 · RF-033).`,
    });
  }
  return out;
}

/* ============================================================================
 * ABA 1 · ESTRUTURA — cascata MP → PI → PA, quantidades e substituição
 * RF-010 · RF-011 · RF-012 · RF-013 · RF-015 a RF-024
 * ========================================================================== */

function abaEstrutura(S, host) {
  const raiz = E.computeNode(S.dados, S.prodId, {});
  const permQtd = permissao(S, ['modoAvancado'], 'alterar quantidades da receita');
  const bloqueioReceita = {
    ok: permQtd.ok && S.modoAvancado,
    motivo: !permQtd.ok ? permQtd.motivo
      : 'Campo bloqueado no modo padrão: a quantidade da receita só é editável no modo avançado (RF-011). Alterne o modo na aba Governança (RF-034).',
  };
  const permSub = permissao(S, ['substituir', 'editarEstrutura'], 'substituir componentes');

  // índice de ocorrências por componente, para o aviso junto da linha (RF-032)
  const porComponente = new Map();
  for (const i of S.diag.itens || []) {
    if (i.prodId == null || i.idx == null) continue;
    const k = `${i.prodId}|${i.idx}`;
    if (!porComponente.has(k)) porComponente.set(k, []);
    porComponente.get(k).push(i);
  }

  host.innerHTML = `
  <div class="pagina" style="max-width:1680px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
      <div>
        <h2 style="margin:0;font-size:14px;font-weight:600;">Estrutura do produto · cascata MP → PI → PA</h2>
        <div class="texto-mini">Lista técnica carregada da integração como ponto de partida, sem digitação manual (RF-002 · RF-010).
        Cada nó aplica o seu próprio fator de faixa; a soma das parcelas dos componentes é a parcela importada do produto (RF-013).</div>
      </div>
      <div class="linha-flex">
        <span class="texto-mini">Origem: <b style="color:var(--ink-2);">${esc(S.cenario.origem_dados || '—')}</b></span>
        ${chip(S.modoAvancado ? 'RECEITA EDITÁVEL' : 'RECEITA PROTEGIDA', S.modoAvancado ? '#f4ecdd' : 'var(--line-2)', S.modoAvancado ? '#8a5e12' : 'var(--ink-3)',
          S.modoAvancado ? 'Modo avançado: quantidades liberadas (RF-034)' : 'Modo padrão: quantidades bloqueadas (RF-011)')}
      </div>
    </div>

    <div class="card" style="overflow:hidden;">
      <div class="bom-grid bom-head editavel">
        <div>INSUMO / COMPONENTE</div>
        <div style="text-align:right;">QTD RECEITA</div>
        <div>ORIGEM / CLASSIFICAÇÃO</div>
        <div>FORNECEDOR</div>
        <div style="text-align:right;">CUSTO FCI UN.</div>
        <div style="text-align:right;">CI NÓ</div>
        <div style="text-align:right;">PARCELA IMP.</div>
        <div style="text-align:center;">AÇÕES</div>
      </div>
      ${linhasDoNo(S, raiz, 0, porComponente, bloqueioReceita, permSub)}
      ${linhaOverhead(S, raiz)}
      <div class="bom-grid editavel bom-total">
        <div style="font-weight:600;font-size:13px;">TOTAL · ${esc(raiz.nome)}</div>
        <div></div><div></div><div></div>
        <div class="mono" style="text-align:right;font-weight:600;">${esc(E.brl(raiz.custo))}</div>
        <div class="mono" style="text-align:right;font-weight:600;color:${E.faixaDe(raiz.ci).chip};">${esc(E.pct(raiz.ci))}</div>
        <div class="mono" style="text-align:right;font-weight:700;color:var(--gold);">${esc(E.brl(raiz.parcela))}</div>
        <div></div>
      </div>
    </div>

    <div class="nota-rodape">
      <b style="color:var(--ink-2);">CI nó</b> = conteúdo de importação do componente · <b style="color:var(--ink-2);">fator de faixa</b> ≤40% → 0 · 40–70% → 0,5 · &gt;70% → 1 (RN-05) ·
      <b style="color:var(--ink-2);">parcela imp.</b> = custo × quantidade × fator (RF-013).
      O overhead compõe o custo total e nunca integra a parcela importada (RF-012).
      A substituição nunca altera a quantidade total da receita (RF-018) e o item original permanece listado mesmo com proporção zero (RF-019).
      Alterações valem apenas neste cenário — o cadastro oficial não é afetado (RF-007 · RNF-06).
    </div>
  </div>`;

  /* ---- quantidade da receita (RF-011) */
  host.querySelectorAll('[data-qtd]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const qtd = Number(String(inp.value).replace(',', '.'));
      if (!(qtd > 0)) { S.ctx.toast('Informe uma quantidade maior que zero.', 'erro'); S.render(); return; }
      S.aplicar({
        chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/componente/qtd`, {
          prodId: inp.dataset.prod, idx: Number(inp.dataset.idx), qtd,
        }),
        ok: 'Quantidade da receita alterada — a mudança exige validação técnica antes da consolidação (RF-036 · RN-11).',
      });
    });
  });

  /* ---- overhead do produto (RF-012) */
  host.querySelector('[data-overhead]')?.addEventListener('change', (ev) => {
    const overhead = Number(String(ev.target.value).replace(',', '.'));
    if (!(overhead >= 0)) { S.ctx.toast('Informe um custo industrial válido.', 'erro'); S.render(); return; }
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/produto/overhead`, { prodId: ev.target.dataset.overhead, overhead }),
      ok: 'Custo industrial (overhead) alterado — compõe o custo total sem integrar a parcela importada (RF-012).',
    });
  });

  /* ---- assistente de substituição e ações das alternativas */
  host.querySelectorAll('[data-subst]').forEach((b) => b.addEventListener('click', () => {
    const [prodId, idx] = b.dataset.subst.split('|');
    assistenteSubstituicao(S, prodId, Number(idx));
  }));
  host.querySelectorAll('[data-reverter]').forEach((b) => b.addEventListener('click', () => {
    const [prodId, idx] = b.dataset.reverter.split('|');
    reverterSubstituicao(S, prodId, Number(idx));
  }));
  host.querySelectorAll('[data-normalizar]').forEach((b) => b.addEventListener('click', () => {
    const [prodId, idx] = b.dataset.normalizar.split('|');
    S.aplicar({
      chamada: () => S.ctx.api.post(`/cenarios/${S.id}/sim/substituicao/normalizar`, { prodId, idx: Number(idx) }),
      ok: 'Proporções normalizadas para 100% (RF-023).',
    });
  }));
  host.querySelectorAll('[data-prop]').forEach((inp) => inp.addEventListener('change', () => {
    const [prodId, idx, mi] = inp.dataset.prop.split('|');
    const valor = Number(String(inp.value).replace(',', '.'));
    if (!(valor >= 0 && valor <= 100)) { S.ctx.toast('A proporção deve ficar entre 0% e 100%.', 'erro'); S.render(); return; }
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/substituicao/proporcao`, {
        prodId, idx: Number(idx), mi: Number(mi), pct: valor,
      }),
      ok: 'Proporção ajustada — a alternativa complementar foi recalculada para totalizar 100% (RF-017).',
    });
  }));
}

/** Linhas dos componentes de um nó, em cascata. */
function linhasDoNo(S, no, nivel, porComponente, bloqueioReceita, permSub) {
  return (no.children || []).map((child) => {
    let html = linhaComponente(S, no.id, child, nivel, porComponente, bloqueioReceita, permSub);
    for (const parte of child.parts) {
      if (parte.node && parte.node.kind === 'prod') {
        html += linhasDoNo(S, parte.node, nivel + 1, porComponente, bloqueioReceita, permSub);
      }
    }
    return html;
  }).join('');
}

function linhaComponente(S, prodIdDono, child, nivel, porComponente, bloqueioReceita, permSub) {
  const principal = child.parts[0];
  const no = principal.node;
  const ins = no.ins;
  const cls = ins ? (E.CLASSES[ins.classSim] || E.CLASSES.nacional) : null;
  const forn = ins ? E.fornecedorDe(S.dados, ins) : null;
  const ehPI = no.kind === 'prod';
  const custoUnit = child.qtd > 0 ? child.custoTot / child.qtd : no.custo;
  const chaveAviso = `${prodIdDono}|${child.idx}`;
  const avisos = porComponente.get(chaveAviso) || [];
  const pad = nivel * 24;

  const tag = ehPI
    ? '<span class="bom-kind" style="background:#e8e2f2;color:#5b4a86;" title="Produto intermediário — exibe os próprios insumos em nível subordinado (RF-013)">PI</span>'
    : '<span class="bom-kind" style="background:var(--line-2);color:var(--ink-2);" title="Matéria-prima / insumo">MP</span>';

  let html = `
  <div class="bom-grid editavel ${nivel > 0 ? 'bom-sub' : ''}">
    <div style="display:flex;align-items:center;gap:9px;padding-left:${pad}px;min-width:0;">
      ${nivel > 0 ? '<span style="color:var(--gold);font-size:12px;">↳</span>' : ''}
      ${tag}
      <div style="min-width:0;">
        <div style="font-weight:${ehPI ? 600 : 400};font-size:12.5px;">${esc(no.nome)}${child.hasMix ? ' <span class="tag-semana" title="Componente com substituição aplicada (RF-015)">MISTURA</span>' : ''}</div>
        <div class="mono" style="font-size:10px;color:var(--ink-3);">${esc(no.codigo || no.sku || no.id)} · grupo ${esc(child.grupo)}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <input class="inp-num" type="number" step="0.0001" min="0" value="${E.n(child.qtd)}"
        data-qtd data-prod="${esc(prodIdDono)}" data-idx="${child.idx}"
        ${attrs(bloqueioReceita, 'Quantidade da receita no cenário — alteração exige validação técnica (RF-036)')}>
      <div style="font-size:9.5px;color:var(--ink-3);">${esc(child.unidade)}${bloqueioReceita.ok ? '' : ' 🔒'}${child.qtdPadrao != null && Math.abs(E.n(child.qtd) - E.n(child.qtdPadrao)) > 1e-9 ? ` · padrão ${esc(E.num(child.qtdPadrao, 4))}` : ''}</div>
    </div>
    <div>
      ${cls ? `<span class="origem-tag" style="background:${cls.bg};color:${cls.fg};" title="${esc(cls.desc)} · CST ${esc(cls.cst)}">${esc(cls.curto)}</span>`
            : '<span class="origem-tag" style="background:#e8e2f2;color:#5b4a86;" title="Intermediário: o conteúdo resulta da própria cascata (RF-057)">Intermediário</span>'}
      ${ins && ins.alt ? '<div style="font-size:9.5px;color:var(--gold-d);">alternativa do cenário</div>' : ''}
    </div>
    <div style="font-size:11.5px;color:var(--ink-2);">${esc(forn ? forn.nome : (ehPI ? 'produção própria' : '—'))}</div>
    <div class="mono" style="text-align:right;">${esc(E.brl(custoUnit))}</div>
    <div class="mono" style="text-align:right;">
      <span style="color:${no.ci > 40 ? 'var(--err)' : no.ci > 0 ? 'var(--warn-fg)' : 'var(--ink-2)'};">${esc(child.hasMix ? E.pct(child.fator * 100) : (ehPI ? E.pct(no.ci) : no.ciLabel))}</span>
      <div style="font-size:9px;color:var(--ink-3);" title="Fator de faixa aplicado na cascata (RN-05)">×${esc(E.num(child.fator, Number.isInteger(child.fator) ? 0 : 2))}</div>
    </div>
    <div class="mono" style="text-align:right;font-weight:600;color:${child.contrib > 0 ? 'var(--gold-d)' : 'var(--ink-3)'};">${esc(E.brl(child.contrib))}</div>
    <div style="display:flex;gap:4px;justify-content:center;">
      <button class="btn-icone" data-subst="${esc(prodIdDono)}|${child.idx}" ${attrs(permSub, 'Assistente de substituição: tipo, item substituto, proporção e prévia do efeito (RF-015 a RF-022)')}>⇄</button>
      ${child.hasMix ? `<button class="btn-icone" data-reverter="${esc(prodIdDono)}|${child.idx}" ${attrs(permSub, 'Reverter ao componente original (RF-024)')}>↺</button>` : ''}
    </div>
  </div>`;

  for (const a of avisos) {
    html += `<div class="linha-aviso ${a.sev === 'erro' ? 'erro' : 'aviso'}">
      <span style="font-weight:700;">${a.sev === 'erro' ? '✕' : '⚠'}</span>
      <div><b>${esc(rotuloTipo(a.tipo))}</b> · ${esc(a.msg)}</div>
    </div>`;
  }

  if (child.hasMix) html += blocoAlternativas(S, prodIdDono, child, permSub);
  return html;
}

/** Alternativas do componente — original e substituto, inclusive com 0% (RF-019 · RF-023). */
function blocoAlternativas(S, prodIdDono, child, permSub) {
  const total = child.parts.reduce((a, p) => a + E.n(p.pct), 0);
  const fechado = Math.abs(total - 100) < 0.01;
  const linhas = child.parts.map((parte) => {
    const zero = E.n(parte.pct) <= 0;
    const papel = parte.origem === 'original' ? 'ORIGINAL' : 'SUBSTITUTO';
    return `
    <div class="linha-alt">
      <div style="display:flex;align-items:center;gap:8px;padding-left:34px;min-width:0;">
        <span class="tag-alt ${parte.origem} ${zero ? 'zero' : ''}">${papel}</span>
        <div style="min-width:0;">
          <div style="font-size:12px;${zero ? 'color:var(--ink-3);' : ''}">${esc(parte.node.nome)}</div>
          <div class="mono" style="font-size:9.5px;color:var(--ink-3);">${esc(parte.node.codigo || parte.node.sku || parte.ref)}${zero ? ' · não utilizado' : ''}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <input class="inp-pct" type="number" step="0.1" min="0" max="100" value="${E.n(parte.pct)}"
          data-prop="${esc(prodIdDono)}|${child.idx}|${parte.mi}"
          ${attrs(permSub, 'Proporção da alternativa; a outra é complementada para 100% (RF-017)')}><span style="font-size:10px;color:var(--ink-3);">%</span>
      </div>
      <div class="mono" style="font-size:11px;color:var(--ink-3);" title="Quantidade calculada sobre a quantidade original da receita (RF-018)">${esc(E.num(parte.qtd, 4))} ${esc(child.unidade)}</div>
      <div style="font-size:11px;color:var(--ink-2);">${esc(nomeFornecedorDe(S, parte.ref))}</div>
      <div class="mono" style="text-align:right;font-size:11.5px;">${esc(E.brl(parte.custoUnit))}</div>
      <div class="mono" style="text-align:right;font-size:11.5px;">${esc(parte.node.ciLabel || E.pct(parte.node.ci))}<div style="font-size:9px;color:var(--ink-3);">×${esc(E.num(parte.fator, 2))}</div></div>
      <div class="mono" style="text-align:right;font-size:11.5px;color:${parte.contrib > 0 ? 'var(--gold-d)' : 'var(--ink-3)'};">${esc(E.brl(parte.contrib))}<div style="font-size:9px;color:var(--ink-3);">${esc(E.brl(parte.custoTot))} custo</div></div>
      <div></div>
    </div>`;
  }).join('');

  return `
  <div class="bom-alt">
    ${linhas}
    <div class="rodape-alt">
      <span style="font-size:11px;color:${fechado ? 'var(--ink-3)' : 'var(--err-fg)'};">
        Proporção total: <b class="mono">${esc(E.num(total, 2))}%</b>${fechado ? '' : ' — fora de 100% (RF-028 · RN-09)'}
      </span>
      ${fechado ? '' : `<button class="btn btn-borda btn-mini" data-normalizar="${esc(prodIdDono)}|${child.idx}" ${attrs(permSub, 'Redistribui proporcionalmente as alternativas até 100% (RF-023)')}>Normalizar para 100%</button>`}
      <button class="btn btn-borda btn-mini" data-subst="${esc(prodIdDono)}|${child.idx}" ${attrs(permSub, 'Reabre o assistente com os valores atuais (RF-017)')}>Ajustar substituição</button>
      <button class="btn btn-borda btn-mini" data-reverter="${esc(prodIdDono)}|${child.idx}" ${attrs(permSub, 'Remove as alternativas e retorna o componente original a 100% (RF-024)')}>Reverter ao original</button>
      <span class="texto-mini">Soma das quantidades: <b class="mono">${esc(E.num(child.parts.reduce((a, p) => a + p.qtd, 0), 4))} ${esc(child.unidade)}</b> · quantidade original da receita <b class="mono">${esc(E.num(child.qtd, 4))}</b> (RF-018)</span>
    </div>
  </div>`;
}

function nomeFornecedorDe(S, ref) {
  const prod = E.acharProduto(S.dados, ref);
  if (prod) return 'produção própria';
  const f = E.fornecedorDe(S.dados, E.acharInsumo(S.dados, ref));
  return f ? f.nome : '—';
}

function linhaOverhead(S, raiz) {
  const perm = permissao(S, ['modoAvancado'], 'alterar o custo industrial');
  const bloqueio = {
    ok: perm.ok && S.modoAvancado,
    motivo: !perm.ok ? perm.motivo
      : 'Campo bloqueado no modo padrão: o custo industrial só é editável no modo avançado (RF-012 · RF-011). Alterne o modo na aba Governança.',
  };
  const prod = raiz.prod || {};
  const alterado = prod.overheadPadrao != null && Math.abs(E.n(prod.overhead) - E.n(prod.overheadPadrao)) > 1e-9;
  return `
  <div class="bom-grid editavel" style="background:var(--panel-2);">
    <div style="font-size:11.5px;color:var(--ink-2);font-weight:600;">Mão de obra + custos industriais (overhead)</div>
    <div></div>
    <div><span class="origem-tag" style="background:${E.CLASSES.nacional.bg};color:${E.CLASSES.nacional.fg};">Nacional</span></div>
    <div style="font-size:11.5px;color:var(--ink-3);">produção própria</div>
    <div style="text-align:right;">
      <input class="inp-num" type="number" step="0.0001" min="0" value="${E.n(raiz.overhead)}"
        data-overhead="${esc(raiz.id)}" ${attrs(bloqueio, 'Custo industrial do produto no cenário (RF-012)')}>
      <div style="font-size:9.5px;color:var(--ink-3);">R$/un${bloqueio.ok ? '' : ' 🔒'}${alterado ? ` · padrão ${esc(E.num(prod.overheadPadrao, 4))}` : ''}</div>
    </div>
    <div class="mono" style="text-align:right;font-size:10.5px;color:var(--ink-3);" title="O overhead não integra a parcela importada (RF-012)">×0</div>
    <div class="mono" style="text-align:right;color:var(--ink-3);">${esc(E.brl(0))}</div>
    <div></div>
  </div>`;
}

function reverterSubstituicao(S, prodId, idx) {
  S.aplicar({
    chamada: () => S.ctx.api.del(`/cenarios/${S.id}/sim/substituicao?prodId=${encodeURIComponent(prodId)}&idx=${idx}`),
    ok: 'Substituição removida — a estrutura voltou ao componente original com 100% (RF-024).',
  });
}

/* ============================================================================
 * ASSISTENTE DE SUBSTITUIÇÃO — 3 etapas + prévia do efeito
 * RF-015 · RF-016 · RF-017 · RF-018 · RF-020 · RF-021 · RF-022 · RF-024
 * ========================================================================== */

async function assistenteSubstituicao(S, prodId, idx) {
  const permSub = permissao(S, ['substituir', 'editarEstrutura'], 'substituir componentes');
  const prod = E.acharProduto(S.dados, prodId);
  const comp = prod && (prod.componentes || [])[idx];
  if (!comp) { S.ctx.toast('Componente não encontrado na estrutura do produto.', 'erro'); return; }

  const wrap = S.ctx.abrirModal('<div class="corpo"><div class="carregando">Carregando alternativas elegíveis</div></div>', { largo: true });

  // RF-020 — alternativas elegíveis, mesmo grupo primeiro
  const { r, local } = await lerApi(S, `/cenarios/${S.id}/sim/substituicao/opcoes?prodId=${encodeURIComponent(prodId)}&idx=${idx}`,
    () => E.opcoesSubstituicao(S.dados, prodId, idx));
  const op = r.opcoes || r;
  const mesmoGrupo = op.mesmoGrupo || [];
  const outros = op.outros || [];
  const todas = [...mesmoGrupo, ...outros];
  const atual = op.atual || {};

  if (!todas.length) {
    wrap.querySelector('.modal').innerHTML = `
      <div class="cabeca"><div style="flex:1;"><h2>Sem alternativas elegíveis</h2>
      <div class="sub">Não há outro item compatível no cenário para substituir «${esc(atual.nome || '')}» (RF-020 · RF-021).</div></div>
      <button class="fechar" data-m="fechar">×</button></div>
      <div class="rodape"><button class="btn btn-borda" data-m="fechar">Fechar</button></div>`;
    wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = S.ctx.fecharModal; });
    return;
  }

  const mixAtual = E.mixOf(comp);
  const jaTemSubstituicao = E.temSubstituicao(comp);
  const sel = {
    modo: jaTemSubstituicao ? (E.n(mixAtual[1].pct) >= 100 ? 'integral' : 'parcial') : 'integral',
    ref: jaTemSubstituicao ? mixAtual[1].ref : todas[0].ref,
    pct: jaTemSubstituicao ? E.n(mixAtual[1].pct) : 100,
  };
  if (!todas.some((o) => o.ref === sel.ref)) sel.ref = todas[0].ref;

  let previa = null;
  let token = 0;

  const opcaoSel = () => todas.find((o) => o.ref === sel.ref) || todas[0];
  const pctSub = () => (sel.modo === 'integral' ? 100 : Math.min(100, Math.max(0, E.n(sel.pct))));

  async function carregarPrevia() {
    const meu = ++token;
    const corpo = { prodId, idx, refSubstituto: sel.ref, modo: sel.modo, pct: pctSub() };
    let p = null;
    try {
      const resp = await S.ctx.api.post(`/cenarios/${S.id}/sim/substituicao/previa`, corpo);
      p = resp && (resp.previa || resp);
      if (!p || (p.ciSimulado == null && !p.erro)) p = null;   // resposta inesperada
    } catch { p = null; }
    // prévia local pelo mesmo motor — garante o RF-022 em qualquer circunstância
    if (!p) { try { p = E.previaSubstituicao(S.dados, prodId, idx, corpo, S.base, S.pars); } catch (err) { p = { erro: err.message }; } }
    if (meu !== token) return;
    previa = p;
    pintarPrevia();
  }

  function pintarPrevia() {
    const box = wrap.querySelector('#as-previa');
    if (box) box.innerHTML = htmlPrevia();
    const aplicar = wrap.querySelector('#as-aplicar');
    if (aplicar && previa && previa.erro) { aplicar.disabled = true; aplicar.title = previa.erro; }
  }

  function htmlPrevia() {
    if (!previa) return '<div class="carregando">Calculando prévia</div>';
    if (previa.erro) return `<div class="aviso-erro"><span>✕</span><div>${esc(previa.erro)}</div></div>`;
    const fxA = previa.faixaAtual || E.faixaDe(previa.ciAtual);
    const fxS = previa.faixaSimulada || E.faixaDe(previa.ciSimulado);
    const delta = previa.deltaPp != null ? previa.deltaPp : E.n(previa.ciSimulado) - E.n(previa.ciAtual);
    const aliqA = previa.aliquotaAtual != null ? previa.aliquotaAtual : E.aliqInter(previa.ciAtual, S.parametros.aliqNormal);
    const aliqS = previa.aliquotaSimulada != null ? previa.aliquotaSimulada : E.aliqInter(previa.ciSimulado, S.parametros.aliqNormal);
    const muda = previa.mudaFaixa != null ? previa.mudaFaixa : fxA.key !== fxS.key;
    const varCusto = E.n(previa.custoAtual) > 0 ? (E.n(previa.deltaCusto) / E.n(previa.custoAtual) * 100) : 0;
    return `
    <div class="previa-efeito">
      <div>
        <div class="rot">CI% ATUAL</div>
        <div class="val" style="color:${fxA.fg};">${esc(E.pct(previa.ciAtual))}</div>
        <div class="texto-mini">${esc(fxA.label)}</div>
      </div>
      <div style="font-size:20px;color:var(--gold);">→</div>
      <div>
        <div class="rot">CI% SIMULADO</div>
        <div class="val" style="color:${fxS.fg};">${esc(E.pct(previa.ciSimulado))}</div>
        <div class="texto-mini">${esc(fxS.label)}</div>
      </div>
      <div>
        <div class="rot">VARIAÇÃO</div>
        <div class="val" style="color:${delta > 0 ? 'var(--err)' : delta < 0 ? 'var(--ok-fg)' : 'var(--ink-2)'};">${esc(E.pp(delta))}</div>
        <div class="texto-mini">custo total ${esc(E.pp(varCusto))}</div>
      </div>
      <div>
        <div class="rot">FAIXA RESULTANTE</div>
        <div style="margin-top:5px;">${chip(fxS.label, fxS.bg, fxS.fg, fxS.range)}</div>
        ${muda ? `<div class="texto-mini" style="color:var(--warn-fg);font-weight:600;">⚠ muda de faixa de enquadramento</div>` : '<div class="texto-mini">faixa mantida</div>'}
      </div>
      <div>
        <div class="rot">ALÍQUOTA</div>
        <div class="val" style="font-size:18px;">${esc(E.num(aliqA, 0))}% → <b style="color:${aliqS === 4 ? 'var(--err)' : 'var(--ok-fg)'};">${esc(E.num(aliqS, 0))}%</b></div>
        <div class="texto-mini">interestadual resultante (RN-07)</div>
      </div>
    </div>`;
  }

  function htmlTabela() {
    const o = opcaoSel();
    const p = pctSub();
    const qtdBase = E.n(atual.qtdReceita != null ? atual.qtdReceita : comp.qtd);
    const unidade = atual.unidade || E.unidadeDe(S.dados, mixAtual[0].ref);
    const qtdOrig = qtdBase * (100 - p) / 100;
    const qtdSub = qtdBase * p / 100;
    return `
    <div class="subst-tabela">
      <div class="subst-linha cabeca">
        <div>ITEM</div><div style="text-align:right;">PROPORÇÃO</div><div style="text-align:right;">QTD CALCULADA</div>
        <div style="text-align:right;">CUSTO FCI UN.</div><div style="text-align:right;">CI DO NÓ</div>
      </div>
      <div class="subst-linha">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="tag-alt original">ORIGINAL</span>
          <div style="min-width:0;">
            <div style="font-size:12px;">${esc(atual.nome || E.nomeDe(S.dados, mixAtual[0].ref))}</div>
            <div class="texto-mini" id="as-nota-orig">${p >= 100 ? 'permanece listado como não utilizado (RF-019)' : 'proporção complementar automática (RF-017)'}</div>
          </div>
        </div>
        <div style="text-align:right;"><span class="mono" style="font-weight:600;" id="as-p-orig">${esc(E.num(100 - p, 1))}%</span></div>
        <div class="mono" style="text-align:right;"><span id="as-q-orig">${esc(E.num(qtdOrig, 4))}</span> ${esc(unidade)}</div>
        <div class="mono" style="text-align:right;">${esc(E.brl(atual.custoFCI))}</div>
        <div class="mono" style="text-align:right;">${esc(E.pct(atual.ci))}</div>
      </div>
      <div class="subst-linha substituto">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="tag-alt substituto">SUBSTITUTO</span>
          <div style="min-width:0;">
            <div style="font-size:12px;">${esc(o.nome)}</div>
            <div class="texto-mini">${esc(o.classeLabel || '')} · ${esc(o.fornecedor || '—')}</div>
          </div>
        </div>
        <div style="text-align:right;">
          ${sel.modo === 'parcial'
            ? `<input class="inp-pct" id="as-pct" type="number" step="0.1" min="0" max="100" value="${E.n(p)}" title="Proporção do substituto; a do original é complementada automaticamente para 100% (RF-017)"> <span style="font-size:10px;color:var(--ink-3);">%</span>`
            : `<span class="mono" style="font-weight:600;">${esc(E.num(p, 1))}%</span>`}
        </div>
        <div class="mono" style="text-align:right;"><span id="as-q-sub">${esc(E.num(qtdSub, 4))}</span> ${esc(unidade)}</div>
        <div class="mono" style="text-align:right;">${esc(E.brl(o.custoFCI))}</div>
        <div class="mono" style="text-align:right;">${esc(E.pct(o.ci))}</div>
      </div>
    </div>
    <div class="texto-mini" style="margin-top:6px;">
      Soma das quantidades: <b class="mono" id="as-soma">${esc(E.num(qtdOrig + qtdSub, 4))} ${esc(unidade)}</b> — igual à quantidade original da receita
      <b class="mono">${esc(E.num(qtdBase, 4))} ${esc(unidade)}</b>; a substituição não altera a quantidade total da receita (RF-018).
    </div>`;
  }

  /** Atualiza apenas as células dependentes da proporção, preservando o foco. */
  function atualizarQuantidades() {
    const p = pctSub();
    const qtdBase = E.n(atual.qtdReceita != null ? atual.qtdReceita : comp.qtd);
    const unidade = atual.unidade || E.unidadeDe(S.dados, mixAtual[0].ref);
    const qOrig = qtdBase * (100 - p) / 100;
    const qSub = qtdBase * p / 100;
    const por = (id, txt) => { const x = wrap.querySelector(id); if (x) x.textContent = txt; };
    por('#as-p-orig', E.num(100 - p, 1) + '%');
    por('#as-q-orig', E.num(qOrig, 4));
    por('#as-q-sub', E.num(qSub, 4));
    por('#as-soma', E.num(qOrig + qSub, 4) + ' ' + unidade);
    por('#as-nota-orig', p >= 100 ? 'permanece listado como não utilizado (RF-019)' : 'proporção complementar automática (RF-017)');
  }

  function desenhar() {
    const o = opcaoSel();
    wrap.querySelector('.modal').innerHTML = `
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;">⇄</div>
      <div style="flex:1;">
        <h2>Assistente de substituição · ${esc(atual.nome || '')}</h2>
        <div class="sub">Estrutura de <b>${esc(prod.nome)}</b> · posição ${idx + 1} · quantidade da receita
          <b class="mono">${esc(E.num(atual.qtdReceita != null ? atual.qtdReceita : comp.qtd, 4))} ${esc(atual.unidade || '')}</b> ·
          ${esc(atual.ehIntermediario ? 'intermediário — só pode ser trocado por outro intermediário (RF-021)' : `grupo «${atual.grupo || '—'}» · ${atual.classeLabel || ''} · ${atual.fornecedor || ''}`)}
        </div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      ${local ? '<div class="aviso-info">Alternativas calculadas localmente pelo mesmo motor do servidor — o resultado da aplicação é idêntico (RNF-10).</div>' : ''}

      <div>
        <div class="etapa-rotulo">1 · TIPO DE SUBSTITUIÇÃO</div>
        <div class="linha-flex" style="gap:10px;">
          <button class="opcao-modo ${sel.modo === 'integral' ? 'ativa' : ''}" data-modo="integral">
            <b>Integral</b>
            <div>O substituto assume 100% da posição e o item original permanece listado com 0% (RF-016 · RF-019).</div>
          </button>
          <button class="opcao-modo ${sel.modo === 'parcial' ? 'ativa' : ''}" data-modo="parcial">
            <b>Parcial</b>
            <div>Informe a proporção do substituto; a do original é complementada automaticamente para 100% (RF-017).</div>
          </button>
        </div>
      </div>

      <div>
        <div class="etapa-rotulo">2 · ITEM SUBSTITUTO ${esc(`(${todas.length} alternativa(s) elegível(is))`)}</div>
        <select id="as-ref" style="width:100%;border:1px solid var(--line);border-radius:7px;padding:8px 10px;font-size:12.5px;background:var(--panel);">
          ${mesmoGrupo.length ? `<optgroup label="Mesmo grupo de insumo">${mesmoGrupo.map((x) => opcaoHtml(x, sel.ref)).join('')}</optgroup>` : ''}
          ${outros.length ? `<optgroup label="Outros itens do cenário">${outros.map((x) => opcaoHtml(x, sel.ref)).join('')}</optgroup>` : ''}
        </select>
        <div class="linha-flex" style="margin-top:7px;gap:6px;">
          ${(o.naturezas || []).map((nat) => chip(nat, 'var(--gold-soft)', '#6d5320', 'Natureza da troca (RF-020)')).join('')}
          <span class="texto-mini">custo FCI <b class="mono">${esc(E.brl(o.custoFCI))}</b> · CI do nó <b class="mono">${esc(o.ciLabel || E.pct(o.ci))}</b> · ${esc(o.classeLabel || '')} · ${esc(o.fornecedor || '—')}</span>
        </div>
        <div style="margin-top:9px;border:1px solid var(--line);border-radius:8px;max-height:150px;overflow-y:auto;">
          ${todas.map((x) => `
            <div class="massa-linha" data-escolher="${esc(x.ref)}" style="cursor:pointer;${x.ref === sel.ref ? 'background:var(--gold-soft);' : ''}">
              <span class="bom-kind" style="background:${x.tipo === 'PI' ? '#e8e2f2' : 'var(--line-2)'};color:${x.tipo === 'PI' ? '#5b4a86' : 'var(--ink-2)'};">${esc(x.tipo || 'MP')}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:11.5px;">${esc(x.nome)} <span class="mono" style="color:var(--ink-3);font-size:10px;">${esc(x.codigo || '')}</span></div>
                <div class="linha-flex" style="gap:4px;margin-top:2px;">${(x.naturezas || []).map((nat) => `<span class="tag-alt ${x.mesmoGrupo ? 'original' : 'substituto'}">${esc(nat)}</span>`).join('')}</div>
              </div>
              <span class="mono" style="font-size:11px;">${esc(E.brl(x.custoFCI))}</span>
              <span class="mono" style="font-size:11px;width:54px;text-align:right;">${esc(x.ciLabel || E.pct(x.ci))}</span>
            </div>`).join('')}
        </div>
      </div>

      <div>
        <div class="etapa-rotulo">3 · PROPORÇÃO E QUANTIDADES</div>
        <div id="as-tabela">${htmlTabela()}</div>
      </div>

      <div>
        <div class="etapa-rotulo">4 · PRÉVIA DO EFEITO NO CI% (RF-022)</div>
        <div id="as-previa">${htmlPrevia()}</div>
      </div>

      <div class="texto-mini">A substituição vale somente neste cenário: o cadastro oficial e a lista técnica do ERP não são alterados (RF-007 · RNF-06).</div>
    </div>
    <div class="rodape">
      ${jaTemSubstituicao ? `<button class="btn btn-borda" id="as-remover" style="color:var(--err);margin-right:auto;" ${attrs(permSub, 'Remove as alternativas e retorna o original a 100% (RF-024)')}>Remover substituição</button>` : ''}
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="as-aplicar" ${attrs(permSub, 'Aplica a substituição ao cenário (RF-015)')}>Aplicar substituição</button>
    </div>`;

    wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = S.ctx.fecharModal; });
    wrap.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
      sel.modo = b.dataset.modo;
      if (sel.modo === 'integral') sel.pct = 100;
      else if (E.n(sel.pct) >= 100) sel.pct = 50;
      desenhar(); carregarPrevia();
    }));
    wrap.querySelector('#as-ref').addEventListener('change', (ev) => {
      sel.ref = ev.target.value; desenhar(); carregarPrevia();
    });
    wrap.querySelectorAll('[data-escolher]').forEach((d) => d.addEventListener('click', () => {
      sel.ref = d.dataset.escolher; desenhar(); carregarPrevia();
    }));
    const inpPct = wrap.querySelector('#as-pct');
    if (inpPct) {
      inpPct.addEventListener('input', () => {
        sel.pct = Math.min(100, Math.max(0, E.n(inpPct.value)));
        atualizarQuantidades();   // RF-017/RF-018 — complemento e quantidades em tempo real
        carregarPrevia();         // RF-022 — prévia do efeito a cada mudança
      });
    }
    wrap.querySelector('#as-remover')?.addEventListener('click', () => {
      S.ctx.fecharModal();
      reverterSubstituicao(S, prodId, idx);
    });
    wrap.querySelector('#as-aplicar').addEventListener('click', () => {
      S.aplicar({
        fecharModal: true,
        chamada: () => S.ctx.api.post(`/cenarios/${S.id}/sim/substituicao`, {
          prodId, idx, refSubstituto: sel.ref, modo: sel.modo, pct: pctSub(),
        }),
        ok: `Substituição aplicada: ${opcaoSel().nome} em ${E.num(pctSub(), 1)}% da posição (RF-015).`,
      });
    });
  }

  desenhar();
  carregarPrevia();
}

function opcaoHtml(x, refSel) {
  return `<option value="${esc(x.ref)}" ${x.ref === refSel ? 'selected' : ''}>${esc(x.nome)} · ${esc(x.codigo || '')} — ${esc(x.classeLabel || '')} · ${esc(E.brl(x.custoFCI))} · CI ${esc(x.ciLabel || E.pct(x.ci))}</option>`;
}

/* ============================================================================
 * ABA 2 · ORIGEM E CONTEÚDO DO ITEM
 * RF-046 · RF-047 · RF-048 · RF-049 · RF-050 · RF-051 · RF-033 · RF-058
 * ========================================================================== */

function abaOrigem(S, host) {
  const perm = permissao(S, ['editarFiscal', 'editarFornecedor'], 'alterar a classificação e o conteúdo dos itens');
  const insumos = [...(S.dados.insumos || [])].sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const usados = new Set();
  for (const p of S.dados.produtos || []) {
    for (const c of p.componentes || []) for (const m of E.mixOf(c)) usados.add(m.ref);
  }

  host.innerHTML = `
  <div class="pagina" style="max-width:1680px;">
    <h2 style="margin:0;font-size:14px;font-weight:600;">Origem e conteúdo de importação dos itens do cenário</h2>
    <div class="texto-mini" style="margin-bottom:12px;">
      A origem do cadastro apenas <b>inicializa</b> a classificação; origem e percentual são campos próprios e independentes, editáveis sem alterar o cadastro oficial (RF-047 · RF-051 · RNF-06).
    </div>

    <div class="card" style="overflow:auto;margin-bottom:14px;">
      <table class="tabela">
        <thead><tr>
          <th>ITEM</th>
          <th>ORIGEM DO CADASTRO</th>
          <th>CLASSIFICAÇÃO ADOTADA</th>
          <th>MODO DO CONTEÚDO</th>
          <th class="num">CI% ADOTADO</th>
          <th>CST INFORMADO × SUGERIDO</th>
          <th>FORNECEDOR</th>
          <th class="num">CUSTO FCI UN.</th>
        </tr></thead>
        <tbody>
          ${insumos.map((ins) => linhaInsumo(S, ins, perm, usados.has(ins.id))).join('')}
          ${insumos.length ? '' : '<tr><td colspan="8" style="color:var(--ink-3);">Nenhum insumo carregado no cenário.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card card-pad">
      <h3 style="margin:0 0 4px;font-size:13px;font-weight:600;">Legenda das classificações de origem (RF-046)</h3>
      <div class="texto-mini" style="margin-bottom:10px;">Quatro classes de origem, com descrição e CST correspondente — base da composição do conteúdo de importação (RN-04).</div>
      <div class="grid-auto">
        ${Object.entries(E.CLASSES).map(([chave, c]) => `
          <div class="faixa-card" style="border-color:${c.border};">
            <div class="linha-flex" style="gap:8px;">
              <span class="origem-tag" style="background:${c.bg};color:${c.fg};">${esc(c.curto)}</span>
              <span class="lim" style="font-size:12px;">CST ${esc(c.cst)}</span>
            </div>
            <div class="classe">${esc(c.label)}</div>
            <div class="texto-mini">${esc(c.desc)}</div>
            <div class="texto-mini" style="margin-top:5px;">
              conteúdo ${c.permiteCI ? 'informado ou por faixa' : (c.importado ? 'integral (100%)' : 'ausente (0%)')} ·
              custo de importação ${c.permiteCustoImp ? 'pelo valor aduaneiro' : 'não aplicável'} ·
              ${esc(chave)}
            </div>
          </div>`).join('')}
      </div>
      <div class="nota-rodape">
        Item <b>nacional</b> tem os campos de conteúdo e de custo de importação desabilitados — qualquer percentual informado é ignorado no cálculo (RF-049).
        A divergência entre o CST informado e o sugerido é apenas sinalizada, sem bloquear a simulação (RF-050 · RF-033).
        A composição do valor aduaneiro dos itens importados fica na aba <b>Câmbio</b> (RF-059).
      </div>
    </div>
  </div>`;

  /* ---- gravação campo a campo (PUT /sim/insumo) */
  host.querySelectorAll('[data-campo]').forEach((ctrl) => {
    ctrl.addEventListener('change', () => {
      const ref = ctrl.dataset.ref;
      const campo = ctrl.dataset.campo;
      let valor = ctrl.value;
      if (ctrl.dataset.tipo === 'num') valor = E.n(String(valor).replace(',', '.'));
      const campos = { [campo]: valor };
      S.aplicar({
        chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/insumo`, { ref, campos }),
        ok: `${rotuloCampo(campo)} atualizado — vale apenas neste cenário (RF-007).`,
      });
    });
  });

  host.querySelectorAll('[data-expandir]').forEach((b) => b.addEventListener('click', () => {
    const k = `custo:${b.dataset.expandir}`;
    estado.abertos[k] = !estado.abertos[k];
    S.render();
  }));
}

function rotuloCampo(campo) {
  const mapa = {
    classSim: 'Classificação de origem', ciModo: 'Modo do conteúdo', ciPct: 'Conteúdo de importação (CI%)',
    ciFaixa: 'Faixa de conteúdo', cstOrigem: 'CST de origem', fornecedorId: 'Fornecedor',
    precoNacional: 'Valor de entrada', icms: 'ICMS destacado', ipi: 'IPI destacado',
    fob: 'FOB', freteInt: 'Frete internacional', seguroInt: 'Seguro internacional',
    ii: 'Imposto de importação', ipiImp: 'IPI de importação', pisCofinsImp: 'PIS/COFINS de importação',
    moeda: 'Moeda do insumo',
  };
  return mapa[campo] || 'Campo do insumo';
}

function linhaInsumo(S, ins, perm, emUso) {
  const cls = E.CLASSES[ins.classSim] || E.CLASSES.nacional;
  const info = E.nodeInfo(ins);
  const divs = divergenciasInsumo(ins);
  const sugeridoCst = E.cstSugerido(ins.classSim, ins.ciFaixa, ins.ciPct, ins.ciModo);
  const informadoCst = String(ins.cstOrigem == null ? '' : ins.cstOrigem);
  const divergeCst = informadoCst && informadoCst !== sugeridoCst;
  const forn = E.fornecedorDe(S.dados, ins);
  const sugeridaOrigem = (ins.origemErp != null && String(ins.origemErp) !== '')
    ? E.classificacaoPorOrigem(ins.origemErp).classSim : null;
  const divergeOrigem = sugeridaOrigem && sugeridaOrigem !== (ins.classSim || 'nacional');

  // RF-049 — item nacional não edita conteúdo nem custo de importação
  const permConteudo = {
    ok: perm.ok && cls.permiteCI,
    motivo: !perm.ok ? perm.motivo
      : (ins.classSim === 'nacional'
        ? 'Item nacional: os campos de conteúdo de importação ficam desabilitados e qualquer percentual informado é ignorado no cálculo (RF-049).'
        : 'Classificação com conteúdo integral (100%) por definição legal — o percentual não é editável (RN-04).'),
  };
  const aberto = !!estado.abertos[`custo:${ins.id}`];

  let html = `
  <tr>
    <td>
      <div style="font-size:12px;font-weight:500;">${esc(ins.nome)}</div>
      <div class="mono" style="font-size:10px;color:var(--ink-3);">${esc(ins.codigo || ins.id)} · grupo ${esc(ins.grupo || '—')} · ${esc(ins.unidade || 'un')}${emUso ? '' : ' · não utilizado na estrutura'}${ins.alt ? ' · alternativa do cenário (RF-055)' : ''}</div>
    </td>
    <td>
      <input value="${esc(ins.origemErp == null ? '—' : ins.origemErp)}" disabled class="mono" style="width:58px;border:1px solid var(--line);border-radius:5px;padding:4px 6px;background:var(--panel-2);color:var(--ink-3);font-size:11px;"
        title="Origem do item no cadastro de origem (somente leitura) — apenas inicializa a classificação (RF-047)">
      <div class="texto-mini">${esc(sugeridaOrigem ? (E.CLASSES[sugeridaOrigem] || {}).curto || sugeridaOrigem : 'sem origem no cadastro')}</div>
    </td>
    <td>
      <select data-ref="${esc(ins.id)}" data-campo="classSim" ${attrs(perm, 'Classificação de origem adotada no cenário (RF-046)')}
        style="border:1px solid ${divergeOrigem ? '#dcc182' : 'var(--line)'};border-radius:5px;padding:4px 6px;font-size:11.5px;background:var(--panel);">
        ${Object.entries(E.CLASSES).map(([k, c]) => `<option value="${k}" ${k === (ins.classSim || 'nacional') ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      <div class="texto-mini"><span class="origem-tag" style="background:${cls.bg};color:${cls.fg};">${esc(cls.curto)}</span></div>
    </td>
    <td>
      <select data-ref="${esc(ins.id)}" data-campo="ciModo" ${attrs(permConteudo, 'Percentual informado ou faixa aplicável (RF-048)')}
        style="border:1px solid var(--line);border-radius:5px;padding:4px 6px;font-size:11.5px;background:var(--panel);">
        <option value="pct" ${ins.ciModo !== 'faixa' ? 'selected' : ''}>Percentual informado</option>
        <option value="faixa" ${ins.ciModo === 'faixa' ? 'selected' : ''}>Faixa aplicável</option>
      </select>
      ${ins.ciModo === 'faixa' ? `
        <select data-ref="${esc(ins.id)}" data-campo="ciFaixa" ${attrs(permConteudo, 'Faixa de conteúdo aplicável (RF-048 · RF-098)')}
          style="margin-top:4px;border:1px solid var(--line);border-radius:5px;padding:4px 6px;font-size:11.5px;background:var(--panel);">
          ${Object.values(E.FAIXAS).map((f) => `<option value="${f.id}" ${f.id === ins.ciFaixa ? 'selected' : ''}>${esc(f.label)} · CST ${esc(f.cst)} · fator ${esc(E.num(f.fator, 1))}</option>`).join('')}
        </select>` : ''}
    </td>
    <td class="num">
      ${ins.ciModo === 'faixa'
        ? `<span class="mono" style="font-weight:600;">${esc(info.ciLabel)}</span><div class="texto-mini">faixa aplicada</div>`
        : `<input class="inp-pct" type="number" step="0.1" min="0" max="100" value="${E.n(ins.ciPct)}" data-ref="${esc(ins.id)}" data-campo="ciPct" data-tipo="num"
             ${attrs(permConteudo, 'Percentual de conteúdo de importação adotado, independente da origem (RF-051)')}>
           <div class="texto-mini">×${esc(E.num(info.fator, 2))} na cascata</div>`}
    </td>
    <td>
      <div class="linha-flex" style="gap:5px;">
        <input value="${esc(informadoCst)}" data-ref="${esc(ins.id)}" data-campo="cstOrigem" ${attrs(perm, 'CST de origem informado na entrada (RF-050)')}
          class="mono" style="width:46px;border:1px solid ${divergeCst ? '#e0a898' : 'var(--line)'};border-radius:5px;padding:4px 6px;font-size:11px;background:var(--panel);" placeholder="—">
        <span style="color:var(--ink-3);">×</span>
        <span class="chip" style="background:${divergeCst ? 'var(--err-bg)' : 'var(--ok-bg)'};color:${divergeCst ? 'var(--err-fg)' : 'var(--ok-fg)'};" title="CST sugerido pela classificação e faixa adotadas (RF-050)">${esc(sugeridoCst)}</span>
      </div>
      ${ins.cstErp != null && String(ins.cstErp) !== '' ? `<div class="texto-mini">entrada ERP: <b class="mono">${esc(ins.cstErp)}</b>${ins.classFiscal ? ` · ${esc(ins.classFiscal)}` : ''}</div>` : ''}
    </td>
    <td>
      <select data-ref="${esc(ins.id)}" data-campo="fornecedorId" ${attrs(perm, 'Fornecedor do item neste cenário')}
        style="border:1px solid var(--line);border-radius:5px;padding:4px 6px;font-size:11.5px;background:var(--panel);max-width:150px;">
        <option value="">—</option>
        ${(S.dados.fornecedores || []).map((f) => `<option value="${esc(f.id)}" ${f.id === ins.fornecedorId ? 'selected' : ''}>${esc(f.nome)}${f.pais ? ` · ${esc(f.pais)}` : ''}</option>`).join('')}
      </select>
      <div class="texto-mini">${esc(forn && forn.pais ? forn.pais : '—')}</div>
    </td>
    <td class="num">
      <b>${esc(E.brl(E.custoFCI(ins, S.dados.cambio)))}</b>
      <div class="texto-mini">${esc(ins.moeda || 'BRL')} · <button class="btn btn-borda btn-mini" data-expandir="${esc(ins.id)}" style="padding:1px 7px;">${aberto ? 'ocultar' : 'custos'}</button></div>
    </td>
  </tr>`;

  for (const d of divs) {
    html += `<tr><td colspan="8" style="padding:0;">
      <div class="linha-aviso aviso" style="padding-left:16px;">
        <span style="font-weight:700;">⚠</span><div>${esc(ins.nome)}: ${esc(d.msg)}</div>
      </div></td></tr>`;
  }

  if (aberto) html += `<tr><td colspan="8" style="background:var(--panel-2);">${blocoCustoEntrada(S, ins, perm)}</td></tr>`;
  return html;
}

/** Custo FCI do item: entrada nacional (RF-058 · RN-03) com memória demonstrável. */
function blocoCustoEntrada(S, ins, perm) {
  const importado = ins.classSim === 'importado_direto';
  const mem = E.memoriaCustoFCI(ins, S.dados.cambio);
  const permNac = {
    ok: perm.ok && !importado,
    motivo: !perm.ok ? perm.motivo
      : 'Item importado diretamente: o custo é composto pelo valor aduaneiro, editável na aba Câmbio (RF-059).',
  };
  return `
  <div style="padding:12px 16px;display:grid;grid-template-columns:1.1fr 1fr;gap:18px;">
    <div>
      <div class="etapa-rotulo">CUSTO DE ENTRADA NACIONAL (RF-058 · RN-03)</div>
      <div class="grid-3">
        ${['precoNacional', 'icms', 'ipi'].map((campo) => `
          <div class="campo">
            <span>${esc(campo === 'precoNacional' ? 'VALOR TOTAL DE ENTRADA' : campo === 'icms' ? 'ICMS DESTACADO' : 'IPI DESTACADO')}</span>
            <input class="mono" type="number" step="0.0001" min="0" value="${E.n(ins[campo])}" data-ref="${esc(ins.id)}" data-campo="${campo}" data-tipo="num"
              ${attrs(permNac, 'ICMS e IPI deduzem do custo FCI; PIS e COFINS não deduzem (RN-03)')}>
          </div>`).join('')}
      </div>
      <div class="texto-mini" style="margin-top:7px;">PIS e COFINS <b>não</b> deduzem do custo FCI (RN-03).
      ${importado ? 'Para este item importado, o custo é o valor aduaneiro — veja a aba Câmbio (RF-059).' : ''}</div>
    </div>
    <div>
      <div class="etapa-rotulo">MEMÓRIA DO CUSTO FCI — ${esc(mem.tipo === 'aduaneiro' ? 'VALOR ADUANEIRO' : 'ENTRADA NACIONAL')}</div>
      <table class="tabela">
        <tbody>
          ${mem.linhas.map((l) => `<tr><td>${esc(l.rotulo)}</td><td class="num">${esc(E.brl(l.valor))}</td></tr>`).join('')}
          <tr><td><b>Custo FCI unitário</b></td><td class="num"><b>${esc(E.brl(mem.total))}</b></td></tr>
        </tbody>
      </table>
      <div class="texto-mini">${esc(mem.nota)}</div>
    </div>
  </div>`;
}

/* ============================================================================
 * ABA 3 · CÂMBIO E VALOR ADUANEIRO
 * RF-052 · RF-053 · RF-054 · RF-055 · RF-059
 * ========================================================================== */

function abaCambio(S, host) {
  const perm = permissao(S, ['editarFornecedor', 'editarFiscal'], 'alterar premissas cambiais e de importação');
  const porMoeda = new Map(E.insumosPorMoeda(S.dados).map((m) => [m.moeda, m]));
  const codigos = [...new Set([...Object.keys(E.MOEDAS), ...Object.keys(S.dados.cambio || {}), ...porMoeda.keys()])];

  host.innerHTML = `
  <div class="pagina" style="max-width:1680px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
      <div>
        <h2 style="margin:0;font-size:14px;font-weight:600;">Câmbio do cenário e composição do valor aduaneiro</h2>
        <div class="texto-mini">Cotação parametrizável por moeda; a alteração recalcula em lote o custo FCI de todos os insumos vinculados (RF-052 · RF-054).
        Vale apenas neste cenário — o cadastro oficial permanece intacto (RF-007).</div>
      </div>
      <button class="btn btn-ouro" id="cb-alternativa" ${attrs(perm, 'Cria no cenário um item/fornecedor alternativo em outra moeda (RF-055)')}>＋ Incluir alternativa cadastral</button>
    </div>

    <div class="pilha">
      ${codigos.map((cod) => cartaoMoeda(S, cod, porMoeda.get(cod), perm)).join('')}
    </div>

    <div class="nota-rodape">
      O valor aduaneiro é composto por FOB (na moeda do insumo) convertido pela cotação, frete e seguro internacionais, imposto de importação,
      IPI de importação e PIS/COFINS de importação — todos editáveis no cenário (RF-059).
      A alternativa cadastral criada aqui existe somente no cenário e não altera o cadastro oficial de itens e fornecedores (RF-055 · RNF-06).
    </div>
  </div>`;

  host.querySelectorAll('[data-cotacao]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const moeda = inp.dataset.cotacao;
      const cotacao = E.n(String(inp.value).replace(',', '.'));
      if (!(cotacao > 0)) { S.ctx.toast('Informe uma cotação maior que zero.', 'erro'); S.render(); return; }
      const cambio = { ...(S.dados.cambio || {}), [moeda]: cotacao };
      const antesCusto = somaCustoMoeda(S.dados, moeda, S.dados.cambio);
      const depoisCusto = somaCustoMoeda(S.dados, moeda, cambio);
      S.aplicar({
        chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/cambio`, { moeda, cotacao, cambio }),
        ok: `Cotação ${moeda} = ${E.num(cotacao, 4)} aplicada em lote: custo FCI dos insumos vinculados ${E.brl(antesCusto)} → ${E.brl(depoisCusto)} (RF-054).`,
      });
    });
  });

  host.querySelectorAll('[data-aduaneiro]').forEach((b) => b.addEventListener('click', () => {
    const k = `adu:${b.dataset.aduaneiro}`;
    estado.abertos[k] = !estado.abertos[k];
    S.render();
  }));

  host.querySelectorAll('[data-adu-campo]').forEach((inp) => inp.addEventListener('change', () => {
    const ref = inp.dataset.ref;
    const campo = inp.dataset.aduCampo;
    const valor = E.n(String(inp.value).replace(',', '.'));
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/insumo`, { ref, campos: { [campo]: valor } }),
      ok: `${rotuloCampo(campo)} atualizado — valor aduaneiro recomposto (RF-059).`,
    });
  }));

  host.querySelectorAll('[data-moeda-insumo]').forEach((sel) => sel.addEventListener('change', () => {
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/insumo`, { ref: sel.dataset.moedaInsumo, campos: { moeda: sel.value } }),
      ok: 'Moeda do insumo alterada — o FOB passa a ser convertido pela nova cotação (RF-052).',
    });
  }));

  host.querySelector('#cb-alternativa')?.addEventListener('click', () => modalAlternativa(S));
}

function somaCustoMoeda(dados, moeda, cambio) {
  return (dados.insumos || [])
    .filter((i) => (i.moeda || 'BRL') === moeda)
    .reduce((a, i) => a + E.custoFCI(i, cambio), 0);
}

function cartaoMoeda(S, cod, info, perm) {
  const meta = E.MOEDAS[cod] || { codigo: cod, nome: cod, simbolo: '' };
  const cotacao = cod === 'BRL' ? 1 : E.n((S.dados.cambio || {})[cod], info ? info.cotacao : 0);
  const padrao = cod === 'BRL' ? 1 : E.n((S.dados.cambioPadrao || {})[cod]);
  const variacao = padrao > 0 ? (cotacao / padrao - 1) * 100 : 0;
  const vinculados = (S.dados.insumos || []).filter((i) => (i.moeda || 'BRL') === cod);
  const custoAtual = vinculados.reduce((a, i) => a + E.custoFCI(i, S.dados.cambio), 0);
  const custoPadrao = vinculados.reduce((a, i) => a + E.custoFCI(i, S.dados.cambioPadrao || S.dados.cambio), 0);
  const permMoeda = cod === 'BRL'
    ? { ok: false, motivo: 'Real é a moeda base do cenário: a cotação é fixa em 1,0000.' }
    : perm;

  return `
  <div class="card" style="overflow:hidden;">
    <div style="padding:13px 18px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--line-2);flex-wrap:wrap;">
      <div style="min-width:170px;">
        <div style="font-weight:600;font-size:14px;" class="mono">${esc(cod)} <span style="color:var(--ink-3);font-weight:400;">${esc(meta.simbolo)}</span></div>
        <div class="texto-mini">${esc(meta.nome)}</div>
      </div>
      <div class="campo" style="min-width:150px;">
        <span>COTAÇÃO NO CENÁRIO (R$)</span>
        <input class="mono" type="number" step="0.0001" min="0" value="${E.n(cotacao)}" data-cotacao="${esc(cod)}"
          ${attrs(permMoeda, 'Cotação usada na conversão do FOB; alterar recalcula em lote (RF-052 · RF-054)')}
          style="width:130px;text-align:right;font-size:14px;font-weight:600;">
      </div>
      <div>
        <div class="texto-mini">REFERÊNCIA DA CARGA</div>
        <div class="mono" style="font-size:12.5px;">${esc(padrao > 0 ? E.num(padrao, 4) : '—')}</div>
      </div>
      <div>
        <div class="texto-mini">VARIAÇÃO FRENTE À BASE</div>
        <div style="font-size:12.5px;">${padrao > 0 ? setaDelta(variacao) : '<span style="color:var(--ink-3);">—</span>'}</div>
      </div>
      <div>
        <div class="texto-mini">EFEITO NO CUSTO FCI DOS VINCULADOS (RF-054)</div>
        <div class="mono" style="font-size:12.5px;">${esc(E.brl(custoPadrao))} → <b>${esc(E.brl(custoAtual))}</b>
          <span style="color:${custoAtual > custoPadrao ? 'var(--err)' : custoAtual < custoPadrao ? 'var(--ok-fg)' : 'var(--ink-3)'};">${esc(custoPadrao > 0 ? E.pp((custoAtual / custoPadrao - 1) * 100) : '')}</span></div>
      </div>
      <div style="flex:1;"></div>
      ${chip(`${vinculados.length} insumo(s) vinculado(s)`, 'var(--line-2)', 'var(--ink-2)', 'Insumos cuja premissa de custo depende desta moeda (RF-053)')}
    </div>
    ${vinculados.length ? vinculados.map((ins) => linhaInsumoMoeda(S, ins, perm)).join('') : vazio('Nenhum insumo vinculado a esta moeda no cenário.')}
  </div>`;
}

function linhaInsumoMoeda(S, ins, perm) {
  const cls = E.CLASSES[ins.classSim] || E.CLASSES.nacional;
  const importado = ins.classSim === 'importado_direto';
  const va = E.valorAduaneiro(ins, S.dados.cambio);
  const aberto = !!estado.abertos[`adu:${ins.id}`];
  const forn = E.fornecedorDe(S.dados, ins);

  let html = `
  <div style="padding:9px 18px;display:grid;grid-template-columns:2.2fr 1fr 1fr 1fr 1fr 110px;gap:10px;align-items:center;border-top:1px solid var(--line-2);font-size:12px;">
    <div style="min-width:0;">
      <div style="font-size:12px;">${esc(ins.nome)}</div>
      <div class="mono" style="font-size:10px;color:var(--ink-3);">${esc(ins.codigo || ins.id)} · ${esc(forn ? forn.nome : '—')}${ins.alt ? ' · alternativa do cenário' : ''}</div>
    </div>
    <div><span class="origem-tag" style="background:${cls.bg};color:${cls.fg};">${esc(cls.curto)}</span></div>
    <div>
      <select data-moeda-insumo="${esc(ins.id)}" ${attrs(perm, 'Moeda do insumo no cenário (RF-052)')}
        style="border:1px solid var(--line);border-radius:5px;padding:4px 6px;font-size:11.5px;background:var(--panel);">
        ${Object.keys(E.MOEDAS).map((m) => `<option value="${m}" ${m === (ins.moeda || 'BRL') ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="mono" style="text-align:right;">${esc(importado ? `${E.num(ins.fob, 4)} ${ins.moeda || ''}` : '—')}<div class="texto-mini">FOB na moeda</div></div>
    <div class="mono" style="text-align:right;font-weight:600;">${esc(E.brl(E.custoFCI(ins, S.dados.cambio)))}<div class="texto-mini">custo FCI un.</div></div>
    <div style="text-align:right;">
      <button class="btn btn-borda btn-mini" data-aduaneiro="${esc(ins.id)}"
        title="${esc(importado ? 'Composição do valor aduaneiro: FOB, frete, seguro, II, IPI e PIS/COFINS de importação (RF-059)' : 'Item não importado diretamente: a composição aduaneira não se aplica (RF-049 · RN-04)')}">
        ${aberto ? '▴ fechar' : '▾ valor aduaneiro'}
      </button>
    </div>
  </div>`;

  if (aberto) {
    html += `<div style="background:var(--panel-2);border-top:1px solid var(--line-2);padding:12px 18px 14px;">
      ${importado ? painelAduaneiro(S, ins, va, perm) : `<div class="aviso-info">Este item está classificado como <b>${esc(cls.label)}</b>.
      A composição do valor aduaneiro só se aplica a itens importados diretamente; altere a classificação na aba <b>Origem e conteúdo</b> se o item for de importação própria (RF-046 · RF-049).</div>`}
    </div>`;
  }
  return html;
}

function painelAduaneiro(S, ins, va, perm) {
  return `
  <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:18px;">
    <div>
      <div class="etapa-rotulo">COMPOSIÇÃO DO VALOR ADUANEIRO · EDITÁVEL (RF-059)</div>
      <div class="grid-3">
        ${E.CAMPOS_ADUANEIROS.map((c) => `
          <div class="campo">
            <span>${esc(c.rotulo.toUpperCase())}</span>
            <input class="mono" type="number" step="0.0001" min="0" value="${E.n(ins[c.campo])}"
              data-adu-campo="${esc(c.campo)}" data-ref="${esc(ins.id)}"
              ${attrs(perm, c.emMoeda ? `Valor na moeda do insumo (${ins.moeda || 'BRL'}), convertido pela cotação do cenário` : 'Valor em reais')}>
            <span class="texto-mini">${esc(c.emMoeda ? (ins.moeda || 'BRL') : 'R$')}</span>
          </div>`).join('')}
      </div>
    </div>
    <div>
      <div class="etapa-rotulo">TOTAL EM REAIS · CONVERSÃO PELA COTAÇÃO DO CENÁRIO</div>
      <table class="tabela">
        <tbody>
          ${va.itens.map((i) => `<tr>
            <td>${esc(i.rotulo)}${i.campo === 'fob' ? ` <span class="texto-mini">${esc(E.num(i.original, 4))} ${esc(i.moeda || '')} × ${esc(E.num(i.taxa, 4))}</span>` : ''}</td>
            <td class="num">${esc(E.brl(i.valor))}</td></tr>`).join('')}
          <tr><td><b>Valor aduaneiro total (custo FCI unitário)</b></td><td class="num"><b>${esc(E.brl(va.total))}</b></td></tr>
        </tbody>
      </table>
      <div class="texto-mini">Para o item importado diretamente, o custo FCI é o valor aduaneiro completo (RN-03 · RF-058).</div>
    </div>
  </div>`;
}

/** Alternativa cadastral criada dentro do cenário (RF-055). */
function modalAlternativa(S) {
  const insumos = [...(S.dados.insumos || [])].sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const wrap = S.ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;">＋</div>
      <div style="flex:1;">
        <h2>Incluir alternativa cadastral no cenário</h2>
        <div class="sub">Cria um item/fornecedor alternativo em outra moeda <b>apenas neste cenário</b>, para comparar origens sem alterar o cadastro oficial (RF-055 · RNF-06).</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="campo">
        <span>ITEM BASE DO CENÁRIO</span>
        <select id="al-base">${insumos.map((i) => `<option value="${esc(i.id)}">${esc(i.nome)} · ${esc(i.codigo || i.id)} · grupo ${esc(i.grupo || '—')}</option>`).join('')}</select>
      </div>
      <div class="grid-2">
        <div class="campo"><span>NOME DA ALTERNATIVA</span><input id="al-nome" placeholder="ex.: Malte Pilsen — origem alemã"></div>
        <div class="campo"><span>GRUPO DE INSUMO</span><input id="al-grupo" placeholder="mantém o grupo do item base"></div>
      </div>
      <div class="grid-3">
        <div class="campo"><span>MOEDA</span>
          <select id="al-moeda">${Object.entries(E.MOEDAS).map(([k, m]) => `<option value="${k}" ${k === 'USD' ? 'selected' : ''}>${esc(k)} · ${esc(m.nome)}</option>`).join('')}</select>
        </div>
        <div class="campo"><span>CLASSIFICAÇÃO DE ORIGEM</span>
          <select id="al-class">${Object.entries(E.CLASSES).map(([k, c]) => `<option value="${k}" ${k === 'importado_direto' ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        </div>
        <div class="campo"><span>COTAÇÃO DA MOEDA (R$)</span><input id="al-cotacao" class="mono" type="number" step="0.0001" min="0" value="${E.n((S.dados.cambio || {}).USD, 5)}"></div>
      </div>
      <div class="grid-2">
        <div class="campo"><span>FORNECEDOR (NOME)</span><input id="al-forn" placeholder="ex.: Weyermann GmbH"></div>
        <div class="campo"><span>PAÍS DO FORNECEDOR</span><input id="al-pais" placeholder="ex.: Alemanha"></div>
      </div>
      <div class="grid-3">
        <div class="campo"><span>FOB NA MOEDA</span><input id="al-fob" class="mono" type="number" step="0.0001" min="0" value="0"></div>
        <div class="campo"><span>FRETE + SEGURO (R$)</span><input id="al-frete" class="mono" type="number" step="0.0001" min="0" value="0"></div>
        <div class="campo"><span>II + IPI + PIS/COFINS (R$)</span><input id="al-trib" class="mono" type="number" step="0.0001" min="0" value="0"></div>
      </div>
      <div class="aviso-restricao">A alternativa passa a figurar na lista de itens substitutos do cenário (RF-020) e aparece nos pontos alterados submetidos à validação técnica (RF-036). O cadastro oficial não é alterado.</div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="al-criar">Criar alternativa no cenário</button>
    </div>`, { largo: true });

  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = S.ctx.fecharModal; });
  wrap.querySelector('#al-criar').onclick = () => {
    const val = (sel) => wrap.querySelector(sel).value;
    const numero = (sel) => E.n(String(val(sel)).replace(',', '.'));
    const nome = val('#al-nome').trim();
    if (!nome) { S.ctx.toast('Informe o nome da alternativa.', 'erro'); return; }
    const corpo = {
      refBase: val('#al-base'), ref: val('#al-base'),
      nome, grupo: val('#al-grupo').trim() || null,
      moeda: val('#al-moeda'), cotacao: numero('#al-cotacao'),
      classSim: val('#al-class'),
      fornecedorNome: val('#al-forn').trim() || null,
      fornecedorPais: val('#al-pais').trim() || null,
      campos: {
        fob: numero('#al-fob'),
        freteInt: numero('#al-frete'), seguroInt: 0,
        ii: numero('#al-trib'), ipiImp: 0, pisCofinsImp: 0,
        moeda: val('#al-moeda'), classSim: val('#al-class'),
      },
    };
    S.aplicar({
      fecharModal: true,
      chamada: () => S.ctx.api.post(`/cenarios/${S.id}/sim/insumo/alternativa`, corpo),
      ok: `Alternativa «${nome}» criada no cenário em ${corpo.moeda} — disponível como item substituto (RF-055).`,
    });
  };
}

/* ============================================================================
 * ABA 4 · VOLUMES E DESTINOS
 * RF-066 · RF-067 · RF-068 · RF-069 · RF-070 · RF-071 · RF-072
 * ========================================================================== */

function abaVolumes(S, host) {
  const perm = permissao(S, ['editarSaida', 'editarPremissas'], 'alterar volumes e preços de saída');
  const permCarga = permissao(S, ['editarSaida'], 'recarregar a base de saídas');
  const prod = E.acharProduto(S.dados, S.prodId);
  const pesos = E.pesosUF(prod);
  const r = S.resultado;
  const variacao = estado.variacaoUf;

  host.innerHTML = `
  <div class="pagina" style="max-width:1680px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
      <div>
        <h2 style="margin:0;font-size:14px;font-weight:600;">Volumes e destinos · ${esc(prod ? prod.nome : '')}</h2>
        <div class="texto-mini">Origem: Sistema de Preços (RF-066). O denominador do CI% é a média ponderada global das saídas interestaduais (RN-02);
        alterar volume ou preço recalcula imediatamente o denominador e o CI% (RF-068).</div>
      </div>
      <div class="linha-flex">
        <div class="campo" style="min-width:150px;">
          <span>VARIAÇÃO DE PREÇO SIMULADA (RF-071)</span>
          <div class="aliq-chip"><input id="vol-variacao" type="number" step="0.5" value="${E.n(variacao)}"><span style="font-size:11px;color:var(--ink-3);padding-right:6px;">%</span></div>
        </div>
        <button class="btn btn-borda" id="vol-substituir" ${attrs(permCarga, 'Descarta as saídas atuais e recarrega integralmente a base do Sistema de Preços (RF-067)')}>Substituir base do Sistema de Preços</button>
        <button class="btn btn-borda" id="vol-complementar" ${attrs(permCarga, 'Mantém as saídas atuais e acrescenta apenas as UFs ausentes (RF-067)')}>Complementar UFs ausentes</button>
      </div>
    </div>

    <div class="grid-kpi">
      ${kpi('PREÇO MÉDIO PONDERADO', esc(E.brl(E.precoMedio(prod))), 'denominador vigente quando a base é saídas (RN-02)')}
      ${kpi('VOLUME TOTAL', esc(E.num(pesos.reduce((a, p) => a + p.volume, 0), 0)), `${pesos.length} UF(s) de destino carregada(s)`)}
      ${kpi('DENOMINADOR APLICADO', esc(E.brl(r.denominador)), esc(r.baseLabel))}
      ${kpi('CI% RESULTANTE', esc(E.pct(r.ci)), `${esc(r.faixa.label)} · alíquota ${esc(E.num(r.enquadramento.aliquota, 0))}%`, r.faixa.fg)}
    </div>

    <div class="card" style="overflow:hidden;margin-bottom:14px;">
      <table class="tabela">
        <thead><tr>
          <th>UF DE DESTINO</th>
          <th class="num">VOLUME</th>
          <th class="num">PREÇO LÍQUIDO</th>
          <th class="num">PESO NO VOLUME</th>
          <th class="num">PESO NO VALOR</th>
          <th class="num">PREÇO SIMULADO (${esc(E.pp(variacao))})</th>
          <th class="num">CI% SIMULADO</th>
          <th class="num">EFEITO NO CI%</th>
          <th>FAIXA</th>
        </tr></thead>
        <tbody id="vol-corpo">
          ${pesos.length ? pesos.map((u) => linhaUf(S, u, perm)).join('') : '<tr><td colspan="9" style="color:var(--ink-3);">Nenhuma saída carregada para este produto — use “Substituir base do Sistema de Preços”.</td></tr>'}
        </tbody>
        ${pesos.length ? `<tfoot><tr style="background:var(--panel-2);font-weight:600;">
          <td>TOTAL · ${esc(pesos.length)} UF(s)</td>
          <td class="num">${esc(E.num(pesos.reduce((a, p) => a + p.volume, 0), 0))}</td>
          <td class="num">${esc(E.brl(E.precoMedio(prod)))}</td>
          <td class="num" title="Os pesos sempre totalizam 100% (RF-070)">${esc(E.num(pesos.reduce((a, p) => a + p.pesoVolume, 0), 1))}%</td>
          <td class="num">${esc(E.num(pesos.reduce((a, p) => a + p.pesoValor, 0), 1))}%</td>
          <td class="num" colspan="4" style="font-weight:400;font-size:11px;color:var(--ink-3);">média ponderada e pesos recalculados a cada alteração (RF-068 · RF-070)</td>
        </tr></tfoot>` : ''}
      </table>
    </div>

    <div class="grid-2">
      <div class="aviso-info">
        <b>Resultado oficial não segmentado por UF.</b> O resultado oficial do cenário não é segmentado por UF; a visão por estado é apoio à análise (RF-069).
        O CI% do produto permanece único, calculado sobre a média ponderada global das saídas interestaduais.
      </div>
      <div class="aviso-info">
        <b>Movimentações posteriores.</b> Movimentações posteriores de distribuidores entre estados não são consideradas (RF-072) — a simulação considera o destino da saída registrada.
      </div>
    </div>

    <div class="nota-rodape">
      A sensibilidade por UF (RF-071) mostra o efeito no CI% do produto de uma variação de preço aplicada àquela UF, mantidas as demais premissas.
      Volume e preço valem apenas neste cenário (RF-007).
    </div>
  </div>`;

  host.querySelector('#vol-variacao')?.addEventListener('change', (ev) => {
    estado.variacaoUf = E.n(String(ev.target.value).replace(',', '.'), 5);
    S.render();
  });

  host.querySelectorAll('[data-saida]').forEach((inp) => inp.addEventListener('change', () => {
    const [uf, campo] = inp.dataset.saida.split('|');
    const valor = E.n(String(inp.value).replace(',', '.'));
    if (valor < 0) { S.ctx.toast('Informe um valor igual ou maior que zero.', 'erro'); S.render(); return; }
    const saidas = (prod.saidas || []).map((s) => (s.uf === uf
      ? { ...s, [campo]: valor }
      : { ...s }));
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/saidas`, {
        prodId: S.prodId, uf, campo, valor, volume: campo === 'volume' ? valor : undefined,
        preco: campo === 'preco' ? valor : undefined, saidas,
      }),
      ok: `${campo === 'volume' ? 'Volume' : 'Preço líquido'} de ${uf} atualizado — denominador e CI% recalculados (RF-068).`,
    });
  }));

  const carga = (modo, rotulo) => {
    S.aplicar({
      chamada: () => S.ctx.api.post(`/cenarios/${S.id}/sim/saidas/carga`, { modo, prodId: S.prodId }),
      ok: `${rotulo} concluída a partir da base do Sistema de Preços (RF-067).`,
    });
  };
  host.querySelector('#vol-substituir')?.addEventListener('click', () => {
    if (!window.confirm('Substituir a base de saídas deste produto pelos dados atuais do Sistema de Preços? Os volumes e preços editados no cenário serão descartados.')) return;
    carga('substituir', 'Substituição da base');
  });
  host.querySelector('#vol-complementar')?.addEventListener('click', () => carga('complementar', 'Complementação das UFs ausentes'));

  /* sensibilidade por UF — RF-071 (API com queda para o motor local) */
  (async () => {
    if (!pesos.length) return;
    const { r: resp } = await lerApi(S,
      `/cenarios/${S.id}/sim/sensibilidade/uf?prodId=${encodeURIComponent(S.prodId)}&variacao=${encodeURIComponent(variacao)}`,
      () => ({ linhas: E.sensibilidadeUF(S.dados, S.prodId, variacao, S.base) }));
    const linhas = Array.isArray(resp) ? resp : (resp.linhas || resp.sensibilidade || []);
    const porUf = new Map(linhas.map((l) => [l.uf, l]));
    const por = (sel, html) => { const x = host.querySelector(sel); if (x) x.innerHTML = html; };
    for (const u of pesos) {
      const l = porUf.get(u.uf);
      if (!l) continue;
      por(`[data-sens-preco="${u.uf}"]`, esc(E.brl(l.precoSimulado)));
      por(`[data-sens-ci="${u.uf}"]`, `<span style="color:${E.faixaDe(l.ciSimulado).fg};">${esc(E.pct(l.ciSimulado))}</span>`);
      por(`[data-sens-delta="${u.uf}"]`, setaDelta(l.deltaPp));
      por(`[data-sens-faixa="${u.uf}"]`, l.mudaFaixa
        ? chip('muda de faixa', 'var(--warn-bg)', 'var(--warn-fg)', 'A variação simulada altera a faixa de enquadramento (RN-06)')
        : '<span class="texto-mini">faixa mantida</span>');
    }
  })();
}

function linhaUf(S, u, perm) {
  return `
  <tr>
    <td><b>${esc(u.uf)}</b></td>
    <td class="num"><input class="inp-num" type="number" step="1" min="0" value="${E.n(u.volume)}" data-saida="${esc(u.uf)}|volume"
      ${attrs(perm, 'Volume de saída para a UF no cenário (RF-066 · RF-068)')}></td>
    <td class="num"><input class="inp-num" type="number" step="0.0001" min="0" value="${E.n(u.preco)}" data-saida="${esc(u.uf)}|preco"
      ${attrs(perm, 'Preço líquido de saída para a UF no cenário (RF-068)')}></td>
    <td class="num mono" title="Participação da UF no volume total — os pesos totalizam 100% (RF-070)">${esc(E.num(u.pesoVolume, 1))}%</td>
    <td class="num mono">${esc(E.num(u.pesoValor, 1))}%</td>
    <td class="num mono" data-sens-preco="${esc(u.uf)}"><span style="color:var(--ink-3);">…</span></td>
    <td class="num mono" data-sens-ci="${esc(u.uf)}"><span style="color:var(--ink-3);">…</span></td>
    <td class="num" data-sens-delta="${esc(u.uf)}"><span style="color:var(--ink-3);">…</span></td>
    <td data-sens-faixa="${esc(u.uf)}"><span style="color:var(--ink-3);">…</span></td>
  </tr>`;
}

/* ============================================================================
 * ABA 5 · CÁLCULO
 * RF-056 · RF-057 · RF-058 · RF-060 · RF-061 · RF-062 · RF-063 · RF-064 · RF-065
 * ========================================================================== */

function abaCalculo(S, host) {
  const r = S.resultado;
  const permBase = permissao(S, ['baseCalculo'], 'alterar a base do denominador');
  const contrib = E.maioresContribuicoes(r, 10);
  const maior = contrib.length ? contrib[0] : null;
  const st = E.icmsST(r.precoMedio || r.custo, r.ci, {
    mva: estado.st.mva, aliqInterna: estado.st.aliqInterna, aliqNormal: S.parametros.aliqNormal,
  });
  const prod = r.produto || {};
  const foraGatilho = Math.abs(r.deltaVigente) > S.parametros.gatilho;

  host.innerHTML = `
  <div class="pagina" style="max-width:1680px;">
    <div class="grid-kpi">
      ${kpi('CI% DO PRODUTO', esc(E.pct(r.ci)), `${esc(r.faixa.range)} · ${esc(r.faixa.label)}`, r.faixa.fg)}
      ${kpi('PARCELA IMPORTADA', esc(E.brl(r.parcela)), 'Σ custo × quantidade × fator de faixa em cascata (RF-013 · RN-01)')}
      ${kpi('DENOMINADOR', esc(E.brl(r.denominador)), `base vigente: ${esc(r.baseLabel)} (RF-060)`)}
      ${kpi('ALÍQUOTA RESULTANTE', `${esc(E.num(r.enquadramento.aliquota, 0))}%`,
        r.enquadramento.aliquota === 4 ? 'CI% &gt; 40% → Resolução SF 13/2012 (RN-07)' : 'alíquota interestadual normal do destino',
        r.enquadramento.aliquota === 4 ? 'var(--err)' : 'var(--ok-fg)')}
    </div>

    <div class="card card-pad" style="margin-bottom:14px;">
      <div class="linha-flex" style="justify-content:space-between;">
        <div>
          <h3 style="margin:0;font-size:13px;font-weight:600;">Base do denominador do CI% (RF-060 · RN-02)</h3>
          <div class="texto-mini">A troca de base recalcula o cenário por completo e fica registrada nos eventos. A tela identifica sempre a base efetivamente aplicada.</div>
        </div>
        <div class="linha-flex" style="gap:8px;">
          <button class="btn ${S.base === 'saida' ? 'btn-escuro' : 'btn-borda'}" data-base="saida"
            ${attrs(permBase, 'Média ponderada global das saídas interestaduais — base padrão (RN-02)')}>Média ponderada das saídas</button>
          <button class="btn ${S.base === 'custo' ? 'btn-escuro' : 'btn-borda'}" data-base="custo"
            ${attrs(permBase, 'Custo total da mercadoria — base alternativa (RF-060)')}>Custo total da mercadoria</button>
        </div>
      </div>
      ${r.baseSolicitada === 'saida' && r.baseUsada === 'custo'
        ? '<div class="aviso-restricao" style="margin:10px 0 0;">Base solicitada: <b>saídas</b>. Como o produto não tem saídas carregadas, o cálculo recaiu sobre o <b>custo total</b> — base identificada em todos os indicadores (RF-060).</div>'
        : ''}
    </div>

    <div class="grid-2" style="align-items:start;margin-bottom:14px;">
      <div class="card" style="overflow:hidden;">
        <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <h3 style="margin:0;font-size:13px;font-weight:600;">Memória de cálculo · ${esc(r.node.nome)}</h3>
          <span class="mono" style="font-size:10.5px;color:var(--ink-3);" title="Versão da fórmula aplicada (RF-056)">${esc(r.versaoFormula)}</span>
        </div>
        <div id="calc-memoria"><div class="carregando">Carregando memória de cálculo</div></div>
        <div class="nota-rodape" style="padding:0 18px 14px;">
          Memória demonstrável até o insumo (RNF-08 · RF-063). O simulador não gera nem transmite a FCI oficial (RN-12).
        </div>
      </div>

      <div class="card" style="overflow:hidden;">
        <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);">
          <h3 style="margin:0;font-size:13px;font-weight:600;">Enquadramento e obrigação acessória (RF-061)</h3>
        </div>
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:11px;">
          <div class="linha-flex">
            ${chip(r.enquadramento.label, r.faixa.bg, r.faixa.fg, r.faixa.range)}
            ${chip(`Alíquota interestadual ${E.num(r.enquadramento.aliquota, 0)}%`, r.enquadramento.aliquota === 4 ? 'var(--err-bg)' : 'var(--ok-bg)', r.enquadramento.aliquota === 4 ? 'var(--err-fg)' : 'var(--ok-fg)')}
            ${chip(r.enquadramento.fciObrigatoria ? 'FCI obrigatória' : 'FCI não exigida', r.enquadramento.fciObrigatoria ? 'var(--warn-bg)' : 'var(--line-2)', r.enquadramento.fciObrigatoria ? 'var(--warn-fg)' : 'var(--ink-3)', 'Obrigatoriedade decorrente de CI% maior que zero (RN-06)')}
          </div>
          <div class="texto-mini"><b>Base legal:</b> ${esc(r.enquadramento.baseLegal)}</div>
          <div class="grid-3">
            ${['ate40', 'de40a70', 'acima70'].map((k) => {
              const f = E.FAIXAS[k];
              const ativa = E.faixaDoCi(r.ci).id === f.id;
              return `<div class="faixa-card" style="${ativa ? `border-color:${f.fg};background:${f.bg};` : ''}">
                <div class="lim" style="color:${f.fg};">${esc(f.label)}</div>
                <div class="classe">fator ${esc(E.num(f.fator, 1))} · CST ${esc(f.cst)}</div>
                ${ativa ? '<div class="texto-mini" style="margin-top:4px;font-weight:600;">faixa do produto</div>' : ''}
              </div>`;
            }).join('')}
          </div>
          <div class="sep"></div>
          <table class="tabela">
            <tbody>
              <tr><td>FCI vigente (pré-apuração integrada)</td><td class="num">${esc(E.pct(prod.fciVigente || 0))}</td></tr>
              <tr><td>Variação vs FCI vigente ${foraGatilho ? chip(`acima do gatilho de ${E.num(S.parametros.gatilho, 1)} p.p. → reemissão (RN-08 · RF-084)`, 'var(--err-bg)', 'var(--err-fg)') : ''}</td>
                  <td class="num" style="color:${foraGatilho ? 'var(--err)' : 'var(--ink)'};">${esc(E.pp(r.deltaVigente))}</td></tr>
              <tr><td>CI% pela base alternativa (custo total)</td><td class="num">${esc(E.pct(r.ciCusto))}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="overflow:hidden;margin-bottom:14px;">
      <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <h3 style="margin:0;font-size:13px;font-weight:600;">Simulação de ICMS-ST (RF-062)</h3>
          <div class="texto-mini">MVA e alíquota interna parametrizáveis; comparação do ICMS próprio e do ICMS-ST nas duas alíquotas.</div>
        </div>
        <div class="linha-flex">
          <div class="campo"><span>MVA (%)</span><div class="aliq-chip"><input id="st-mva" type="number" step="1" min="0" value="${E.n(estado.st.mva)}"></div></div>
          <div class="campo"><span>ALÍQUOTA INTERNA DO DESTINO (%)</span><div class="aliq-chip"><input id="st-interna" type="number" step="0.5" min="0" value="${E.n(estado.st.aliqInterna)}"></div></div>
          <div class="campo"><span>PREÇO UNITÁRIO DE REFERÊNCIA</span><span class="mono" style="font-size:13px;font-weight:600;">${esc(E.brl(st.preco))}</span></div>
        </div>
      </div>
      <table class="tabela">
        <thead><tr>
          <th>CENÁRIO DE ALÍQUOTA</th>
          <th class="num">ALÍQUOTA INTERESTADUAL</th>
          <th class="num">ICMS PRÓPRIO (CRÉDITO DO CLIENTE)</th>
          <th class="num">BASE DE ST (MVA)</th>
          <th class="num">ICMS TOTAL NO DESTINO</th>
          <th class="num">ICMS-ST A RECOLHER</th>
          <th class="num">CARGA TOTAL</th>
        </tr></thead>
        <tbody>
          ${linhaSt('Com o CI% simulado', st.comCI, true)}
          ${linhaSt(`Alíquota normal do destino (${E.num(st.aliqNormal, 0)}%)`, st.semCI, false)}
          <tr style="background:var(--panel-2);font-weight:600;">
            <td>DIFERENÇA</td><td class="num">—</td>
            <td class="num">${esc(E.brl(st.comCI.icmsProprio - st.semCI.icmsProprio))}</td>
            <td class="num">—</td><td class="num">${esc(E.brl(st.comCI.icmsTotal - st.semCI.icmsTotal))}</td>
            <td class="num" style="color:${st.difST > 0 ? 'var(--err)' : st.difST < 0 ? 'var(--ok-fg)' : 'var(--ink)'};">${esc(E.brl(st.difST))}</td>
            <td class="num">${esc(E.brl(st.difCarga))}</td>
          </tr>
        </tbody>
      </table>
      <div style="padding:12px 18px;">
        <div class="aviso-info">
          <b>A carga tributária total do destino não muda</b> (diferença de ${esc(E.brl(st.difCarga))}): o que muda é a <b>divisão</b> entre o
          ICMS próprio destacado na operação interestadual — que é crédito do cliente — e o ICMS-ST recolhido no destino.
          Com alíquota de 4%, o ICMS próprio cai, o crédito do cliente diminui e o ICMS-ST sobe na mesma medida.
          ${esc(st.nota)}
        </div>
        ${st.aplicavel ? '' : '<div class="texto-mini" style="margin-top:7px;">Neste cenário a alíquota resultante é igual à normal do destino — não há deslocamento de carga para o ST.</div>'}
      </div>
    </div>

    <div class="card" style="overflow:hidden;">
      <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Componentes ordenados por contribuição (RF-065)</h3>
        <span class="texto-mini">${maior ? `maior contribuinte: <b style="color:var(--gold-d);">${esc(maior.nome)}</b> · ${esc(E.num(maior.participacao, 1))}% da parcela importada` : ''}</span>
      </div>
      <div style="padding:8px 18px 16px;">
        ${contrib.length ? contrib.map((c, i) => `
          <div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-top:1px solid var(--line-2);">
            <span class="mono" style="width:18px;text-align:right;font-size:11px;color:var(--ink-3);">${i + 1}</span>
            <span style="flex:0 0 290px;font-size:12px;${i === 0 ? 'font-weight:600;' : ''}">${esc(c.nome)}
              <span class="texto-mini">· ${esc(c.grupo)}${c.hasMix ? ' · com substituição' : ''}</span></span>
            <div style="flex:1;height:9px;border-radius:5px;background:var(--line-2);overflow:hidden;">
              <div style="width:${Math.max(0, Math.min(100, c.participacao))}%;height:100%;background:${i === 0 ? 'var(--gold)' : '#d9c496'};"></div>
            </div>
            <span class="mono" style="width:60px;text-align:right;font-size:11px;color:var(--ink-3);">×${esc(E.num(c.fator, 2))}</span>
            <span class="mono" style="width:100px;text-align:right;">${esc(E.brl(c.contrib))}</span>
            <span class="mono" style="width:58px;text-align:right;font-size:11px;${i === 0 ? 'font-weight:700;color:var(--gold-d);' : 'color:var(--ink-3);'}">${esc(E.num(c.participacao, 1))}%</span>
          </div>`).join('') : vazio('Produto sem componentes na estrutura.')}
        <div class="nota-rodape">Participação = contribuição do componente ÷ parcela importada do produto. O peso no custo total aparece na memória de cálculo.</div>
      </div>
    </div>
  </div>`;

  host.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.base === S.base) return;
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/base`, { base: b.dataset.base }),
      ok: `Base do denominador alterada para ${b.dataset.base === 'saida' ? 'média ponderada das saídas' : 'custo total da mercadoria'} (RF-060).`,
    });
  }));
  const mudaSt = () => {
    estado.st = {
      mva: E.n(String(host.querySelector('#st-mva').value).replace(',', '.'), S.parametros.mva),
      aliqInterna: E.n(String(host.querySelector('#st-interna').value).replace(',', '.'), S.parametros.aliqInterna),
    };
    S.render();
  };
  host.querySelector('#st-mva')?.addEventListener('change', mudaSt);
  host.querySelector('#st-interna')?.addEventListener('change', mudaSt);

  /* memória de cálculo completa com a versão da fórmula — RF-056 */
  (async () => {
    const { r: resp } = await lerApi(S, `/cenarios/${S.id}/resultado?prodId=${encodeURIComponent(S.prodId)}`,
      () => ({ memoria: E.memoriaCalculo(S.dados, S.prodId, S.base, S.pars) }));
    const memoria = resp.memoria || resp;
    const linhas = (memoria && memoria.linhas) || [];
    const alvo = host.querySelector('#calc-memoria');
    if (!alvo) return;
    alvo.innerHTML = `
      <table class="tabela">
        <tbody>
          ${linhas.map((l) => `<tr${l.destaque ? ' style="background:var(--panel-2);"' : ''}>
            <td${l.destaque ? ' style="font-weight:600;"' : ''}>${esc(l.rotulo)}</td>
            <td class="num"${l.destaque ? ' style="font-weight:700;"' : ''}>${esc(formatarMemoria(l))}</td></tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:10px 18px 0;" class="texto-mini">Versão da fórmula: <b class="mono">${esc(memoria.versaoFormula || S.parametros.versaoFormula)}</b> (RF-056)</div>`;
  })();
}

function formatarMemoria(l) {
  if (l.tipo === 'moeda') return E.brl(l.valor);
  if (l.tipo === 'pct') return E.pct(l.valor);
  if (l.tipo === 'pctInt') return E.num(l.valor, 0) + '%';
  if (l.tipo === 'pp') return E.pp(l.valor);
  return String(l.valor == null ? '—' : l.valor);
}

function linhaSt(rotulo, c, destaque) {
  return `
  <tr${destaque ? ' style="background:#fdfcf9;"' : ''}>
    <td${destaque ? ' style="font-weight:600;"' : ''}>${esc(rotulo)}</td>
    <td class="num">${esc(E.num(c.aliquota, 0))}%</td>
    <td class="num">${esc(E.brl(c.icmsProprio))}</td>
    <td class="num">${esc(E.brl(c.baseST))}</td>
    <td class="num">${esc(E.brl(c.icmsTotal))}</td>
    <td class="num">${esc(E.brl(c.st))}</td>
    <td class="num"><b>${esc(E.brl(c.carga))}</b></td>
  </tr>`;
}

/* ============================================================================
 * ABA 6 · VALIDAÇÃO — diagnóstico consolidado
 * RF-025 · RF-026 · RF-027 · RF-028 · RF-029 · RF-030 · RF-031 · RF-032 · RF-033
 * ========================================================================== */

function abaValidacao(S, host) {
  const d = S.diag;
  const grupos = d.grupos || [];
  const comErro = grupos.filter((g) => g.nErros > 0);
  const comAviso = grupos.filter((g) => g.nAvisos > 0);

  host.innerHTML = `
  <div class="pagina" style="max-width:1400px;">
    ${d.nErros ? `
      <div class="aviso-erro" style="margin-bottom:14px;">
        <span style="font-size:15px;">✕</span>
        <div><b>Consolidar e congelar indisponíveis.</b> ${esc(d.motivo || `Cenário com ${d.nErros} erro(s) de validação de estrutura (RF-025).`)}
        <div class="texto-mini" style="margin-top:4px;">A simulação continua liberada: a restrição vale apenas para as ações de encerramento do ciclo (RF-025 · RF-038).</div></div>
      </div>`
    : `<div class="aviso-info" style="margin-bottom:14px;background:var(--ok-bg);border-color:#a9c9b5;color:var(--ok-fg);">
        <b>✓ Estrutura consistente.</b> Nenhum erro de validação — congelar e consolidar estão liberados quanto à estrutura${S.exigeValidacao ? ', mas há alteração de receita pendente de validação técnica (RF-038)' : ''}.
      </div>`}

    <div class="grid-kpi">
      ${kpi('ERROS', esc(E.num(d.nErros, 0)), 'bloqueiam congelar e consolidar (RF-025)', d.nErros ? 'var(--err)' : 'var(--ok-fg)')}
      ${kpi('AVISOS', esc(E.num(d.nAvisos, 0)), 'sinalizam sem bloquear (RF-032 · RF-033)', d.nAvisos ? 'var(--warn)' : 'var(--ok-fg)')}
      ${kpi('PONTOS ALTERADOS', esc(E.num(E.diffs(S.dados).length, 0)), 'em relação à carga de origem (RF-036)')}
      ${kpi('RECEITA ALTERADA', S.exigeValidacao ? 'SIM' : 'NÃO', S.exigeValidacao ? 'exige validação técnica antes de consolidar (RN-11)' : 'nenhuma quantidade ou overhead fora do padrão', S.exigeValidacao ? 'var(--err)' : 'var(--ok-fg)')}
    </div>

    <h2 style="margin:0 0 4px;font-size:14px;font-weight:600;">Erros de validação (${esc(E.num(d.nErros, 0))})</h2>
    <div class="texto-mini" style="margin-bottom:10px;">Cada ocorrência informa o produto ou o cadastro de origem (RF-032). Erros impedem apenas congelar e consolidar.</div>
    ${comErro.length ? comErro.map((g) => grupoDiag(g, 'erro')).join('') : '<div class="aviso-info" style="margin-bottom:16px;">Nenhum erro identificado nos validadores de estrutura e de cadastro.</div>'}

    <h2 style="margin:16px 0 4px;font-size:14px;font-weight:600;">Avisos (${esc(E.num(d.nAvisos, 0))})</h2>
    <div class="texto-mini" style="margin-bottom:10px;">Avisos não bloqueiam a simulação — incluem divergência de CST (RF-033 · RF-050) e divergência de volume envasado × especificação do SKU (RF-030 · RF-014).</div>
    ${comAviso.length ? comAviso.map((g) => grupoDiag(g, 'aviso')).join('') : '<div class="aviso-info">Nenhum aviso pendente.</div>'}

    <div class="card card-pad" style="margin-top:16px;">
      <h3 style="margin:0 0 6px;font-size:13px;font-weight:600;">O que cada validador verifica</h3>
      <div class="grid-2">
        <ul class="texto-mini" style="margin:0;padding-left:18px;line-height:1.8;">
          <li><b>RF-026 · RF-027</b> — presença e quantidade dos componentes obrigatórios por grupo, com tolerância.</li>
          <li><b>RF-028</b> — soma das proporções das alternativas exatamente 100% (RN-09).</li>
          <li><b>RF-029</b> — distribuição entre alternativas igual à quantidade original da receita.</li>
          <li><b>RF-030 · RF-014</b> — volume envasado coerente com a especificação técnica do SKU.</li>
        </ul>
        <ul class="texto-mini" style="margin:0;padding-left:18px;line-height:1.8;">
          <li><b>RF-031</b> — confronto imediato: a cada alteração, as inconsistências novas são apresentadas com as opções desfazer ou manter e corrigir.</li>
          <li><b>RF-032</b> — diagnóstico consolidado separando erros de avisos, com o produto ou o cadastro de origem.</li>
          <li><b>RF-033 · RF-050</b> — coerência fiscal entre o CST informado e o sugerido, sem bloqueio.</li>
          <li><b>RF-025</b> — motivo declarado quando congelar e consolidar ficam indisponíveis.</li>
        </ul>
      </div>
    </div>
  </div>`;

  host.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => {
    const alvo = b.dataset.prod;
    // só troca o produto do topo quando a ocorrência é de um produto acabado
    if (alvo && S.pas.some((p) => p.id === alvo)) estado.prodId = alvo;
    S.irPara(b.dataset.ir);
  }));
}

function grupoDiag(g, sev) {
  const itens = (g.itens || []).filter((i) => i.sev === sev);
  if (!itens.length) return '';
  const origemCadastro = g.chave === '__cadastro__';
  return `
  <div class="diag-grupo">
    <header>
      <span style="color:${sev === 'erro' ? 'var(--err-fg)' : 'var(--warn-fg)'};">${sev === 'erro' ? '✕' : '⚠'}</span>
      <span>${esc(g.rotulo)}</span>
      ${chip(origemCadastro ? 'cadastro do cenário' : 'estrutura do produto', 'var(--line-2)', 'var(--ink-3)', 'Origem da ocorrência (RF-032)')}
      <div style="flex:1;"></div>
      <span class="texto-mini">${esc(E.num(itens.length, 0))} ocorrência(s)</span>
      ${!origemCadastro && g.chave !== '__geral__'
        ? `<button class="btn btn-borda btn-mini" data-ir="estrutura" data-prod="${esc(g.chave)}">Abrir na estrutura</button>`
        : (origemCadastro ? '<button class="btn btn-borda btn-mini" data-ir="origem">Abrir cadastro do cenário</button>' : '')}
    </header>
    ${itens.map((i) => `
      <div class="diag-item ${sev}">
        <span class="marca">${sev === 'erro' ? '✕' : '⚠'}</span>
        <div>
          <b>${esc(rotuloTipo(i.tipo))}</b>${i.campo ? ` <span class="mono texto-mini">campo ${esc(i.campo)}</span>` : ''}
          ${i.idx != null ? ` <span class="texto-mini">· posição ${esc(E.num(i.idx + 1, 0))}</span>` : ''}
          <div>${esc(i.msg)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

/* ============================================================================
 * ABA 7 · ALTERAÇÕES EM MASSA POR GRUPO DE INSUMO
 * RF-040 · RF-041 · RF-042 · RF-043 · RF-044 · RF-045
 * ========================================================================== */

function abaMassa(S, host) {
  const perm = permissao(S, ['massa'], 'aplicar alterações em lote');
  host.innerHTML = '<div class="pagina"><div class="carregando">Carregando grupos de insumo</div></div>';

  (async () => {
    const { r: resp } = await lerApi(S, `/cenarios/${S.id}/sim/massa/grupos`, () => ({ grupos: E.gruposDeInsumo(S.dados) }));
    const grupos = Array.isArray(resp) ? resp : (resp.grupos || []);
    if (!grupos.length) { host.innerHTML = `<div class="pagina">${vazio('Nenhum grupo de insumo na ficha técnica do cenário.')}</div>`; return; }

    if (!estado.massa || !grupos.some((g) => g.grupo === estado.massa.grupo)) {
      estado.massa = { grupo: grupos[0].grupo, ref: null, pct: 100, selecionadas: null, previa: null };
    }
    const m = estado.massa;
    const itens = E.itensDoGrupo(S.dados, m.grupo);
    const posicoes = E.posicoesDoGrupo(S.dados, m.grupo);
    const estruturas = [...new Map(posicoes.map((p) => [p.prodId, p])).values()];
    if (!m.ref || !itens.some((i) => i.ref === m.ref)) m.ref = itens.length ? itens[0].ref : null;
    if (!m.selecionadas) m.selecionadas = estruturas.map((e) => e.prodId);

    const desenhar = () => {
      const itemSel = itens.find((i) => i.ref === m.ref);
      host.innerHTML = `
      <div class="pagina" style="max-width:1680px;">
        <h2 style="margin:0;font-size:14px;font-weight:600;">Alteração em massa por grupo de insumo</h2>
        <div class="texto-mini" style="margin-bottom:12px;">
          Substituição em lote de todas as posições de um grupo de insumo, com proporção uniforme, prévia do efeito e seleção das estruturas afetadas (RF-040 a RF-043).
          A substituição individual por SKU continua disponível na aba <b>Estrutura</b>, inclusive depois da operação em lote (RF-044).
        </div>

        <div class="massa-passos" style="margin-bottom:14px;">
          <div class="card" style="overflow:hidden;">
            <div class="bom-head" style="padding:10px 14px;">1 · GRUPO DE INSUMO (RF-040)</div>
            <div style="max-height:300px;overflow-y:auto;">
              ${grupos.map((g) => `
                <div class="massa-linha" data-grupo="${esc(g.grupo)}" style="cursor:pointer;${g.grupo === m.grupo ? 'background:var(--gold-soft);' : ''}">
                  <input type="radio" ${g.grupo === m.grupo ? 'checked' : ''} tabindex="-1" style="pointer-events:none;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:${g.grupo === m.grupo ? 600 : 400};">${esc(g.grupo)}</div>
                    <div class="texto-mini">${esc(E.num(g.posicoes, 0))} posição(ões) · ${esc(E.num(g.nEstruturas, 0))} estrutura(s)</div>
                  </div>
                </div>`).join('')}
            </div>
          </div>

          <div class="card" style="overflow:hidden;">
            <div class="bom-head" style="padding:10px 14px;">2 · ITEM SUBSTITUTO DO GRUPO «${esc(m.grupo)}»</div>
            <div style="max-height:300px;overflow-y:auto;">
              ${itens.length ? itens.map((i) => `
                <div class="massa-linha" data-item="${esc(i.ref)}" style="cursor:pointer;${i.ref === m.ref ? 'background:var(--gold-soft);' : ''}">
                  <input type="radio" ${i.ref === m.ref ? 'checked' : ''} tabindex="-1" style="pointer-events:none;">
                  <span class="bom-kind" style="background:${i.tipo === 'PI' ? '#e8e2f2' : 'var(--line-2)'};color:${i.tipo === 'PI' ? '#5b4a86' : 'var(--ink-2)'};">${esc(i.tipo)}</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;">${esc(i.nome)} <span class="mono texto-mini">${esc(i.codigo)}</span></div>
                    <div class="texto-mini">${esc(i.classeLabel)} · ${esc(i.fornecedor)}</div>
                  </div>
                  <span class="mono" style="font-size:11px;">${esc(E.brl(i.custoFCI))}</span>
                  <span class="mono" style="font-size:11px;width:52px;text-align:right;">${esc(E.pct(i.ci))}</span>
                </div>`).join('') : vazio('Nenhum item cadastrado neste grupo.')}
            </div>
          </div>

          <div class="card" style="overflow:hidden;">
            <div class="bom-head" style="padding:10px 14px;">3 · PROPORÇÃO APLICADA</div>
            <div style="padding:13px 14px;display:flex;flex-direction:column;gap:10px;">
              <div class="linha-flex">
                ${[100, 50, 25].map((v) => `<button class="massa-preset ${E.n(m.pct) === v ? 'ativo' : ''}" data-preset="${v}">${v}%</button>`).join('')}
                <div class="aliq-chip"><input id="massa-pct" type="number" step="0.5" min="0" max="100" value="${E.n(m.pct)}"><span style="font-size:11px;color:var(--ink-3);padding-right:6px;">%</span></div>
              </div>
              <div class="texto-mini">
                ${E.n(m.pct) >= 100
                  ? 'Substituição integral: o substituto assume 100% de cada posição e o item original permanece listado com 0% (RF-016 · RF-019).'
                  : 'Substituição parcial: o item original de cada posição é complementado automaticamente para 100% (RF-017).'}
                A quantidade total da receita de cada estrutura não é alterada (RF-018).
              </div>
              ${itemSel ? `<div class="sep"></div>
              <div class="texto-mini">Substituto escolhido: <b>${esc(itemSel.nome)}</b> · custo FCI <b class="mono">${esc(E.brl(itemSel.custoFCI))}</b> · CI do nó <b class="mono">${esc(E.pct(itemSel.ci))}</b></div>` : ''}
              <div class="linha-flex">
                <button class="btn btn-escuro" id="massa-previa">Ver prévia</button>
                <button class="btn btn-ouro" id="massa-aplicar" ${attrs(perm, 'Aplica a substituição somente às estruturas selecionadas (RF-041 · RF-042)')}>Aplicar em lote</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="overflow:hidden;margin-bottom:14px;">
          <div style="padding:11px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:13px;font-weight:600;">Estruturas afetadas (RF-042)</h3>
            <span class="texto-mini">Só as estruturas marcadas são alteradas.</span>
            <div style="flex:1;"></div>
            <button class="btn btn-borda btn-mini" id="massa-todas">Marcar todas</button>
            <button class="btn btn-borda btn-mini" id="massa-nenhuma">Desmarcar todas</button>
            <span class="texto-mini"><b>${esc(E.num(m.selecionadas.length, 0))}</b> de ${esc(E.num(estruturas.length, 0))} selecionada(s)</span>
          </div>
          <div class="massa-lista" style="max-height:230px;border:none;border-radius:0;">
            ${posicoes.length ? estruturas.map((e) => {
              const doProd = posicoes.filter((p) => p.prodId === e.prodId);
              return `
              <div class="massa-linha">
                <input type="checkbox" data-estrutura="${esc(e.prodId)}" ${m.selecionadas.includes(e.prodId) ? 'checked' : ''}>
                <span class="bom-kind" style="background:${e.prodTipo === 'PI' ? '#e8e2f2' : 'var(--line-2)'};color:${e.prodTipo === 'PI' ? '#5b4a86' : 'var(--ink-2)'};">${esc(e.prodTipo)}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:12px;">${esc(e.prodNome)} <span class="mono texto-mini">${esc(e.prodSku)}</span></div>
                  <div class="texto-mini">${doProd.map((p) => `posição ${p.idx + 1}: ${esc(p.nomeAtual)} (${esc(E.num(p.qtd, 3))} ${esc(p.unidade)})${p.temMix ? ' · já com substituição' : ''}`).join(' · ')}</div>
                </div>
              </div>`;
            }).join('') : vazio('Nenhuma posição deste grupo na ficha técnica.')}
          </div>
        </div>

        <div id="massa-previa-box">${m.previa ? htmlPreviaMassa(m.previa) : '<div class="aviso-info">Escolha o grupo, o item substituto e a proporção e clique em <b>Ver prévia</b> para conferir o efeito antes de aplicar (RF-043).</div>'}</div>
      </div>`;

      host.querySelectorAll('[data-grupo]').forEach((d) => d.addEventListener('click', () => {
        m.grupo = d.dataset.grupo; m.ref = null; m.selecionadas = null; m.previa = null;
        abaMassa(S, host);
      }));
      host.querySelectorAll('[data-item]').forEach((d) => d.addEventListener('click', () => {
        m.ref = d.dataset.item; m.previa = null; desenhar();
      }));
      host.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        m.pct = E.n(b.dataset.preset); m.previa = null; desenhar();
      }));
      host.querySelector('#massa-pct')?.addEventListener('change', (ev) => {
        m.pct = Math.min(100, Math.max(0, E.n(String(ev.target.value).replace(',', '.'))));
        m.previa = null; desenhar();
      });
      host.querySelectorAll('[data-estrutura]').forEach((cb) => cb.addEventListener('change', () => {
        const id = cb.dataset.estrutura;
        m.selecionadas = cb.checked ? [...new Set([...m.selecionadas, id])] : m.selecionadas.filter((x) => x !== id);
        m.previa = null; desenhar();
      }));
      host.querySelector('#massa-todas')?.addEventListener('click', () => {
        m.selecionadas = estruturas.map((e) => e.prodId); m.previa = null; desenhar();
      });
      host.querySelector('#massa-nenhuma')?.addEventListener('click', () => {
        m.selecionadas = []; m.previa = null; desenhar();
      });

      host.querySelector('#massa-previa')?.addEventListener('click', async (ev) => {
        if (!m.ref) { S.ctx.toast('Escolha o item substituto do grupo.', 'erro'); return; }
        if (!m.selecionadas.length) { S.ctx.toast('Selecione ao menos uma estrutura (RF-042).', 'erro'); return; }
        ev.target.disabled = true;
        const corpo = { grupo: m.grupo, refSubstituto: m.ref, pct: E.n(m.pct), prodIds: m.selecionadas };
        let previa = null;
        try {
          const resp = await S.ctx.api.post(`/cenarios/${S.id}/sim/massa/previa`, corpo);
          previa = resp && (resp.previa || resp);
          if (!previa || previa.aplicavel === undefined) previa = null;   // resposta inesperada
        } catch { previa = null; }
        if (!previa) previa = E.previaMassa(S.dados, corpo, S.base, S.pars);
        m.previa = previa;
        desenhar();
      });

      const btnAplicar = host.querySelector('#massa-aplicar');
      if (btnAplicar && m.previa && m.previa.aplicavel === false) {
        // RF-045 — operação sem efeito: aplicar fica indisponível com o motivo declarado
        btnAplicar.disabled = true;
        btnAplicar.title = m.previa.motivoIndisponivel || 'Operação em lote sem efeito (RF-045).';
      }
      btnAplicar?.addEventListener('click', () => {
        if (!m.ref) { S.ctx.toast('Escolha o item substituto do grupo.', 'erro'); return; }
        if (!m.selecionadas.length) { S.ctx.toast('Selecione ao menos uma estrutura (RF-042).', 'erro'); return; }
        S.aplicar({
          chamada: () => S.ctx.api.post(`/cenarios/${S.id}/sim/massa/aplicar`, {
            grupo: m.grupo, refSubstituto: m.ref, pct: E.n(m.pct), prodIds: m.selecionadas,
          }),
          ok: `Alteração em lote aplicada ao grupo «${m.grupo}» em ${E.num(m.selecionadas.length, 0)} estrutura(s) — a substituição individual por SKU continua disponível na aba Estrutura (RF-041 · RF-044).`,
        }).then((resp) => { if (resp) { estado.massa = null; abaMassa(S, host); } });
      });
    };

    desenhar();
  })();
}

function htmlPreviaMassa(p) {
  const impactos = p.impactos || [];
  return `
  <div class="card" style="overflow:hidden;">
    <div style="padding:12px 16px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <h3 style="margin:0;font-size:13px;font-weight:600;">Prévia do efeito em lote (RF-043)</h3>
      <span class="texto-mini">substituto <b>${esc(p.nomeSubstituto || '')}</b> · proporção <b class="mono">${esc(E.num(p.pct, 1))}%</b> ·
        ${esc(E.num(p.nAplicadas, 0))} de ${esc(E.num(p.nPosicoes, 0))} posição(ões) elegível(is) ·
        ${esc(E.num(impactos.length, 0))} produto(s) acabado(s) impactado(s)</span>
    </div>
    ${p.aplicavel === false ? `<div style="padding:12px 16px;"><div class="aviso-erro"><span>✕</span>
      <div><b>Aplicar indisponível.</b> ${esc(p.motivoIndisponivel || 'A operação não produz efeito (RF-045).')}</div></div></div>` : ''}
    ${impactos.length ? `
      <table class="tabela">
        <thead><tr><th>PRODUTO ACABADO</th><th class="num">CI% ANTES</th><th class="num">CI% DEPOIS</th><th class="num">VARIAÇÃO</th><th>FAIXA ANTES → DEPOIS</th><th class="num">CUSTO ANTES</th><th class="num">CUSTO DEPOIS</th></tr></thead>
        <tbody>
          ${impactos.map((i) => `
            <tr>
              <td>${esc(i.nome)} <span class="mono texto-mini">${esc(i.sku || '')}</span></td>
              <td class="num mono">${esc(E.pct(i.ciAntes))}</td>
              <td class="num mono" style="color:${(i.faixaDepois || E.faixaDe(i.ciDepois)).fg};font-weight:600;">${esc(E.pct(i.ciDepois))}</td>
              <td class="num">${setaDelta(i.deltaPp)}</td>
              <td>${chip((i.faixaAntes || E.faixaDe(i.ciAntes)).label, 'var(--line-2)', 'var(--ink-3)')} →
                  ${chip((i.faixaDepois || E.faixaDe(i.ciDepois)).label, (i.faixaDepois || E.faixaDe(i.ciDepois)).bg, (i.faixaDepois || E.faixaDe(i.ciDepois)).fg)}
                  ${i.mudaFaixa ? '<span class="texto-mini" style="color:var(--warn-fg);font-weight:600;">⚠ muda de faixa</span>' : ''}</td>
              <td class="num mono">${esc(E.brl(i.custoAntes))}</td>
              <td class="num mono">${esc(E.brl(i.custoDepois))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
    : vazio('Nenhum produto acabado é impactado pela seleção atual.')}
    <div class="nota-rodape" style="padding:0 16px 14px;">
      A prévia não altera o cenário. Posições em que o substituto já é o item original são ignoradas (RF-045).
    </div>
  </div>`;
}

/* ============================================================================
 * ABA 8 · GOVERNANÇA DO CICLO
 * RF-005 · RF-006 · RF-008 · RF-009 · RF-034 · RF-035 · RF-036 · RF-037 · RF-038
 * ========================================================================== */

/** POST tolerante ao prefixo da rota de governança (gov/… ou raiz do cenário). */
async function postGov(S, sufixo, corpo) {
  try {
    return await S.ctx.api.post(`/cenarios/${S.id}/gov/${sufixo}`, corpo);
  } catch (err) {
    if (err.status === 404) return S.ctx.api.post(`/cenarios/${S.id}/${sufixo}`, corpo);
    throw err;
  }
}

function abaGovernanca(S, host) {
  const permModo = permissao(S, ['modoAvancado'], 'alternar o modo de edição');
  const permSubmeter = permissao(S, ['submeterValidacao'], 'submeter alterações à validação técnica');
  const permCongelar = permissao(S, ['congelar'], 'congelar as premissas');
  const permConsolidar = permissao(S, ['consolidar'], 'consolidar o cenário para decisão');
  const permDirec = capacidade(S.ctx, ['consolidar'], 'registrar direcionamentos por área');
  const podeDecidir = capacidade(S.ctx, ['validarTecnico'], 'aprovar ou reprovar a validação técnica');

  const diffs = E.diffs(S.dados);
  const graves = diffs.filter((d) => d.exigeValidacao);
  const temErro = S.diag.nErros > 0;
  const status = S.cenario.status;
  const congelado = status === 'congelado' || status === 'consolidado';
  const consolidado = status === 'consolidado';

  // RF-038 — motivo declarado do bloqueio de congelar e consolidar.
  // A liberação vem do servidor (`governanca.liberaConsolidacao`), que é o
  // mesmo critério aplicado por POST /gov/consolidar: a aprovação técnica não
  // apaga o diff da receita, então contar `graves` não diz se a alteração já
  // foi aprovada. Sem esse dado a tela manteria o botão travado justamente
  // depois da aprovação, impedindo o encerramento do ciclo de governança.
  const govSrv = S.governanca || {};
  const liberaConsolidar = govSrv.liberaConsolidacao != null
    ? govSrv.liberaConsolidacao
    : !graves.length;
  const pendenteValidacao = !!govSrv.pendente;
  const motivoBloqueio = temErro
    ? (S.diag.motivo || `Cenário com ${S.diag.nErros} erro(s) de validação de estrutura (RF-025).`)
    : (!liberaConsolidar
      ? (pendenteValidacao
        ? `Há ${graves.length} alteração(ões) de receita aguardando decisão da validação técnica — a consolidação depende da aprovação (RF-038 · RN-11).`
        : `Há ${graves.length} alteração(ões) de receita sem aprovação técnica registrada — a consolidação depende da validação (RF-038 · RN-11).`)
      : null);

  const bloqueioCongelar = { ...permCongelar };
  if (bloqueioCongelar.ok && temErro) { bloqueioCongelar.ok = false; bloqueioCongelar.motivo = `Congelar indisponível: ${motivoBloqueio}`; }
  if (bloqueioCongelar.ok && congelado) { bloqueioCongelar.ok = false; bloqueioCongelar.motivo = `O cenário já está ${status}.`; }
  const bloqueioConsolidar = { ...permConsolidar };
  if (bloqueioConsolidar.ok && motivoBloqueio) { bloqueioConsolidar.ok = false; bloqueioConsolidar.motivo = `Consolidar indisponível: ${motivoBloqueio}`; }
  if (bloqueioConsolidar.ok && consolidado) { bloqueioConsolidar.ok = false; bloqueioConsolidar.motivo = 'O cenário já está consolidado.'; }

  const passo = (num, titulo, texto, classe) => `
    <div class="gov-passo ${classe}">
      <div class="gov-num">${classe === 'concluido' ? '✓' : classe === 'bloqueado' ? '!' : num}</div>
      <div style="flex:1;">
        <div style="font-size:12.5px;font-weight:600;">${esc(titulo)}</div>
        <div class="texto-mini">${texto}</div>
      </div>
    </div>`;

  host.innerHTML = `
  <div class="pagina" style="max-width:1680px;">
    <div class="grid-2" style="align-items:start;margin-bottom:14px;">
      <div class="card" style="overflow:hidden;">
        <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);">
          <h3 style="margin:0;font-size:13px;font-weight:600;">Modo de edição do cenário (RF-034)</h3>
          <div class="texto-mini">A alternância é explícita e declara o efeito: o modo avançado libera os campos de quantidade da receita e de custo industrial, que ficam bloqueados no modo padrão (RF-011 · RF-012).</div>
        </div>
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:11px;">
          <div class="linha-flex" style="gap:10px;">
            <button class="opcao-modo ${!S.modoAvancado ? 'ativa' : ''}" data-modo="padrao" ${attrs(permModo, 'Mantém a receita protegida (RF-011)')}>
              <b>Modo padrão</b>
              <div>Receita protegida: quantidades e overhead bloqueados. Substituição, premissas fiscais, câmbio e saídas permanecem editáveis.</div>
            </button>
            <button class="opcao-modo ${S.modoAvancado ? 'ativa' : ''}" data-modo="avancado" ${attrs(permModo, 'Libera a edição das quantidades da receita (RF-034)')}>
              <b>Modo avançado</b>
              <div>Libera quantidade da receita e custo industrial. Toda alteração passa a exigir validação técnica antes da consolidação (RN-11).</div>
            </button>
          </div>
          ${permModo.ok ? '' : `<div class="aviso-restricao">🔒 ${esc(permModo.motivo)}</div>`}
          <div class="texto-mini">Modo atual: <b>${S.modoAvancado ? 'avançado' : 'padrão'}</b>${S.exigeValidacao ? ' · há alteração de receita pendente de validação técnica (RF-038)' : ''}</div>
        </div>
      </div>

      <div class="card" style="overflow:hidden;">
        <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);">
          <h3 style="margin:0;font-size:13px;font-weight:600;">Passos do ciclo de governança</h3>
          <div class="texto-mini">Calcular → validar → congelar → consolidar. Cada passo informa se está concluído, em curso ou bloqueado.</div>
        </div>
        ${passo(1, 'Calcular', `CI% apurado para ${esc(E.num(S.pas.length, 0))} produto(s) acabado(s) · versão da fórmula <b class="mono">${esc(S.parametros.versaoFormula)}</b>`, 'concluido')}
        ${passo(2, 'Validar', temErro
          ? `<span style="color:var(--err-fg);">${esc(S.diag.nErros)} erro(s) de validação a corrigir (RF-025)</span>`
          : (graves.length ? `${esc(graves.length)} alteração(ões) de receita a submeter à validação técnica (RF-036)` : 'Nenhuma inconsistência e nenhuma alteração de receita pendente'),
          temErro ? 'bloqueado' : (graves.length ? 'atual' : 'concluido'))}
        ${passo(3, 'Congelar premissas', congelado
          ? 'Premissas congeladas — edição exige nova versão (RN-10)'
          : (bloqueioCongelar.ok ? 'Disponível: trava as premissas para rastreabilidade da decisão (RF-005)' : `<span style="color:var(--err-fg);">${esc(bloqueioCongelar.motivo)}</span>`),
          congelado ? 'concluido' : (bloqueioCongelar.ok ? 'atual' : 'bloqueado'))}
        ${passo(4, 'Consolidar para decisão', consolidado
          ? 'Cenário consolidado — base do relatório executivo e dos direcionamentos (RF-008 · RF-087)'
          : (bloqueioConsolidar.ok ? 'Disponível: encerra o ciclo e habilita o relatório executivo (RF-008)' : `<span style="color:var(--err-fg);">${esc(bloqueioConsolidar.motivo)}</span>`),
          consolidado ? 'concluido' : (bloqueioConsolidar.ok ? 'atual' : 'bloqueado'))}
        <div style="padding:12px 18px;display:flex;gap:9px;flex-wrap:wrap;border-top:1px solid var(--line-2);background:var(--panel-2);">
          <button class="btn btn-borda" id="gov-congelar" ${attrs(bloqueioCongelar, 'Congela as premissas do cenário (RF-005)')}>🔒 Congelar premissas</button>
          <button class="btn btn-ouro" id="gov-consolidar" ${attrs(bloqueioConsolidar, 'Consolida o cenário para decisão (RF-008)')}>✔ Consolidar para decisão</button>
          ${consolidado ? `<button class="btn btn-borda" id="gov-relatorio">📄 Abrir relatório executivo</button>` : ''}
        </div>
      </div>
    </div>

    <div class="card" style="overflow:hidden;margin-bottom:14px;">
      <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Pontos alterados em relação ao padrão (RF-036)</h3>
        <span class="texto-mini">${esc(E.num(diffs.length, 0))} ponto(s) · ${esc(E.num(graves.length, 0))} exige(m) validação técnica</span>
        <div style="flex:1;"></div>
        <button class="btn btn-escuro btn-mini" id="gov-submeter" ${attrs({
          ok: permSubmeter.ok && diffs.length > 0,
          motivo: !permSubmeter.ok ? permSubmeter.motivo : 'Não há pontos alterados para submeter à validação técnica.',
        }, 'Submete os pontos alterados à validação técnica (RF-036)')}>Submeter à validação técnica</button>
      </div>
      ${diffs.length ? `
        <table class="tabela">
          <thead><tr><th>PONTO</th><th>PRODUTO / CADASTRO</th><th>ITEM</th><th class="num">VALOR PADRÃO</th><th class="num">VALOR NO CENÁRIO</th><th>VALIDAÇÃO</th></tr></thead>
          <tbody>
            ${diffs.map((d) => `
              <tr>
                <td>${esc(d.rotulo)}</td>
                <td class="texto-mini">${esc(d.produto)}</td>
                <td>${esc(d.item)}</td>
                <td class="num mono" style="color:var(--ink-3);">${esc(d.de)}</td>
                <td class="num mono" style="font-weight:600;">${esc(d.para)}</td>
                <td>${d.exigeValidacao
                  ? chip('exige validação técnica', 'var(--err-bg)', 'var(--err-fg)', 'Alteração de receita (RN-11 · RF-038)')
                  : chip('premissa do cenário', 'var(--line-2)', 'var(--ink-3)', 'Não bloqueia a consolidação')}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
      : vazio('Nenhum ponto alterado: o cenário está idêntico à carga de origem.')}
    </div>

    <div class="grid-2" style="align-items:start;margin-bottom:14px;">
      <div class="card" style="overflow:hidden;">
        <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);">
          <h3 style="margin:0;font-size:13px;font-weight:600;">Histórico de validações técnicas (RF-037)</h3>
          <div class="texto-mini">Responsável, área, data e decisão de cada submissão.</div>
        </div>
        <div id="gov-historico"><div class="carregando">Carregando histórico</div></div>
      </div>

      <div class="card" style="overflow:hidden;">
        <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:10px;">
          <h3 style="margin:0;font-size:13px;font-weight:600;">Direcionamentos por área (RF-009)</h3>
          <div style="flex:1;"></div>
          <button class="btn btn-borda btn-mini" id="gov-novo-direc" ${attrs(permDirec, 'Registra um direcionamento para a área responsável (RF-009 · RF-088)')}>＋ Novo direcionamento</button>
        </div>
        <div id="gov-direcionamentos"><div class="carregando">Carregando direcionamentos</div></div>
      </div>
    </div>

    <div class="card" style="overflow:hidden;">
      <div style="padding:13px 18px;border-bottom:1px solid var(--line-2);">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Linha do tempo do cenário (RF-006)</h3>
        <div class="texto-mini">Criação, recarga, alterações relevantes, validações, congelamento, consolidação e versões — toda alteração gera evento (RNF-04).</div>
      </div>
      <div id="gov-eventos" style="padding:8px 18px 16px;"><div class="carregando">Carregando eventos</div></div>
    </div>

    <div class="nota-rodape">
      Cenário congelado ou consolidado recusa edição com a indicação da versão (RN-10).
      A consolidação é recusada com erro de validação pendente (RF-008 · RF-025) ou com alteração de receita não aprovada (RF-038 · RN-11).
    </div>
  </div>`;

  /* ---- modo padrão ⇄ avançado (RF-034) */
  host.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    const modo = b.dataset.modo;
    if ((modo === 'avancado') === S.modoAvancado) return;
    S.aplicar({
      chamada: () => S.ctx.api.put(`/cenarios/${S.id}/sim/modo`, { modo }),
      ok: modo === 'avancado'
        ? 'Modo avançado ativado: campos de quantidade da receita e de custo industrial liberados; as alterações exigirão validação técnica (RF-034 · RN-11).'
        : 'Modo padrão ativado: campos de quantidade da receita e de custo industrial bloqueados (RF-011 · RF-012).',
    });
  }));

  host.querySelector('#gov-submeter')?.addEventListener('click', () => {
    S.aplicar({
      chamada: () => postGov(S, 'validacao/submeter', {
        pontos: diffs.map((d) => ({ tipo: d.tipo, produto: d.produto, item: d.item, de: d.de, para: d.para, exigeValidacao: d.exigeValidacao })),
        resumo: `${diffs.length} ponto(s) alterado(s), ${graves.length} com alteração de receita`,
      }),
      ok: 'Pontos alterados submetidos à validação técnica — aguardando decisão do responsável (RF-036 · RF-037).',
    }).then(() => abaGovernanca(S, host));
  });

  host.querySelector('#gov-congelar')?.addEventListener('click', () => {
    if (!window.confirm('Congelar as premissas deste cenário? A partir daí, qualquer alteração exigirá uma nova versão (RN-10).')) return;
    S.aplicar({
      chamada: () => postGov(S, 'congelar', { resumo: 'Premissas congeladas para rastreabilidade da decisão' }),
      ok: 'Cenário congelado — premissas travadas e versão preservada (RF-005 · RN-10).',
    });
  });

  host.querySelector('#gov-consolidar')?.addEventListener('click', () => {
    if (!window.confirm('Consolidar este cenário para decisão? O resultado passa a servir de base ao relatório executivo e aos direcionamentos.')) return;
    S.aplicar({
      chamada: () => postGov(S, 'consolidar', { resumo: 'Cenário consolidado para decisão' }),
      ok: 'Cenário consolidado para decisão (RF-008). O relatório executivo está disponível.',
    });
  });

  host.querySelector('#gov-relatorio')?.addEventListener('click', () => S.ctx.navegar(`#/relatorio/${S.id}`));
  host.querySelector('#gov-novo-direc')?.addEventListener('click', () => modalDirecionamento(S, () => abaGovernanca(S, host)));

  /* ---- histórico de validações (RF-037) */
  (async () => {
    const { r: resp } = await lerApi(S, `/cenarios/${S.id}/gov/validacao/historico`, () => ({ historico: [] }));
    const lista = Array.isArray(resp) ? resp : (resp.historico || resp.validacoes || []);
    // RF-038 — esta rota é a fonte autoritativa da liberação: uma edição
    // posterior à aprovação pode tê-la invalidado, e o pacote do cenário em
    // memória ficaria defasado. Se a situação mudou, redesenha a aba para que
    // o botão «Consolidar» reflita o que o servidor realmente aceita.
    if (resp && resp.liberaConsolidacao != null) {
      const antes = S.governanca || {};
      if (antes.liberaConsolidacao !== resp.liberaConsolidacao
        || !!antes.pendente !== !!resp.pendente) {
        S.governanca = {
          exigeValidacao: resp.exigeValidacao,
          liberaConsolidacao: resp.liberaConsolidacao,
          aprovadaVigente: resp.aprovadaVigente,
          pendente: resp.pendente,
        };
        S.render();
        return;                       // o render refaz esta aba com o estado certo
      }
    }
    const alvo = host.querySelector('#gov-historico');
    if (!alvo) return;
    alvo.innerHTML = lista.length ? `
      <table class="tabela">
        <thead><tr><th>DATA</th><th>RESPONSÁVEL / ÁREA</th><th>ESCOPO</th><th>DECISÃO</th><th></th></tr></thead>
        <tbody>
          ${lista.map((v) => {
            const dec = String(v.decisao || v.status || 'pendente').toLowerCase();
            const cores = dec.includes('aprov') ? ['var(--ok-bg)', 'var(--ok-fg)']
              : dec.includes('reprov') ? ['var(--err-bg)', 'var(--err-fg)'] : ['var(--warn-bg)', 'var(--warn-fg)'];
            const pendente = !dec.includes('aprov') && !dec.includes('reprov');
            return `<tr>
              <td class="mono" style="font-size:11px;">${esc(dataHora(v.decidido_em || v.criado_em || v.criadoEm))}</td>
              <td>${esc(v.responsavel || v.decidido_por || v.solicitante || '—')}
                <div class="texto-mini">${esc(v.area || '—')}</div></td>
              <td class="texto-mini">${esc(v.resumo || v.escopo || '—')}</td>
              <td>${chip(dec.toUpperCase(), cores[0], cores[1])}
                ${v.justificativa ? `<div class="texto-mini">${esc(v.justificativa)}</div>` : ''}</td>
              <td style="white-space:nowrap;">
                ${pendente ? `
                  <button class="btn btn-borda btn-mini" data-decidir="${esc(v.id)}|aprovada" ${attrs(podeDecidir, 'Aprova a alteração de receita submetida (RF-037)')}>Aprovar</button>
                  <button class="btn btn-borda btn-mini" data-decidir="${esc(v.id)}|reprovada" style="color:var(--err);" ${attrs(podeDecidir, 'Reprova a alteração submetida (RF-037)')}>Reprovar</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`
      : vazio('Nenhuma submissão registrada. Use “Submeter à validação técnica” quando houver alteração de receita (RF-036).');

    alvo.querySelectorAll('[data-decidir]').forEach((b) => b.addEventListener('click', async () => {
      const [vid, decisao] = b.dataset.decidir.split('|');
      const justificativa = window.prompt(`Justificativa da decisão (${decisao}):`, '') || '';
      try {
        await S.ctx.api.post(`/validacoes/${vid}/decidir`, { decisao, justificativa });
        S.ctx.toast(`Validação técnica ${decisao} e registrada no histórico (RF-037).`, 'ok');
        const pacote = await S.ctx.api.get(`/cenarios/${S.id}`);
        S.absorver(pacote, true);
        S.render();
      } catch (err) { S.ctx.toast(err.message, 'erro'); }
    }));
  })();

  /* ---- direcionamentos por área (RF-009) */
  (async () => {
    // A rota devolve { manuais, automaticos, areas, base, alertas }: os manuais
    // vêm da tabela e os automáticos chegam agrupados por área, em blocos com
    // `itens` (RF-009 · RF-088).
    const { r: resp } = await lerApi(S, `/cenarios/${S.id}/gov/direcionamentos`, () => ({ manuais: [], automaticos: [] }));
    const manuais = (resp.manuais || []).map((d) => ({
      area: d.area, prioridade: d.prioridade, texto: d.texto, produto: d.produto,
      autor: d.criado_nome, em: d.criado_em, origem: 'manual',
    }));
    const automaticos = (resp.automaticos || []).flatMap((b) =>
      (b.itens || []).map((i) => ({ ...i, area: b.area, origem: i.origem || 'automatico' })));
    const lista = [...manuais, ...automaticos];
    const alvo = host.querySelector('#gov-direcionamentos');
    if (!alvo) return;
    alvo.innerHTML = lista.length ? lista.map((d) => `
      <div class="diag-item" style="border-top:1px solid var(--line-2);">
        <span class="marca">▸</span>
        <div style="flex:1;">
          <div class="linha-flex" style="gap:7px;">
            ${chip(d.area || '—', 'var(--gold-soft)', '#6d5320')}
            ${d.prioridade ? `<span class="prio ${esc(String(d.prioridade).toLowerCase())}">${esc(String(d.prioridade).toUpperCase())}</span>` : ''}
            ${d.origem === 'manual'
              ? chip('manual', 'var(--line-2)', 'var(--ink-3)', 'Registrado por um usuário (RF-009)')
              : chip('do motor', 'var(--line-2)', 'var(--ink-3)', 'Derivado do resultado e dos alertas (RF-088)')}
            ${d.produto ? `<span class="texto-mini">${esc(d.produto)}</span>` : ''}
            ${d.em ? `<span class="texto-mini">${esc(dataHora(d.em))}${d.autor ? ` · ${esc(d.autor)}` : ''}</span>` : ''}
          </div>
          <div style="margin-top:3px;">${esc(d.texto || '')}</div>
        </div>
      </div>`).join('')
      : vazio('Nenhum direcionamento registrado. Os direcionamentos acompanham o relatório executivo (RF-088).');
  })();

  /* ---- linha do tempo (RF-006) */
  (async () => {
    const { r: resp } = await lerApi(S, `/cenarios/${S.id}/eventos`, () => ({ eventos: [] }));
    const lista = Array.isArray(resp) ? resp : (resp.eventos || []);
    const alvo = host.querySelector('#gov-eventos');
    if (!alvo) return;
    // Contrato de `cenario_eventos`: { usuario_nome, tipo, detalhe (JSONB),
    // registrado_em }. O `detalhe` é estruturado — passa pelo resumidor
    // compartilhado em vez de ser interpolado como texto.
    alvo.innerHTML = lista.length ? lista.map((ev) => {
      const req = requisitoEvento(ev.detalhe);
      const resumo = resumoEvento(ev.tipo, ev.detalhe);
      return `
      <div class="timeline-item">
        <div class="quando">${esc(dataHora(ev.registrado_em))}</div>
        <div style="flex:1;">
          <div style="font-size:12px;"><b>${esc(rotuloEvento(ev.tipo, ev.detalhe))}</b>
            ${req ? chip(req, 'var(--line-2)', 'var(--ink-3)', 'Requisito registrado na trilha (RNF-04)') : ''}</div>
          <div class="texto-mini">${resumo ? esc(resumo) : '—'}${ev.usuario_nome ? ` · ${esc(ev.usuario_nome)}` : ''}</div>
        </div>
      </div>`;
    }).join('')
      : vazio('Nenhum evento registrado para este cenário.');
  })();
}

/** Direcionamento por área responsável (RF-009 · RF-088). */
function modalDirecionamento(S, aoSalvar) {
  const wrap = S.ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;">▸</div>
      <div style="flex:1;">
        <h2>Novo direcionamento por área</h2>
        <div class="sub">Registra a providência esperada da área responsável a partir do resultado do cenário (RF-009 · RF-088).</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="grid-2">
        <div class="campo"><span>ÁREA RESPONSÁVEL</span>
          <select id="dir-area">${E.AREAS_TRATAMENTO.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
        </div>
        <div class="campo"><span>PRIORIDADE</span>
          <select id="dir-prio"><option value="alta">Alta</option><option value="media" selected>Média</option><option value="baixa">Baixa</option></select>
        </div>
      </div>
      <div class="campo"><span>DIRECIONAMENTO</span>
        <textarea id="dir-texto" style="min-height:90px;border:1px solid var(--line);border-radius:7px;padding:8px 10px;font-size:12px;" placeholder="ex.: Negociar malte nacional equivalente para reduzir o CI% abaixo de 40% no SKU 600 ml."></textarea>
      </div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="dir-salvar">Registrar direcionamento</button>
    </div>`);
  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = S.ctx.fecharModal; });
  wrap.querySelector('#dir-salvar').onclick = async () => {
    const texto = wrap.querySelector('#dir-texto').value.trim();
    if (!texto) { S.ctx.toast('Escreva o direcionamento.', 'erro'); return; }
    try {
      await S.ctx.api.post(`/cenarios/${S.id}/gov/direcionamentos`, {
        area: wrap.querySelector('#dir-area').value,
        prioridade: wrap.querySelector('#dir-prio').value,
        texto,
      });
      S.ctx.fecharModal();
      S.ctx.toast('Direcionamento registrado para a área responsável (RF-009).', 'ok');
      aoSalvar();
    } catch (err) { S.ctx.toast(err.message, 'erro'); }
  };
}
