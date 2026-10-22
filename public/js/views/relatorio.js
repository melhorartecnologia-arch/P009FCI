/**
 * Relatório executivo do cenário (RF-087 · RF-088 · RF-089 · RF-009).
 *
 *   RF-087  identificação completa do cenário, premissas e indicadores
 *   RF-088  direcionamentos para decisão em blocos distintos por área
 *   RF-089  exportação em PDF com cabeçalho/rodapé de identificação
 *   RF-086  alertas com a área responsável pelo tratamento
 *   RF-009  registro manual de direcionamento à área responsável
 *   RF-060  emissão sobre a base alternativa (custo) sem alterar o cenário
 *
 * O payload vem pronto do servidor (motor único — RNF-10): a tela não recalcula
 * CI%, apenas apresenta e permite registrar/remover direcionamentos manuais.
 */
import { esc, num, pct, brl, dataHora } from '../format.js';
import { tokenAtual } from '../api.js';
import { AREAS_TRATAMENTO } from '/shared/engine.mjs';

const COR_AREA = {
  'Compras': '#3d4c7a',
  'Pricing': '#8a5e12',
  'Fiscal/Tributário': '#a03d2c',
  'Controladoria': '#2f6b46',
  'Industrial/PCP': '#5b5048',
};
const corDaArea = (a) => COR_AREA[a] || '#5b5048';
const pp = (v) => (v > 0 ? '+' : '') + num(v, 1) + ' p.p.';

export async function telaRelatorio(el, ctx, params) {
  const id = params[0];
  if (!id) { ctx.navegar('#/cenarios'); return; }

  const R = {
    id,
    base: '',
    pacote: null,
    cenarios: [],      // RF-087 — seletor de cenário do topo

    async carregar() {
      const q = R.base ? `?base=${encodeURIComponent(R.base)}` : '';
      R.pacote = await ctx.api.get(`/cenarios/${id}/relatorio${q}`);
      R.base = R.pacote.base;
    },
    render() { desenhar(R, el, ctx); },
  };

  // RF-087 — o seletor do topo permite trocar o cenário sem voltar à lista;
  // a falha na leitura da lista não impede a emissão do cenário corrente.
  try {
    const rc = await ctx.api.get('/cenarios');
    R.cenarios = rc.cenarios || [];
  } catch {
    R.cenarios = [];
  }

  await R.carregar();
  R.render();
}

/* ------------------------------------------------------------------ desenho */

function desenhar(R, el, ctx) {
  const p = R.pacote;
  const rel = p.relatorio;
  const c = p.cenario;
  const ind = rel.indicadores;
  const cab = rel.cabecalho;
  const podeRegistrar = ctx.pode('consolidar');
  // os blocos por área vêm sempre presentes no payload; a tela mostra os preenchidos
  const comItens = rel.direcionamentos.filter((b) => (b.itens || []).length);

  ctx.definirTopo(
    'Relatório executivo',
    `RF-087 · RF-088 · RF-089 — ${esc(c.codigo)} v${c.versao} · emitido por ${esc(rel.emissao.por)} em ${esc(rel.emissao.emBr)}`,
    `<span class="chip" style="background:var(--panel-2);color:var(--ink-2);border:1px solid var(--line);">${esc(rel.rotulos.status)}</span>`
  );
  ctx.definirAlertas(ind.nAlertas);

  el.innerHTML = `
  <div class="pagina" style="max-width:1320px;">

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <button class="btn btn-borda" id="r-voltar">← Simulação</button>
      <div class="campo" style="min-width:320px;margin:0;">
        <span>CENÁRIO DO RELATÓRIO (RF-087)</span>
        <select id="r-cenario" title="Troque o cenário sem voltar à lista — o relatório é reemitido na hora.">
          ${(R.cenarios && R.cenarios.length
              ? R.cenarios
              : [{ id: R.id, codigo: c.codigo, nome: c.nome, versao: c.versao }])
            .map((x) => `<option value="${esc(String(x.id))}" ${String(x.id) === String(R.id) ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nome)} · v${esc(String(x.versao))}</option>`).join('')}
        </select>
      </div>
      <div class="campo" style="min-width:330px;margin:0;">
        <span>BASE DO DENOMINADOR PARA ESTA EMISSÃO (RF-060)</span>
        <select id="r-base">
          <option value="saida" ${R.base === 'saida' ? 'selected' : ''}>Média ponderada global das saídas interestaduais (RN-02)</option>
          <option value="custo" ${R.base === 'custo' ? 'selected' : ''}>Custo total da mercadoria (alternativa)</option>
        </select>
      </div>
      <div style="flex:1;"></div>
      <button class="btn btn-ouro" id="r-pdf" ${podeOuAviso(ctx, 'relatorio')}>⤓ Exportar PDF (RF-089)</button>
    </div>

    <!-- RF-087 · identificação ------------------------------------------- -->
    <div class="rel-bloco">
      <header>
        <h3>Identificação do cenário e das premissas</h3>
        <span style="font-size:11px;color:var(--ink-3);">Fórmula ${esc(cab.versaoFormula)} · modo ${esc(cab.modo === 'avancado' ? 'avançado' : 'padrão')}</span>
      </header>
      <div class="rel-ident">
        ${ident('CENÁRIO', `${esc(c.nome)}`)}
        ${ident('IDENTIFICADOR · VERSÃO', `<span class="mono">${esc(c.codigo)}</span> · v${c.versao}`)}
        ${ident('TIPO · CICLO', `${esc(rel.rotulos.tipo)} ${esc(c.ciclo || '')}`)}
        ${ident('SITUAÇÃO', esc(rel.rotulos.status))}
        ${ident('AUTOR', esc(c.autor))}
        ${ident('CRIADO EM', dataHora(c.criadoEm))}
        ${ident('ÚLTIMA ALTERAÇÃO', dataHora(c.atualizadoEm))}
        ${ident('CONGELADO EM', c.congeladoEm ? dataHora(c.congeladoEm) : '—')}
        ${ident('CONSOLIDADO EM', c.consolidadoEm ? dataHora(c.consolidadoEm) : '—')}
        ${ident('BASE DO DENOMINADOR', esc(cab.baseCalculoLabel))}
        ${ident('GATILHO DE REEMISSÃO', `${num(cab.gatilhoReemissao, 1)} p.p.`)}
        ${ident('ORIGEM DOS DADOS', esc(c.origemDados || 'carga integrada'))}
        ${ident('CÂMBIO DO CENÁRIO', moedasHtml(cab.cambio, cab.cambioPadrao))}
        ${ident('EMITIDO POR', `${esc(rel.emissao.por)} · ${esc(rel.emissao.area)}`)}
      </div>
    </div>

    <!-- RF-087 · indicadores --------------------------------------------- -->
    <div class="grid-kpi">
      <div class="kpi"><div class="rotulo">CI% MÉDIO PONDERADO</div>
        <div class="valor" style="color:${ind.ciMedio > 40 ? 'var(--err)' : 'var(--ok-fg)'};">${pct(ind.ciMedio)}</div>
        <div class="hint">${ind.nProdutos} produto(s) acabado(s)</div></div>
      <div class="kpi"><div class="rotulo">PRODUTOS ACIMA DE 40%</div>
        <div class="valor" style="color:${ind.acima40 ? 'var(--err)' : 'var(--ink)'};">${ind.acima40}</div>
        <div class="hint">alíquota interestadual de 4% (RN-07)</div></div>
      <div class="kpi"><div class="rotulo">REEMISSÃO DE FCI EXIGIDA</div>
        <div class="valor" style="color:${ind.nReemissao ? 'var(--err)' : 'var(--ink)'};">${ind.nReemissao}</div>
        <div class="hint">variação acima de ${num(cab.gatilhoReemissao, 1)} p.p. (RN-08)</div></div>
      <div class="kpi"><div class="rotulo">DIAGNÓSTICO DA ESTRUTURA</div>
        <div class="valor" style="color:${ind.nErros ? 'var(--err)' : 'var(--ok-fg)'};">${ind.nErros} / ${ind.nAvisos}</div>
        <div class="hint">erros / avisos abertos (RF-033)</div></div>
    </div>

    <!-- distribuição por faixa ------------------------------------------- -->
    <div class="rel-bloco">
      <header><h3>Distribuição por faixa de enquadramento (RN-06)</h3></header>
      <div style="padding:16px;">
        <div class="grafico">
          ${faixaCol('100% nacional · CI% = 0', ind.dist.nacional || 0, ind.nProdutos, '#a9c9b5')}
          ${faixaCol('Até 40% · nacional c/ CI', ind.dist.baixo, ind.nProdutos, '#3f7d54')}
          ${faixaCol('40% a 70% · CI > 40%', ind.dist.medio, ind.nProdutos, '#b07d1e')}
          ${faixaCol('Acima de 70% · equiparado a importado', ind.dist.alto, ind.nProdutos, '#a03d2c')}
        </div>
      </div>
    </div>

    <!-- resultado por produto -------------------------------------------- -->
    <div class="rel-bloco">
      <header><h3>Resultado por produto acabado</h3>
        <span style="font-size:11px;color:var(--ink-3);">CI% = parcela importada ÷ denominador × 100 (RN-01)</span></header>
      <div style="overflow-x:auto;">
        <table class="tabela">
          <thead><tr>
            <th>PRODUTO</th><th class="num">CI%</th><th>ENQUADRAMENTO</th>
            <th class="num">ALÍQ.</th><th class="num">FCI VIGENTE</th><th class="num">VARIAÇÃO</th>
            <th class="num">PARCELA IMPORTADA</th><th class="num">DENOMINADOR</th>
            <th class="num">ICMS-ST RESULT.</th><th>MAIORES CONTRIBUIÇÕES</th>
            <th>FCI OBRIGATÓRIA</th><th>REEMISSÃO EXIGIDA</th>
          </tr></thead>
          <tbody>${rel.produtos.map(linhaProduto).join('')}</tbody>
        </table>
      </div>
      <div style="padding:10px 16px;font-size:10.5px;color:var(--ink-3);border-top:1px solid var(--line-2);">
        Denominador conforme a base vigente desta emissão: <b>${esc(cab.baseCalculoLabel)}</b>.
        Custo FCI = valor total de entrada − ICMS − IPI; PIS e COFINS não são dedutíveis (RN-03).
      </div>
    </div>

    <!-- RF-086 · alertas com área responsável ---------------------------- -->
    <div class="rel-bloco">
      <header><h3>Alertas do cenário e área responsável pelo tratamento (RF-083 a RF-086)</h3>
        <span style="font-size:11px;color:var(--ink-3);">${rel.alertas.length} alerta(s)</span></header>
      ${rel.alertas.length ? rel.alertas.map(linhaAlerta).join('') : `
        <div style="padding:16px;font-size:12px;color:var(--ink-3);">
          Nenhum alerta: todos os produtos permanecem na faixa da ficha vigente, com variação
          inferior ao gatilho de ${num(cab.gatilhoReemissao, 1)} p.p. e CI% abaixo de 40%.
        </div>`}
    </div>

    <!-- RF-088 · direcionamentos por área -------------------------------- -->
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 12px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0;font-size:15px;font-weight:600;">Direcionamentos para decisão</h2>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;">
          RF-088 — blocos distintos por área, derivados do resultado e dos alertas, somados aos
          direcionamentos registrados manualmente (RF-009).
        </div>
      </div>
      <button class="btn btn-escuro" id="r-dir-novo" ${podeOuAviso(ctx, 'consolidar')}>＋ Registrar direcionamento</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(372px,1fr));gap:14px;">
      ${comItens.length ? comItens.map((b) => blocoArea(b, podeRegistrar)).join('') : `
        <div class="roadmap-box"><div class="titulo">Nenhum direcionamento</div>
          O cenário não apresenta desvios que exijam encaminhamento às áreas.</div>`}
    </div>

    <!-- RF-089 · histórico de emissões ----------------------------------- -->
    <div class="rel-bloco" style="margin-top:20px;">
      <header><h3>Histórico de emissões deste relatório (RF-089 · RNF-04)</h3></header>
      ${p.emissoes.length ? `<div style="overflow-x:auto;"><table class="tabela">
        <thead><tr><th>EMITIDO EM</th><th>VERSÃO</th><th>FORMATO</th><th>ARQUIVO</th></tr></thead>
        <tbody>${p.emissoes.map((e) => `<tr>
          <td>${dataHora(e.gerado_em)}</td><td class="mono">v${e.versao}</td>
          <td>${esc(String(e.formato).toUpperCase())}</td>
          <td class="mono" style="font-size:10.5px;">${esc(e.gerado_nome || '—')}</td></tr>`).join('')}
        </tbody></table></div>` : `
        <div style="padding:16px;font-size:12px;color:var(--ink-3);">
          Nenhuma exportação registrada. A consulta em tela não gera registro; apenas a exportação em
          PDF é gravada no histórico.
        </div>`}
    </div>

    <div class="aviso-restricao" style="margin-top:18px;">
      <b>⚠ Ressalva de uso gerencial.</b> ${esc(rel.ressalva)}
    </div>
  </div>`;

  /* ----------------------------------------------------------- interação */

  el.querySelector('#r-voltar').onclick = () => ctx.navegar(`#/sim/${R.id}`);

  // RF-087 — troca de cenário sem navegação adicional
  const selCen = el.querySelector('#r-cenario');
  if (selCen) selCen.onchange = (e) => {
    if (String(e.target.value) === String(R.id)) return;
    ctx.navegar(`#/relatorio/${e.target.value}`);
  };

  el.querySelector('#r-base').onchange = async (e) => {
    R.base = e.target.value;
    try { await R.carregar(); R.render(); }
    catch (err) { ctx.toast(err.message, 'erro'); }
  };

  const btnPdf = el.querySelector('#r-pdf');
  if (btnPdf && !btnPdf.disabled) btnPdf.onclick = () => baixarPdf(R, ctx, btnPdf);

  const btnDir = el.querySelector('#r-dir-novo');
  if (btnDir && !btnDir.disabled) btnDir.onclick = () => modalDirecionamento(R, ctx);

  el.querySelectorAll('[data-remover-dir]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await ctx.api.del(`/cenarios/${R.id}/gov/direcionamentos/${b.dataset.removerDir}`);
        ctx.toast('Direcionamento manual removido.', 'ok');
        await R.carregar(); R.render();
      } catch (err) { ctx.toast(err.message, 'erro'); b.disabled = false; }
    };
  });
}

/* ------------------------------------------------------------- fragmentos */

const ident = (rot, val) => `<div class="campo-ident"><div class="rot">${rot}</div><div class="val">${val}</div></div>`;

function podeOuAviso(ctx, acao) {
  return ctx.pode(acao) ? '' : 'disabled title="Ação não habilitada para o seu perfil (RF-035) — a consulta permanece liberada"';
}

function moedasHtml(cambio, padrao) {
  const chaves = Object.keys(cambio || {});
  if (!chaves.length) return '—';
  return chaves.map((m) => {
    const atual = Number(cambio[m]) || 0;
    const ref = padrao && padrao[m] != null ? Number(padrao[m]) : null;
    const dif = ref != null && ref !== 0 ? (atual / ref - 1) * 100 : null;
    const marca = dif != null && Math.abs(dif) > 0.01
      ? ` <span style="color:${dif > 0 ? 'var(--err-fg)' : 'var(--ok-fg)'};">(${dif > 0 ? '+' : ''}${num(dif, 1)}% vs carga)</span>` : '';
    return `<span class="mono" style="font-size:11.5px;">${esc(m)} ${num(atual, 4)}</span>${marca}`;
  }).join('<br>');
}

function faixaCol(rotulo, valor, total, cor) {
  const alt = total > 0 ? Math.max(3, (valor / total) * 100) : 3;
  return `<div class="grafico-col">
    <div class="grafico-val" style="color:${cor};">${valor}</div>
    <div class="grafico-barra" style="height:${alt}%;background:${cor};"></div>
    <div class="grafico-rot">${rotulo}</div>
  </div>`;
}

function linhaProduto(p) {
  const corCi = p.ci > 70 ? '#a03d2c' : p.ci > 40 ? '#b07d1e' : '#2f6b46';
  const corDelta = Math.abs(p.deltaVigente) > 0.05
    ? (p.exigeReemissao ? 'var(--err-fg)' : 'var(--warn-fg)') : 'var(--ink-3)';
  return `<tr>
    <td><b>${esc(p.nome)}</b><div class="mono" style="font-size:10px;color:var(--ink-3);">${esc(p.sku)}</div></td>
    <td class="num"><b style="color:${corCi};">${pct(p.ci)}</b></td>
    <td style="font-size:11px;">${esc(p.enquadramento)}</td>
    <td class="num mono">${num(p.aliquota, 0)}%</td>
    <td class="num mono">${pct(p.fciVigente)}</td>
    <td class="num mono" style="color:${corDelta};font-weight:600;">${pp(p.deltaVigente)}</td>
    <td class="num mono">${brl(p.parcela)}</td>
    <td class="num mono">${brl(p.denominador)}</td>
    <td class="num mono">${num(p.icmsST.aliqResultante, 1)}%<div style="font-size:9.5px;color:var(--ink-3);">${p.icmsST.difCarga >= 0 ? '+' : ''}${num(p.icmsST.difCarga, 1)} p.p. de carga</div></td>
    <td style="font-size:10.5px;color:var(--ink-2);line-height:1.45;">
      ${p.maiores.length ? p.maiores.map((m) => `${esc(m.nome)} <span class="mono">${pct(m.participacao)}</span>`).join('<br>') : '—'}</td>
    <td>${p.fciObrigatoria
      ? '<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);" title="Produto com conteúdo de importação — FCI obrigatória (RN-06)">Sim</span>'
      : '<span class="chip" style="background:var(--line-2);color:var(--ink-3);" title="Produto sem conteúdo de importação — FCI dispensada (RN-06)">Não</span>'}</td>
    <td>${p.exigeReemissao
      ? '<span class="chip" style="background:var(--err-bg);color:var(--err-fg);" title="Variação do CI% superior ao gatilho parametrizado — reemissão da FCI exigida (RF-084 · RN-08)">Sim</span>'
      : '<span class="chip" style="background:var(--ok-bg);color:var(--ok-fg);" title="Variação dentro do gatilho parametrizado — reemissão não exigida (RF-084)">Não</span>'}</td>
  </tr>`;
}

function linhaAlerta(a) {
  const erro = a.sev === 'erro';
  const icone = a.tipo === 'reemissao' ? '🔁' : a.tipo === 'faixa' ? '⇅' : a.tipo === 'risco' ? '⚖' : '📄';
  return `<div class="gov-passo ${erro ? 'bloqueado' : ''}" style="align-items:flex-start;">
    <div class="gov-num" style="background:${erro ? 'var(--err-bg)' : 'var(--warn-bg)'};color:${erro ? 'var(--err-fg)' : 'var(--warn-fg)'};">${icone}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;font-size:12.5px;color:${erro ? 'var(--err-fg)' : 'var(--warn-fg)'};">${esc(a.titulo)} — ${esc(a.produto)}</div>
      <div style="font-size:11.5px;color:var(--ink-2);margin-top:3px;line-height:1.55;">${esc(a.msg)}</div>
      <div style="font-size:10.5px;color:var(--ink-3);margin-top:5px;">
        <b>Área responsável:</b> ${esc(a.area)} · <b>Ação:</b> ${esc(a.acao)}${a.baseLegal ? ` · <b>Base legal:</b> ${esc(a.baseLegal)}` : ''}
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div class="mono" style="font-size:12.5px;font-weight:600;">${pct(a.ci)}</div>
      <div style="font-size:10px;color:var(--ink-3);">vigente ${pct(a.vigente)}</div>
    </div>
  </div>`;
}

function blocoArea(b, podeRegistrar) {
  const cor = corDaArea(b.area);
  return `<div class="rel-area">
    <header style="background:${cor};">
      ${esc(b.area)}
      <span style="float:right;font-weight:400;font-size:10.5px;opacity:.9;">
        ${b.total} item(ns) · ${b.nAutomaticos} do motor · ${b.nManuais} manual(is)
      </span>
    </header>
    ${b.itens.map((i) => `<div class="item">
      <div style="display:flex;gap:7px;align-items:center;margin-bottom:3px;flex-wrap:wrap;">
        <span class="prio ${esc(i.prioridade || 'media')}">${esc(String(i.prioridade || 'media').toUpperCase())}</span>
        <b style="font-size:11.5px;">${esc(i.produto || 'Cenário')}</b>
        ${i.origem === 'manual' ? '<span class="chip" style="background:var(--gold-soft);color:var(--gold-d);font-size:9px;">manual</span>' : ''}
        <div style="flex:1;"></div>
        ${i.origem === 'manual' && podeRegistrar
          ? `<button class="btn-icone" title="Remover direcionamento manual" data-remover-dir="${esc(i.id)}">✕</button>` : ''}
      </div>
      <div style="color:var(--ink-2);">${esc(i.texto)}</div>
      ${i.autor ? `<div style="font-size:10px;color:var(--ink-3);margin-top:4px;">Registrado por ${esc(i.autor)}${i.criadoEm ? ` · ${dataHora(i.criadoEm)}` : ''}</div>` : ''}
    </div>`).join('')}
  </div>`;
}

/* ---------------------------------------------------------------- ações */

/**
 * RF-089 — a exportação viaja com o token no cabeçalho, portanto não pode ser
 * um link simples: o arquivo é baixado como blob e entregue ao navegador.
 */
async function baixarPdf(R, ctx, botao) {
  const rotuloOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Gerando PDF…';
  try {
    const resp = await fetch(`/api/cenarios/${R.id}/relatorio/pdf?base=${encodeURIComponent(R.base)}`, {
      headers: { Authorization: `Bearer ${tokenAtual()}` },
    });
    if (!resp.ok) {
      let msg = `Erro ${resp.status} ao gerar o relatório.`;
      try { const j = await resp.json(); if (j && j.erro) msg = j.erro; } catch { /* resposta não-JSON */ }
      throw new Error(msg);
    }
    const nome = nomeDoCabecalho(resp.headers.get('Content-Disposition'))
      || `relatorio-fci-${R.pacote.cenario.codigo}-v${R.pacote.cenario.versao}.pdf`;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    ctx.toast(`Relatório ${nome} exportado — a emissão foi registrada no histórico (RF-089).`, 'ok');
    await R.carregar(); R.render();
  } catch (err) {
    ctx.toast(err.message, 'erro');
    botao.disabled = false;
    botao.textContent = rotuloOriginal;
  }
}

function nomeDoCabecalho(cd) {
  if (!cd) return '';
  const m = /filename="?([^";]+)"?/.exec(cd);
  return m ? m[1] : '';
}

/** RF-009 — registro manual de direcionamento à área responsável. */
function modalDirecionamento(R, ctx) {
  const produtos = R.pacote.relatorio.produtos;
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;color:var(--gold-d);">➤</div>
      <div style="flex:1;">
        <h2>Registrar direcionamento à área responsável</h2>
        <div class="sub">RF-009 — o direcionamento entra no bloco da área no relatório executivo, somado aos itens derivados automaticamente do resultado (RF-088).</div>
      </div>
      <button class="fechar" id="d-fechar">×</button>
    </div>
    <div class="corpo">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="campo"><span>ÁREA RESPONSÁVEL</span>
          <select id="d-area">${AREAS_TRATAMENTO.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
        </div>
        <div class="campo"><span>PRIORIDADE</span>
          <select id="d-prio">
            <option value="alta">Alta</option>
            <option value="media" selected>Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </div>
      </div>
      <div class="campo"><span>PRODUTO (OPCIONAL)</span>
        <select id="d-prod">
          <option value="">Cenário como um todo</option>
          ${produtos.map((p) => `<option value="${esc(p.nome)} (${esc(p.sku)})">${esc(p.nome)} · ${esc(p.sku)}</option>`).join('')}
        </select>
      </div>
      <div class="campo"><span>DIRECIONAMENTO</span>
        <textarea id="d-texto" rows="4" placeholder="ex.: Cotar malte nacional equivalente para reduzir o CI% abaixo de 40% no próximo ciclo."></textarea>
      </div>
      <div class="aviso-info">O registro fica vinculado ao cenário e à versão, com autor e data (RNF-04), e aparece marcado como «manual» no relatório.</div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" id="d-cancelar">Cancelar</button>
      <button class="btn btn-ouro" id="d-salvar">Registrar</button>
    </div>`);
  wrap.querySelector('#d-fechar').onclick = ctx.fecharModal;
  wrap.querySelector('#d-cancelar').onclick = ctx.fecharModal;
  wrap.querySelector('#d-salvar').onclick = async () => {
    const texto = wrap.querySelector('#d-texto').value.trim();
    if (!texto) { ctx.toast('Escreva o direcionamento à área.', 'erro'); return; }
    const botao = wrap.querySelector('#d-salvar');
    botao.disabled = true;
    try {
      await ctx.api.post(`/cenarios/${R.id}/gov/direcionamentos`, {
        area: wrap.querySelector('#d-area').value,
        prioridade: wrap.querySelector('#d-prio').value,
        produto: wrap.querySelector('#d-prod').value || null,
        texto,
      });
      ctx.fecharModal();
      ctx.toast('Direcionamento registrado no bloco da área.', 'ok');
      await R.carregar(); R.render();
    } catch (err) { ctx.toast(err.message, 'erro'); botao.disabled = false; }
  };
}
