'use strict';
/**
 * Comparação de cenários (RF-073 a RF-079).
 *
 * Cobre a seleção de até dez cenários simultâneos (RF-073), a matriz de CI%
 * por produto e cenário com faixa e amplitude (RF-074), o drill-down do
 * produto até os insumos dos intermediários (RF-075 · RF-076), a série
 * comparativa do produto em foco (RF-077) e o painel lateral que altera um
 * cenário sem sair da tela, devolvendo a matriz já recalculada
 * (RF-078 · RF-079).
 *
 * Regra de ouro da arquitetura: TODA regra de cálculo vive no motor
 * compartilhado (shared/engine.mjs). Este serviço apenas orquestra — resolve a
 * seleção do usuário, carrega os snapshots dos cenários, delega ao motor e, nas
 * alterações do painel, reaproveita os serviços de simulação já existentes
 * (que gravam o snapshot e registram o evento de auditoria). Nenhuma base de
 * origem é alterada (RNF-06) e as mensagens são em português (RNF-03).
 */
const { query } = require('../db');
const { eventoCenario } = require('../audit');
const { engine } = require('../engine');
const simulacao = require('./simulacao.service');

// ---------------------------------------------------------------------------
// Apoio comum
// ---------------------------------------------------------------------------

/** Erro de regra de negócio apresentado ao usuário em português (RNF-03). */
function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

/**
 * Erros lançados pelo motor chegam sem status HTTP — são violações de regra de
 * estrutura e viram 422 (entidade não processável), preservando a mensagem.
 */
function comoRegra(fn) {
  try {
    return fn();
  } catch (err) {
    if (!err.status) err.status = 422;
    throw err;
  }
}

/**
 * Parâmetros mestres consumidos pelo motor (RF-096 a RF-099).
 * Reaproveita a leitura única da governança; caso o módulo não esteja
 * disponível, a leitura local da tabela «parametros» mantém a comparação
 * operante (nenhuma tela depende de outro domínio para abrir).
 */
async function carregarParametros() {
  try {
    const gov = require('./governanca.service');
    if (gov && typeof gov.carregarParametros === 'function') return gov.carregarParametros();
  } catch (err) { /* governança indisponível — segue com a leitura local */ }
  return carregarParametrosLocal();
}

/** Leitura local equivalente dos parâmetros mestres (contingência). */
async function carregarParametrosLocal() {
  const E = engine();
  const { rows } = await query('SELECT chave, valor FROM parametros');
  const p = Object.fromEntries(rows.map((r) => [r.chave, r.valor || {}]));
  const st = p.st || { mva: 30, aliqInterna: 18, aliqNormal: 12 };
  return {
    gatilho: p.gatilho_reemissao && p.gatilho_reemissao.pp != null ? Number(p.gatilho_reemissao.pp) : 5,
    st,
    aliqNormal: st.aliqNormal != null ? Number(st.aliqNormal) : 12,
    versaoFormula: (p.motor && p.motor.versaoFormula) || E.VERSAO_FORMULA_PADRAO,
    faixas: p.faixas, aliquotas: p.aliquotas, moedas: p.moedas,
  };
}

/** Identificador numérico de cenário informado pela tela. */
function idCenario(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!/^\d+$/.test(texto) || Number(texto) <= 0) {
    throw erro(404, `Identificador de cenário inválido: «${texto || '—'}».`);
  }
  return Number(texto);
}

/**
 * Lista de cenários da comparação, aceita como arranjo (corpo JSON) ou como
 * texto separado por vírgulas (query string `ids=1,2,3`). A ordem informada é
 * preservada — ela define a ordem das colunas da matriz — e as repetições são
 * descartadas.
 */
function listaIds(valor) {
  let bruto = [];
  if (Array.isArray(valor)) bruto = valor;
  else if (typeof valor === 'string') bruto = valor.split(',');
  else if (valor != null && valor !== '') bruto = [valor];

  const ids = [];
  for (const v of bruto) {
    const texto = String(v == null ? '' : v).trim();
    if (!texto) continue;
    if (!/^\d+$/.test(texto) || Number(texto) <= 0) {
      throw erro(422, `Identificador de cenário inválido na seleção da comparação: «${texto}».`);
    }
    const n = Number(texto);
    if (!ids.includes(n)) ids.push(n);
  }
  return ids;
}

/** RF-073 — a comparação aceita no máximo dez cenários simultâneos. */
function garantirLimite(E, ids) {
  if (ids.length > E.LIMITE_COMPARACAO) {
    throw erro(
      422,
      `A comparação aceita no máximo ${E.LIMITE_COMPARACAO} cenários simultâneos — ` +
      `foram informados ${ids.length}. Retire ${ids.length - E.LIMITE_COMPARACAO} cenário(s) da seleção ` +
      'para prosseguir (RF-073).'
    );
  }
}

/**
 * RN-10 — cenário congelado (RF-005) ou consolidado (RF-008) recusa qualquer
 * edição, inclusive as feitas pelo painel lateral da comparação (RF-078).
 */
function garantirEditavel(cenario) {
  if (cenario.status === 'congelado' || cenario.status === 'consolidado') {
    throw erro(
      409,
      `Cenário ${cenario.codigo} está ${cenario.status} — as premissas estão travadas para rastreabilidade e ` +
      'o painel lateral da comparação não aceita alterações. Duplique o cenário como nova versão para ' +
      'continuar simulando (RN-10).'
    );
  }
}

/**
 * Snapshots dos cenários selecionados, na ordem informada.
 * Somente as colunas necessárias à comparação são lidas.
 */
async function carregarCenarios(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT id, codigo, nome, versao, status, ciclo, autor_nome, base_calculo, dados
       FROM cenarios WHERE id = ANY($1)`,
    [ids]
  );
  const porId = new Map(rows.map((r) => [Number(r.id), Object.assign({}, r, { id: Number(r.id), dados: r.dados || {} })]));
  const faltando = ids.filter((i) => !porId.has(i));
  if (faltando.length) {
    throw erro(404, `Cenário(s) da comparação não encontrado(s): ${faltando.join(', ')}. Atualize a seleção (RF-073).`);
  }
  return ids.map((i) => porId.get(i));
}

/** Um único cenário, com o snapshot completo. */
async function carregarCenario(id) {
  const [cenario] = await carregarCenarios([idCenario(id)]);
  return cenario;
}

/**
 * Cenários mais recentes, usados quando o usuário ainda não salvou nenhuma
 * seleção. Devolvidos em ordem crescente de identificador para que as colunas
 * da matriz sigam a cronologia de criação.
 */
async function idsRecentes(limite) {
  const { rows } = await query('SELECT id FROM cenarios ORDER BY id DESC LIMIT $1', [limite]);
  return rows.map((r) => Number(r.id)).sort((a, b) => a - b);
}

/** Cenários disponíveis para inclusão e exclusão imediatas na tela (RF-073). */
async function cenariosDisponiveis() {
  const { rows } = await query(
    `SELECT id, codigo, nome, versao, status, tipo, ciclo, autor_nome, base_calculo, atualizado_em
       FROM cenarios ORDER BY id DESC`
  );
  return rows.map((r) => ({
    id: Number(r.id), codigo: r.codigo, nome: r.nome, versao: r.versao, status: r.status,
    tipo: r.tipo, ciclo: r.ciclo, autor: r.autor_nome, base: r.base_calculo,
    atualizadoEm: r.atualizado_em,
  }));
}

/** Seleção gravada do usuário (RF-073). */
async function selecaoGravada(usuarioId) {
  const { rows } = await query(
    'SELECT cenario_ids, prod_foco, atualizado_em FROM comparacao_selecao WHERE usuario_id = $1',
    [usuarioId]
  );
  if (!rows[0]) return null;
  return {
    ids: (rows[0].cenario_ids || []).map(Number),
    prodFoco: rows[0].prod_foco == null ? null : String(rows[0].prod_foco),
    atualizadoEm: rows[0].atualizado_em,
  };
}

/**
 * Resolve a seleção efetiva da comparação, nesta ordem de precedência:
 *   1. identificadores informados na chamada;
 *   2. seleção gravada do usuário (tabela comparacao_selecao);
 *   3. cenários mais recentes, até o limite do RF-073.
 */
async function resolverSelecao(E, usuario, idsInformados) {
  if (idsInformados && idsInformados.length) {
    garantirLimite(E, idsInformados);
    const gravada = await selecaoGravada(usuario.id);
    return {
      ids: idsInformados, origem: 'informada',
      prodFoco: gravada ? gravada.prodFoco : null,
      atualizadoEm: gravada ? gravada.atualizadoEm : null,
    };
  }
  const gravada = await selecaoGravada(usuario.id);
  if (gravada && gravada.ids.length) {
    return {
      ids: gravada.ids.slice(0, E.LIMITE_COMPARACAO), origem: 'salva',
      prodFoco: gravada.prodFoco, atualizadoEm: gravada.atualizadoEm,
    };
  }
  return {
    ids: await idsRecentes(E.LIMITE_COMPARACAO), origem: 'recentes',
    prodFoco: null, atualizadoEm: null,
  };
}

/** RF-060 — base do denominador aplicada à comparação. */
function baseDa(baseInformada, cenarios) {
  const pedida = String(baseInformada == null ? '' : baseInformada).trim();
  if (pedida === 'saida' || pedida === 'custo') return pedida;
  if (pedida) {
    throw erro(422, `Base de cálculo inválida: «${pedida}». Use «saida» (média ponderada das saídas interestaduais) ou «custo» (custo total) — RF-060.`);
  }
  const primeiro = cenarios[0];
  return (primeiro && (primeiro.base_calculo || (primeiro.dados || {}).base)) || 'saida';
}

/**
 * Visão completa da comparação: matriz (RF-074) e série do produto em foco
 * (RF-077). Quando o foco salvo não existe mais nos cenários selecionados, o
 * primeiro produto da matriz assume o foco e a troca é sinalizada à tela.
 */
function montarVisao(E, cenarios, base, params, prodFocoPedido) {
  const matriz = comoRegra(() => E.matrizComparativa(cenarios, base, params));
  const pedido = prodFocoPedido == null || prodFocoPedido === '' ? null : String(prodFocoPedido);
  const existe = !!pedido && matriz.linhas.some((l) => String(l.prodId) === pedido);
  const prodFoco = existe ? pedido : (matriz.linhas.length ? String(matriz.linhas[0].prodId) : null);
  const serie = prodFoco ? comoRegra(() => E.serieComparativa(cenarios, prodFoco, base, params)) : null;
  return {
    matriz,
    prodFoco,
    prodFocoAjustado: !!pedido && !existe,
    serie,
    produtos: matriz.linhas.map((l) => ({ prodId: l.prodId, sku: l.sku, nome: l.nome })),
  };
}

// ---------------------------------------------------------------------------
// Seleção de cenários (RF-073)
// ---------------------------------------------------------------------------

/**
 * Painel da comparação com a seleção vigente e a matriz correspondente.
 * Sem seleção gravada, abre com os cenários mais recentes.
 */
async function visaoAtual(usuario, { ids, base, prodFoco } = {}) {
  const E = engine();
  const selecao = await resolverSelecao(E, usuario, listaIds(ids));
  const cenarios = await carregarCenarios(selecao.ids);
  const params = await carregarParametros();
  const baseUsada = baseDa(base, cenarios);
  const visao = montarVisao(E, cenarios, baseUsada, params, prodFoco != null && prodFoco !== '' ? prodFoco : selecao.prodFoco);

  return {
    selecao: {
      cenarioIds: selecao.ids,
      prodFoco: visao.prodFoco,
      origem: selecao.origem,              // informada | salva | recentes
      atualizadoEm: selecao.atualizadoEm,
      limite: E.LIMITE_COMPARACAO,         // RF-073
      total: selecao.ids.length,
      vagas: Math.max(0, E.LIMITE_COMPARACAO - selecao.ids.length),
    },
    base: baseUsada,
    matriz: visao.matriz,
    serie: visao.serie,
    produtos: visao.produtos,
    prodFocoAjustado: visao.prodFocoAjustado,
    disponiveis: await cenariosDisponiveis(),
    parametros: params,
    capacidadesPainel: CAPACIDADE_POR_TIPO,   // RF-078 — o que o painel permite editar
  };
}

/**
 * RF-073 — grava a seleção do usuário. A inclusão e a exclusão são imediatas:
 * a resposta já traz a matriz recalculada para a nova seleção.
 */
async function salvarSelecao(usuario, { cenarioIds, prodFoco, base } = {}) {
  const E = engine();
  const ids = listaIds(cenarioIds);
  garantirLimite(E, ids);
  if (!ids.length) {
    throw erro(422, 'Selecione ao menos um cenário para a comparação (RF-073).');
  }

  const cenarios = await carregarCenarios(ids);
  const params = await carregarParametros();
  const baseUsada = baseDa(base, cenarios);
  const visao = montarVisao(E, cenarios, baseUsada, params, prodFoco);

  const { rows } = await query(
    `INSERT INTO comparacao_selecao (usuario_id, cenario_ids, prod_foco, atualizado_em)
          VALUES ($1, $2, $3, now())
     ON CONFLICT (usuario_id)
       DO UPDATE SET cenario_ids = EXCLUDED.cenario_ids,
                     prod_foco   = EXCLUDED.prod_foco,
                     atualizado_em = now()
     RETURNING cenario_ids, prod_foco, atualizado_em`,
    [usuario.id, ids, visao.prodFoco]
  );

  return {
    selecao: {
      cenarioIds: (rows[0].cenario_ids || []).map(Number),
      prodFoco: rows[0].prod_foco,
      origem: 'salva',
      atualizadoEm: rows[0].atualizado_em,
      limite: E.LIMITE_COMPARACAO,
      total: ids.length,
      vagas: Math.max(0, E.LIMITE_COMPARACAO - ids.length),
    },
    base: baseUsada,
    matriz: visao.matriz,
    serie: visao.serie,
    produtos: visao.produtos,
    prodFocoAjustado: visao.prodFocoAjustado,
  };
}

// ---------------------------------------------------------------------------
// Matriz, drill-down e série (RF-074 a RF-077)
// ---------------------------------------------------------------------------

/** RF-074 — matriz de CI% por produto e cenário, com faixa e amplitude. */
async function matriz(usuario, { ids, base, prodFoco } = {}) {
  const E = engine();
  const selecao = await resolverSelecao(E, usuario, listaIds(ids));
  const cenarios = await carregarCenarios(selecao.ids);
  const params = await carregarParametros();
  const baseUsada = baseDa(base, cenarios);
  const visao = montarVisao(E, cenarios, baseUsada, params, prodFoco != null && prodFoco !== '' ? prodFoco : selecao.prodFoco);

  return {
    base: baseUsada,
    cenarioIds: selecao.ids,
    origemSelecao: selecao.origem,
    limite: E.LIMITE_COMPARACAO,
    matriz: visao.matriz,
    serie: visao.serie,
    produtos: visao.produtos,
    prodFoco: visao.prodFoco,
    prodFocoAjustado: visao.prodFocoAjustado,
  };
}

/**
 * RF-075 · RF-076 — drill-down do produto até os insumos dos componentes
 * intermediários. Cada nó declara se é expansível e a base do seu nível; a
 * conferência confirma que, no nível do produto, as contribuições somam o CI%
 * apresentado.
 */
async function drill(usuario, { cenarioId, prodId, base } = {}) {
  const E = engine();
  const cenario = await carregarCenario(cenarioId);
  const dados = cenario.dados || {};
  const params = await carregarParametros();
  const baseUsada = baseDa(base, [cenario]);

  const acabados = (dados.produtos || []).filter((p) => (p.tipo || 'PA') === 'PA');
  const alvo = prodId == null || prodId === '' ? (acabados[0] || {}).id : String(prodId);
  if (!alvo) {
    throw erro(422, `Cenário ${cenario.codigo} não possui produtos acabados carregados. Recarregue a estrutura do ERP (RF-002).`);
  }
  if (!E.acharProduto(dados, alvo)) {
    throw erro(404, `Produto «${alvo}» não encontrado na estrutura do cenário ${cenario.codigo}.`);
  }

  const detalhe = comoRegra(() => E.drillDown(dados, alvo, baseUsada, params));

  return {
    cenario: {
      id: cenario.id, codigo: cenario.codigo, nome: cenario.nome,
      versao: cenario.versao, status: cenario.status, ciclo: cenario.ciclo,
      autor: cenario.autor_nome,
    },
    prodId: alvo,
    base: baseUsada,
    drill: detalhe,
    niveis: detalhe.niveis,
    resultado: detalhe.resultado,
    // RF-076 — base de cada nível declarada e soma das contribuições conferida
    notaBase: detalhe.notaBase,
    conferencia: detalhe.conferencia,
    somaContribuicoesPp: detalhe.somaContribuicoesPp,
    produtos: acabados.map((p) => ({ prodId: p.id, sku: p.sku, nome: p.nome, tipo: p.tipo || 'PA' })),
  };
}

/** RF-077 — série comparativa do CI% do produto em foco entre os cenários. */
async function serie(usuario, { ids, prodId, base } = {}) {
  const E = engine();
  const selecao = await resolverSelecao(E, usuario, listaIds(ids));
  const cenarios = await carregarCenarios(selecao.ids);
  const params = await carregarParametros();
  const baseUsada = baseDa(base, cenarios);

  const matrizAtual = comoRegra(() => E.matrizComparativa(cenarios, baseUsada, params));
  const pedido = prodId == null || prodId === '' ? (selecao.prodFoco || null) : String(prodId);
  const existe = !!pedido && matrizAtual.linhas.some((l) => String(l.prodId) === pedido);
  const alvo = existe ? pedido : (matrizAtual.linhas.length ? String(matrizAtual.linhas[0].prodId) : null);
  if (!alvo) {
    throw erro(422, 'Os cenários selecionados não possuem produtos acabados em comum para a série comparativa (RF-077).');
  }

  return {
    base: baseUsada,
    cenarioIds: selecao.ids,
    prodId: alvo,
    prodFocoAjustado: !!pedido && !existe,
    serie: comoRegra(() => E.serieComparativa(cenarios, alvo, baseUsada, params)),
    produtos: matrizAtual.linhas.map((l) => ({ prodId: l.prodId, sku: l.sku, nome: l.nome })),
  };
}

// ---------------------------------------------------------------------------
// Painel lateral de edição sem sair da comparação (RF-078 · RF-079)
// ---------------------------------------------------------------------------

/**
 * RF-078 — o painel lateral edita câmbio, classificação e conteúdo de
 * importação dos insumos, preço e proporções de substituição. Cada tipo exige
 * a capacidade correspondente da matriz de permissões (RF-035 · RF-039).
 */
const CAPACIDADE_POR_TIPO = {
  cambio: 'editarFornecedor',
  insumo: 'editarFiscal',
  preco: 'editarSaida',
  proporcao: 'substituir',
};

const ROTULO_POR_TIPO = {
  cambio: 'cotação da moeda',
  insumo: 'classificação e conteúdo de importação do insumo',
  preco: 'preço da UF de destino',
  proporcao: 'proporção da substituição',
};

/** Capacidade exigida pelo tipo de alteração do painel (RF-078). */
function capacidadeDoTipo(tipo) {
  const chave = String(tipo == null ? '' : tipo).trim();
  const capacidade = CAPACIDADE_POR_TIPO[chave];
  if (!capacidade) {
    throw erro(
      422,
      `Tipo de alteração não aceito pelo painel da comparação: «${chave || '—'}». ` +
      `Tipos aceitos (RF-078): ${Object.keys(CAPACIDADE_POR_TIPO).join(', ')}.`
    );
  }
  return capacidade;
}

/**
 * Ajuste do preço de uma UF de destino pelo painel (RF-066 · RF-078).
 * A lista completa de saídas é remontada com o novo preço e entregue ao
 * serviço de simulação, que aplica a regra, preserva a referência da carga e
 * registra o evento — nada é recalculado aqui.
 */
async function alterarPreco(E, cenario, { prodId, uf, preco }, usuario) {
  const dados = cenario.dados || {};
  const prod = E.acharProduto(dados, prodId);
  if (!prod) {
    throw erro(404, `Produto «${prodId == null ? '—' : prodId}» não encontrado na estrutura do cenário ${cenario.codigo}.`);
  }
  const alvo = String(uf == null ? '' : uf).trim().toUpperCase();
  if (!E.UFS.includes(alvo)) {
    throw erro(422, `UF inválida: «${uf == null ? '—' : uf}». Informe uma unidade da Federação de destino (RF-066).`);
  }
  const valor = E.n(preco, NaN);
  if (!Number.isFinite(valor) || valor < 0) {
    throw erro(422, `Informe o preço da UF ${alvo} como um número igual ou maior que zero (RF-066).`);
  }
  const atuais = prod.saidas || [];
  if (!atuais.some((s) => String(s.uf).toUpperCase() === alvo)) {
    throw erro(
      422,
      `A UF ${alvo} não consta nos destinos de «${prod.nome}» neste cenário. Inclua o destino na tela de ` +
      'volumes e destinos antes de ajustar o preço pelo painel da comparação (RF-066 · RF-078).'
    );
  }
  const saidas = atuais.map((s) => {
    const codigo = String(s.uf).toUpperCase();
    return { uf: codigo, volume: E.n(s.volume), preco: codigo === alvo ? valor : E.n(s.preco) };
  });
  return simulacao.atualizarSaidas(cenario.id, { prodId: String(prodId), saidas }, usuario);
}

/** Despacha a alteração do painel ao serviço de simulação correspondente. */
async function aplicarAlteracao(E, cenario, alteracao, usuario) {
  const tipo = String(alteracao.tipo).trim();
  if (tipo === 'cambio') {
    // RF-052 · RF-054 — a nova cotação recalcula todos os insumos da moeda
    return simulacao.atualizarCambio(cenario.id, { moeda: alteracao.moeda, cotacao: alteracao.cotacao }, usuario);
  }
  if (tipo === 'insumo') {
    // RF-046 a RF-051 · RF-058 · RF-059 — classificação, conteúdo e custos
    const campos = alteracao.campos;
    if (!campos || typeof campos !== 'object' || Array.isArray(campos) || !Object.keys(campos).length) {
      throw erro(422, 'Informe em «campos» ao menos um atributo do insumo a alterar pelo painel (RF-078).');
    }
    return simulacao.atualizarInsumo(cenario.id, { ref: alteracao.ref, campos }, usuario);
  }
  if (tipo === 'preco') {
    return alterarPreco(E, cenario, alteracao, usuario);
  }
  // RF-017 · RF-023 — proporção entre o item original e o substituto
  const idx = E.n(alteracao.idx, NaN);
  const mi = E.n(alteracao.mi, NaN);
  const pct = E.n(alteracao.pct, NaN);
  if (!Number.isInteger(idx) || idx < 0) {
    throw erro(422, 'Informe «idx» como a posição inteira do componente na ficha técnica (RF-017).');
  }
  if (!Number.isInteger(mi) || mi < 0) {
    throw erro(422, 'Informe «mi» como o índice inteiro da alternativa dentro do componente (RF-017).');
  }
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw erro(422, 'A proporção deve ser um número entre 0 e 100 (RF-017 · RF-023).');
  }
  return simulacao.ajustarProporcao(cenario.id, { prodId: alteracao.prodId, idx, mi, pct }, usuario);
}

/**
 * RF-078 · RF-079 — aplica uma alteração pontual no cenário sem sair da
 * comparação e devolve a matriz já recalculada, de modo que as colunas do
 * cenário alterado mudem sem recarregar a tela.
 *
 * A capacidade exigida é verificada na rota (RF-035 · RF-100); aqui o
 * congelamento é recusado com 409 (RN-10), a alteração é delegada ao serviço de
 * simulação — que grava o snapshot e audita (RNF-04) — e a matriz é remontada
 * sobre a seleção vigente da comparação.
 */
async function painel(usuario, { cenarioId, alteracao, ids, base, prodFoco } = {}) {
  const E = engine();
  if (!alteracao || typeof alteracao !== 'object' || Array.isArray(alteracao)) {
    throw erro(422, 'Envie «alteracao» com o tipo e os campos da edição do painel (RF-078).');
  }
  const tipo = String(alteracao.tipo == null ? '' : alteracao.tipo).trim();
  capacidadeDoTipo(tipo);

  const id = idCenario(cenarioId);
  const cenario = await carregarCenario(id);
  garantirEditavel(cenario);                       // RN-10

  const efeito = await aplicarAlteracao(E, cenario, Object.assign({}, alteracao, { tipo }), usuario);

  // RNF-04 — registra que a alteração foi feita pelo painel da comparação
  await eventoCenario(id, usuario, 'comparacao-painel', {
    requisito: 'RF-078 · RF-079',
    tipo,
    rotulo: ROTULO_POR_TIPO[tipo],
    capacidade: CAPACIDADE_POR_TIPO[tipo],
    alteracao,
  });

  // RF-079 — matriz recalculada imediatamente sobre a seleção vigente
  const selecao = await resolverSelecao(E, usuario, listaIds(ids));
  const idsMatriz = selecao.ids.includes(id)
    ? selecao.ids
    : [id].concat(selecao.ids).slice(0, E.LIMITE_COMPARACAO);
  const cenarios = await carregarCenarios(idsMatriz);
  const params = await carregarParametros();
  const baseUsada = baseDa(base, cenarios);
  const visao = montarVisao(E, cenarios, baseUsada, params, prodFoco != null && prodFoco !== '' ? prodFoco : selecao.prodFoco);

  return {
    cenario: efeito.cenario,
    validacao: efeito.validacao,                   // RF-025 · RF-032
    confronto: efeito.confronto,                   // RF-031
    matriz: visao.matriz,                          // RF-079
    serie: visao.serie,                            // RF-077
    produtos: visao.produtos,
    prodFoco: visao.prodFoco,
    base: baseUsada,
    cenarioIds: idsMatriz,
    alteracao: {
      tipo, rotulo: ROTULO_POR_TIPO[tipo], capacidade: CAPACIDADE_POR_TIPO[tipo],
      cenarioId: id, codigo: cenario.codigo,
    },
    painel: efeito,                                // apoio da operação (mix, moedas, saídas…)
  };
}

module.exports = {
  // apoio
  carregarParametros, carregarCenarios, carregarCenario, cenariosDisponiveis,
  selecaoGravada, CAPACIDADE_POR_TIPO, ROTULO_POR_TIPO, capacidadeDoTipo,
  // RF-073
  visaoAtual, salvarSelecao,
  // RF-074 a RF-077
  matriz, drill, serie,
  // RF-078 · RF-079
  painel,
};
