/**
 * Comparação de cenários e análise assistida — Simulador FCI.
 *
 * RF-073 · seleção de até dez cenários simultâneos (E.LIMITE_COMPARACAO)
 * RF-074 · matriz de CI% por produto e cenário, com faixa por cor e amplitude
 * RF-075 · drill-down até o insumo, sem ação de expansão em itens finais
 * RF-076 · contribuição em pontos percentuais e ressalva de base por nível
 * RF-077 · gráfico comparativo do produto em foco entre cenários
 * RF-078 · edição das premissas do cenário sem sair da comparação
 * RF-079 · recálculo imediato da matriz após a edição
 * RF-080 · conversa de análise assistida sobre o contexto selecionado
 * RF-081 · sete análises padrão oferecidas como sugestões
 * RF-082 · ressalva de caráter gerencial sem validade fiscal em toda resposta
 * RF-035 · ações sem permissão ficam desabilitadas, com o motivo no title
 * RNF-02 · interface desktop densa — apoio à decisão sem navegação adicional
 * RNF-03 · todos os rótulos e mensagens em português do Brasil
 */
import { esc, num, pct, brl, dataHora } from '../format.js';
import * as E from '/shared/engine.mjs';

/**
 * Chave da conversa de análise: identificadores dos cenários do recorte em
 * ordem crescente, unidos por hífen (ex.: «1-3-7»). A mesma seleção recupera
 * sempre o mesmo histórico (RF-080).
 */
function contextoAnalise() {
  return (vista && vista.selecao ? vista.selecao : [])
    .map(Number).filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b).join('-');
}

/** Capacidade exigida por tipo de alteração do painel (RF-078 · RF-035). */
const CAPACIDADE_PAINEL = {
  cambio: 'editarFornecedor',
  insumo: 'editarFiscal',
  preco: 'editarSaida',
  proporcao: 'substituir',
};

/** Limite do enquadramento legal destacado no gráfico (RN-06 · RN-07). */
const LIMITE_CI = 40;

const estado = {
  aba: 'matriz',          // 'matriz' | 'analise'
  base: '',               // '' = base vigente de cada cenário · 'saida' · 'custo'
  prodFoco: null,
  cenarioFoco: null,
  abertos: new Set(),     // nós expandidos do drill-down (RF-075)
  mensagens: null,        // histórico da conversa (null = ainda não carregado)
  rascunho: '',
  pendente: false,
  flashCenario: null,     // coluna recalculada ao vivo (RF-079)
};

let vista = null;         // { selecao, disponiveis, matriz, limite, padrao, drill, serie }
let raiz = null;          // elemento da tela
let ctxAtual = null;

/* ======================================================================== *
 * ENTRADA DA TELA
 * ======================================================================== */

export async function telaComparacao(el, ctx, params) {
  raiz = el;
  ctxAtual = ctx;
  estado.pendente = false;
  estado.flashCenario = null;

  ctx.definirTopo(
    'Comparação de cenários',
    'RF-073 a RF-082 — matriz de CI% por produto e cenário, drill-down até o insumo, edição ao vivo e análise assistida',
    '<span class="chip" style="background:var(--gold-soft);color:var(--gold-d);">Apoio à decisão</span>');

  el.innerHTML = '<div class="carregando">Carregando comparação</div>';

  let comp = null;
  let padrao = null;
  try {
    const [rc, rp] = await Promise.all([
      ctx.api.get('/comparacao'),
      ctx.api.get('/analise/padrao'),
    ]);
    comp = rc;
    padrao = rp;
  } catch (err) {
    el.innerHTML = `<div class="pagina"><div class="aviso-erro"><span>✕</span>
      <div><b>Não foi possível carregar a comparação.</b> ${esc(err.message)}</div></div></div>`;
    return;
  }

  vista = normalizarComparacao(comp);
  vista.padrao = normalizarPadrao(padrao);

  // A faixa de seleção precisa de TODOS os cenários disponíveis (RF-073).
  if (!vista.disponiveis.length) {
    try {
      const r = await ctx.api.get('/cenarios');
      vista.disponiveis = (r.cenarios || []).map(resumirCenario);
    } catch { vista.disponiveis = vista.matriz ? vista.matriz.cenarios.map(resumirCenario) : []; }
  }

  // Produto em foco: o pedido pela rota, o salvo na seleção do usuário ou o de
  // maior amplitude de CI% (primeira linha da matriz).
  const pedido = Array.isArray(params) ? params.find((p) => p) : null;
  if (pedido && produtoExiste(pedido)) estado.prodFoco = pedido;
  else if (vista.prodFocoSalvo && produtoExiste(vista.prodFocoSalvo)) estado.prodFoco = vista.prodFocoSalvo;
  ajustarFoco();

  await carregarFoco(ctx, { silencioso: true });
  pintar(ctx);
}

/* ======================================================================== *
 * NORMALIZAÇÃO DO CONTRATO (server/ em construção paralela — seção 4.4)
 * ======================================================================== */

function resumirCenario(c) {
  return {
    id: c.id, codigo: c.codigo, nome: c.nome, versao: c.versao,
    status: c.status, autor: c.autor_nome || c.autor || '', ciclo: c.ciclo || '',
    base: c.base_calculo || c.base || 'saida',
  };
}

function normalizarMatriz(resp) {
  if (!resp) return null;
  const m = resp.matriz || (resp.linhas ? resp : null);
  if (!m || !Array.isArray(m.linhas)) return null;
  return {
    cenarios: (m.cenarios || []).map(resumirCenario),
    linhas: m.linhas,
    limite: m.limite || E.LIMITE_COMPARACAO,
    base: m.base || '',
  };
}

/** Seleção vigente — o servidor devolve `selecao` como objeto (seção 4.4). */
function lerSelecao(resp, reserva) {
  const r = resp || {};
  const obj = (r.selecao && !Array.isArray(r.selecao)) ? r.selecao : null;
  const lista = Array.isArray(r.selecao) ? r.selecao
    : (obj && obj.cenarioIds) || r.cenarioIds || r.ids || reserva || [];
  return {
    // os identificadores trafegam como inteiros — normalizar evita seleção
    // com tipos mistos quando o payload traz texto (RF-073)
    ids: lista.map(idCen).filter((x) => x != null),
    limite: (obj && obj.limite) || r.limite || E.LIMITE_COMPARACAO,
    prodFoco: (obj && obj.prodFoco) || r.prodFoco || null,
    origem: (obj && obj.origem) || r.origemSelecao || '',
  };
}

function normalizarComparacao(resp) {
  const r = resp || {};
  const matriz = normalizarMatriz(r);
  const sel = lerSelecao(r, matriz ? matriz.cenarios.map((c) => c.id) : []);
  const brutos = r.disponiveis || r.cenariosDisponiveis || r.todos || r.lista || [];
  return {
    selecao: sel.ids,
    prodFocoSalvo: sel.prodFoco,
    origemSelecao: sel.origem,
    disponiveis: brutos.map(resumirCenario),
    matriz,
    limite: sel.limite,
    padrao: [],
    drill: null,
    serie: null,
    drillErro: '',
    serieErro: '',
  };
}

function normalizarPadrao(resp) {
  const r = resp || {};
  const lista = Array.isArray(r) ? r : (r.analises || r.padrao || r.sugestoes || r.itens || []);
  return lista.length ? lista : E.analisesPadrao();
}

function normalizarDrill(resp) {
  const r = resp || {};
  const d = r.drill || (r.niveis ? r : null);
  if (!d) return null;
  return {
    niveis: d.niveis || [],
    ci: E.n(d.ci != null ? d.ci : (d.resultado && d.resultado.ci)),
    denominador: E.n(d.denominador),
    somaContribuicoesPp: E.n(d.somaContribuicoesPp),
    conferencia: d.conferencia !== false,
    notaBase: d.notaBase || '',
    produto: d.produto || (d.resultado && d.resultado.produto) || null,
    resultado: d.resultado || null,
  };
}

function normalizarSerie(resp) {
  const r = resp || {};
  const s = r.serie || (r.pontos ? r : null);
  if (!s) return null;
  return { pontos: s.pontos || [], maximo: E.n(s.maximo), minimo: E.n(s.minimo), amplitudePp: E.n(s.amplitudePp), nome: s.nome || '' };
}

/** Título da análise padrão a partir do identificador (RF-081). */
function tituloAnalise(id) {
  if (!id) return '';
  const a = (vista && vista.padrao ? vista.padrao : E.analisesPadrao()).find((x) => x.id === id);
  return a ? a.titulo : String(id);
}

/**
 * Mensagens do histórico no formato da API (seção 4.5):
 * { papel: 'usuario'|'assistente', pergunta, analise, conteudo, criadoEm }.
 * A mensagem do usuário pode não ter pergunta livre — nesse caso o rótulo é o
 * título da análise padrão escolhida.
 */
function normalizarMensagens(resp) {
  const r = resp || {};
  const bruto = Array.isArray(r) ? r : (r.mensagens || r.historico || r.itens || r.conversa || []);
  const saida = [];
  for (const m of bruto) {
    if (!m) continue;
    const quando = m.criadoEm || m.criado_em || m.em || m.quando || null;
    const conteudo = (m.conteudo && typeof m.conteudo === 'object') ? m.conteudo : null;
    const papel = m.papel || m.autor || m.quem || ((conteudo && conteudo.blocos) || m.blocos ? 'assistente' : 'usuario');

    if (papel === 'assistente' || papel === 'assistant' || papel === 'sistema') {
      saida.push(mensagemAssistente(conteudo || m.resposta || m, quando, m.usuario));
      continue;
    }
    const texto = m.pergunta || (conteudo && conteudo.pergunta) || m.texto ||
      tituloAnalise(m.analise || (conteudo && conteudo.analise)) || 'Análise do contexto selecionado';
    saida.push({ papel: 'usuario', texto, em: quando, quem: m.usuario || '' });
    // par pergunta/resposta num só registro
    if (m.resposta) saida.push(mensagemAssistente(m.resposta, quando, m.usuario));
  }
  return saida;
}

function mensagemAssistente(r, quando, quem) {
  const o = r || {};
  const blocos = Array.isArray(o.blocos) && o.blocos.length
    ? o.blocos
    : (o.texto ? [{ tipo: 'texto', texto: o.texto }] : []);
  return {
    papel: 'assistente',
    titulo: o.titulo || '',
    blocos,
    citacoes: o.citacoes || [],
    ressalva: o.ressalva || E.RESSALVA_GERENCIAL,   // RF-082 — sempre presente
    analise: o.analise || '',
    em: quando,
    quem: quem || '',
  };
}

/* ======================================================================== *
 * ESTADO DE FOCO
 * ======================================================================== */

function matrizAtual() { return vista && vista.matriz ? vista.matriz : null; }

function cenariosDaMatriz() {
  const m = matrizAtual();
  return m ? m.cenarios : [];
}

function produtoExiste(prodId) {
  const m = matrizAtual();
  return !!(m && m.linhas.some((l) => l.prodId === prodId));
}

function linhaFoco() {
  const m = matrizAtual();
  if (!m) return null;
  return m.linhas.find((l) => l.prodId === estado.prodFoco) || null;
}

/** Garante produto e cenário em foco válidos — a primeira linha é a de maior amplitude. */
function ajustarFoco() {
  const m = matrizAtual();
  if (!m || !m.linhas.length) { estado.prodFoco = null; }
  else if (!produtoExiste(estado.prodFoco)) { estado.prodFoco = m.linhas[0].prodId; }

  const cens = cenariosDaMatriz();
  if (!cens.length) { estado.cenarioFoco = null; return; }
  if (!cens.some((c) => c.id === estado.cenarioFoco)) estado.cenarioFoco = cens[0].id;
}

/**
 * Identificador de cenário vindo do DOM. `cenarios.id` é SERIAL (sql/001) e a
 * API devolve inteiros; `dataset` devolve sempre texto. Sem esta conversão a
 * comparação estrita falharia na retirada do cenário da seleção, no destaque
 * da coluna em foco e na abertura do painel (RF-073 · RF-078).
 */
function idCen(valor) {
  if (valor == null || valor === '') return null;
  const texto = String(valor).trim();
  const n = Number(texto);
  return Number.isFinite(n) && String(n) === texto ? n : valor;
}

function cenarioPorId(id) {
  const mesmo = (c) => String(c.id) === String(id);
  return cenariosDaMatriz().find(mesmo) ||
    (vista.disponiveis || []).find(mesmo) || null;
}

function congeladoCenario(c) {
  return !!c && (c.status === 'congelado' || c.status === 'consolidado');
}

/* ======================================================================== *
 * CARGA DE DADOS
 * ======================================================================== */

async function recarregarMatriz(ctx, respostaPronta) {
  const pronta = normalizarMatriz(respostaPronta);
  if (pronta) { vista.matriz = pronta; ajustarFoco(); return; }
  if (!vista.selecao.length) { vista.matriz = { cenarios: [], linhas: [], limite: vista.limite, base: estado.base }; ajustarFoco(); return; }
  const q = new URLSearchParams({ ids: vista.selecao.join(',') });
  if (estado.base) q.set('base', estado.base);
  if (estado.prodFoco) q.set('prodFoco', estado.prodFoco);
  const r = await ctx.api.get(`/comparacao/matriz?${q.toString()}`);
  vista.matriz = normalizarMatriz(r) || { cenarios: [], linhas: [], limite: vista.limite, base: estado.base };
  ajustarFoco();
}

/** Drill-down (RF-075) e série do gráfico (RF-077) do produto em foco. */
async function carregarFoco(ctx, opcoes = {}) {
  vista.drill = null;
  vista.serie = null;
  vista.drillErro = '';
  vista.serieErro = '';
  if (!estado.prodFoco || !estado.cenarioFoco || !vista.selecao.length) return;

  const qd = new URLSearchParams({ cenarioId: estado.cenarioFoco, prodId: estado.prodFoco });
  if (estado.base) qd.set('base', estado.base);
  const qs = new URLSearchParams({ ids: vista.selecao.join(','), prodId: estado.prodFoco });
  if (estado.base) qs.set('base', estado.base);

  const [d, s] = await Promise.all([
    ctx.api.get(`/comparacao/drill?${qd.toString()}`).catch((err) => {
      vista.drillErro = err.message;
      if (!opcoes.silencioso) ctx.toast(`Detalhamento por insumo: ${err.message}`, 'erro');
      return null;
    }),
    ctx.api.get(`/comparacao/serie?${qs.toString()}`).catch((err) => {
      vista.serieErro = err.message;
      if (!opcoes.silencioso) ctx.toast(`Gráfico comparativo: ${err.message}`, 'erro');
      return null;
    }),
  ]);
  vista.drill = normalizarDrill(d);
  vista.serie = normalizarSerie(s);
}

async function trocarFoco(ctx, { prodId, cenarioId }) {
  if (prodId) estado.prodFoco = prodId;
  if (cenarioId) estado.cenarioFoco = cenarioId;
  estado.abertos.clear();
  pintar(ctx);                       // feedback imediato do foco
  await carregarFoco(ctx);
  pintar(ctx);
}

/* ======================================================================== *
 * 1 · SELEÇÃO DE CENÁRIOS (RF-073)
 * ======================================================================== */

async function alternarCenario(ctx, id) {
  const sel = vista.selecao.slice();
  const i = sel.indexOf(id);
  const limite = vista.limite || E.LIMITE_COMPARACAO;
  const c = cenarioPorId(id);

  if (i >= 0 && sel.length === 1) {
    // a comparação exige ao menos um cenário selecionado (RF-073)
    ctx.toast('A comparação exige ao menos um cenário selecionado. Inclua outro cenário antes de retirar este.', 'erro');
    return;
  } else if (i >= 0) {
    sel.splice(i, 1);
  } else if (sel.length >= limite) {
    // RF-073 — inclusão bloqueada no limite, com o motivo explicado
    ctx.toast(`Limite de ${limite} cenários simultâneos na comparação (RF-073 · decisão E-13). ` +
      'Retire um cenário da faixa antes de incluir outro.', 'erro');
    return;
  } else {
    sel.push(id);
  }

  try {
    const r = await ctx.api.put('/comparacao/selecao', {
      cenarioIds: sel,
      prodFoco: estado.prodFoco || undefined,
      base: estado.base || undefined,
    });
    const nova = lerSelecao(r, sel);
    vista.selecao = nova.ids;
    vista.limite = nova.limite;
    if (nova.prodFoco) vista.prodFocoSalvo = nova.prodFoco;
    estado.mensagens = null;        // o recorte mudou — a conversa é outra (RF-080)
    await recarregarMatriz(ctx, r);
    await carregarFoco(ctx);
    if (estado.aba === 'analise') await carregarHistorico(ctx);
    pintar(ctx);
    ctx.toast(i >= 0
      ? `Cenário ${c ? c.codigo : ''} retirado da comparação — ${vista.selecao.length} de ${limite}.`
      : `Cenário ${c ? c.codigo : ''} incluído na comparação — ${vista.selecao.length} de ${limite}.`, 'ok');
  } catch (err) {
    ctx.toast(err.message, 'erro');
  }
}

function htmlFaixaSelecao() {
  const sel = new Set(vista.selecao);
  const limite = vista.limite || E.LIMITE_COMPARACAO;
  const cheio = sel.size >= limite;
  const lista = (vista.disponiveis || []).slice().sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));

  return `
  <div class="card card-pad" style="margin-bottom:14px;">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--ink-3);font-weight:600;letter-spacing:.4px;">CENÁRIOS NA COMPARAÇÃO</div>
      <span class="chip" style="background:${cheio ? 'var(--warn-bg)' : 'var(--gold-soft)'};color:${cheio ? 'var(--warn-fg)' : 'var(--gold-d)'};"
        title="Limite de ${limite} cenários simultâneos (RF-073 · decisão E-13)">${sel.size} de ${limite} cenários</span>
      <div style="flex:1;"></div>
      <label class="linha-flex" style="gap:7px;font-size:11px;color:var(--ink-3);">
        <span style="font-weight:600;letter-spacing:.3px;">BASE DE CÁLCULO</span>
        <select id="sel-base" style="border:1px solid var(--line);border-radius:7px;padding:6px 9px;font-size:11.5px;background:var(--panel);"
          title="Denominador aplicado na comparação (RF-060). «Base de cada cenário» respeita o denominador gravado em cada um.">
          <option value="" ${estado.base === '' ? 'selected' : ''}>Base vigente de cada cenário</option>
          <option value="saida" ${estado.base === 'saida' ? 'selected' : ''}>Saídas interestaduais (média ponderada)</option>
          <option value="custo" ${estado.base === 'custo' ? 'selected' : ''}>Custo total da mercadoria</option>
        </select>
      </label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${lista.length ? lista.map((c) => {
        const ativo = sel.has(c.id);
        const trava = congeladoCenario(c);
        const motivo = ativo
          ? `Retirar ${c.codigo} da comparação`
          : (cheio ? `Limite de ${limite} cenários atingido — retire um cenário antes de incluir ${c.codigo}` : `Incluir ${c.codigo} na comparação`);
        return `
        <button class="chip-status" data-cen-chip="${esc(c.id)}" title="${esc(motivo)} · ${esc(c.nome)} · ${esc(c.status || '')}"
          style="border:1px solid ${ativo ? 'var(--gold)' : 'var(--line)'};background:${ativo ? 'var(--gold-soft)' : 'var(--panel)'};
                 color:${ativo ? 'var(--gold-d)' : 'var(--ink-2)'};cursor:pointer;${!ativo && cheio ? 'opacity:.55;' : ''}">
          <span class="ponto" style="background:${ativo ? 'var(--gold)' : '#d6d0c4'};"></span>
          <b>${esc(c.codigo)}</b> ${esc(c.nome)}
          <span class="mono" style="font-size:9.5px;opacity:.75;">v${esc(c.versao)}</span>
          ${trava ? '<span title="Cenário congelado ou consolidado — premissas travadas (RN-10)">🔒</span>' : ''}
        </button>`;
      }).join('') : '<div class="texto-mini">Nenhum cenário disponível. Crie um cenário em <a href="#/cenarios">Cenários</a>.</div>'}
    </div>
    <div class="texto-mini" style="margin-top:9px;">
      Clique em um cenário para incluir ou retirar — a matriz é recalculada na hora (RF-073).
      Clique no cabeçalho de uma coluna (<b style="color:var(--gold-d);">⚙</b>) para editar as premissas daquele cenário
      sem sair desta tela (RF-078 · RF-079). Nenhuma alteração afeta os demais cenários nem o cadastro oficial (RF-007).
    </div>
  </div>`;
}

/* ======================================================================== *
 * 2 · MATRIZ DE CI% POR PRODUTO E CENÁRIO (RF-074)
 * ======================================================================== */

function faixaDaCelula(cel) {
  if (cel && cel.faixa && cel.faixa.bg) return cel.faixa;
  return E.faixaDe(cel ? cel.ci : 0);
}

function htmlMatriz() {
  const m = matrizAtual();
  if (!m || !m.cenarios.length) {
    return `<div class="card card-pad" style="margin-bottom:14px;">
      <div class="aviso-info">Selecione ao menos um cenário na faixa acima para montar a matriz de CI% por produto e cenário (RF-074).</div>
    </div>`;
  }
  if (!m.linhas.length) {
    return `<div class="card card-pad" style="margin-bottom:14px;">
      <div class="aviso-info">Os cenários selecionados não possuem produtos acabados carregados.
      Sincronize as fontes em <a href="#/integracoes">Integrações</a> e recarregue a estrutura no cenário (RF-002).</div>
    </div>`;
  }

  const nCols = m.cenarios.length;
  const mudam = m.linhas.filter((l) => l.mudaFaixa).length;

  return `
  <div class="card" style="overflow:hidden;margin-bottom:14px;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:260px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Matriz de CI% · produto × cenário</h3>
        <div class="texto-mini" style="margin-top:2px;">
          ${m.linhas.length} produto(s) acabado(s) × ${nCols} cenário(s) · ordenados pela amplitude de CI%.
          Cada célula traz o CI% com a cor da faixa e a alíquota interestadual resultante.
        </div>
      </div>
      <span class="chip" style="background:var(--err-bg);color:var(--err-fg);" title="Linha com inset vermelho à esquerda">maior CI% da linha</span>
      <span class="chip" style="background:var(--ok-bg);color:var(--ok-fg);" title="Linha com inset verde à esquerda">menor CI% da linha</span>
      ${mudam ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);"
        title="Produtos cujo enquadramento muda conforme o cenário — atenção fiscal (RN-06)">${mudam} muda(m) de faixa</span>` : ''}
    </div>
    <div style="overflow-x:auto;">
      <table class="matriz" style="min-width:${Math.max(760, 320 + nCols * 150)}px;">
        <thead>
          <tr>
            <th style="min-width:280px;">PRODUTO ACABADO</th>
            ${m.cenarios.map((c) => {
              const trava = congeladoCenario(c);
              const emFoco = c.id === estado.cenarioFoco;
              const flash = estado.flashCenario === c.id;
              return `
              <th data-col-cen="${esc(c.id)}" title="Abrir o painel de edição das premissas de ${esc(c.codigo)} — ${esc(c.nome)}${trava ? ' (cenário congelado: campos somente leitura)' : ''} · RF-078"
                style="cursor:pointer;min-width:150px;${emFoco ? 'background:var(--gold-soft);' : ''}${flash ? 'box-shadow:inset 0 -3px 0 var(--gold);' : ''}">
                <div style="display:flex;align-items:center;gap:6px;">
                  <b style="font-size:11px;color:var(--ink);">${esc(c.codigo)}</b>
                  <span style="color:var(--gold-d);font-size:11px;">⚙</span>
                  ${trava ? '<span title="Congelado — somente leitura (RN-10)">🔒</span>' : ''}
                </div>
                <div style="font-weight:500;font-size:10.5px;color:var(--ink-2);text-transform:none;letter-spacing:0;">${esc(c.nome)}</div>
                <div style="font-weight:400;font-size:9px;color:var(--ink-3);letter-spacing:0;" class="mono">v${esc(c.versao)} · ${esc(c.status || '')}</div>
              </th>`;
            }).join('')}
            <th style="text-align:right;min-width:104px;" title="Diferença, em pontos percentuais, entre o maior e o menor CI% da linha (RF-074)">AMPLITUDE</th>
          </tr>
        </thead>
        <tbody>
          ${m.linhas.map((l) => htmlLinhaMatriz(l)).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:10px 18px;background:var(--panel-2);border-top:1px solid var(--line-2);" class="texto-mini">
      Linhas destacadas em dourado-claro mudam de faixa de enquadramento entre os cenários — o mesmo produto sai
      de uma alíquota interestadual para outra conforme as premissas (RN-06 · RN-07). Clique em uma célula para
      colocar o produto em foco no detalhamento e no gráfico.
    </div>
  </div>`;
}

function htmlLinhaMatriz(l) {
  const emFoco = l.prodId === estado.prodFoco;
  const fundo = emFoco ? 'background:var(--gold-soft);' : (l.mudaFaixa ? 'background:#fdfbf7;' : '');
  return `
  <tr data-linha-prod="${esc(l.prodId)}" style="${fundo}${l.mudaFaixa ? 'box-shadow:inset 3px 0 0 var(--warn);' : ''}">
    <td class="cel-prod" style="cursor:pointer;" title="Colocar «${esc(l.nome)}» em foco no detalhamento e no gráfico">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="color:var(--gold-d);font-size:11px;width:10px;">${emFoco ? '▸' : ''}</span>
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:12px;">${esc(l.nome)}</div>
          <div class="mono" style="font-size:9.5px;color:var(--ink-3);">
            ${esc(l.sku || l.prodId)}${E.n(l.fciVigente) > 0 ? ` · FCI vigente ${pct(l.fciVigente)}` : ''}
          </div>
        </div>
        ${l.mudaFaixa ? '<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);" title="O enquadramento deste produto muda de faixa entre os cenários comparados (RF-074)">MUDA DE FAIXA</span>' : ''}
      </div>
    </td>
    ${(l.celulas || []).map((cel, i) => htmlCelula(l, cel, i)).join('')}
    <td>
      <div class="amplitude" title="Maior CI% ${pct(l.maiorCi)} · menor CI% ${pct(l.menorCi)}"
        style="color:${E.n(l.amplitudePp) >= 10 ? 'var(--err-fg)' : (E.n(l.amplitudePp) > 0 ? 'var(--ink)' : 'var(--ink-3)')};">
        ${num(l.amplitudePp, 1)} p.p.
      </div>
    </td>
  </tr>`;
}

function htmlCelula(l, cel, i) {
  if (!cel || cel.ausente) {
    return `<td><div class="celula" data-cel-prod="${esc(l.prodId)}" data-cel-cen=""
      style="color:var(--ink-3);background:var(--panel-2);cursor:default;"
      title="Produto não existe neste cenário — nada a comparar nesta célula">—<span class="mini">ausente</span></div></td>`;
  }
  const fx = faixaDaCelula(cel);
  const marca = i === l.idxMaior ? ' maior' : (i === l.idxMenor ? ' menor' : '');
  const emFoco = l.prodId === estado.prodFoco && cel.cenarioId === estado.cenarioFoco;
  const flash = estado.flashCenario === cel.cenarioId;
  const dica = [
    `${l.nome} · ${cel.codigo || ''}`,
    `CI% ${pct(cel.ci)} — ${fx.label}`,
    `Alíquota interestadual ${num(cel.aliquota, 0)}%`,
    `Parcela importada ${brl(cel.parcela)} ÷ denominador ${brl(cel.denominador)}`,
    `Base usada: ${cel.baseUsada === 'saida' ? 'saídas interestaduais' : 'custo total'}`,
    `vs FCI vigente ${E.pp(cel.deltaVigente)}`,
  ].join(' · ');
  return `
  <td>
    <div class="celula${marca}" data-cel-prod="${esc(l.prodId)}" data-cel-cen="${esc(cel.cenarioId)}"
      title="${esc(dica)}"
      style="background:${fx.bg};color:${fx.fg};${emFoco ? 'outline:2px solid var(--gold);outline-offset:-2px;' : ''}${flash ? 'animation:fcifadein .35s ease;' : ''}">
      ${pct(cel.ci)}
      <span class="mini">ICMS ${num(cel.aliquota, 0)}%${E.n(cel.deltaVigente) ? ` · ${E.pp(cel.deltaVigente)}` : ''}</span>
    </div>
  </td>`;
}

/* ======================================================================== *
 * 3 · DRILL-DOWN ATÉ O INSUMO (RF-075 · RF-076)
 * ======================================================================== */

function htmlDrill() {
  const m = matrizAtual();
  if (!m || !m.linhas.length) return '';
  const l = linhaFoco();
  const cen = cenarioPorId(estado.cenarioFoco);
  const d = vista.drill;

  return `
  <div class="card" style="overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Detalhamento até o insumo</h3>
        <div class="texto-mini" style="margin-top:2px;">
          Contribuição de cada item no CI% do produto, em pontos percentuais (RF-076).
        </div>
      </div>
      <label class="campo" style="min-width:230px;">
        <span>PRODUTO EM FOCO</span>
        <select id="sel-prod-foco" title="Produto detalhado no drill-down e no gráfico comparativo">
          ${m.linhas.map((x) => `<option value="${esc(x.prodId)}" ${x.prodId === estado.prodFoco ? 'selected' : ''}>
            ${esc(x.sku || x.prodId)} · ${esc(x.nome)}</option>`).join('')}
        </select>
      </label>
      <label class="campo" style="min-width:190px;">
        <span>CENÁRIO DO DETALHAMENTO</span>
        <select id="sel-cen-foco" title="Cenário cujas premissas são abertas no detalhamento">
          ${m.cenarios.map((c) => `<option value="${esc(c.id)}" ${c.id === estado.cenarioFoco ? 'selected' : ''}>
            ${esc(c.codigo)} · ${esc(c.nome)} (v${esc(c.versao)})</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-borda btn-mini" id="btn-abrir-sim"
        title="Abrir este produto na tela de simulação do cenário em foco">Abrir na simulação →</button>
    </div>

    ${!d ? (vista.drillErro
      ? `<div class="aviso-erro" style="margin:14px 18px;"><span>✕</span><div><b>Detalhamento indisponível.</b> ${esc(vista.drillErro)}</div></div>`
      : '<div class="carregando">Calculando o detalhamento do produto em foco</div>') : `
    <div style="padding:11px 18px;background:var(--panel-2);border-bottom:1px solid var(--line-2);display:flex;gap:22px;align-items:center;flex-wrap:wrap;">
      <div>
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.4px;">Σ CONTRIBUIÇÕES DOS COMPONENTES</div>
        <div class="mono" style="font-size:17px;font-weight:600;">${num(d.somaContribuicoesPp, 2)} p.p.</div>
      </div>
      <div style="font-size:16px;color:var(--ink-3);">=</div>
      <div>
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.4px;">CI% APRESENTADO NA MATRIZ</div>
        <div class="mono" style="font-size:17px;font-weight:600;color:${E.faixaDe(d.ci).fg};">${pct(d.ci)}</div>
      </div>
      <div class="chip" style="background:${d.conferencia ? 'var(--ok-bg)' : 'var(--err-bg)'};color:${d.conferencia ? 'var(--ok-fg)' : 'var(--err-fg)'};"
        title="${d.conferencia ? 'As contribuições dos componentes somam exatamente o CI% apresentado (RF-076)' : 'Divergência entre a soma das contribuições e o CI% apresentado — verifique a estrutura do produto'}">
        ${d.conferencia ? '✓ as contribuições somam o CI% apresentado' : '✕ soma divergente do CI% apresentado'}
      </div>
      <div style="flex:1;"></div>
      <div class="texto-mini" style="max-width:420px;">
        Denominador vigente: <b class="mono" style="color:var(--ink-2);">${brl(d.denominador)}</b>
        ${cen ? ` · cenário <b style="color:var(--ink-2);">${esc(cen.codigo)}</b>` : ''}
        ${l ? ` · produto <b style="color:var(--ink-2);">${esc(l.nome)}</b>` : ''}
      </div>
    </div>

    <div class="drill-linha" style="background:var(--panel-2);border-bottom:1px solid var(--line);font-size:10px;font-weight:700;letter-spacing:.4px;color:var(--ink-3);">
      <div>COMPONENTE / INSUMO</div>
      <div style="text-align:right;">CUSTO NO PRODUTO</div>
      <div style="text-align:right;">FATOR DE FAIXA</div>
      <div style="text-align:right;">CONTRIBUIÇÃO</div>
      <div>PESO RELATIVO</div>
    </div>

    <div id="arvore-drill">
      ${d.niveis.length
        ? htmlNiveis(d.niveis, 0, 'n')
        : '<div class="aviso-info" style="margin:14px 18px;">Produto sem componentes carregados neste cenário.</div>'}
    </div>

    <div style="padding:10px 18px;background:var(--panel-2);border-top:1px solid var(--line-2);" class="texto-mini">
      ${esc(d.notaBase || 'No nível do produto a base é o denominador vigente; nos níveis inferiores a base é o próprio intermediário (RF-076).')}
      Itens sem nível inferior não apresentam ação de expansão (RF-075).
    </div>`}
  </div>`;
}

function htmlNiveis(nos, nivel, prefixo) {
  const maior = nos.reduce((a, x) => Math.max(a, Math.abs(E.n(x.contribPp))), 0);
  return nos.map((no, i) => {
    const chave = `${prefixo}-${i}`;
    const aberto = estado.abertos.has(chave);
    const largura = maior > 0 ? Math.min(100, Math.abs(E.n(no.contribPp)) / maior * 100) : 0;
    const corTipo = no.tipo === 'PI'
      ? { bg: '#e6e9f2', fg: '#3d4c7a' }
      : { bg: 'var(--line-2)', fg: 'var(--ink-2)' };
    const fx = E.faixaDoCi(no.ciNo);

    return `
    <div class="drill-no">
      <div class="drill-linha">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;margin-left:${nivel * 20}px;">
          <button class="drill-exp ${no.expansivel ? '' : 'vazio'}" data-exp="${chave}"
            ${no.expansivel ? `title="${aberto ? 'Recolher' : 'Abrir'} a estrutura do intermediário «${esc(no.nome)}»"` : 'tabindex="-1" aria-hidden="true"'}>
            ${no.expansivel ? (aberto ? '−' : '+') : ''}
          </button>
          <span class="bom-kind" style="background:${corTipo.bg};color:${corTipo.fg};">${esc(no.tipo || 'MP')}</span>
          <div style="min-width:0;">
            <div style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(no.nome)}</div>
            <div class="mono" style="font-size:9px;color:var(--ink-3);">
              ${esc(no.grupo || '—')} · ${num(no.qtd, 3)} ${esc(no.unidade || '')} ·
              <span style="color:${fx.fg};">CI próprio ${pct(no.ciNo)}</span> · fator ×${num(no.fator, 2)}
              ${no.hasMix ? ' · <b style="color:var(--gold-d);">substituição ativa</b>' : ''}
            </div>
          </div>
        </div>
        <div class="mono" style="text-align:right;font-size:11px;" title="Custo do item dentro do produto">${brl(no.custoTot)}</div>
        <div class="mono" style="text-align:right;font-size:11px;color:${E.n(no.fator) > 0 ? 'var(--ink)' : 'var(--ink-3)'};"
          title="Fator de faixa aplicado na cascata (RN-05): 0 até 40%, 0,5 entre 40% e 70%, 1 acima de 70%">×${num(no.fator, 2)}</div>
        <div class="mono" style="text-align:right;font-weight:600;font-size:11.5px;"
          title="Parcela importada deste item ${brl(no.contrib)} ÷ base ${brl(no.baseDivisao)} × 100">${num(no.contribPp, 2)} p.p.</div>
        <div class="drill-barra" title="Peso relativo deste item na contribuição do nível">
          <div style="width:${num(largura, 1).replace(',', '.')}%;"></div>
        </div>
      </div>

      ${no.hasMix && no.alternativas ? `
      <div style="padding:0 12px 7px ${nivel * 20 + 40}px;" class="texto-mini">
        Proporções em uso:
        ${no.alternativas.map((a) => `<span class="tag-alt ${a.papel === 'substituto' ? 'substituto' : 'original'}${a.naoUtilizado ? ' zero' : ''}"
          title="${esc(a.nome)} · ${a.papel === 'substituto' ? 'substituto' : 'item original'} · contribuição ${brl(a.contrib)}">
          ${esc(a.nome)} ${num(a.pct, 0)}%</span>`).join(' ')}
        <span style="color:var(--ink-3);"> — o item original permanece listado mesmo com proporção zero (RF-019).</span>
      </div>` : ''}

      ${no.expansivel ? `
      <div data-filhos="${chave}" ${aberto ? '' : 'hidden'} style="background:#fdfbf7;">
        <div style="padding:6px 12px 6px ${nivel * 20 + 40}px;font-size:10px;color:#6d5320;background:#f7f4ed;line-height:1.45;">
          ⚠ ${esc((no.filhos && no.filhos[0] && no.filhos[0].ressalva) ||
            'Contribuições deste nível têm como base o próprio intermediário, não o produto acabado (RF-076).')}
          Base deste nível: <b class="mono">${brl((no.filhos && no.filhos[0] && no.filhos[0].baseDivisao) || no.custoUnit)}</b>.
        </div>
        ${htmlNiveis(no.filhos || [], nivel + 1, chave)}
      </div>` : ''}
    </div>`;
  }).join('');
}

/* ======================================================================== *
 * 4 · GRÁFICO COMPARATIVO (RF-077)
 * ======================================================================== */

function htmlGrafico() {
  const m = matrizAtual();
  if (!m || !m.linhas.length) return '';
  const l = linhaFoco();
  const s = vista.serie;

  if (!s) {
    return `<div class="card" style="overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line-2);">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Gráfico comparativo · CI% por cenário</h3>
      </div>
      ${vista.serieErro
        ? `<div class="aviso-erro" style="margin:14px 18px;"><span>✕</span><div><b>Gráfico indisponível.</b> ${esc(vista.serieErro)}</div></div>`
        : '<div class="carregando">Montando a série do produto em foco</div>'}
    </div>`;
  }

  const pontos = s.pontos || [];
  const maxCi = pontos.reduce((a, p) => Math.max(a, E.n(p.ci)), 0);
  const escala = Math.max(50, maxCi * 1.15);
  const alturaUtil = 177;                       // .grafico: 190px − padding 12px − borda 1px
  const alturaLimite = LIMITE_CI / escala * alturaUtil;

  return `
  <div class="card" style="overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--line-2);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Gráfico comparativo · CI% por cenário</h3>
        <div class="texto-mini" style="margin-top:2px;">${esc(l ? l.nome : (s.nome || ''))} — cor da barra pela faixa de enquadramento.</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.4px;">AMPLITUDE ENTRE CENÁRIOS</div>
        <div class="mono" style="font-size:16px;font-weight:600;">${num(s.amplitudePp, 1)} p.p.</div>
      </div>
    </div>
    <div style="padding:6px 12px 0;">
      <div style="position:relative;">
        <div class="grafico">
          ${pontos.map((p) => {
            if (p.ausente) {
              return `<div class="grafico-col" title="Produto ausente em ${esc(p.codigo || '')}">
                <div class="grafico-val" style="color:var(--ink-3);">—</div>
                <div class="grafico-barra" style="height:3px;background:var(--line-2);"></div>
              </div>`;
            }
            const fx = (p.faixa && p.faixa.fg) ? p.faixa : E.faixaDe(p.ci);
            const h = Math.max(1.5, E.n(p.ci) / escala * 100);
            return `
            <div class="grafico-col" title="${esc(`${p.codigo || ''} · ${p.nome || ''} · CI% ${pct(p.ci)} · ${fx.label} · alíquota ${num(p.aliquota, 0)}% · vs FCI vigente ${E.pp(p.deltaVigente)}`)}">
              <div class="grafico-val" style="color:${fx.fg};">${pct(p.ci)}</div>
              <div class="grafico-barra" style="height:${num(h, 1).replace(',', '.')}%;background:${fx.chip || fx.fg};"></div>
            </div>`;
          }).join('')}
        </div>
        <div class="grafico-limite" style="position:absolute;left:0;right:0;bottom:${num(alturaLimite, 1).replace(',', '.')}px;pointer-events:none;">
          <span style="position:absolute;right:2px;top:-14px;font-size:9.5px;color:var(--err);background:rgba(242,239,232,.85);padding:0 4px;">
            limite de ${num(LIMITE_CI, 0)}% · acima disso a alíquota interestadual cai a 4%
          </span>
        </div>
      </div>
      <div style="display:flex;gap:12px;padding:8px 6px 12px;">
        ${pontos.map((p) => `<div class="grafico-rot" style="flex:1;">
          <b style="color:var(--ink-2);">${esc(p.codigo || '')}</b><br>${esc(p.nome || '')}${p.versao != null ? `<br><span class="mono">v${esc(p.versao)}</span>` : ''}
        </div>`).join('')}
      </div>
    </div>
    <div style="padding:10px 18px;background:var(--panel-2);border-top:1px solid var(--line-2);" class="texto-mini">
      Trocar o produto em foco atualiza o gráfico, as faixas e o detalhamento (RF-077).
      A linha tracejada marca o limite de ${num(LIMITE_CI, 0)}% (Resolução SF 13/2012 · RN-07).
    </div>
  </div>`;
}

/* ======================================================================== *
 * 5 · PAINEL LATERAL DE EDIÇÃO (RF-078 · RF-079)
 * ======================================================================== */

/** Capacidades exigidas por tipo de alteração do painel (RF-035 · RF-078). */
function permissoesPainel(ctx) {
  return {
    cambio: ctx.pode(CAPACIDADE_PAINEL.cambio),
    insumo: ctx.pode(CAPACIDADE_PAINEL.insumo),
    preco: ctx.pode(CAPACIDADE_PAINEL.preco),
    proporcao: ctx.pode(CAPACIDADE_PAINEL.proporcao),
  };
}

function motivoBloqueio(tipo, congelado) {
  if (congelado) return 'Cenário congelado ou consolidado — premissas travadas para rastreabilidade (RN-10). Crie uma nova versão do cenário para simular alterações.';
  const mapa = {
    cambio: 'Seu perfil não possui a capacidade «editarFornecedor», exigida para alterar cotações de câmbio (RF-052 · RF-054 · RF-035).',
    insumo: 'Seu perfil não possui a capacidade «editarFiscal», exigida para alterar classificação, conteúdo de importação e custos do insumo (RF-046 a RF-051 · RF-058 · RF-059 · RF-035).',
    preco: 'Seu perfil não possui a capacidade «editarSaida», exigida para alterar o preço da UF de destino (RF-066 · RF-068 · RF-035).',
    proporcao: 'Seu perfil não possui a capacidade «substituir», exigida para alterar proporções de substituição (RF-017 · RF-023 · RF-035).',
  };
  return mapa[tipo] || 'Ação indisponível para o perfil ativo (RF-035).';
}

/** Refs de insumo e intermediário usados pelo produto em foco (apoio à decisão). */
function refsUsadas(dados, prodId, vistos) {
  const visitados = vistos || new Set();
  const out = new Set();
  if (!prodId || visitados.has(prodId)) return out;
  visitados.add(prodId);
  const prod = (dados.produtos || []).find((p) => p.id === prodId);
  if (!prod) return out;
  for (const c of prod.componentes || []) {
    const refs = (c.mix && c.mix.length) ? c.mix.map((x) => x.ref) : [c.ref];
    for (const r of refs) {
      out.add(r);
      for (const sub of refsUsadas(dados, r, visitados)) out.add(sub);
    }
  }
  return out;
}

async function abrirPainelCenario(ctx, cenarioId) {
  const resumo = cenarioPorId(cenarioId);
  ctx.abrirPainel(`
    <header>
      <div style="flex:1;min-width:0;">
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.5px;">PREMISSAS DO CENÁRIO · RF-078</div>
        <div style="font-size:14px;font-weight:600;margin-top:2px;">${esc(resumo ? resumo.codigo : cenarioId)} · ${esc(resumo ? resumo.nome : '')}</div>
      </div>
      <button class="btn-icone" id="btn-fechar-painel" title="Fechar o painel">✕</button>
    </header>
    <div class="corpo"><div class="carregando">Carregando premissas do cenário</div></div>`);
  document.getElementById('btn-fechar-painel')?.addEventListener('click', () => ctx.fecharPainel());

  let cenario = null;
  try {
    const r = await ctx.api.get(`/cenarios/${encodeURIComponent(cenarioId)}`);
    cenario = r.cenario || r;
  } catch (err) {
    const corpo = document.querySelector('#painel-ativo .corpo');
    if (corpo) corpo.innerHTML = `<div class="aviso-erro"><span>✕</span><div>${esc(err.message)}</div></div>`;
    return;
  }

  const dados = cenario.dados || { insumos: [], produtos: [], cambio: {}, fornecedores: [] };
  const congelado = congeladoCenario({ status: cenario.status });
  const perm = permissoesPainel(ctx);
  const prodId = estado.prodFoco;
  const prod = (dados.produtos || []).find((p) => p.id === prodId) || null;
  const usadas = refsUsadas(dados, prodId);

  const insumos = (dados.insumos || []).slice().sort((a, b) => {
    const ua = usadas.has(a.id) ? 0 : 1;
    const ub = usadas.has(b.id) ? 0 : 1;
    return ua - ub || String(a.nome).localeCompare(String(b.nome));
  });

  const painel = document.getElementById('painel-ativo');
  if (!painel) return;

  painel.innerHTML = `
    <header>
      <div style="flex:1;min-width:0;">
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.5px;">PREMISSAS DO CENÁRIO · RF-078</div>
        <div style="font-size:14px;font-weight:600;margin-top:2px;">${esc(cenario.codigo)} · ${esc(cenario.nome)}</div>
        <div class="texto-mini">v${esc(cenario.versao)} · ${esc(cenario.status)} ·
          base ${esc((cenario.base_calculo || 'saida') === 'saida' ? 'saídas interestaduais' : 'custo total')}</div>
      </div>
      <button class="btn-icone" id="btn-fechar-painel" title="Fechar o painel">✕</button>
    </header>
    <div class="corpo">
      ${congelado ? `<div class="aviso-restricao">🔒 Cenário <b>${esc(cenario.status)}</b> — premissas travadas para rastreabilidade (RN-10).
        Os campos abaixo ficam em somente leitura. Crie uma nova versão do cenário para simular alterações.</div>` : `
        <div class="aviso-info">Cada alteração recalcula <b>apenas as colunas deste cenário</b> na matriz, sem recarregar a tela (RF-079).
        As premissas valem só neste cenário — o cadastro oficial e os demais cenários não são afetados (RF-007).</div>`}

      ${secaoCambio(dados, congelado, perm)}
      ${secaoInsumos(dados, insumos, usadas, congelado, perm)}
      ${secaoPrecoEntrada(dados, insumos, usadas, congelado, perm)}
      ${secaoSaidas(prod, congelado, perm)}
      ${secaoProporcoes(dados, prod, congelado, perm)}
    </div>
    <div class="rodape">
      <span style="flex:1;" class="texto-mini">Alterações registradas na trilha de auditoria do cenário (RNF-04).</span>
      <button class="btn btn-escuro btn-mini" id="btn-painel-sim" title="Abrir este cenário na tela de simulação">Abrir na simulação →</button>
    </div>`;

  painel.querySelector('#btn-fechar-painel')?.addEventListener('click', () => ctx.fecharPainel());
  painel.querySelector('#btn-painel-sim')?.addEventListener('click', () => {
    ctx.fecharPainel();
    ctx.navegar(`#/sim/${cenario.id}`);
  });

  painel.querySelectorAll('[data-tipo]').forEach((campo) => {
    const anterior = campo.value;
    campo.addEventListener('change', async () => {
      const alteracao = montarAlteracao(campo);
      if (!alteracao) {
        ctx.toast('Informe um número válido para este campo.', 'erro');
        campo.value = anterior;
        return;
      }
      campo.disabled = true;
      try {
        await aplicarAlteracaoPainel(ctx, cenario.id, alteracao);
        campo.style.borderColor = 'var(--ok)';
        setTimeout(() => { campo.style.borderColor = ''; }, 900);
      } catch (err) {
        ctx.toast(err.message, 'erro');
        campo.value = anterior;                 // a premissa do cenário não mudou
      }
      campo.disabled = false;
    });
  });
}

/**
 * Monta a alteração no formato aceito pelo painel (RF-078):
 *   cambio    → { tipo, moeda, cotacao }
 *   insumo    → { tipo, ref, campos: { campo: valor } }
 *   preco     → { tipo, prodId, uf, preco }
 *   proporcao → { tipo, prodId, idx, mi, pct }
 */
function montarAlteracao(campo) {
  const tipo = campo.dataset.tipo;
  const numerico = campo.dataset.numerico === '1';
  const valor = numerico ? E.n(campo.value, NaN) : campo.value;
  if (numerico && !Number.isFinite(valor)) return null;

  if (tipo === 'cambio') return { tipo, moeda: campo.dataset.moeda, cotacao: valor };
  if (tipo === 'insumo') {
    const campos = {};
    campos[campo.dataset.campo] = valor;
    return { tipo, ref: campo.dataset.ref, campos };
  }
  if (tipo === 'preco') return { tipo, prodId: campo.dataset.prodId, uf: campo.dataset.uf, preco: valor };
  return {
    tipo: 'proporcao', prodId: campo.dataset.prodId,
    idx: Number(campo.dataset.idx), mi: Number(campo.dataset.mi), pct: valor,
  };
}

/** RF-079 — recálculo imediato: só as colunas do cenário editado mudam. */
async function aplicarAlteracaoPainel(ctx, cenarioId, alteracao) {
  const r = await ctx.api.put('/comparacao/painel', {
    cenarioId, alteracao,
    ids: vista.selecao,
    base: estado.base || undefined,
    prodFoco: estado.prodFoco || undefined,
  });
  await recarregarMatriz(ctx, r);
  if (r && r.confronto && Array.isArray(r.confronto) && r.confronto.length) {
    // RF-031 — inconsistências NOVAS geradas pela edição
    ctx.toast(`Atenção: a alteração gerou ${r.confronto.length} inconsistência(s) nova(s) — verifique a validação do cenário (RF-031).`, 'erro');
  }
  estado.flashCenario = cenarioId;
  await carregarFoco(ctx, { silencioso: true });
  pintar(ctx);
  setTimeout(() => {
    if (estado.flashCenario === cenarioId) { estado.flashCenario = null; pintar(ctx); }
  }, 1400);
  const cen = cenarioPorId(cenarioId);
  ctx.toast(`Matriz recalculada para ${cen ? cen.codigo : 'o cenário'} (RF-079).`, 'ok');
}

function cabecaSecao(titulo, liberado, secao, congelado, extra) {
  return `<header style="display:flex;align-items:center;gap:8px;">
    <span style="flex:1;">${titulo}</span>
    ${extra || ''}
    ${liberado ? '' : `<span class="chip" style="background:var(--line-2);color:var(--ink-3);"
      title="${esc(motivoBloqueio(secao, congelado))}">${congelado ? '🔒 somente leitura' : 'sem permissão'}</span>`}
  </header>`;
}

function secaoCambio(dados, congelado, perm) {
  const liberado = perm.cambio && !congelado;
  const moedas = Object.keys(dados.cambio || {}).filter((m) => m !== 'BRL');
  const porMoeda = E.insumosPorMoeda(dados);
  return `
  <div class="painel-secao">
    ${cabecaSecao('CÂMBIO · COTAÇÃO POR MOEDA (RF-052)', liberado, 'cambio', congelado)}
    <div class="conteudo">
      ${moedas.length ? moedas.map((m) => {
        const info = E.MOEDAS[m] || { nome: m, simbolo: m };
        const grupo = porMoeda.find((x) => x.moeda === m);
        const padrao = E.n((dados.cambioPadrao || {})[m]);
        const atual = E.n((dados.cambio || {})[m]);
        return `
        <div style="display:flex;align-items:center;gap:9px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11.5px;font-weight:500;">${esc(info.nome)} <span class="mono" style="color:var(--ink-3);">${esc(m)}</span></div>
            <div class="texto-mini">${grupo ? `${grupo.insumos.length} insumo(s) vinculado(s)` : 'sem insumos vinculados'}
              ${padrao ? ` · referência da carga ${num(padrao, 4)}` : ''}
              ${padrao && Math.abs(atual - padrao) > 1e-9 ? ' · <b style="color:var(--gold-d);">alterado no cenário</b>' : ''}</div>
          </div>
          <input class="inp-num" style="width:84px;" type="number" step="0.0001" min="0" value="${num(atual, 4).replace(/\./g, '').replace(',', '.')}"
            data-tipo="cambio" data-moeda="${esc(m)}" data-numerico="1"
            ${liberado ? '' : 'disabled'} title="${liberado ? `Cotação de ${esc(m)} neste cenário (RF-052)` : esc(motivoBloqueio('cambio', congelado))}">
        </div>`;
      }).join('') : '<div class="texto-mini">Nenhuma moeda estrangeira no cenário — sem exposição cambial direta.</div>'}
    </div>
  </div>`;
}

function secaoInsumos(dados, insumos, usadas, congelado, perm) {
  const liberado = perm.insumo && !congelado;
  return `
  <div class="painel-secao">
    ${cabecaSecao('CLASSIFICAÇÃO E CONTEÚDO DE IMPORTAÇÃO (RF-046 · RF-048 · RF-051)', liberado, 'insumo', congelado,
      `<span class="chip" style="background:var(--gold-soft);color:var(--gold-d);">${insumos.length} insumo(s)</span>`)}
    <div class="conteudo" style="max-height:330px;overflow-y:auto;">
      ${insumos.map((i) => {
        const cls = E.CLASSES[i.classSim] || E.CLASSES.nacional;
        const permiteCI = !!cls.permiteCI;
        const info = E.nodeInfo(i);
        const noFoco = usadas.has(i.id);
        return `
        <div style="border:1px solid ${noFoco ? '#e3cfa4' : 'var(--line-2)'};border-radius:8px;padding:8px 10px;${noFoco ? 'background:#fffdf8;' : ''}">
          <div style="display:flex;align-items:baseline;gap:7px;">
            <div style="flex:1;min-width:0;font-size:11.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
              title="${esc(i.nome)} · ${esc(i.codigo || i.id)}">${esc(i.nome)}</div>
            ${noFoco ? '<span class="chip" style="background:var(--gold-soft);color:var(--gold-d);" title="Insumo presente na estrutura do produto em foco">NO FOCO</span>' : ''}
            <span class="mono" style="font-size:9px;color:var(--ink-3);">${esc(i.grupo || '')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;">
            <select data-tipo="insumo" data-ref="${esc(i.id)}" data-campo="classSim" ${liberado ? '' : 'disabled'}
              style="flex:1;min-width:132px;border:1px solid ${cls.border || 'var(--line)'};border-radius:6px;padding:4px 6px;font-size:10.5px;background:${cls.bg};color:${cls.fg};font-weight:500;"
              title="${liberado ? esc(cls.desc) : esc(motivoBloqueio('insumo', congelado))}">
              ${Object.entries(E.CLASSES).map(([k, v]) => `<option value="${k}" ${i.classSim === k ? 'selected' : ''}>${esc(v.curto)}</option>`).join('')}
            </select>
            ${permiteCI ? `
              <select data-tipo="insumo" data-ref="${esc(i.id)}" data-campo="ciModo" ${liberado ? '' : 'disabled'}
                style="border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:10.5px;background:var(--panel);"
                title="${liberado ? 'Conteúdo informado em percentual ou por faixa legal (RF-048)' : esc(motivoBloqueio('insumo', congelado))}">
                <option value="pct" ${i.ciModo !== 'faixa' ? 'selected' : ''}>CI %</option>
                <option value="faixa" ${i.ciModo === 'faixa' ? 'selected' : ''}>por faixa</option>
              </select>
              ${i.ciModo === 'faixa' ? `
                <select data-tipo="insumo" data-ref="${esc(i.id)}" data-campo="ciFaixa" ${liberado ? '' : 'disabled'}
                  style="border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:10.5px;background:var(--panel);">
                  ${Object.values(E.FAIXAS).map((f) => `<option value="${f.id}" ${i.ciFaixa === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
                </select>`
              : `<div style="display:flex;align-items:center;gap:3px;">
                  <input class="inp-pct" type="number" step="1" min="0" max="100" value="${num(E.n(i.ciPct), 0)}"
                    data-tipo="insumo" data-ref="${esc(i.id)}" data-campo="ciPct" data-numerico="1" ${liberado ? '' : 'disabled'}
                    title="${liberado ? 'Conteúdo de importação adotado para este insumo (RF-051)' : esc(motivoBloqueio('insumo', congelado))}">
                  <span style="font-size:9.5px;color:var(--ink-3);">%CI</span>
                </div>`}`
            : `<span class="chip" style="background:${cls.bg};color:${cls.fg};"
                title="${esc(cls.desc)}">conteúdo ${esc(info.ciLabel)}</span>`}
            <span class="mono" style="font-size:9.5px;color:var(--ink-3);" title="Custo FCI do insumo (valor de entrada − ICMS − IPI · RN-03)">
              FCI ${brl(E.custoFCI(i, dados.cambio))}</span>
            <span class="chip" style="background:var(--line-2);color:var(--ink-3);"
              title="CST de origem sugerido pela classificação e faixa adotadas (RF-050)">CST ${esc(E.cstSugerido(i.classSim, i.ciFaixa, i.ciPct, i.ciModo))}</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function secaoPrecoEntrada(dados, insumos, usadas, congelado, perm) {
  const liberado = perm.insumo && !congelado;
  return `
  <div class="painel-secao">
    ${cabecaSecao('PREÇO DE ENTRADA (RF-058 · RF-059)', liberado, 'insumo', congelado)}
    <div class="conteudo" style="max-height:300px;overflow-y:auto;">
      <div class="texto-mini">Itens importados diretamente são valorados pelo valor aduaneiro (FOB na moeda do insumo
      mais frete, seguro e tributos de importação · RF-059); os demais pelo preço nacional de entrada (RF-058).</div>
      ${insumos.map((i) => {
        const cls = E.CLASSES[i.classSim] || E.CLASSES.nacional;
        const importado = !!cls.permiteCustoImp;
        const campo = importado ? 'fob' : 'precoNacional';
        const valor = E.n(importado ? i.fob : i.precoNacional);
        const padrao = E.n(importado ? i.fob : i.precoPadrao);
        const moeda = importado ? (i.moeda || 'BRL') : 'BRL';
        const noFoco = usadas.has(i.id);
        return `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${noFoco ? '<b style="color:var(--gold-d);">●</b> ' : ''}${esc(i.nome)}</div>
            <div class="texto-mini">${esc(cls.curto)}
              ${importado ? ` · valor aduaneiro ${brl(E.valorAduaneiro(i, dados.cambio))}` : (padrao ? ` · padrão ${brl(padrao)}` : '')}</div>
          </div>
          <input class="inp-num" style="width:86px;" type="number" step="0.0001" min="0" value="${num(valor, 4).replace(/\./g, '').replace(',', '.')}"
            data-tipo="insumo" data-ref="${esc(i.id)}" data-campo="${campo}" data-numerico="1" ${liberado ? '' : 'disabled'}
            title="${liberado ? (importado ? `FOB em ${esc(moeda)} — compõe o valor aduaneiro (RF-059)` : 'Valor total de entrada no mercado nacional (RF-058)') : esc(motivoBloqueio('insumo', congelado))}">
          <span class="mono" style="font-size:9px;color:var(--ink-3);width:26px;">${esc(moeda)}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function secaoSaidas(prod, congelado, perm) {
  const liberado = perm.preco && !congelado;
  const saidas = (prod && prod.saidas) || [];
  const pm = prod ? E.precoMedio(prod) : 0;
  const pesos = prod ? E.pesosUF(prod) : [];
  return `
  <div class="painel-secao">
    ${cabecaSecao('PREÇO DE SAÍDA POR UF (RF-066 · RF-070)', liberado, 'preco', congelado,
      `<span class="chip" style="background:var(--gold-soft);color:var(--gold-d);">${esc(prod ? (prod.sku || prod.nome) : 'sem produto em foco')}</span>`)}
    <div class="conteudo" style="max-height:290px;overflow-y:auto;">
      ${!prod ? '<div class="texto-mini">Coloque um produto em foco na matriz para editar as saídas interestaduais daquele produto.</div>' : `
      <div class="texto-mini">Denominador vigente do produto: média ponderada global das saídas —
        <b class="mono" style="color:var(--ink-2);">${brl(pm)}</b>. O resultado oficial não é segmentado por UF (RF-069).</div>
      ${saidas.length ? saidas.map((s) => {
        const peso = pesos.find((p) => p.uf === s.uf);
        return `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:34px;font-weight:600;font-size:11.5px;" class="mono">${esc(s.uf)}</div>
          <div style="flex:1;min-width:0;" class="texto-mini">
            peso ${peso ? pct(peso.pesoVolume) : '—'} do volume
            ${E.n(s.precoPadrao) && Math.abs(E.n(s.preco) - E.n(s.precoPadrao)) > 1e-9 ? ' · <b style="color:var(--gold-d);">preço alterado</b>' : ''}
          </div>
          <span class="mono" style="font-size:10.5px;color:var(--ink-3);width:74px;text-align:right;"
            title="Volume de saída para ${esc(s.uf)}. Volumes e destinos são mantidos na simulação do cenário (RF-066 · RF-067).">${num(E.n(s.volume), 0)}</span>
          <input class="inp-num" style="width:82px;" type="number" step="0.0001" min="0" value="${num(E.n(s.preco), 4).replace(/\./g, '').replace(',', '.')}"
            data-tipo="preco" data-prod-id="${esc(prod.id)}" data-uf="${esc(s.uf)}" data-numerico="1" ${liberado ? '' : 'disabled'}
            title="${liberado ? `Preço de saída para ${esc(s.uf)} — recalcula o denominador do produto (RF-066 · RF-068)` : esc(motivoBloqueio('preco', congelado))}">
        </div>`;
      }).join('') : '<div class="texto-mini">Produto sem saídas interestaduais carregadas — o CI% recai sobre o custo total (RF-060).</div>'}`}
    </div>
  </div>`;
}

/** Posições com substituição ativa no produto em foco e nos seus intermediários. */
function posicoesComMix(dados, prodId, vistos) {
  const visitados = vistos || new Set();
  const saida = [];
  if (!prodId || visitados.has(prodId)) return saida;
  visitados.add(prodId);
  const prod = (dados.produtos || []).find((p) => p.id === prodId);
  if (!prod) return saida;
  (prod.componentes || []).forEach((c, idx) => {
    if (E.temSubstituicao(c)) saida.push({ prod, c, idx });
  });
  for (const c of prod.componentes || []) {
    const refs = (c.mix && c.mix.length) ? c.mix.map((x) => x.ref) : [c.ref];
    for (const r of refs) {
      for (const sub of posicoesComMix(dados, r, visitados)) saida.push(sub);
    }
  }
  return saida;
}

function secaoProporcoes(dados, prod, congelado, perm) {
  const liberado = perm.proporcao && !congelado;
  const comMix = posicoesComMix(dados, prod ? prod.id : null);
  return `
  <div class="painel-secao">
    ${cabecaSecao('PROPORÇÕES DE SUBSTITUIÇÃO (RF-017 · RF-019 · RF-023)', liberado, 'proporcao', congelado)}
    <div class="conteudo" style="max-height:290px;overflow-y:auto;">
      ${!prod ? '<div class="texto-mini">Coloque um produto em foco na matriz para ajustar as proporções daquele produto.</div>'
        : (comMix.length ? comMix.map(({ prod: dono, c, idx }) => `
        <div style="border:1px solid var(--line-2);border-radius:8px;padding:8px 10px;">
          <div style="font-size:11px;font-weight:600;">Posição ${idx + 1} · ${esc(E.nomeDe(dados, c.ref))}</div>
          <div class="texto-mini">Em <b style="color:var(--ink-2);">${esc(dono.nome)}</b>${dono.id === (prod && prod.id) ? ' (produto em foco)' : ` (${esc(dono.tipo || 'PI')} da cascata)`}
            · quantidade da receita ${num(E.n(c.qtd), 3)} ${esc(E.unidadeDe(dados, c.ref) || '')}</div>
          ${(c.mix || []).map((m, mi) => `
          <div style="display:flex;align-items:center;gap:7px;margin-top:6px;">
            <span class="tag-alt ${mi === 0 ? 'original' : 'substituto'}${E.n(m.pct) === 0 ? ' zero' : ''}"
              title="${mi === 0 ? 'Item original da receita — permanece listado mesmo com proporção zero (RF-019)' : 'Item substituto'}">
              ${mi === 0 ? 'ORIGINAL' : 'SUBSTITUTO'}</span>
            <div style="flex:1;min-width:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(E.nomeDe(dados, m.ref))}</div>
            <input class="inp-pct" type="number" step="1" min="0" max="100" value="${num(E.n(m.pct), 0)}"
              data-tipo="proporcao" data-prod-id="${esc(dono.id)}" data-idx="${idx}" data-mi="${mi}" data-numerico="1"
              ${liberado ? '' : 'disabled'}
              title="${liberado ? 'Proporção desta alternativa na posição (as proporções da posição devem somar 100% · RF-023)' : esc(motivoBloqueio('proporcao', congelado))}">
            <span style="font-size:9.5px;color:var(--ink-3);">%</span>
          </div>`).join('')}
          <div class="texto-mini" style="margin-top:6px;">
            Soma atual: <b class="mono" style="color:${Math.abs((c.mix || []).reduce((a, m) => a + E.n(m.pct), 0) - 100) < 0.01 ? 'var(--ok-fg)' : 'var(--err-fg)'};">
            ${num((c.mix || []).reduce((a, m) => a + E.n(m.pct), 0), 1)}%</b> — proporções fora de 100% são apontadas na validação (RF-023 · RF-029).
          </div>
        </div>`).join('')
        : '<div class="texto-mini">Nenhuma substituição ativa no produto em foco nem nos seus intermediários, neste cenário. Aplique substituições na tela de simulação (RF-015 a RF-018).</div>')}
    </div>
  </div>`;
}

/* ======================================================================== *
 * 6 · ANÁLISE ASSISTIDA (RF-080 · RF-081 · RF-082)
 * ======================================================================== */

async function carregarHistorico(ctx) {
  const contexto = contextoAnalise();
  if (!contexto) { estado.mensagens = []; return; }
  try {
    const r = await ctx.api.get(`/analise/historico?contexto=${encodeURIComponent(contexto)}`);
    estado.mensagens = normalizarMensagens(r);
  } catch (err) {
    estado.mensagens = [];
    ctx.toast(`Histórico da análise: ${err.message}`, 'erro');
  }
}

async function enviarAnalise(ctx, { analise, pergunta }) {
  if (!vista.selecao.length) {
    ctx.toast('Selecione ao menos um cenário para que a análise seja produzida sobre dados reais da simulação (RF-080).', 'erro');
    return;
  }
  if (estado.pendente) return;
  if (!estado.mensagens) estado.mensagens = [];

  const daLista = (vista.padrao || []).find((a) => a.id === analise);
  const texto = (pergunta || '').trim() || (daLista ? daLista.titulo : 'Análise do contexto selecionado');

  estado.pendente = true;
  estado.rascunho = '';
  estado.mensagens.push({ papel: 'usuario', texto, em: new Date().toISOString() });
  pintar(ctx);

  try {
    const r = await ctx.api.post('/analise', {
      cenarioIds: vista.selecao,
      prodId: estado.prodFoco || undefined,
      analise: analise || undefined,
      pergunta: (pergunta || '').trim() || undefined,
      base: estado.base || undefined,
    });
    // a resposta já devolve a conversa gravada do recorte (RF-080)
    if (r && Array.isArray(r.historico) && r.historico.length) {
      estado.mensagens = normalizarMensagens({ mensagens: r.historico });
    } else {
      estado.mensagens.push(mensagemAssistente((r && r.resposta) || r || {}, new Date().toISOString()));
    }
  } catch (err) {
    estado.mensagens.pop();
    ctx.toast(err.message, 'erro');
  }
  estado.pendente = false;
  pintar(ctx);
}

async function limparConversa(ctx) {
  const contexto = contextoAnalise();
  if (!contexto) return;
  try {
    const r = await ctx.api.del(`/analise/historico?contexto=${encodeURIComponent(contexto)}`);
    estado.mensagens = [];
    ctx.toast((r && r.mensagem) || 'Conversa de análise removida.', 'ok');
  } catch (err) {
    ctx.toast(err.message, 'erro');
  }
  pintar(ctx);
}

function htmlBlocos(blocos) {
  return (blocos || []).map((b) => {
    if (!b) return '';
    if (b.tipo === 'lista') {
      return `<ul>${(b.itens || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    }
    if (b.tipo === 'tabela') {
      return `<table>
        <thead><tr>${(b.colunas || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${(b.linhas || []).map((l) => `<tr>${(l || []).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
    }
    return `<p style="margin:6px 0;">${esc(b.texto || '')}</p>`;
  }).join('');
}

function htmlMensagem(m) {
  if (m.papel === 'usuario') {
    return `<div class="chat-msg usuario" title="${esc(m.em ? dataHora(m.em) : '')}">${esc(m.texto)}</div>`;
  }
  return `
  <div class="chat-msg assistente">
    ${m.titulo ? `<h4>${esc(m.titulo)}</h4>` : ''}
    ${htmlBlocos(m.blocos)}
    ${(m.citacoes || []).length ? `<div class="texto-mini" style="margin-top:7px;">
      Dados citados: ${m.citacoes.slice(0, 8).map((c) => `<span class="chip" style="background:var(--panel-2);color:var(--ink-2);"
        title="Origem: ${esc(c.tipo || '')}">${esc(c.chave)} ${esc(c.valor)}</span>`).join(' ')}
    </div>` : ''}
    <div class="ressalva">${esc(m.ressalva || E.RESSALVA_GERENCIAL)}</div>
  </div>`;
}

function htmlChat() {
  const cens = cenariosDaMatriz();
  const l = linhaFoco();
  const msgs = estado.mensagens || [];
  const padrao = vista.padrao || [];

  return `
  <div style="display:grid;grid-template-columns:1fr 330px;gap:14px;align-items:start;">
    <div class="card" style="overflow:hidden;height:calc(100vh - 280px);min-height:460px;">
      <div class="chat">
        <div class="chat-hist" id="chat-hist">
          ${!msgs.length ? `
          <div class="chat-msg assistente">
            <h4>Análise assistida sobre os cenários selecionados</h4>
            <p style="margin:6px 0;">Escolha uma das sete análises padrão abaixo ou faça uma pergunta livre.
            As respostas são produzidas sobre os dados dos cenários em comparação
            ${cens.length ? `(${cens.map((c) => esc(c.codigo)).join(', ')})` : '(nenhum cenário selecionado)'}
            ${l ? `, com o produto «${esc(l.nome)}» em foco` : ''}.</p>
            <div class="ressalva">${esc(E.RESSALVA_GERENCIAL)}</div>
          </div>` : msgs.map(htmlMensagem).join('')}
          ${estado.pendente ? `<div class="chat-msg assistente"><div class="carregando" style="padding:4px 0;">Analisando o contexto selecionado</div></div>` : ''}
        </div>

        <div class="chat-sugestoes">
          ${padrao.map((a) => `<button class="chat-sugestao" data-analise="${esc(a.id)}"
            title="${esc(a.descricao || a.titulo)}" ${estado.pendente ? 'disabled' : ''}>${esc(a.titulo)}</button>`).join('')}
        </div>

        <form class="chat-entrada" id="form-pergunta">
          <input id="inp-pergunta" type="text" autocomplete="off" value="${esc(estado.rascunho)}"
            placeholder="Pergunte sobre os cenários em comparação — ex.: por que o CI% do IPA sobe no cenário B?"
            ${estado.pendente ? 'disabled' : ''}>
          <button class="btn btn-ouro" type="submit" ${estado.pendente || !vista.selecao.length ? 'disabled' : ''}
            title="${vista.selecao.length ? 'Enviar a pergunta sobre o contexto selecionado (RF-080)' : 'Selecione ao menos um cenário para analisar'}">Analisar</button>
        </form>
      </div>
    </div>

    <div class="pilha">
      <div class="card card-pad">
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.5px;">CONTEXTO DA ANÁLISE</div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:7px;">
          <div class="texto-mini">Cenários: ${cens.length
            ? cens.map((c) => `<b style="color:var(--ink-2);">${esc(c.codigo)}</b>`).join(', ')
            : '<b style="color:var(--err-fg);">nenhum selecionado</b>'}</div>
          <label class="campo">
            <span>PRODUTO EM FOCO</span>
            <select id="sel-prod-analise" title="Produto considerado nas análises de impacto, caminho e sensibilidade">
              ${(matrizAtual() ? matrizAtual().linhas : []).map((x) => `<option value="${esc(x.prodId)}" ${x.prodId === estado.prodFoco ? 'selected' : ''}>
                ${esc(x.sku || x.prodId)} · ${esc(x.nome)}</option>`).join('')}
            </select>
          </label>
          <div class="texto-mini">Base: <b style="color:var(--ink-2);">${estado.base === 'custo' ? 'custo total'
            : (estado.base === 'saida' ? 'saídas interestaduais' : 'base vigente de cada cenário')}</b></div>
          <div class="texto-mini" title="A conversa é guardada por recorte de cenários: a mesma seleção recupera sempre o mesmo histórico (RF-080)">
            Conversa do recorte <b class="mono" style="color:var(--ink-2);">${esc(contextoAnalise() || '—')}</b>
            · ${msgs.length} mensagem(ns)</div>
        </div>
        <div class="sep" style="margin:11px 0;"></div>
        <button class="btn btn-borda btn-mini" id="btn-limpar-conversa" ${msgs.length ? '' : 'disabled'}
          title="${msgs.length ? 'Remove todo o histórico desta conversa de análise' : 'Não há conversa registrada para limpar'}">Limpar conversa</button>
      </div>

      <div class="card card-pad">
        <div style="font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.5px;">ANÁLISES PADRÃO (RF-081)</div>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:7px;">
          ${padrao.map((a) => `<div class="texto-mini"><b style="color:var(--ink-2);">${esc(a.titulo)}</b><br>${esc(a.descricao || '')}</div>`).join('')}
        </div>
      </div>

      <div class="aviso-restricao" style="margin-bottom:0;">
        <b>Caráter gerencial.</b> ${esc(E.RESSALVA_GERENCIAL)}
      </div>
    </div>
  </div>`;
}

/* ======================================================================== *
 * RENDERIZAÇÃO E EVENTOS
 * ======================================================================== */

function pintar(ctx) {
  if (!raiz) return;
  const m = matrizAtual();
  const nCen = m ? m.cenarios.length : 0;

  raiz.innerHTML = `
  <div class="pagina" style="max-width:1500px;">
    ${htmlFaixaSelecao()}

    <div class="sim-abas" style="margin-bottom:14px;border-bottom:1px solid var(--line);">
      <button class="sim-aba ${estado.aba === 'matriz' ? 'ativa' : ''}" data-aba="matriz">
        Matriz, detalhamento e gráfico</button>
      <button class="sim-aba ${estado.aba === 'analise' ? 'ativa' : ''}" data-aba="analise">
        Análise assistida</button>
      <div style="flex:1;"></div>
      <div style="display:flex;align-items:center;gap:9px;padding-bottom:6px;" class="texto-mini">
        ${nCen} cenário(s) em comparação · perfil <b style="color:var(--ink-2);">${esc((ctx.usuario && ctx.usuario.perfil) || '')}</b>
      </div>
    </div>

    ${estado.aba === 'matriz' ? `
      ${htmlMatriz()}
      ${m && m.linhas.length ? `<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px;align-items:start;">
        ${htmlDrill()}
        ${htmlGrafico()}
      </div>` : ''}
    ` : htmlChat()}
  </div>`;

  ligarEventos(ctx);
}

function ligarEventos(ctx) {
  // abas
  raiz.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', async () => {
    estado.aba = b.dataset.aba;
    if (estado.aba === 'analise' && estado.mensagens === null) {
      pintar(ctx);
      await carregarHistorico(ctx);
    }
    pintar(ctx);
  }));

  // 1 · seleção de cenários (RF-073)
  raiz.querySelectorAll('[data-cen-chip]').forEach((b) => b.addEventListener('click', () => {
    alternarCenario(ctx, idCen(b.dataset.cenChip));
  }));

  raiz.querySelector('#sel-base')?.addEventListener('change', async (e) => {
    estado.base = e.target.value;
    try {
      await recarregarMatriz(ctx);
      await carregarFoco(ctx);
      pintar(ctx);
      ctx.toast(`Base de cálculo da comparação: ${estado.base === 'custo' ? 'custo total'
        : (estado.base === 'saida' ? 'saídas interestaduais' : 'base vigente de cada cenário')} (RF-060).`, 'ok');
    } catch (err) { ctx.toast(err.message, 'erro'); }
  });

  // 2 · matriz — célula coloca produto e cenário em foco; cabeçalho abre o painel
  raiz.querySelectorAll('[data-cel-prod]').forEach((c) => c.addEventListener('click', () => {
    const prodId = c.dataset.celProd;
    const cenarioId = idCen(c.dataset.celCen);
    if (!cenarioId) { trocarFoco(ctx, { prodId }); return; }
    trocarFoco(ctx, { prodId, cenarioId });
  }));
  raiz.querySelectorAll('[data-linha-prod] .cel-prod').forEach((td) => td.addEventListener('click', () => {
    trocarFoco(ctx, { prodId: td.parentElement.dataset.linhaProd });
  }));
  raiz.querySelectorAll('[data-col-cen]').forEach((th) => th.addEventListener('click', () => {
    abrirPainelCenario(ctx, idCen(th.dataset.colCen));   // RF-078
  }));

  // 3 · drill-down — expansão apenas em itens com nível inferior (RF-075)
  raiz.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => {
    const chave = b.dataset.exp;
    const box = raiz.querySelector(`[data-filhos="${chave}"]`);
    if (!box) return;
    if (estado.abertos.has(chave)) { estado.abertos.delete(chave); box.hidden = true; b.textContent = '+'; b.title = 'Abrir a estrutura do intermediário'; }
    else { estado.abertos.add(chave); box.hidden = false; b.textContent = '−'; b.title = 'Recolher a estrutura do intermediário'; }
  }));

  raiz.querySelector('#sel-prod-foco')?.addEventListener('change', (e) => trocarFoco(ctx, { prodId: e.target.value }));
  raiz.querySelector('#sel-cen-foco')?.addEventListener('change', (e) => trocarFoco(ctx, { cenarioId: idCen(e.target.value) }));
  raiz.querySelector('#btn-abrir-sim')?.addEventListener('click', () => {
    if (!estado.cenarioFoco) { ctx.toast('Selecione um cenário na comparação.', 'erro'); return; }
    ctx.navegar(`#/sim/${estado.cenarioFoco}`);
  });

  // 6 · análise assistida
  raiz.querySelector('#sel-prod-analise')?.addEventListener('change', (e) => trocarFoco(ctx, { prodId: e.target.value }));
  raiz.querySelectorAll('[data-analise]').forEach((b) => b.addEventListener('click', () => {
    enviarAnalise(ctx, { analise: b.dataset.analise, pergunta: '' });
  }));
  raiz.querySelector('#inp-pergunta')?.addEventListener('input', (e) => { estado.rascunho = e.target.value; });
  raiz.querySelector('#form-pergunta')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = (estado.rascunho || '').trim();
    if (!txt) { ctx.toast('Escreva a pergunta ou escolha uma das análises padrão (RF-081).', 'erro'); return; }
    enviarAnalise(ctx, { analise: null, pergunta: txt });
  });
  raiz.querySelector('#btn-limpar-conversa')?.addEventListener('click', () => limparConversa(ctx));

  const hist = raiz.querySelector('#chat-hist');
  if (hist) hist.scrollTop = hist.scrollHeight;
  const inp = raiz.querySelector('#inp-pergunta');
  if (inp && estado.aba === 'analise' && !estado.pendente) {
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}
