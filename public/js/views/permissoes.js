/**
 * Matriz de permissões por área e perfil.
 *
 *   RF-039  matriz de permissões por área e perfil, consultável pelo usuário
 *   RF-035  ação fora do perfil é exibida desabilitada, com o motivo declarado
 *   RF-100  integrações e parâmetros mestres são exclusivos do Administrador (TI)
 *   RNF-09  a tela deriva da MESMA fonte usada pelo servidor para autorizar
 *
 * Tela de consulta — sempre liberada a todos os perfis. As linhas são as áreas
 * da cervejaria; as colunas, as capacidades do simulador agrupadas por domínio.
 * A área do usuário logado é destacada.
 */
import { esc } from '../format.js';

/**
 * Metadados locais das capacidades: grupo de coluna e rótulo curto do cabeçalho.
 * O nome completo vem do servidor (motor · RNF-09); este mapa apenas organiza a
 * apresentação, de modo que a tela permaneça legível mesmo que novas capacidades
 * sejam acrescentadas ao contrato.
 */
const META = {
  // Cenário
  abrir:             { grupo: 'Cenário',       curto: 'Abrir' },
  criarCenario:      { grupo: 'Cenário',       curto: 'Criar / duplicar' },
  salvar:            { grupo: 'Cenário',       curto: 'Salvar premissas' },
  baseCalculo:       { grupo: 'Cenário',       curto: 'Base de cálculo' },
  relatorio:         { grupo: 'Cenário',       curto: 'Relatório' },
  // Premissas
  editarPremissas:   { grupo: 'Premissas',     curto: 'Editar premissas' },
  editarFiscal:      { grupo: 'Premissas',     curto: 'Origem / fiscal' },
  editarFornecedor:  { grupo: 'Premissas',     curto: 'Fornecedor / câmbio' },
  editarSaida:       { grupo: 'Premissas',     curto: 'Volumes / preços' },
  congelar:          { grupo: 'Premissas',     curto: 'Congelar' },
  // Estrutura
  editarEstrutura:   { grupo: 'Estrutura',     curto: 'Alterar estrutura' },
  substituir:        { grupo: 'Estrutura',     curto: 'Substituir item' },
  modoAvancado:      { grupo: 'Estrutura',     curto: 'Modo avançado' },
  massa:             { grupo: 'Estrutura',     curto: 'Lote' },
  // Governança
  submeterValidacao: { grupo: 'Governança',    curto: 'Submeter' },
  validarTecnico:    { grupo: 'Governança',    curto: 'Validar' },
  consolidar:        { grupo: 'Governança',    curto: 'Consolidar' },
  aprovar:           { grupo: 'Governança',    curto: 'Aprovar' },
  // Dados mestres
  integracoes:       { grupo: 'Dados mestres', curto: 'Integrações' },
  parametros:        { grupo: 'Dados mestres', curto: 'Parâmetros' },
  usuarios:          { grupo: 'Dados mestres', curto: 'Usuários' },
};

const ORDEM_GRUPOS = ['Cenário', 'Premissas', 'Estrutura', 'Governança', 'Dados mestres'];
const GRUPO_PADRAO = 'Cenário';

/** Capacidades exclusivas do Administrador de TI (RF-100). */
const SO_ADMIN = ['integracoes', 'parametros', 'usuarios'];

/** Legenda dos perfis da especificação de requisitos (RF-039). */
const PERFIS = [
  {
    nome: 'Simulador',
    cor: 'var(--line-2)', fg: 'var(--ink-2)',
    resumo: 'Cria cenários e simula livremente premissas e substituições.',
    detalhe: 'Abre e cria cenários, edita premissas (câmbio, origem, preços, volumes), aplica '
      + 'substituições e alterações em lote e submete o resultado à validação técnica. '
      + 'Não valida, não congela e não consolida.',
  },
  {
    nome: 'Validador',
    cor: 'var(--ok-bg)', fg: 'var(--ok-fg)',
    resumo: 'Confere a consistência técnica antes de o cenário avançar.',
    detalhe: 'Analisa o diagnóstico de validação, decide sobre as alterações de receita '
      + 'submetidas (RF-037 · RF-038) e devolve o cenário ao simulador quando há pendência. '
      + 'Sem a sua decisão, a consolidação é recusada (RN-11).',
  },
  {
    nome: 'Especialista',
    cor: 'var(--gold-soft)', fg: 'var(--gold-d)',
    resumo: 'Atua sobre a dimensão técnica da sua área de domínio.',
    detalhe: 'Fiscal/Tributário ajusta classificação de origem, CST e conteúdo de importação; '
      + 'Compras trata fornecedor, câmbio e custos de entrada; Pricing e Industrial/PCP tratam '
      + 'preços, volumes por UF e estrutura. Habilita o modo avançado quando a análise exige '
      + 'alterar quantidades e overhead (RF-034).',
  },
  {
    nome: 'Aprovador',
    cor: 'var(--warn-bg)', fg: 'var(--warn-fg)',
    resumo: 'Congela premissas, consolida e aprova o cenário.',
    detalhe: 'Congela o conjunto de premissas para rastreabilidade (RF-005 · RN-10), consolida o '
      + 'cenário como referência da decisão (RF-008) e registra os direcionamentos por área '
      + '(RF-009 · RF-088). A consolidação é recusada com erro de validação pendente (RF-025).',
  },
  {
    nome: 'Administrador',
    cor: 'var(--err-bg)', fg: 'var(--err-fg)',
    resumo: 'Administra os dados mestres e o acesso ao simulador — perfil de TI.',
    detalhe: 'Único perfil com acesso a integrações e fontes de dados (RF-090 a RF-095), '
      + 'parâmetros mestres (RF-096 a RF-099) e cadastro de usuários e perfis. '
      + 'Não decide sobre o conteúdo das simulações.',
  },
];

/* ------------------------------------------------------------------ tela */

export async function telaPermissoes(el, ctx) {
  ctx.definirTopo(
    'Permissões por área e perfil',
    'RF-039 · RF-035 · RF-100 — capacidades habilitadas por área; a consulta permanece liberada a todos os perfis'
  );

  let m;
  try {
    m = await ctx.api.get('/permissoes/matriz');
  } catch (err) {
    el.innerHTML = `<div class="pagina"><div class="aviso-erro"><span>✕</span>
      <div><b>Não foi possível carregar a matriz de permissões.</b> ${esc(err.message)}</div></div></div>`;
    ctx.toast(err.message, 'erro');
    return;
  }

  const usuario = m.usuario || {};
  const areas = m.areas || [];
  const capacidades = ordenarCapacidades(m.capacidades || []);
  const grupos = agrupar(capacidades);

  const minha = areas.find((a) => a.ativa) || null;
  const liberadas = capacidades.filter((c) => temCapacidade(usuario, c.chave));
  const bloqueadas = capacidades.filter((c) => !temCapacidade(usuario, c.chave));

  el.innerHTML = `
  <div class="pagina" style="max-width:1500px;">
    <div class="pilha">

      <!-- Perfil ativo (RF-039) -->
      <div class="rel-bloco" style="margin-bottom:0;">
        <header>
          <h3>Seu perfil ativo</h3>
          <span class="chip" style="background:var(--gold-soft);color:var(--gold-d);">
            ${esc(usuario.perfil || '—')}${usuario.is_admin ? ' · ADMINISTRADOR' : ''}</span>
        </header>
        <div class="rel-ident">
          <div class="campo-ident"><div class="rot">USUÁRIO</div>
            <div class="val">${esc(usuario.nome || '—')}</div></div>
          <div class="campo-ident"><div class="rot">ÁREA</div>
            <div class="val">${esc(usuario.area || '—')}</div></div>
          <div class="campo-ident"><div class="rot">PERFIL</div>
            <div class="val">${esc(usuario.perfil || '—')}</div></div>
          <div class="campo-ident"><div class="rot">CAPACIDADES LIBERADAS</div>
            <div class="val">${liberadas.length} de ${capacidades.length}</div></div>
        </div>
        <div style="padding:0 16px 15px;">
          <div style="font-size:11.5px;color:var(--ink-2);line-height:1.6;margin-bottom:11px;">
            <b>Atribuição:</b> ${esc(usuario.atribuicao || (minha && minha.atribuicao) || 'Participação na simulação conforme a área.')}
          </div>

          <div class="texto-mini" style="font-weight:700;letter-spacing:.3px;margin-bottom:6px;">
            LIBERADO PARA VOCÊ · ${liberadas.length}
          </div>
          <div class="linha-flex" style="gap:6px;">
            ${liberadas.length ? liberadas.map((c) => `
              <span class="chip" style="background:var(--ok-bg);color:var(--ok-fg);"
                    title="${esc(c.rotulo)} — habilitado para ${esc(usuario.perfil || 'o seu perfil')}">
                ✓ ${esc(c.rotulo)}</span>`).join('')
              : '<span class="texto-mini">Nenhuma capacidade de alteração — perfil somente de consulta.</span>'}
          </div>

          ${bloqueadas.length ? `
          <div class="sep" style="margin:12px 0;"></div>
          <div class="texto-mini" style="font-weight:700;letter-spacing:.3px;margin-bottom:6px;">
            NÃO HABILITADO PARA O SEU PERFIL · ${bloqueadas.length}
          </div>
          <div class="linha-flex" style="gap:6px;">
            ${bloqueadas.map((c) => `
              <span class="chip" style="background:var(--line-2);color:var(--ink-3);"
                    title="${esc(c.rotulo)} — ação exibida desabilitada, com o motivo declarado na tela em que aparece (RF-035)">
                · ${esc(c.rotulo)}</span>`).join('')}
          </div>` : ''}
        </div>
      </div>

      <!-- Matriz área × capacidade (RF-039) -->
      <div class="rel-bloco" style="margin-bottom:0;">
        <header>
          <h3>Matriz de capacidades por área · ${areas.length} área(s) × ${capacidades.length} capacidade(s)</h3>
          <span class="texto-mini"><b class="perm-sim">✓</b> habilitado · <b class="perm-nao">·</b> não habilitado</span>
        </header>
        <div style="overflow-x:auto;">
          <table class="perm-tabela">
            <thead>
              <tr>
                <th class="area" rowspan="2">ÁREA · PERFIL</th>
                ${grupos.map((g) => `
                  <th colspan="${g.itens.length}" style="border-left:1px solid var(--line);"
                      title="Grupo de capacidades: ${esc(g.nome)}">${esc(g.nome.toUpperCase())}</th>`).join('')}
              </tr>
              <tr>
                ${capacidades.map((c, i) => `
                  <th title="${esc(c.rotulo)}${SO_ADMIN.includes(c.chave) ? ' — exclusivo do Administrador (TI), conforme RF-100' : ''}"
                      style="${bordaGrupo(capacidades, i)}font-weight:600;">${esc(c.curto)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${areas.map((a) => linhaArea(a, capacidades)).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:11px 16px;border-top:1px solid var(--line-2);">
          <div class="texto-mini">
            A linha destacada é a área do seu usuário${minha ? ` — <b>${esc(minha.area)}</b> · ${esc(minha.perfil || '')}` : ''}.
            Passe o cursor sobre o cabeçalho de cada coluna para ver o nome completo da capacidade e
            sobre cada célula para ver a área, a capacidade e a situação.
          </div>
        </div>
      </div>

      <!-- Legenda dos perfis (RF-039 · RF-100) -->
      <div class="rel-bloco" style="margin-bottom:0;">
        <header>
          <h3>Perfis de acesso</h3>
          <span class="texto-mini">${PERFIS.length} perfis previstos no escopo funcional</span>
        </header>
        <div style="padding:14px 16px;" class="pilha">
          ${PERFIS.map((p) => `
            <div style="display:grid;grid-template-columns:150px 1fr;gap:14px;align-items:start;">
              <div>
                <span class="chip" style="background:${p.cor};color:${p.fg};">${esc(p.nome.toUpperCase())}</span>
                <div class="texto-mini" style="margin-top:5px;">${esc(p.resumo)}</div>
              </div>
              <div style="font-size:11.5px;color:var(--ink-2);line-height:1.6;">${esc(p.detalhe)}</div>
            </div>
            <div class="sep"></div>`).join('')}
          <div class="aviso-restricao" style="margin-bottom:0;">
            <b>Exclusividade do Administrador (RF-100).</b> As telas de
            <a href="#/integracoes">Integrações e fontes de dados</a> (conexão, mapeamento, teste e
            sincronização) e de <a href="#/parametros">Parâmetros mestres</a> (alíquotas, faixas,
            gatilho de reemissão e versão da fórmula) são de uso exclusivo do perfil
            <b>Administrador (TI)</b>. Para os demais perfis essas telas abrem em modo de consulta,
            com os controles de alteração desabilitados e o motivo declarado — a visualização nunca
            é bloqueada.
          </div>
        </div>
      </div>

      <div class="aviso-info">
        <b>Regra de impedimento (RF-035).</b> Ação fora do perfil nunca é escondida: ela aparece
        <b>desabilitada</b>, com o motivo no próprio controle, indicando a capacidade necessária e a
        área responsável. Ao ser tentada por outro caminho, a API devolve a mesma mensagem de
        impedimento (HTTP 403) em lugar de executar. A <b>consulta de cenários, cálculos,
        comparações, alertas e relatórios permanece liberada a todos os perfis</b>: o perfil
        restringe apenas a alteração e a decisão.
      </div>

      <div class="nota-rodape">
        Esta matriz é derivada da mesma definição de capacidades que o servidor usa para autorizar
        cada chamada (RNF-09), de modo que a tela nunca ofereça uma ação que a API recusaria.
        A atribuição de perfil a cada usuário é feita pelo Administrador de TI na tela
        <a href="#/usuarios">Usuários</a>.
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------- auxiliares */

/** Capacidade efetiva do usuário, incluindo a prerrogativa de administrador (RF-100). */
function temCapacidade(usuario, chave) {
  if (usuario.is_admin && SO_ADMIN.includes(chave)) return true;
  return (usuario.acoes || []).includes(chave);
}

/** Normaliza e ordena as colunas por grupo, preservando capacidades novas. */
function ordenarCapacidades(brutas) {
  const lista = brutas.map((c) => {
    const meta = META[c.chave] || {};
    return {
      chave: c.chave,
      rotulo: c.rotulo || meta.curto || c.chave,
      curto: meta.curto || c.rotulo || c.chave,
      grupo: c.grupo || meta.grupo || GRUPO_PADRAO,
    };
  });
  const ordemGrupo = (g) => {
    const i = ORDEM_GRUPOS.indexOf(g);
    return i < 0 ? ORDEM_GRUPOS.length : i;
  };
  const chaves = Object.keys(META);
  const ordemCap = (k) => {
    const i = chaves.indexOf(k);
    return i < 0 ? chaves.length : i;
  };
  return lista.sort((a, b) =>
    ordemGrupo(a.grupo) - ordemGrupo(b.grupo)
    || ordemCap(a.chave) - ordemCap(b.chave)
    || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

function agrupar(capacidades) {
  const grupos = [];
  for (const c of capacidades) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nome === c.grupo) ultimo.itens.push(c);
    else grupos.push({ nome: c.grupo, itens: [c] });
  }
  return grupos;
}

function bordaGrupo(capacidades, i) {
  const primeira = i === 0 || capacidades[i - 1].grupo !== capacidades[i].grupo;
  return primeira ? 'border-left:1px solid var(--line);' : '';
}

/* RF-039 — uma linha por área; a área do usuário recebe a classe .ativa */
function linhaArea(a, capacidades) {
  const permissoes = a.permissoes || {};
  return `
    <tr class="${a.ativa ? 'ativa' : ''}">
      <td class="area" title="${esc(a.atribuicao || a.area)}">
        ${esc(a.area)}${a.ativa
          ? ' <span class="chip" style="background:var(--gold);color:#272525;">sua área</span>'
          : ''}
        <div style="font-weight:400;font-size:10px;color:var(--ink-3);margin-top:1px;">${esc(a.perfil || '—')}</div>
      </td>
      ${capacidades.map((c, i) => {
        const ok = !!permissoes[c.chave];
        return `<td class="${ok ? 'perm-sim' : 'perm-nao'}" style="${bordaGrupo(capacidades, i)}"
                    title="${esc(a.area)} · ${esc(c.rotulo)}: ${ok ? 'habilitado' : 'não habilitado'}">${ok ? '✓' : '·'}</td>`;
      }).join('')}
    </tr>`;
}
