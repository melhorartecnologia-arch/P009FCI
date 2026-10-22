'use strict';
/**
 * Análise assistida dos cenários selecionados (RF-080 · RF-081 · RF-082).
 *
 * Recurso de conversação iterativa sobre o contexto da comparação. As respostas
 * são produzidas pelo motor compartilhado a partir dos dados reais da simulação
 * — citam sempre produtos, cenários e valores existentes no contexto — e o
 * histórico da conversa é mantido na tabela fci.analise_mensagens (RF-080).
 * O catálogo das análises padrão vem do motor (RF-081) e a ressalva de uso
 * gerencial acompanha toda resposta (RF-082).
 *
 * Regra de ouro da arquitetura: TODA regra de negócio vive no motor
 * (shared/engine.mjs). Este serviço apenas orquestra — monta o contexto, chama
 * o motor, grava as mensagens e devolve a conversa. Nenhuma base de origem é
 * alterada (RNF-06) e as mensagens são em português do Brasil (RNF-03).
 */
const { query, transacao } = require('../db');
const { engine } = require('../engine');

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

/** Limite de mensagens devolvidas em uma leitura do histórico (RF-080). */
const LIMITE_HISTORICO = 100;

/**
 * Parâmetros mestres consumidos pelo motor (RF-096 a RF-099).
 * Reaproveita a leitura única da governança; caso o módulo não esteja
 * disponível, a leitura local da tabela «parametros» mantém a análise operante.
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

/**
 * Lista de cenários do contexto, aceita como arranjo (corpo JSON) ou como texto
 * separado por vírgulas. A ordem informada é preservada — o primeiro cenário é
 * o principal das análises de produto — e as repetições são descartadas.
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
      throw erro(422, `Identificador de cenário inválido no contexto da análise: «${texto}».`);
    }
    const n = Number(texto);
    if (!ids.includes(n)) ids.push(n);
  }
  return ids;
}

/**
 * Chave do contexto da conversa: identificadores dos cenários em ordem
 * crescente, unidos por hífen (ex.: «1-3-7»). A mesma seleção recupera sempre
 * o mesmo histórico, qualquer que seja a ordem em que foi informada (RF-080).
 */
function chaveContexto(ids) {
  return ids.slice().sort((a, b) => a - b).join('-');
}

/** Valida a chave de contexto recebida da tela. */
function validarContexto(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!/^\d+(-\d+)*$/.test(texto)) {
    throw erro(
      422,
      `Contexto inválido: «${texto || '—'}». Informe os identificadores dos cenários em ordem crescente, ` +
      'unidos por hífen — por exemplo «1-3-7» (RF-080).'
    );
  }
  return texto;
}

/** Snapshots dos cenários do contexto, na ordem informada. */
async function carregarCenarios(ids) {
  const { rows } = await query(
    `SELECT id, codigo, nome, versao, status, ciclo, autor_nome, base_calculo, dados
       FROM cenarios WHERE id = ANY($1)`,
    [ids]
  );
  const porId = new Map(rows.map((r) => [Number(r.id), Object.assign({}, r, { id: Number(r.id), dados: r.dados || {} })]));
  const faltando = ids.filter((i) => !porId.has(i));
  if (faltando.length) {
    throw erro(404, `Cenário(s) do contexto da análise não encontrado(s): ${faltando.join(', ')}.`);
  }
  return ids.map((i) => porId.get(i));
}

/** RF-060 — base do denominador aplicada à análise. */
function baseDa(baseInformada, cenarios) {
  const pedida = String(baseInformada == null ? '' : baseInformada).trim();
  if (pedida === 'saida' || pedida === 'custo') return pedida;
  if (pedida) {
    throw erro(422, `Base de cálculo inválida: «${pedida}». Use «saida» (média ponderada das saídas interestaduais) ou «custo» (custo total) — RF-060.`);
  }
  const primeiro = cenarios[0];
  return (primeiro && (primeiro.base_calculo || (primeiro.dados || {}).base)) || 'saida';
}

/** Mensagem do histórico no formato consumido pela tela (RF-080). */
function comoMensagem(linha) {
  return {
    id: linha.id,
    contexto: linha.contexto,
    cenarioId: linha.cenario_id == null ? null : Number(linha.cenario_id),
    papel: linha.papel,                 // usuario | assistente
    pergunta: linha.pergunta,
    analise: linha.analise,
    conteudo: linha.conteudo || {},
    usuario: linha.usuario_nome,
    criadoEm: linha.criado_em,
  };
}

/** Leitura da conversa do contexto para o usuário, em ordem cronológica. */
async function lerHistorico(usuarioId, contexto, limite = LIMITE_HISTORICO) {
  const { rows } = await query(
    `SELECT id, contexto, cenario_id, usuario_nome, papel, pergunta, analise, conteudo, criado_em
       FROM analise_mensagens
      WHERE contexto = $1 AND usuario_id = $2
      ORDER BY criado_em, id
      LIMIT $3`,
    [contexto, usuarioId, limite]
  );
  return rows.map(comoMensagem);
}

// ---------------------------------------------------------------------------
// Catálogo das análises padrão (RF-081 · RF-082)
// ---------------------------------------------------------------------------

/**
 * RF-081 — análises padrão solicitáveis para o contexto selecionado, com a
 * ressalva de uso gerencial apresentada junto ao recurso (RF-082).
 */
function analisesPadrao() {
  const E = engine();
  return {
    analises: E.analisesPadrao(),
    ressalva: E.RESSALVA_GERENCIAL,     // RF-082
    limiteContexto: E.LIMITE_COMPARACAO,
    limiteHistorico: LIMITE_HISTORICO,
  };
}

// ---------------------------------------------------------------------------
// Conversa iterativa sobre os cenários (RF-080)
// ---------------------------------------------------------------------------

/**
 * RF-080 · RF-081 · RF-082 — responde a uma solicitação de análise sobre os
 * cenários selecionados e mantém o histórico da conversa.
 *
 * Grava duas mensagens no contexto: a do usuário (pergunta e/ou análise pedida)
 * e a do assistente (resposta completa produzida pelo motor). A resposta
 * devolve a conversa atualizada e a ressalva de uso gerencial.
 */
async function responder(usuario, pedido = {}) {
  const E = engine();
  const ids = listaIds(pedido.cenarioIds);
  if (!ids.length) {
    throw erro(422, 'Selecione ao menos um cenário para que a análise seja produzida sobre dados reais da simulação (RF-080).');
  }
  if (ids.length > E.LIMITE_COMPARACAO) {
    throw erro(
      422,
      `O contexto da análise aceita no máximo ${E.LIMITE_COMPARACAO} cenários simultâneos — ` +
      `foram informados ${ids.length}. Reduza a seleção para prosseguir (RF-073 · RF-080).`
    );
  }

  const pergunta = String(pedido.pergunta == null ? '' : pedido.pergunta).trim();
  const analisePedida = String(pedido.analise == null ? '' : pedido.analise).trim();
  if (!pergunta && !analisePedida) {
    throw erro(422, 'Informe a pergunta a analisar ou escolha uma das análises padrão disponíveis (RF-080 · RF-081).');
  }
  if (analisePedida && !E.analisesPadrao().some((a) => a.id === analisePedida)) {
    throw erro(
      422,
      `Análise padrão desconhecida: «${analisePedida}». Análises disponíveis (RF-081): ` +
      E.analisesPadrao().map((a) => `${a.id} (${a.titulo})`).join(', ') + '.'
    );
  }

  const cenarios = await carregarCenarios(ids);
  const params = await carregarParametros();
  const base = baseDa(pedido.base, cenarios);
  const contexto = chaveContexto(ids);
  const principal = cenarios[0];

  // Contexto entregue ao motor: cenários do recorte, produto em foco, base
  // vigente e parâmetros mestres. Nenhum cálculo é feito aqui (RNF-10).
  const ctx = {
    cenarios, base, params,
    prodId: pedido.prodId == null || pedido.prodId === '' ? null : String(pedido.prodId),
  };
  if (pedido.variacaoCambial != null) ctx.variacaoCambial = E.n(pedido.variacaoCambial, 10);
  if (pedido.variacaoPreco != null) ctx.variacaoPreco = E.n(pedido.variacaoPreco, 5);
  if (pedido.alvo != null) ctx.alvo = E.n(pedido.alvo, 40);

  const resposta = comoRegra(() => E.responderAnalise(ctx, {
    analise: analisePedida || undefined,
    pergunta: pergunta || undefined,
  }));

  // RF-080 — histórico da conversa: pergunta do usuário e resposta produzida
  await transacao(async (client) => {
    await client.query(
      `INSERT INTO analise_mensagens
         (contexto, cenario_id, usuario_id, usuario_nome, papel, pergunta, analise, conteudo)
       VALUES ($1, $2, $3, $4, 'usuario', $5, $6, $7)`,
      [
        contexto, principal.id, usuario.id, usuario.nome,
        pergunta || null, analisePedida || null,
        JSON.stringify({
          cenarioIds: ids, base, prodId: ctx.prodId,
          pergunta: pergunta || null, analise: analisePedida || null,
        }),
      ]
    );
    await client.query(
      `INSERT INTO analise_mensagens
         (contexto, cenario_id, usuario_id, usuario_nome, papel, pergunta, analise, conteudo)
       VALUES ($1, $2, $3, $4, 'assistente', NULL, $5, $6)`,
      [contexto, principal.id, usuario.id, usuario.nome, resposta.analise || null, JSON.stringify(resposta)]
    );
  });

  return {
    contexto,
    cenarioIds: ids,
    base,
    resposta,
    historico: await lerHistorico(usuario.id, contexto),
    sugestoes: resposta.sugestoes,           // RF-081 — próximas análises do recorte
    ressalva: E.RESSALVA_GERENCIAL,          // RF-082
  };
}

/** RF-080 — conversa do contexto, em ordem cronológica, até 100 mensagens. */
async function historico(usuario, contextoBruto) {
  const E = engine();
  const contexto = validarContexto(contextoBruto);
  const mensagens = await lerHistorico(usuario.id, contexto);
  return {
    contexto,
    cenarioIds: contexto.split('-').map(Number),
    mensagens,
    total: mensagens.length,
    limite: LIMITE_HISTORICO,
    ressalva: E.RESSALVA_GERENCIAL,          // RF-082
  };
}

/** RF-080 — limpa a conversa do contexto para o usuário. */
async function limparHistorico(usuario, contextoBruto) {
  const E = engine();
  const contexto = validarContexto(contextoBruto);
  const { rowCount } = await query(
    'DELETE FROM analise_mensagens WHERE contexto = $1 AND usuario_id = $2',
    [contexto, usuario.id]
  );
  return {
    contexto,
    removidas: rowCount,
    mensagens: [],
    mensagem: rowCount
      ? `Conversa do contexto ${contexto} apagada: ${rowCount} mensagem(ns) removida(s).`
      : `Não havia mensagens registradas no contexto ${contexto}.`,
    ressalva: E.RESSALVA_GERENCIAL,          // RF-082
  };
}

module.exports = {
  // apoio
  carregarParametros, chaveContexto, validarContexto, LIMITE_HISTORICO,
  // RF-081 · RF-082
  analisesPadrao,
  // RF-080
  responder, historico, limparHistorico,
};
