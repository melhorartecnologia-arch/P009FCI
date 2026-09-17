import { esc, num, pct, brl, dataHora } from '../format.js';
import { CLASSES, computeNode, resultadoProduto, faixaDe, aliqInter, precoMedio, cstSugerido, resumoCenario, alertasCenario } from '../engine.js';

const ST = {
  rascunho:  { label: 'Rascunho',  bg: '#efeae0', fg: '#8b8681' },
  calculado: { label: 'Calculado', bg: '#e9f1eb', fg: '#2f6b46' },
  congelado: { label: 'Congelado', bg: '#f4ecdd', fg: '#8a5e12' },
  consolidado: { label: 'Consolidado', bg: '#e6e9f2', fg: '#3d4c7a' },
};

const estado = { aba: 'estrutura', produtoId: null, sujo: false };

export async function telaSimulacao(el, ctx, [id]) {
  const [{ cenario }, { parametros }] = await Promise.all([
    ctx.api.get(`/cenarios/${id}`),
    ctx.api.get('/parametros'),
  ]);
  const dados = cenario.dados || { produtos: [], insumos: [], fornecedores: [], cambio: {} };
  const gatilho = (parametros.gatilho_reemissao && parametros.gatilho_reemissao.valor.pp) || 5;
  const aliqNormal = (parametros.st && parametros.st.valor.aliqNormal) || 12;
  const versaoFormula = (parametros.motor && parametros.motor.valor.versaoFormula) || 'CI% v1';
  ctx.definirAlertas(alertasCenario(dados, gatilho).length);

  const pas = dados.produtos.filter((p) => p.tipo === 'PA');
  if (!estado.produtoId || !pas.find((p) => p.id === estado.produtoId)) {
    estado.produtoId = pas.length ? pas[0].id : null;
  }
  const congelado = cenario.status === 'congelado' || cenario.status === 'consolidado';
  const st = ST[cenario.status] || ST.rascunho;
  const acoes = ctx.usuario.acoes || [];
  const podeSalvar = acoes.includes('salvar') && !congelado;
  const podeCongelar = acoes.includes('congelar');

  ctx.definirTopo('Simulação', `${esc(cenario.origem_dados || '')}`, `
    <span style="color:var(--ink-3);">·</span>
    <span style="font-size:13px;color:var(--ink-2);font-weight:500;">${esc(cenario.nome)}</span>
    <span class="chip" style="background:${st.bg};color:${st.fg};">${st.label}</span>
    <span style="font-size:10.5px;color:var(--ink-3);" class="mono">${esc(cenario.codigo)} · v${cenario.versao}</span>`);

  const resultado = estado.produtoId ? resultadoProduto(dados, estado.produtoId) : null;

  el.innerHTML = `
  <div>
    <div class="sim-topo">
      <div class="linha1">
        <div style="font-size:11px;color:var(--ink-3);font-weight:600;letter-spacing:.4px;">PRODUTO ACABADO (SKU)</div>
        <select id="sel-produto" style="min-width:280px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-weight:500;font-size:13px;">
          ${pas.map((p) => `<option value="${esc(p.id)}" ${p.id === estado.produtoId ? 'selected' : ''}>${esc(p.sku)} · ${esc(p.nome)}</option>`).join('')}
        </select>
        <div style="flex:1;"></div>
        ${resultado ? `
        <div class="sim-ci-box">
          <div style="text-align:right;"><div style="font-size:9.5px;color:var(--ink-3);letter-spacing:.4px;">CI% DO PRODUTO</div><div style="font-size:11px;color:var(--ink-3);">base ${resultado.basisLabel}</div></div>
          <div class="grande" style="color:${resultado.faixa.fg};">${pct(resultado.ci)}</div>
          <span class="chip" style="background:${resultado.faixa.bg};color:${resultado.faixa.fg};">${resultado.faixa.label}</span>
        </div>` : ''}
      </div>
      <div class="sim-abas">
        ${aba('estrutura', 'Estrutura')}
        ${aba('parametrizacao', 'Parametrização')}
        ${aba('calculo', 'Cálculo')}
        ${aba('validacao', 'Validação')}
        ${aba('massa', 'Alterações em massa')}
        <div style="flex:1;"></div>
        <div style="display:flex;align-items:center;gap:9px;padding-bottom:6px;">
          <span style="font-size:10.5px;color:var(--ink-3);">modo <b style="color:var(--ink-2);">Receita protegida</b> · perfil <b style="color:var(--ink-2);">${esc(ctx.usuario.perfil || '')}</b></span>
        </div>
      </div>
    </div>

    ${congelado ? `
    <div style="margin:16px 26px 0;background:#f4ecdd;border:1px solid #e3cfa4;border-radius:9px;padding:11px 15px;display:flex;align-items:center;gap:11px;font-size:12.5px;color:#6d5320;">
      <span style="font-size:15px;">🔒</span>
      <div style="flex:1;">Cenário <b>congelado</b> — premissas travadas para rastreabilidade (RN-10). Crie uma nova versão para editar.</div>
      <button class="btn btn-ouro btn-mini" id="btn-nova-versao">Nova versão</button>
    </div>` : ''}

    <div id="aba-conteudo"></div>

    <div style="position:sticky;bottom:0;background:rgba(242,239,232,.94);backdrop-filter:blur(8px);border-top:1px solid var(--line);padding:11px 26px;display:flex;align-items:center;gap:10px;z-index:10;">
      <span style="font-size:11px;color:var(--ink-3);">Alterações valem apenas neste cenário — o cadastro oficial e os demais cenários não são afetados (RF-007).</span>
      <div style="flex:1;"></div>
      <button class="btn btn-borda" id="btn-recarregar" ${congelado ? 'disabled' : ''} title="Recarrega estrutura, custos e saídas do staging integrado (RF-002)">⬇ Recarregar estrutura do ERP</button>
      ${podeCongelar && !congelado ? '<button class="btn btn-borda" id="btn-congelar">🔒 Congelar premissas</button>' : ''}
      <button class="btn btn-ouro" id="btn-salvar" ${podeSalvar ? '' : 'disabled'} title="${podeSalvar ? 'Grava as premissas deste cenário' : 'Perfil sem permissão de gravação ou cenário congelado'}">Salvar alterações</button>
    </div>
  </div>`;

  function aba(chave, rotulo) {
    return `<button class="sim-aba ${estado.aba === chave ? 'ativa' : ''}" data-aba="${chave}">${rotulo}</button>`;
  }

  // ---- interações do topo
  el.querySelector('#sel-produto')?.addEventListener('change', (e) => {
    estado.produtoId = e.target.value;
    telaSimulacao(el, ctx, [id]);
  });
  el.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
    estado.aba = b.dataset.aba;
    telaSimulacao(el, ctx, [id]);
  }));
  el.querySelector('#btn-nova-versao')?.addEventListener('click', async () => {
    try {
      const r = await ctx.api.post(`/cenarios/${id}/duplicar`, {});
      ctx.toast(`Nova versão criada: ${r.cenario.codigo} (v${r.cenario.versao}).`, 'ok');
      ctx.navegar(`#/sim/${r.cenario.id}`);
    } catch (err) { ctx.toast(err.message, 'erro'); }
  });
  el.querySelector('#btn-recarregar')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await ctx.api.post(`/cenarios/${id}/recarregar`, {});
      ctx.toast('Estrutura recarregada das fontes integradas — sem digitação manual (RF-002).', 'ok');
      telaSimulacao(el, ctx, [id]);
    } catch (err) { ctx.toast(err.message, 'erro'); e.target.disabled = false; }
  });
  el.querySelector('#btn-congelar')?.addEventListener('click', async () => {
    try {
      await ctx.api.put(`/cenarios/${id}/status`, { status: 'congelado' });
      ctx.toast('Cenário congelado — qualquer alteração futura exigirá nova versão (RN-10).', 'ok');
      telaSimulacao(el, ctx, [id]);
    } catch (err) { ctx.toast(err.message, 'erro'); }
  });
  el.querySelector('#btn-salvar')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await ctx.api.put(`/cenarios/${id}/dados`, { dados, resumo: 'Premissas do cenário atualizadas na simulação' });
      estado.sujo = false;
      ctx.toast('Cenário salvo. Alteração registrada na trilha de auditoria (RC-010).', 'ok');
    } catch (err) { ctx.toast(err.message, 'erro'); }
    e.target.disabled = false;
  });

  // ---- conteúdo da aba
  const corpo = el.querySelector('#aba-conteudo');
  if (!pas.length) {
    corpo.innerHTML = `<div class="pagina"><div class="roadmap-box">
      <div class="titulo">Cenário sem estrutura carregada</div>
      Sincronize as fontes de dados em <a href="#/integracoes">Integrações</a> e use “Recarregar estrutura do ERP”.
      A operação continua possível sobre dados já carregados mesmo com integrações em erro (RF-095).
    </div></div>`;
    return;
  }
  if (estado.aba === 'estrutura') abaEstrutura(corpo, ctx, dados, cenario, congelado);
  else if (estado.aba === 'parametrizacao') abaParametrizacao(corpo, ctx, dados, congelado, () => { estado.sujo = true; telaSimulacao(el, ctx, [id]); });
  else if (estado.aba === 'calculo') abaCalculo(corpo, dados, { aliqNormal, versaoFormula, gatilho });
  else if (estado.aba === 'validacao') abaValidacao(corpo, dados);
  else if (estado.aba === 'massa') corpo.innerHTML = roadmap('Alterações em massa por grupo de insumo', 'Substituição em lote, proporção por grupo, prévia do efeito e seleção de estruturas.', 'Entrega S5 · 13–16/10 (RF-040 a RF-045)');
}

/* ===================== ABA ESTRUTURA (BOM) ===================== */
function abaEstrutura(el, ctx, dados, cenario, congelado) {
  const node = computeNode(dados, estado.produtoId, {});
  const fornecedorDe = (ins) => {
    const f = dados.fornecedores.find((x) => x.id === ins.fornecedorId);
    return f ? f.nome : '—';
  };

  const linha = (child, nivel, qtdReceita) => {
    const n = child.node;
    const isProd = n.kind === 'prod';
    const ins = n.ins;
    const cls = ins ? CLASSES[ins.classSim] || CLASSES.nacional : null;
    const kindTag = isProd
      ? '<span class="bom-kind" style="background:#e8e2f2;color:#5b4a86;">PI</span>'
      : '<span class="bom-kind" style="background:var(--line-2);color:var(--ink-2);">MP</span>';
    const contribuicao = child.contrib;
    const contribCor = contribuicao > 0 ? 'var(--gold-d)' : 'var(--ink-3)';
    const pad = 16 + nivel * 26;
    let html = `
    <div class="bom-grid ${nivel > 0 ? 'bom-sub' : ''}">
      <div style="display:flex;align-items:center;gap:9px;padding-left:${pad - 16}px;">
        ${nivel > 0 ? '<span style="color:var(--gold);font-size:12px;">↳</span>' : ''}
        ${kindTag}
        <div>
          <div style="font-weight:${isProd ? 600 : 400};font-size:12.5px;">${esc(n.nome)}</div>
          <div style="font-size:10px;color:var(--ink-3);" class="mono">${esc(n.id)}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <span class="mono" style="font-size:12px;">${num(qtdReceita, qtdReceita < 1 ? 4 : 3)}</span>
        <div style="font-size:9.5px;color:var(--ink-3);">${esc(ins ? ins.unidade : 'L')} <span title="Quantidade da receita bloqueada no modo padrão — edição apenas em modo avançado com validação técnica (RF-011 · S2)">🔒</span></div>
      </div>
      <div>${cls ? `<span class="origem-tag" style="background:${cls.bg};color:${cls.fg};">${cls.curto}</span>` : '<span class="origem-tag" style="background:#e8e2f2;color:#5b4a86;">Intermediário</span>'}</div>
      <div style="font-size:11.5px;color:var(--ink-2);">${ins ? esc(fornecedorDe(ins)) : '—'}</div>
      <div style="text-align:right;" class="mono">${brl(n.custo)}</div>
      <div style="text-align:right;" class="mono">
        <span style="color:${n.ci > 40 ? '#a03d2c' : n.ci > 0 ? '#8a5e12' : 'var(--ink-2)'};">${isProd ? pct(n.ci) : esc(n.ciLabel)}</span>
        <div style="font-size:9px;color:var(--ink-3);">×${num(child.fator, Number.isInteger(child.fator) ? 0 : 2)}</div>
      </div>
      <div style="text-align:right;font-weight:600;" class="mono"><span style="color:${contribCor};">${brl(contribuicao)}</span></div>
    </div>`;
    if (isProd && n.children) {
      for (const sub of n.children) html += linha(sub, nivel + 1, sub.qtd);
    }
    return html;
  };

  el.innerHTML = `
  <div class="pagina" style="max-width:1600px;padding-bottom:20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:12px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0;font-size:14px;font-weight:600;">Estrutura do produto · cascata MP → PI → PA</h2>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;">Lista técnica (BOM) carregada da integração como ponto de partida — sem digitação manual (RF-002). O cadastro oficial não é alterado.</div>
      </div>
      <span style="font-size:10.5px;color:var(--ink-3);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 11px;">⬇ Origem: ${esc(cenario.origem_dados || '—')}</span>
    </div>
    <div class="card" style="overflow:hidden;">
      <div class="bom-grid bom-head" style="border-bottom:1px solid var(--line);">
        <div>INSUMO / COMPONENTE</div><div style="text-align:right;">QTD RECEITA</div><div>ORIGEM / CLASSIFICAÇÃO</div><div>FORNECEDOR</div><div style="text-align:right;">CUSTO FCI UN.</div><div style="text-align:right;">CI NÓ</div><div style="text-align:right;">PARCELA IMP.</div>
      </div>
      ${node.children.map((c) => linha(c, 0, c.qtd)).join('')}
      <div class="bom-grid" style="background:var(--panel-2);">
        <div style="font-size:11px;color:var(--ink-2);font-weight:600;">Mão de obra + custos industriais (overhead)</div>
        <div></div><div></div><div></div>
        <div style="text-align:right;" class="mono">${brl(node.prod.overhead || 0)} <span title="Edição do custo industrial na entrega S2 (RF-012)">🔒</span></div>
        <div style="text-align:right;font-size:10px;color:var(--ink-3);">nacional</div>
        <div style="text-align:right;color:var(--ink-3);" class="mono">—</div>
      </div>
      <div class="bom-grid bom-total">
        <div style="font-weight:600;font-size:13px;">TOTAL · ${esc(node.nome)}</div>
        <div></div><div></div><div></div>
        <div style="text-align:right;font-weight:600;" class="mono">${brl(node.custo)}</div>
        <div style="text-align:right;font-weight:600;" class="mono" ><span style="color:${faixaDe(node.ci).chip};">${pct(node.ci)}</span></div>
        <div style="text-align:right;font-weight:700;color:var(--gold);" class="mono">${brl(node.parcela)}</div>
      </div>
    </div>
    <div class="nota-rodape" style="display:flex;gap:22px;flex-wrap:wrap;">
      <span><b style="color:var(--ink-2);">CI Nó</b> = conteúdo importado do componente. <b style="color:var(--ink-2);">Fator de faixa</b> na cascata: ≤40%→0 · 40–70%→0,5 · &gt;70%→1 (RN-05).</span>
      <span><b style="color:var(--ink-2);">Parcela Imp.</b> = custo × qtd × fator.</span>
      <span><b style="color:var(--ink-2);">Substituição de componentes</b> <span class="tag-semana">ENTREGA S4 · 05–09/10</span></span>
    </div>
  </div>`;
}

/* ===================== ABA PARAMETRIZAÇÃO ===================== */
function abaParametrizacao(el, ctx, dados, congelado, aoMudar) {
  const produto = dados.produtos.find((p) => p.id === estado.produtoId);
  const insumosPorMoeda = (m) => dados.insumos.filter((i) => i.moeda === m && i.classSim === 'importado_direto');
  const moedas = Object.keys(dados.cambio || {});

  el.innerHTML = `
  <div class="pagina" style="display:flex;flex-direction:column;gap:16px;padding-bottom:20px;">
    <div class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Câmbio do cenário</h3>
        <span class="tag-semana">PRÉVIA S2 · RF-052/RF-054</span>
      </div>
      <div style="font-size:11px;color:var(--ink-3);margin-bottom:14px;">Cotação parametrizável por moeda; a alteração recalcula em lote o custo FCI dos insumos vinculados. Vale apenas neste cenário.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;">
        ${moedas.map((m) => `
          <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-weight:600;font-size:12.5px;" class="mono">${esc(m)}</span>
              <span style="font-size:10px;color:var(--ink-3);">${insumosPorMoeda(m).length} insumo(s) vinculado(s)</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:9px;">
              <span style="font-size:11px;color:var(--ink-3);">R$</span>
              <input type="number" step="0.01" min="0" value="${dados.cambio[m]}" data-moeda="${esc(m)}" ${congelado ? 'disabled' : ''}
                style="width:100%;text-align:right;border:1px solid var(--line);border-radius:7px;padding:8px 10px;font-family:var(--mono);font-size:15px;font-weight:600;background:var(--panel);">
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Volumes e preços por UF · ${esc(produto ? produto.nome : '')}</h3>
        <span class="tag-semana">CARGA S1 · EDIÇÃO S3 (RF-066/RF-068)</span>
      </div>
      <div style="font-size:11px;color:var(--ink-3);margin-bottom:10px;">Origem: Sistema de Preços. Denominador do CI% = média ponderada global das saídas interestaduais (RN-02). Movimentações posteriores de distribuidores não são consideradas.</div>
      <table class="tabela">
        <thead><tr><th>UF DE DESTINO</th><th class="num">VOLUME</th><th class="num">PREÇO LÍQUIDO</th><th class="num">PESO</th></tr></thead>
        <tbody>
          ${(produto && produto.saidas && produto.saidas.length) ? produto.saidas.map((s) => {
            const total = produto.saidas.reduce((a, x) => a + x.volume, 0) || 1;
            return `<tr><td><b>${esc(s.uf)}</b></td><td class="num">${num(s.volume, 0)}</td><td class="num">${brl(s.preco)}</td><td class="num">${num(s.volume / total * 100, 1)}%</td></tr>`;
          }).join('') : '<tr><td colspan="4" style="color:var(--ink-3);">Sem saídas carregadas para este produto.</td></tr>'}
        </tbody>
      </table>
      ${produto && produto.saidas && produto.saidas.length ? `<div class="nota-rodape">Preço médio ponderado: <b class="mono" style="color:var(--ink-2);">${brl(precoMedio(produto))}</b> · pesos totalizam 100% (RF-070).</div>` : ''}
    </div>
  </div>`;

  el.querySelectorAll('input[data-moeda]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!(v > 0)) { ctx.toast('Cotação inválida.', 'erro'); return; }
      dados.cambio[inp.dataset.moeda] = v;
      ctx.toast(`Cotação ${inp.dataset.moeda} aplicada em lote aos insumos vinculados — clique em “Salvar alterações” para persistir.`, '');
      aoMudar();
    });
  });
}

/* ===================== ABA CÁLCULO ===================== */
function abaCalculo(el, dados, { aliqNormal, versaoFormula, gatilho }) {
  const r = resultadoProduto(dados, estado.produtoId);
  const produto = dados.produtos.find((p) => p.id === estado.produtoId);
  const contribuintes = [...r.node.children].sort((a, b) => b.contrib - a.contrib).slice(0, 6);
  const aliq = aliqInter(r.ci, aliqNormal);
  const deltaVig = r.ci - (produto.fciVigente || 0);

  el.innerHTML = `
  <div class="pagina" style="display:flex;flex-direction:column;gap:16px;padding-bottom:20px;">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;">
      <div class="kpi"><div class="rotulo">CI% DO PRODUTO</div><div class="valor" style="color:${r.faixa.fg};">${pct(r.ci)}</div><div class="hint">${r.faixa.range} · ${r.faixa.label}</div></div>
      <div class="kpi"><div class="rotulo">PARCELA IMPORTADA</div><div class="valor">${brl(r.node.parcela)}</div><div class="hint">valor aduaneiro em cascata (RN-01)</div></div>
      <div class="kpi"><div class="rotulo">DENOMINADOR</div><div class="valor">${brl(r.denominador)}</div><div class="hint">base: ${r.basisLabel} (RN-02)</div></div>
      <div class="kpi"><div class="rotulo">ALÍQUOTA INTERESTADUAL</div><div class="valor" style="color:${aliq === 4 ? 'var(--err)' : 'var(--ok-fg)'};">${aliq}%</div><div class="hint">${aliq === 4 ? 'Res. SF 13/2012 — CI% > 40%' : 'destinos 7% / 12% conforme UF'}</div></div>
    </div>

    <div class="card card-pad">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Memória de cálculo · ${esc(r.node.nome)}</h3>
        <span style="font-size:11px;color:var(--ink-3);" class="mono">${esc(versaoFormula)}</span>
      </div>
      <table class="tabela">
        <tbody>
          <tr><td>Custo total da mercadoria (cascata + overhead)</td><td class="num">${brl(r.node.custo)}</td></tr>
          <tr><td>Parcela importada (custo × qtd × fator de faixa)</td><td class="num" style="color:var(--gold-d);font-weight:600;">${brl(r.node.parcela)}</td></tr>
          <tr><td>Denominador vigente — ${r.basisLabel}</td><td class="num">${brl(r.denominador)}</td></tr>
          <tr><td><b>CI% = parcela importada ÷ denominador × 100</b></td><td class="num" style="font-weight:700;color:${r.faixa.fg};">${pct(r.ci)}</td></tr>
          <tr><td>CI% pela base alternativa (custo total)</td><td class="num">${pct(r.ciCusto)}</td></tr>
          <tr><td>FCI vigente (pré-apuração integrada)</td><td class="num">${pct(produto.fciVigente || 0)}</td></tr>
          <tr><td>Variação vs FCI vigente ${Math.abs(deltaVig) > gatilho ? `<span class="chip" style="background:var(--err-bg);color:var(--err-fg);">acima do gatilho de ${num(gatilho, 1)} p.p. → reemissão (RN-08)</span>` : ''}</td>
              <td class="num" style="color:${Math.abs(deltaVig) > gatilho ? 'var(--err)' : 'var(--ink)'};">${deltaVig > 0 ? '+' : ''}${num(deltaVig, 1)} p.p.</td></tr>
        </tbody>
      </table>
      <div class="nota-rodape">Memória demonstrável até o insumo (RNF-08). O simulador não gera nem transmite a FCI oficial (RN-12).</div>
    </div>

    <div class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Componentes de maior contribuição</h3>
        <span class="tag-semana">PRÉVIA S3 · RF-065</span>
      </div>
      ${contribuintes.map((c, i) => {
        const p = r.node.parcela > 0 ? c.contrib / r.node.parcela * 100 : 0;
        return `
        <div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-top:1px solid var(--line-2);">
          <span style="width:18px;text-align:right;font-size:11px;color:var(--ink-3);" class="mono">${i + 1}</span>
          <span style="flex:0 0 300px;font-size:12px;${i === 0 ? 'font-weight:600;' : ''}">${esc(c.node.nome)}</span>
          <div style="flex:1;height:8px;border-radius:5px;background:var(--line-2);overflow:hidden;"><div style="width:${p}%;height:100%;background:${i === 0 ? 'var(--gold)' : '#d9c496'};"></div></div>
          <span style="width:90px;text-align:right;" class="mono">${brl(c.contrib)}</span>
          <span style="width:52px;text-align:right;font-size:11px;color:var(--ink-3);" class="mono">${num(p, 1)}%</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ===================== ABA VALIDAÇÃO ===================== */
function abaValidacao(el, dados) {
  // Prévia S2 — coerência fiscal (RF-033/RF-050): CST da entrada × CST sugerido.
  const avisos = [];
  for (const ins of dados.insumos) {
    const sugerido = cstSugerido(ins.classSim, ins.ciFaixa, ins.ciPct, ins.ciModo);
    if (ins.cstErp && String(ins.cstErp) !== String(sugerido)) {
      avisos.push({
        insumo: ins,
        msg: `«${ins.nome}»: CST da entrada (${ins.cstErp} · SD1.D1_CLASFIS) difere do sugerido (${sugerido}) para a classificação adotada — aviso sem bloqueio (E-05).`,
      });
    }
  }
  el.innerHTML = `
  <div class="pagina" style="display:flex;flex-direction:column;gap:16px;padding-bottom:20px;">
    <div class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Coerência fiscal · CST informado × sugerido</h3>
        <span class="tag-semana">PRÉVIA S2 · RF-033/RF-050</span>
      </div>
      ${avisos.length ? avisos.map((a) => `
        <div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line-2);font-size:12px;color:var(--warn-fg);">
          <span style="font-weight:700;">⚠</span><div>${esc(a.msg)}</div>
        </div>`).join('') : '<div style="font-size:12px;color:var(--ok-fg);">✓ Nenhuma divergência de CST identificada nos insumos carregados.</div>'}
    </div>
    ${roadmap('Validadores de estrutura e diagnóstico consolidado',
      'Componentes obrigatórios, soma de proporções = 100%, distribuição × quantidade original, confronto imediato ao editar, bloqueio por inconsistência e painel de erros × avisos.',
      'Entregas S4 (07–09/10 · RF-026 a RF-031) e S5 (13–15/10 · RF-025/RF-032)')}
  </div>`;
}

function roadmap(titulo, texto, tag) {
  return `<div class="roadmap-box">
    <div class="titulo">${esc(titulo)}</div>
    <div style="max-width:640px;margin:0 auto 8px;">${esc(texto)}</div>
    <span class="tag-semana">${esc(tag)}</span>
  </div>`;
}
