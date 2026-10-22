/**
 * Painel de cenários — porta de entrada do Simulador FCI.
 *
 *   RF-001  criação de cenário com identificador único, versão, status, autor e data
 *   RF-002  carga automática da estrutura a partir das fontes integradas
 *   RF-003  duplicação de cenário como nova versão, preservando a origem
 *   RF-004  painel com indicadores recalculados de cada cenário
 *   RF-005  recarga da estrutura a partir da origem, preservando premissas
 *   RF-006  histórico de alterações com autor, data, versão e status
 *   RF-007  isolamento: nada afeta outro cenário nem o cadastro oficial
 *   RF-008  linhagem de versões derivadas de um mesmo cenário de origem
 *   RF-035  ações fora do perfil ficam visíveis, desabilitadas e explicadas
 *   RN-12   ambiente analítico, sem validade fiscal
 *
 * Os indicadores chegam calculados pelo servidor a partir do motor único
 * (RNF-10): a tela não recalcula CI%, apenas apresenta e compara.
 */
import { esc, num, pct, dataHora } from '../format.js';

const ST = {
  rascunho:    { label: 'Rascunho',    bg: '#efeae0', fg: '#8b8681', dot: '#8b8681' },
  calculado:   { label: 'Calculado',   bg: '#e9f1eb', fg: '#2f6b46', dot: '#3f7d54' },
  congelado:   { label: 'Congelado',   bg: '#f4ecdd', fg: '#8a5e12', dot: '#b07d1e' },
  consolidado: { label: 'Consolidado', bg: '#e6e9f2', fg: '#3d4c7a', dot: '#3d4c7a' },
};

const ROTULO_TIPO = { orcamento: 'Orçamento anual', revisao: 'Revisão mensal' };

const INDIC_VAZIO = {
  ciMedio: 0, nProdutos: 0, acima40: 0, nAlertas: 0, nErros: 0, nInsumos: 0,
  dist: { baixo: 0, medio: 0, alto: 0 },
};

/** Estado de filtro preservado entre re-renderizações da lista. */
const filtro = { status: 'todos', texto: '' };

/* ------------------------------------------------------------------ tela */

export async function telaCenarios(el, ctx) {
  ctx.definirTopo(
    'Cenários de simulação',
    'RF-001 a RF-008 — criação, carga integrada, duplicação, recarga, indicadores recalculados, histórico e isolamento'
  );

  let resposta;
  try {
    resposta = await ctx.api.get('/cenarios');
  } catch (err) {
    el.innerHTML = `<div class="pagina"><div class="aviso-erro"><span>✕</span>
      <div><b>Não foi possível carregar os cenários.</b> ${esc(err.message)}</div></div></div>`;
    ctx.toast(err.message, 'erro');
    return;
  }

  const cenarios = resposta.cenarios || [];
  const parametros = resposta.parametros || {};
  const gatilho = parametros.gatilho != null ? parametros.gatilho : 5;

  // RF-008 — código do cenário de origem, para o selo "derivado de".
  const codigoPorId = new Map(cenarios.map((c) => [String(c.id), c.codigo]));

  // RF-004 — os indicadores do conjunto são sempre derivados da carga atual:
  // recarregar a tela recalcula tudo, sem cache local.
  const totais = cenarios.reduce((acc, c) => {
    const i = c.indicadores || INDIC_VAZIO;
    acc.produtos += i.nProdutos || 0;
    acc.insumos += i.nInsumos || 0;
    acc.acima40 += i.acima40 || 0;
    acc.alertas += i.nAlertas || 0;
    acc.erros += i.nErros || 0;
    return acc;
  }, { produtos: 0, insumos: 0, acima40: 0, alertas: 0, erros: 0 });

  ctx.definirAlertas(totais.alertas);

  const recente = cenarios[0] ? (cenarios[0].indicadores || INDIC_VAZIO) : INDIC_VAZIO;
  const nomeRecente = cenarios[0] ? cenarios[0].codigo : '—';
  const podeCriar = ctx.pode('criarCenario');
  const motivoCriar = 'Ação «criar e duplicar cenário» não habilitada para o seu perfil '
    + `(${esc(ctx.usuario && ctx.usuario.perfil ? ctx.usuario.perfil : 'perfil atual')}) — RF-035. `
    + 'A consulta de cenários, cálculos e relatórios permanece liberada. Consulte a matriz de permissões.';

  el.innerHTML = `
  <div class="pagina" style="max-width:1500px;">

    <!-- RN-12 — aviso permanente de ambiente sem validade fiscal -->
    <div class="aviso-restricao">
      <b>Ambiente analítico de simulação — sem validade fiscal.</b> Os cenários apoiam a decisão de
      compras, pricing e planejamento tributário. Nenhum resultado substitui a FCI oficial, gera
      obrigação acessória ou é transmitido à SEFAZ (RN-12). As bases de origem são lidas sem
      qualquer gravação (RNF-06).
    </div>

    <div class="grid-kpi">
      ${kpi('CENÁRIOS DE SIMULAÇÃO', String(cenarios.length),
        'isolados entre si e do cadastro oficial (RF-007)')}
      ${kpi('CI% MÉDIO · CENÁRIO MAIS RECENTE', pct(recente.ciMedio),
        `${esc(nomeRecente)} · média ponderada pelos volumes por UF (RN-02)`,
        corDoCi(recente.ciMedio))}
      ${kpi('PRODUTOS ACIMA DE 40%', String(totais.acima40),
        'alíquota interestadual de 4% (RN-07) · todos os cenários',
        totais.acima40 ? 'var(--err)' : '')}
      ${kpi('ALERTAS DE REEMISSÃO', String(totais.alertas),
        `gatilho de variação: ${num(gatilho, 1)} p.p. (RF-083 · RF-099)`,
        totais.alertas ? 'var(--err)' : '')}
    </div>

    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:12px;gap:14px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0;font-size:15px;font-weight:600;">Carteira de cenários</h2>
        <div class="texto-mini" style="margin-top:3px;">
          Indicadores recalculados a cada abertura do painel (RF-004) ·
          ${totais.produtos} produto(s) acabado(s) e ${totais.insumos} insumo(s) sob avaliação
          ${totais.erros
            ? ` · <b style="color:var(--err-fg);">${totais.erros} erro(s) de validação em aberto</b> (RF-025 · RF-033)`
            : ' · nenhum erro de validação em aberto'}
        </div>
      </div>
      <div class="linha-flex">
        <div class="campo" style="min-width:150px;">
          <span>STATUS</span>
          <select id="f-status">
            <option value="todos">Todos os status</option>
            <option value="rascunho">Rascunho</option>
            <option value="calculado">Calculado</option>
            <option value="congelado">Congelado</option>
            <option value="consolidado">Consolidado</option>
          </select>
        </div>
        <div class="campo" style="min-width:210px;">
          <span>BUSCAR POR NOME OU CÓDIGO</span>
          <input id="f-texto" placeholder="ex.: Orçamento 2027 ou CEN-0003" autocomplete="off">
        </div>
        <button class="btn btn-borda" id="btn-atualizar"
          title="Recarregar o painel e recalcular os indicadores de todos os cenários (RF-004)">⟳ Atualizar</button>
        <button class="btn btn-ouro" id="btn-novo"
          ${podeCriar ? 'title="Criar um cenário novo com estrutura carregada das fontes integradas (RF-001 · RF-002)"' : `disabled title="${motivoCriar}"`}>
          ＋ Novo cenário</button>
      </div>
    </div>

    <div id="lista-cenarios"></div>

    <div class="nota-rodape">
      Duplicar um cenário gera uma nova versão com a mesma linhagem e as mesmas premissas; o cenário
      de origem permanece integralmente preservado (RF-003 · RF-007 · RF-008). Cenários congelados ou
      consolidados recusam edição para manter a rastreabilidade da decisão (RN-10) — para simular
      novas hipóteses, duplique-os.
    </div>
  </div>`;

  const lista = el.querySelector('#lista-cenarios');
  const selStatus = el.querySelector('#f-status');
  const inpTexto = el.querySelector('#f-texto');
  selStatus.value = filtro.status;
  inpTexto.value = filtro.texto;

  const recarregarTela = () => telaCenarios(el, ctx);

  /** Aplica os filtros e redesenha apenas a lista, mantendo o foco do campo. */
  function pintarLista() {
    const alvo = filtro.texto.trim().toLowerCase();
    const visiveis = cenarios.filter((c) => {
      if (filtro.status !== 'todos' && c.status !== filtro.status) return false;
      if (!alvo) return true;
      return `${c.nome || ''} ${c.codigo || ''} ${c.ciclo || ''}`.toLowerCase().includes(alvo);
    });

    if (!cenarios.length) {
      lista.innerHTML = `
        <div class="roadmap-box">
          <div class="titulo">Nenhum cenário criado ainda</div>
          Crie o primeiro cenário — a estrutura de produtos, insumos e dados mestres é carregada
          automaticamente das fontes de dados integradas, sem digitação manual (RF-002).
          Configure as fontes em <a href="#/integracoes">Integrações</a>.
        </div>`;
      return;
    }

    if (!visiveis.length) {
      lista.innerHTML = `
        <div class="roadmap-box">
          <div class="titulo">Nenhum cenário atende ao filtro</div>
          ${cenarios.length} cenário(s) cadastrado(s). Ajuste o status ou o texto da busca.
        </div>`;
      return;
    }

    lista.innerHTML = `
      <div class="grid-cenarios">
        ${visiveis.map((c) => cartao(c, codigoPorId, podeCriar, motivoCriar)).join('')}
      </div>
      <div class="texto-mini" style="margin-top:10px;">
        Exibindo ${visiveis.length} de ${cenarios.length} cenário(s).
      </div>`;
    ligarAcoes(lista, ctx, recarregarTela);
  }

  selStatus.addEventListener('change', () => { filtro.status = selStatus.value; pintarLista(); });
  inpTexto.addEventListener('input', () => { filtro.texto = inpTexto.value; pintarLista(); });

  el.querySelector('#btn-atualizar').addEventListener('click', recarregarTela);

  const btnNovo = el.querySelector('#btn-novo');
  if (podeCriar) btnNovo.addEventListener('click', () => modalNovo(ctx, recarregarTela));

  pintarLista();
}

/* ------------------------------------------------------------ componentes */

function kpi(rotulo, valor, hint, cor) {
  return `<div class="kpi">
    <div class="rotulo">${esc(rotulo)}</div>
    <div class="valor"${cor ? ` style="color:${cor};"` : ''}>${valor}</div>
    <div class="hint">${hint}</div>
  </div>`;
}

/** Cores das faixas legais de conteúdo de importação (RN-05 · RN-07). */
function corDoCi(ci) {
  if (!(ci > 0)) return '';
  if (ci > 70) return '#a03d2c';
  if (ci > 40) return '#b07d1e';
  return '#2f6b46';
}

/* RF-004 — cartão com os indicadores de apoio à decisão do cenário */
function cartao(c, codigoPorId, podeCriar, motivoCriar) {
  const st = ST[c.status] || ST.rascunho;
  const i = Object.assign({}, INDIC_VAZIO, c.indicadores || {});
  const dist = Object.assign({ baixo: 0, medio: 0, alto: 0 }, i.dist || {});
  const totalFaixas = Math.max(1, dist.baixo + dist.medio + dist.alto);
  const congelado = c.status === 'congelado' || c.status === 'consolidado';
  const codigoOrigem = c.origem_codigo || (c.origem_id ? codigoPorId.get(String(c.origem_id)) : '');

  const selos = [
    i.nAlertas
      ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);"
           title="Alertas de reemissão de FCI por variação de CI% acima do gatilho (RF-083 a RF-086)">⚠ ${i.nAlertas} alerta(s)</span>`
      : '',
    i.nErros
      ? `<span class="chip" style="background:var(--err-bg);color:var(--err-fg);"
           title="Inconsistências de estrutura, origem ou enquadramento que impedem a consolidação (RF-025 · RF-033 · RF-008)">✕ ${i.nErros} erro(s) de validação</span>`
      : '',
    c.modo === 'avancado'
      ? `<span class="chip" style="background:var(--warn-bg);color:var(--warn-fg);"
           title="Modo avançado: edição de quantidades da estrutura e overhead liberada (RF-034)">modo avançado</span>`
      : '',
    (c.base_calculo || 'saida') === 'custo'
      ? `<span class="chip" style="background:var(--line-2);color:var(--ink-3);"
           title="Denominador do CI%: custo de produção, em vez do preço de saída (RF-060)">base: custo</span>`
      : '',
    codigoOrigem
      ? `<span class="chip" style="background:var(--gold-soft);color:var(--gold-d);"
           title="Versão derivada de outro cenário; a origem permanece preservada (RF-003 · RF-008)">⎘ derivado de ${esc(codigoOrigem)}</span>`
      : '',
  ].filter(Boolean).join(' ');

  return `
  <div class="cenario-card" data-id="${esc(c.id)}">
    <div class="cabeca">
      <div style="min-width:0;">
        <div class="nome">${esc(c.nome)}</div>
        <div class="meta">
          <span class="mono">${esc(c.codigo)}</span> ·
          ${esc(ROTULO_TIPO[c.tipo] || c.tipo || 'cenário')}${c.ciclo ? ` ${esc(c.ciclo)}` : ''} ·
          <b>v${esc(c.versao)}</b>
        </div>
      </div>
      <span class="chip-status" style="background:${st.bg};color:${st.fg};"
            title="Status do cenário: ${esc(st.label)} (RF-001 · RN-10)">
        <span class="ponto" style="background:${st.dot};"></span>${st.label}
      </span>
    </div>

    <div class="corpo">
      <div class="metricas">
        <div>
          <div class="r">CI% MÉDIO PONDERADO</div>
          <div class="v" style="color:${corDoCi(i.ciMedio) || 'inherit'};">${pct(i.ciMedio)}</div>
        </div>
        <div>
          <div class="r">PRODUTOS · INSUMOS</div>
          <div class="v">${i.nProdutos} · ${i.nInsumos}</div>
        </div>
        <div>
          <div class="r">&gt; 40%</div>
          <div class="v" style="color:${i.acima40 ? '#a03d2c' : 'inherit'};">${i.acima40}</div>
        </div>
      </div>

      <div class="barra-faixas"
           title="Distribuição dos produtos por faixa legal (RN-05): ${dist.baixo} até 40% · ${dist.medio} de 40% a 70% · ${dist.alto} acima de 70%">
        <div style="width:${(dist.baixo / totalFaixas * 100).toFixed(2)}%;background:#3f7d54;"></div>
        <div style="width:${(dist.medio / totalFaixas * 100).toFixed(2)}%;background:#b07d1e;"></div>
        <div style="width:${(dist.alto / totalFaixas * 100).toFixed(2)}%;background:#a03d2c;"></div>
      </div>
      <div class="texto-mini" style="margin-top:5px;">
        ≤ 40%: <b>${dist.baixo}</b> · 40–70%: <b>${dist.medio}</b> · &gt; 70%: <b>${dist.alto}</b>
      </div>

      ${selos ? `<div class="linha-flex" style="gap:5px;margin-top:9px;">${selos}</div>` : ''}

      <div class="autor">
        Autor: ${esc(c.autor_nome || '—')}<br>
        Atualizado em ${dataHora(c.atualizado_em)}
        ${c.origem_dados
          ? `<br>⬇ Carga integrada: ${esc(c.origem_dados)}`
          : '<br>⬇ Carga integrada: — (estrutura ainda não carregada da origem)'}
      </div>
    </div>

    <div class="acoes">
      <button class="btn btn-escuro" style="flex:1;" data-acao="abrir"
        title="Abrir o espaço de simulação do cenário (RF-010 a RF-072)">Abrir simulação →</button>
      <button class="btn btn-borda" data-acao="relatorio"
        title="Relatório executivo do cenário com direcionamentos por área (RF-087 · RF-088)">Relatório</button>
      <button class="btn btn-borda" style="width:34px;padding:0;justify-content:center;" data-acao="duplicar"
        ${podeCriar ? 'title="Duplicar como nova versão — a origem é preservada (RF-003)"' : `disabled title="${motivoCriar}"`}>⎘</button>
      <button class="btn btn-borda" style="width:34px;padding:0;justify-content:center;" data-acao="recarregar"
        ${congelado
          ? `disabled title="Cenário ${esc(st.label.toLowerCase())}: estrutura e premissas travadas para rastreabilidade (RN-10). Duplique-o para simular novamente."`
          : 'title="Recarregar a estrutura da origem preservando as premissas do cenário (RF-005)"'}>⟳</button>
      <button class="btn btn-borda" style="width:34px;padding:0;justify-content:center;" data-acao="historico"
        title="Histórico de alterações e linhagem de versões (RF-006 · RF-008 · RNF-04)">🕘</button>
    </div>
  </div>`;
}

function ligarAcoes(lista, ctx, recarregarTela) {
  lista.querySelectorAll('.cenario-card').forEach((card) => {
    const id = card.dataset.id;
    const botao = (acao) => card.querySelector(`[data-acao="${acao}"]`);

    botao('abrir').addEventListener('click', () => ctx.navegar(`#/sim/${id}`));
    botao('relatorio').addEventListener('click', () => ctx.navegar(`#/relatorio/${id}`));
    botao('historico').addEventListener('click', () => painelHistorico(id, ctx));

    const btnDup = botao('duplicar');
    if (!btnDup.disabled) {
      btnDup.addEventListener('click', () => confirmarDuplicacao(card, id, ctx, recarregarTela));
    }
    const btnRec = botao('recarregar');
    if (!btnRec.disabled) {
      btnRec.addEventListener('click', () => confirmarRecarga(card, id, ctx, recarregarTela));
    }
  });
}

/* --------------------------------------------------------------- RF-001 */

function modalNovo(ctx, aoCriar) {
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;color:var(--gold-d);">▦</div>
      <div style="flex:1;">
        <h2>Novo cenário de simulação</h2>
        <div class="sub">Identificador único, versão 1, status Rascunho, autor e data de criação (RF-001).
        A estrutura de produtos e insumos é carregada das fontes integradas, sem digitação manual (RF-002).</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="campo"><span>NOME DO CENÁRIO</span>
        <input id="m-nome" placeholder="ex.: Orçamento Anual 2027" autocomplete="off" autofocus></div>
      <div class="grid-2">
        <div class="campo"><span>TIPO DE CENÁRIO</span>
          <select id="m-tipo">
            <option value="orcamento">Orçamento anual</option>
            <option value="revisao" selected>Revisão mensal</option>
          </select>
        </div>
        <div class="campo"><span>CICLO</span>
          <input id="m-ciclo" placeholder="ex.: 2027 ou Set/2026" autocomplete="off"></div>
      </div>
      <div class="aviso-info">
        O cenário nasce <b>isolado</b>: alterações feitas nele não afetam outros cenários nem o
        cadastro oficial de origem (RF-007 · RNF-06). O ambiente é analítico e não possui validade
        fiscal (RN-12).
      </div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="m-criar">Criar cenário</button>
    </div>`);

  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = ctx.fecharModal; });

  wrap.querySelector('#m-criar').onclick = async () => {
    const nome = wrap.querySelector('#m-nome').value.trim();
    if (!nome) {
      ctx.toast('Informe o nome do cenário para criá-lo (RF-001).', 'erro');
      wrap.querySelector('#m-nome').focus();
      return;
    }
    const botao = wrap.querySelector('#m-criar');
    botao.disabled = true;
    botao.textContent = 'Criando e carregando estrutura…';
    try {
      const r = await ctx.api.post('/cenarios', {
        nome,
        tipo: wrap.querySelector('#m-tipo').value,
        ciclo: wrap.querySelector('#m-ciclo').value.trim(),
      });
      const dados = (r.cenario && r.cenario.dados) || {};
      ctx.fecharModal();
      ctx.toast(
        `Cenário ${r.cenario.codigo} (v${r.cenario.versao}) criado com estrutura integrada: `
        + `${(dados.produtos || []).length} produto(s) e ${(dados.insumos || []).length} insumo(s) (RF-001 · RF-002).`,
        'ok');
      if (aoCriar) await aoCriar();
      ctx.navegar(`#/sim/${r.cenario.id}`);
    } catch (err) {
      ctx.toast(err.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Criar cenário';
    }
  };
}

/* --------------------------------------------------------------- RF-003 */

function confirmarDuplicacao(card, id, ctx, aoConcluir) {
  const nome = card.querySelector('.nome').textContent.trim();
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;color:var(--gold-d);">⎘</div>
      <div style="flex:1;">
        <h2>Duplicar como nova versão</h2>
        <div class="sub">RF-003 · RF-008 — a cópia nasce em Rascunho, com a versão seguinte e a mesma linhagem.</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="aviso-info">
        Será criada uma nova versão de <b>${esc(nome)}</b> com todas as premissas atuais
        (câmbio, origem e conteúdo, preços, volumes, substituições e overhead).
        <b>O cenário de origem é integralmente preservado</b> e continua disponível para consulta e
        comparação (RF-003 · RF-007). As duas versões passam a compor a mesma linhagem (RF-008).
      </div>
      <div class="texto-mini">
        Use a duplicação para simular hipóteses sobre um cenário congelado ou consolidado sem
        perder a rastreabilidade da decisão já registrada (RN-10).
      </div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="d-ok">Duplicar preservando a origem</button>
    </div>`);

  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = ctx.fecharModal; });

  wrap.querySelector('#d-ok').onclick = async () => {
    const botao = wrap.querySelector('#d-ok');
    botao.disabled = true;
    botao.textContent = 'Duplicando…';
    try {
      const r = await ctx.api.post(`/cenarios/${id}/duplicar`, {});
      ctx.fecharModal();
      ctx.toast(
        `Nova versão ${r.cenario.codigo} (v${r.cenario.versao}) criada. `
        + 'O cenário de origem permanece intacto (RF-003 · RF-007 · RF-008).',
        'ok');
      if (aoConcluir) await aoConcluir();
    } catch (err) {
      ctx.toast(err.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Duplicar preservando a origem';
    }
  };
}

/* --------------------------------------------------------------- RF-005 */

function confirmarRecarga(card, id, ctx, aoConcluir) {
  const nome = card.querySelector('.nome').textContent.trim();
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:17px;">⟳</div>
      <div style="flex:1;">
        <h2>Recarregar a estrutura a partir da origem</h2>
        <div class="sub">RF-005 — relê a estrutura e os dados mestres das fontes integradas,
        preservando as premissas já informadas no cenário.</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div class="aviso-restricao">
        A estrutura de <b>${esc(nome)}</b> será relida das fontes integradas. <b>São preservadas</b>
        as premissas do cenário: câmbio, origem e conteúdo de importação, preços, volumes por UF,
        substituições aplicadas e overhead (RF-005).
      </div>
      <div class="texto-mini">
        Itens que deixaram de existir na origem e divergências de cadastro são apontados no
        diagnóstico de validação do cenário (RF-025 · RF-033) para tratamento antes do recálculo.
        A leitura é unidirecional: nada é gravado nos sistemas de origem (RNF-06).
      </div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="rc-ok">Recarregar da origem</button>
    </div>`);

  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => { b.onclick = ctx.fecharModal; });

  wrap.querySelector('#rc-ok').onclick = async () => {
    const botao = wrap.querySelector('#rc-ok');
    botao.disabled = true;
    botao.textContent = 'Recarregando…';
    try {
      const r = await ctx.api.post(`/cenarios/${id}/recarregar`, {});
      const v = r.validacao || {};
      const nErros = v.nErros != null ? v.nErros : 0;
      const nAvisos = v.nAvisos != null ? v.nAvisos : 0;
      ctx.fecharModal();
      ctx.toast(
        `Estrutura recarregada de ${r.cenario.origem_dados || 'origem integrada'} — `
        + `${nErros} erro(s) e ${nAvisos} aviso(s) no diagnóstico (RF-005 · RF-025).`,
        nErros ? 'erro' : 'ok');
      if (aoConcluir) await aoConcluir();
    } catch (err) {
      ctx.toast(err.message, 'erro');
      botao.disabled = false;
      botao.textContent = 'Recarregar da origem';
    }
  };
}

/* ------------------------------------------------------- RF-006 · RF-008 */

async function painelHistorico(id, ctx) {
  const painel = ctx.abrirPainel(`
    <header>
      <div style="flex:1;">
        <h2 style="margin:0;font-size:14px;font-weight:600;">Histórico e versões</h2>
        <div class="texto-mini">RF-006 · RF-008 · RNF-04 — autor, data, versão e status de cada alteração</div>
      </div>
      <button class="btn-icone" id="h-fechar" title="Fechar o painel">✕</button>
    </header>
    <div class="corpo"><div class="carregando">Carregando</div></div>`);
  painel.querySelector('#h-fechar').onclick = ctx.fecharPainel;

  try {
    const h = await ctx.api.get(`/cenarios/${id}/eventos`);
    const c = h.cenario || {};
    const st = ST[c.status] || ST.rascunho;
    const versoes = h.versoes || [];
    const eventos = h.eventos || [];

    painel.querySelector('.corpo').innerHTML = `
      <div class="painel-secao">
        <header>SITUAÇÃO ATUAL</header>
        <div class="conteudo" style="font-size:11.5px;">
          <div><b class="mono">${esc(c.codigo || '')}</b> · versão ${esc(c.versao || '')} ·
            <span class="chip" style="background:${st.bg};color:${st.fg};">${st.label}</span></div>
          <div class="texto-mini">Autor: ${esc(c.autor || '—')}</div>
          <div class="texto-mini">Criado em ${dataHora(c.criadoEm)}</div>
          ${c.congeladoEm ? `<div class="texto-mini">Congelado em ${dataHora(c.congeladoEm)} (RF-005 · RN-10)</div>` : ''}
          ${c.consolidadoEm ? `<div class="texto-mini">Consolidado em ${dataHora(c.consolidadoEm)} (RF-008)</div>` : ''}
          ${c.origemDados ? `<div class="texto-mini">Carga integrada: ${esc(c.origemDados)}</div>` : ''}
        </div>
      </div>

      <div class="painel-secao">
        <header>LINHAGEM DE VERSÕES (RF-008) · ${versoes.length}</header>
        <div class="conteudo">
          ${versoes.length ? versoes.map((v) => {
            const sv = ST[v.status] || ST.rascunho;
            const atual = String(v.id) === String(id);
            return `<div class="linha-flex" style="gap:9px;font-size:11.5px;${atual ? 'font-weight:600;' : ''}">
              <span class="chip" style="background:${sv.bg};color:${sv.fg};">v${esc(v.versao)}</span>
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                    title="${esc(v.nome)} · ${esc(sv.label)}">${esc(v.nome)}</span>
              ${atual ? '<span class="texto-mini">atual</span>' : `<a href="#/sim/${esc(v.id)}" style="font-size:10.5px;">abrir</a>`}
            </div>`;
          }).join('') : '<div class="texto-mini">Cenário sem versões derivadas.</div>'}
        </div>
      </div>

      <div class="painel-secao">
        <header>EVENTOS REGISTRADOS (RF-006 · RNF-04) · ${eventos.length}</header>
        <div class="conteudo" style="gap:0;">
          ${eventos.length ? eventos.map((e) => `
            <div class="timeline-item" style="flex-direction:column;gap:2px;">
              <div style="font-size:11.5px;font-weight:600;">${esc(e.acao)}</div>
              <div style="font-size:11px;color:var(--ink-2);line-height:1.5;">${esc(e.detalhe || '')}</div>
              <div class="texto-mini">
                ${esc(e.autor_nome || 'sistema')}${e.autor_area ? ` · ${esc(e.autor_area)}` : ''} · ${dataHora(e.criado_em)}
              </div>
            </div>`).join('') : '<div class="texto-mini">Nenhum evento registrado.</div>'}
        </div>
      </div>

      <div class="texto-mini" style="padding:0 2px;">
        Todo evento relevante do cenário é registrado com autor, área, data e status, compondo a
        trilha de auditoria da decisão (RF-006 · RNF-04).
      </div>`;
  } catch (err) {
    painel.querySelector('.corpo').innerHTML =
      `<div class="aviso-erro"><span>✕</span><div>${esc(err.message)}</div></div>`;
    ctx.toast(err.message, 'erro');
  }
}
