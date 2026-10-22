'use strict';
/**
 * Governança do cenário.
 *
 *   RF-005 · RN-10  congelamento das premissas (indisponível com erro — RF-025)
 *   RF-008 · RF-038 · RN-11  consolidação para decisão
 *   RF-060          base de cálculo do denominador
 *   RF-036 · RF-037 validação técnica das alterações de receita
 *   RF-009 · RF-088 direcionamentos às áreas responsáveis
 *
 * Regra de ouro: toda regra de negócio vive no motor compartilhado
 * (shared/engine.mjs). Este serviço apenas orquestra — carrega o cenário,
 * chama o motor, grava o resultado e registra o evento de auditoria (RNF-04).
 */
const { query, transacao } = require('../db');
const { eventoCenario } = require('../audit');
const { engine } = require('../engine');
const { obterCenario } = require('./cenario.service');

const BASES_VALIDAS = ['saida', 'custo'];           // RF-060 · RN-02
const DECISOES_VALIDAS = ['aprovada', 'reprovada']; // RF-037
const PRIORIDADES = ['alta', 'media', 'baixa'];     // RF-009

const ROTULO_BASE = {
  saida: 'média ponderada global das saídas interestaduais',
  custo: 'custo total da mercadoria',
};

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

/** Converte e valida identificadores recebidos da rota (evita 500 por tipo). */
function idNumerico(valor, rotulo = 'Identificador') {
  const texto = String(valor == null ? '' : valor).trim();
  if (!/^\d+$/.test(texto) || Number(texto) <= 0) {
    const e = new Error(`${rotulo} inválido: «${texto || '—'}».`);
    e.status = 404;
    throw e;
  }
  return Number(texto);
}

/** Data em formato brasileiro para as mensagens de impedimento (RNF-03). */
function dataBr(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (err) {
    return new Date(valor).toISOString();
  }
}

/**
 * Parâmetros mestres consumidos pelo motor (RF-096 a RF-099):
 * gatilho de reemissão, premissas de ICMS-ST, alíquota normal do destino e
 * versão da fórmula vigente. Exportada para reuso pelos demais domínios.
 */
async function carregarParametros() {
  const E = engine();
  const { rows } = await query('SELECT chave, valor FROM parametros');
  const p = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  const st = p.st || { mva: 30, aliqInterna: 18, aliqNormal: 12 };
  return {
    gatilho: p.gatilho_reemissao && p.gatilho_reemissao.pp != null ? Number(p.gatilho_reemissao.pp) : 5,
    st,
    aliqNormal: st.aliqNormal != null ? Number(st.aliqNormal) : 12,
    versaoFormula: (p.motor && p.motor.versaoFormula) || E.VERSAO_FORMULA_PADRAO,
    faixas: p.faixas,
    aliquotas: p.aliquotas,
    moedas: p.moedas,
  };
}

/** Base vigente do cenário (coluna de governança ⟶ snapshot ⟶ padrão). */
function baseDe(cenario) {
  return cenario.base_calculo || (cenario.dados || {}).base || 'saida';
}

/**
 * Resposta padrão das rotas que alteram o cenário (RF-031):
 * cenário gravado + diagnóstico consolidado + confronto da edição.
 */
function respostaCenario(cenario, dadosAntes) {
  const E = engine();
  const dados = cenario.dados || {};
  return {
    cenario,
    validacao: E.diagnostico(dados, { modo: cenario.modo }),                            // RF-025 · RF-032
    confronto: E.confrontarEdicao(dadosAntes || dados, dados, { modo: cenario.modo }),  // RF-031
  };
}

/** RN-10 — cenário congelado ou consolidado recusa qualquer edição. */
function garantirEditavel(cenario) {
  if (cenario.status === 'congelado' || cenario.status === 'consolidado') {
    const e = new Error(
      `Cenário ${cenario.codigo} está ${cenario.status} — premissas travadas para rastreabilidade. ` +
      `Crie uma nova versão para editar (RN-10).`
    );
    e.status = 409;
    throw e;
  }
}

/** Concordância de número nas mensagens ao usuário (RNF-03). */
function plural(quantidade, singular, pluralizado) {
  return `${quantidade} ${quantidade === 1 ? singular : pluralizado}`;
}

/** Erro padrão de validação de estrutura pendente (RF-025). */
function erroValidacaoPendente(acao, diagnostico, requisitos) {
  const e = new Error(
    `${acao}: o cenário apresenta ${plural(diagnostico.nErros, 'erro', 'erros')} de validação de estrutura. ` +
    `Corrija as inconsistências apontadas no diagnóstico antes de prosseguir (${requisitos}).`
  );
  e.status = 409;
  e.parcial = {
    validacao: {
      nErros: diagnostico.nErros,
      nAvisos: diagnostico.nAvisos,
      motivo: diagnostico.motivo,
      itens: diagnostico.erros,
    },
  };
  return e;
}

/**
 * Assinatura dos pontos que exigem validação técnica (RN-11). Serve para
 * reconhecer que uma aprovação já registrada cobre exatamente as alterações
 * de receita presentes no cenário — edições que não exigem validação
 * (preço, volume, câmbio) e atos de governança não invalidam a aprovação.
 */
function assinaturaPontos(pontos) {
  return (Array.isArray(pontos) ? pontos : [])
    .filter((p) => p && p.exigeValidacao)
    .map((p) => [p.tipo, p.prodId, p.idx, p.item, p.de, p.para].join('|'))
    .sort()
    .join(' ;; ');
}

/** Linha de validação técnica formatada para a tela (RF-037). */
function formatarValidacao(v) {
  const pontos = Array.isArray(v.pontos) ? v.pontos : [];
  const exigem = pontos.filter((p) => p && p.exigeValidacao);
  return {
    ...v,
    pontos,
    exigem,
    nPontos: pontos.length,
    nExigem: exigem.length,
    decidido: !!v.decidido_em,
    // RF-037 — decisão visível no cenário com responsável, área e data
    decisao: v.status === 'pendente'
      ? `Aguardando decisão técnica · submetida por ${v.submetido_nome || '—'} (${v.submetido_area || '—'}) em ${dataBr(v.submetido_em)}`
      : `${v.status === 'aprovada' ? 'Aprovada' : 'Reprovada'} por ${v.decidido_nome || '—'} (${v.decidido_area || '—'}) em ${dataBr(v.decidido_em)}`,
  };
}

/**
 * Situação da validação técnica do cenário (RF-038 · RN-11).
 * Uma aprovação é considerada VIGENTE quando foi decidida após a última
 * alteração do cenário ou quando cobre exatamente os pontos que hoje exigem
 * validação — nunca quando existe alteração de receita não aprovada.
 */
async function situacaoValidacao(cenario) {
  const E = engine();
  const dados = cenario.dados || {};
  const { rows } = await query(
    `SELECT * FROM validacoes_tecnicas WHERE cenario_id = $1 ORDER BY submetido_em DESC, id DESC`,
    [cenario.id]
  );
  const assinaturaAtual = assinaturaPontos(E.diffs(dados));
  const ultimaAlteracao = cenario.atualizado_em ? new Date(cenario.atualizado_em).getTime() : 0;
  const aprovadas = rows
    .filter((v) => v.status === 'aprovada' && v.decidido_em)
    .sort((a, b) => new Date(b.decidido_em) - new Date(a.decidido_em));
  const aprovadaVigente = aprovadas.find((v) =>
    new Date(v.decidido_em).getTime() >= ultimaAlteracao
    || assinaturaPontos(v.pontos) === assinaturaAtual) || null;
  const exigeValidacao = E.exigeValidacaoTecnica(dados);
  return {
    validacoes: rows,
    pendente: rows.find((v) => v.status === 'pendente') || null,
    aprovadas,
    aprovadaVigente,
    ultimaDecidida: rows.find((v) => v.status !== 'pendente') || null,
    exigeValidacao,
    assinaturaAtual,
    // RF-038 — consolidação liberada só sem exigência ou com aprovação vigente
    liberaConsolidacao: !exigeValidacao || !!aprovadaVigente,
  };
}

// ---------------------------------------------------------------------------
// Congelamento das premissas (RF-005 · RN-10)
// ---------------------------------------------------------------------------

/**
 * RF-005 — congela o cenário: premissas travadas, com autor e data gravados.
 * Indisponível enquanto houver erro de validação de estrutura (RF-025).
 */
async function congelarCenario(idBruto, usuario) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const atual = await obterCenario(id);

  if (atual.status === 'congelado' || atual.status === 'consolidado') {
    const e = new Error(
      `Cenário ${atual.codigo} já está ${atual.status} desde ` +
      `${dataBr(atual.status === 'congelado' ? atual.congelado_em : atual.consolidado_em)} ` +
      `(${(atual.status === 'congelado' ? atual.congelado_por : atual.consolidado_por) || '—'}) — ` +
      `premissas travadas para rastreabilidade. Crie uma nova versão para alterar (RN-10).`
    );
    e.status = 409;
    throw e;
  }

  const dados = atual.dados || {};
  const diagnostico = E.diagnostico(dados, { modo: atual.modo });
  // RF-005 · RF-025 — congelar fica indisponível com erro pendente
  if (E.temErros(dados, { modo: atual.modo })) throw erroValidacaoPendente('Congelamento recusado', diagnostico, 'RF-005 · RF-025');

  // atualizado_em não é tocado: congelar é ato de governança, não alteração de
  // premissa — assim uma aprovação técnica vigente continua válida (RF-038).
  const { rows } = await query(
    `UPDATE cenarios
        SET status = 'congelado', congelado_em = now(), congelado_por = $2
      WHERE id = $1 RETURNING *`,
    [id, usuario.nome]
  );
  await eventoCenario(id, usuario, 'status', {
    acao: 'congelamento', requisito: 'RF-005',
    de: atual.status, para: 'congelado',
    avisos: diagnostico.nAvisos,
    base: baseDe(atual),
  });
  return respostaCenario(rows[0], dados);
}

// ---------------------------------------------------------------------------
// Consolidação para decisão (RF-008 · RF-038 · RN-11)
// ---------------------------------------------------------------------------

/**
 * RF-008 — consolida o cenário para decisão. Recusada (409) quando:
 *   (a) houver erro de validação de estrutura pendente (RF-008 · RF-025);
 *   (b) houver alteração de receita sem validação técnica aprovada vigente
 *       (RF-038 · RN-11).
 */
async function consolidarCenario(idBruto, usuario) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const atual = await obterCenario(id);

  if (atual.status === 'consolidado') {
    const e = new Error(
      `Cenário ${atual.codigo} já foi consolidado em ${dataBr(atual.consolidado_em)} por ` +
      `${atual.consolidado_por || '—'} — crie uma nova versão para simular novamente (RN-10).`
    );
    e.status = 409;
    throw e;
  }

  const dados = atual.dados || {};
  const diagnostico = E.diagnostico(dados, { modo: atual.modo });
  // (a) RF-008 · RF-025 — erro de validação de estrutura pendente
  if (E.temErros(dados, { modo: atual.modo })) throw erroValidacaoPendente('Consolidação recusada', diagnostico, 'RF-008 · RF-025');

  // (b) RF-038 · RN-11 — alteração de receita exige validação técnica aprovada
  const situacao = await situacaoValidacao(atual);
  if (situacao.exigeValidacao && !situacao.aprovadaVigente) {
    const pontos = E.diffs(dados).filter((d) => d.exigeValidacao);
    const refPontos = pontos.length === 1 ? 'a alteração' : `as ${pontos.length} alterações`;
    let msg;
    if (situacao.pendente) {
      msg = `Consolidação recusada: as alterações de receita deste cenário foram submetidas à validação técnica ` +
            `(#${situacao.pendente.id}, por ${situacao.pendente.submetido_nome || '—'} em ` +
            `${dataBr(situacao.pendente.submetido_em)}) e aguardam decisão (RF-038 · RN-11).`;
    } else if (situacao.ultimaDecidida) {
      const u = situacao.ultimaDecidida;
      msg = `Consolidação recusada: não há validação técnica aprovada vigente para ` +
            `${refPontos} de receita do cenário — ` +
            `a última decisão registrada foi «${u.status}» por ${u.decidido_nome || '—'} ` +
            `(${u.decidido_area || '—'}) em ${dataBr(u.decidido_em)}. Submeta novamente os pontos alterados ` +
            `à validação técnica (RF-038 · RN-11).`;
    } else {
      msg = `Consolidação recusada: o cenário contém ${plural(pontos.length, 'alteração', 'alterações')} ` +
            `de receita ou de custo industrial que ${pontos.length === 1 ? 'exige' : 'exigem'} validação técnica ` +
            `aprovada antes da consolidação. Submeta os pontos alterados à validação técnica (RF-038 · RN-11).`;
    }
    const e = new Error(msg);
    e.status = 409;
    e.parcial = {
      exigeValidacaoTecnica: true,
      pendente: situacao.pendente ? formatarValidacao(situacao.pendente) : null,
      pontos,
    };
    throw e;
  }

  const { rows } = await query(
    `UPDATE cenarios
        SET status = 'consolidado', consolidado_em = now(), consolidado_por = $2
      WHERE id = $1 RETURNING *`,
    [id, usuario.nome]
  );
  await eventoCenario(id, usuario, 'status', {
    acao: 'consolidacao', requisito: 'RF-008',
    de: atual.status, para: 'consolidado',
    base: baseDe(atual),
    validacaoTecnica: situacao.aprovadaVigente
      ? { id: situacao.aprovadaVigente.id, por: situacao.aprovadaVigente.decidido_nome, area: situacao.aprovadaVigente.decidido_area, em: situacao.aprovadaVigente.decidido_em }
      : 'não exigida (nenhuma alteração de receita)',
  });
  return respostaCenario(rows[0], dados);
}

// ---------------------------------------------------------------------------
// Base de cálculo do denominador (RF-060 · RN-02)
// ---------------------------------------------------------------------------

/**
 * RF-060 — define a base do denominador do CI%: 'saida' (média ponderada
 * global das saídas interestaduais) ou 'custo' (custo total da mercadoria).
 * Grava na coluna de governança e no snapshot do cenário, para que motor,
 * telas e relatório apliquem a mesma base (RNF-10).
 */
async function definirBase(idBruto, baseBruta, usuario) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const base = String(baseBruta == null ? '' : baseBruta).trim().toLowerCase();
  if (!BASES_VALIDAS.includes(base)) {
    const e = new Error(
      `Base de cálculo inválida: «${base || '—'}». Informe «saida» (${ROTULO_BASE.saida}) ` +
      `ou «custo» (${ROTULO_BASE.custo}) — RF-060.`
    );
    e.status = 422;
    throw e;
  }

  const atual = await obterCenario(id);
  garantirEditavel(atual);   // RN-10

  const dadosAntes = atual.dados || {};
  const dados = E.clonar(dadosAntes);
  dados.base = base;         // RF-060 — base vigente dentro do snapshot

  const { rows } = await query(
    `UPDATE cenarios SET base_calculo = $2, dados = $3, atualizado_em = now()
      WHERE id = $1 RETURNING *`,
    [id, base, JSON.stringify(dados)]
  );
  await eventoCenario(id, usuario, 'base', {
    requisito: 'RF-060',
    de: baseDe(atual), para: base,
    rotulo: ROTULO_BASE[base],
  });
  return respostaCenario(rows[0], dadosAntes);
}

// ---------------------------------------------------------------------------
// Validação técnica das alterações de receita (RF-036 · RF-037 · RF-038 · RN-11)
// ---------------------------------------------------------------------------

/**
 * RF-036 — submete as alterações à validação técnica. A submissão congela a
 * lista de pontos alterados devolvida pelo motor (`diffs`), cada um com o
 * valor padrão da carga e o valor no cenário, e registra responsável, área e
 * data. Recusada (422) quando nenhum ponto exige validação técnica.
 */
async function submeterValidacao(idBruto, usuario, notas) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const atual = await obterCenario(id);

  if (atual.status === 'consolidado') {
    const e = new Error(
      `Cenário ${atual.codigo} já consolidado em ${dataBr(atual.consolidado_em)} — ` +
      `submissão à validação técnica indisponível. Crie uma nova versão (RN-10).`
    );
    e.status = 409;
    throw e;
  }

  const dados = atual.dados || {};
  const pontos = E.diffs(dados);                                  // RF-036 — lista completa
  const exigem = pontos.filter((p) => p.exigeValidacao);          // RN-11 — receita/custo industrial
  if (!exigem.length) {
    const e = new Error(
      'Submissão desnecessária: nenhuma alteração do cenário exige validação técnica. ' +
      'Apenas mudanças de receita (quantidade de componente) ou de custo industrial (overhead) ' +
      'precisam de aprovação antes da consolidação (RF-036 · RN-11).'
    );
    e.status = 422;
    throw e;
  }

  const { rows } = await query(
    `INSERT INTO validacoes_tecnicas
       (cenario_id, status, pontos, submetido_por, submetido_nome, submetido_area, submetido_em, notas)
     VALUES ($1, 'pendente', $2, $3, $4, $5, now(), $6)
     RETURNING *`,
    [id, JSON.stringify(pontos), usuario.id, usuario.nome, usuario.area || '', String(notas == null ? '' : notas).trim()]
  );
  await eventoCenario(id, usuario, 'validacao', {
    acao: 'submissao', requisito: 'RF-036',
    validacaoId: rows[0].id,
    area: usuario.area || '',
    nPontos: pontos.length, nExigem: exigem.length,
    pontos: exigem.map((p) => ({ rotulo: p.rotulo, produto: p.produto, item: p.item, de: p.de, para: p.para })),
  });

  // Payload uniforme das rotas de alteração (RF-031): a submissão é ato de
  // governança e não edita premissas, logo o confronto vem sem regressão.
  return {
    submissao: formatarValidacao(rows[0]),
    pontos,
    exigem,
    ...respostaCenario(atual, dados),
  };
}

/**
 * RF-037 — histórico das validações técnicas do cenário, mais recente
 * primeiro, com os pontos submetidos e a decisão (responsável, área e data).
 */
async function historicoValidacoes(idBruto) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};
  const situacao = await situacaoValidacao(cenario);
  return {
    validacoes: situacao.validacoes.map(formatarValidacao),
    total: situacao.validacoes.length,
    pendente: situacao.pendente ? formatarValidacao(situacao.pendente) : null,
    aprovadaVigente: situacao.aprovadaVigente ? formatarValidacao(situacao.aprovadaVigente) : null,
    exigeValidacao: situacao.exigeValidacao,                      // RN-11
    liberaConsolidacao: situacao.liberaConsolidacao,              // RF-038
    pontosAtuais: E.diffs(dados).filter((d) => d.exigeValidacao), // RF-036
    cenario: {
      id: cenario.id, codigo: cenario.codigo, nome: cenario.nome,
      status: cenario.status, versao: cenario.versao,
      atualizadoEm: cenario.atualizado_em,
    },
  };
}

/**
 * RF-037 · RF-038 — registra a aprovação ou reprovação da validação técnica
 * com responsável, área e data, e publica o evento no cenário. Recusada (409)
 * quando a validação já tiver sido decidida.
 */
async function decidirValidacao(vidBruto, { decisao, notas } = {}, usuario) {
  const vid = idNumerico(vidBruto, 'Validação técnica');
  const d = String(decisao == null ? '' : decisao).trim().toLowerCase();
  if (!DECISOES_VALIDAS.includes(d)) {
    const e = new Error(`Decisão inválida: «${d || '—'}». Informe «aprovada» ou «reprovada» (RF-037).`);
    e.status = 422;
    throw e;
  }

  const linha = await transacao(async (client) => {
    const r0 = await client.query('SELECT * FROM validacoes_tecnicas WHERE id = $1 FOR UPDATE', [vid]);
    const v = r0.rows[0];
    if (!v) {
      const e = new Error(`Validação técnica #${vid} não encontrada.`);
      e.status = 404;
      throw e;
    }
    if (v.status !== 'pendente') {
      const e = new Error(
        `Validação técnica #${vid} já foi ${v.status} por ${v.decidido_nome || '—'} ` +
        `(${v.decidido_area || '—'}) em ${dataBr(v.decidido_em)} — a decisão é definitiva. ` +
        `Submeta uma nova validação para registrar outra decisão (RF-037).`
      );
      e.status = 409;
      throw e;
    }
    const r1 = await client.query(
      `UPDATE validacoes_tecnicas
          SET status = $2, decidido_por = $3, decidido_nome = $4, decidido_area = $5,
              decidido_em = now(),
              notas = CASE WHEN $6 = '' THEN notas ELSE $6 END
        WHERE id = $1 RETURNING *`,
      [vid, d, usuario.id, usuario.nome, usuario.area || '', String(notas == null ? '' : notas).trim()]
    );
    return r1.rows[0];
  });

  // RF-037 — a decisão fica visível no cenário pela trilha de eventos (RNF-04)
  await eventoCenario(linha.cenario_id, usuario, 'validacao', {
    acao: 'decisao', requisito: 'RF-037 · RF-038',
    validacaoId: linha.id,
    decisao: d,
    area: usuario.area || '',
    notas: linha.notas || '',
    nPontos: Array.isArray(linha.pontos) ? linha.pontos.length : 0,
  });

  const cenario = await obterCenario(linha.cenario_id);
  const situacao = await situacaoValidacao(cenario);
  return {
    validacaoTecnica: formatarValidacao(linha),
    liberaConsolidacao: situacao.liberaConsolidacao,   // RF-038
    ...respostaCenario(cenario, cenario.dados || {}),
  };
}

// ---------------------------------------------------------------------------
// Direcionamentos às áreas (RF-009 · RF-088)
// ---------------------------------------------------------------------------

/**
 * RF-009 · RF-088 — direcionamentos por área: os automáticos derivam do
 * resultado e dos alertas pelo motor; os manuais são os registrados pela
 * equipe durante a consolidação.
 */
async function listarDirecionamentos(idBruto) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};
  const params = await carregarParametros();
  const base = baseDe(cenario);
  const listaAlertas = E.alertas(dados, params.gatilho, base, params);
  const { rows } = await query(
    `SELECT id, cenario_id, area, produto, texto, prioridade, origem, criado_nome, criado_em
       FROM direcionamentos
      WHERE cenario_id = $1
      ORDER BY area, criado_em DESC, id DESC`,
    [id]
  );
  return {
    manuais: rows,
    automaticos: E.direcionamentosPorArea(dados, listaAlertas, base, params),  // RF-088
    areas: E.AREAS_TRATAMENTO,                                                 // RF-086
    base,
    alertas: listaAlertas.length,
  };
}

/** RF-009 — registra direcionamento manual à área responsável. */
async function criarDirecionamento(idBruto, { area, produto, texto, prioridade } = {}, usuario) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const cenario = await obterCenario(id);   // garante existência (404)

  const areas = E.AREAS_TRATAMENTO;
  const areaInformada = String(area == null ? '' : area).trim();
  if (!areas.includes(areaInformada)) {
    const e = new Error(
      `Área inválida: «${areaInformada || '—'}». Informe uma das áreas de tratamento: ${areas.join(' · ')} (RF-086).`
    );
    e.status = 422;
    throw e;
  }
  const textoInformado = String(texto == null ? '' : texto).trim();
  if (!textoInformado) {
    const e = new Error('Informe o texto do direcionamento à área (RF-009).');
    e.status = 422;
    throw e;
  }
  const prio = String(prioridade == null || prioridade === '' ? 'media' : prioridade).trim().toLowerCase();
  if (!PRIORIDADES.includes(prio)) {
    const e = new Error(`Prioridade inválida: «${prio}». Informe «alta», «media» ou «baixa» (RF-009).`);
    e.status = 422;
    throw e;
  }

  const { rows } = await query(
    `INSERT INTO direcionamentos
       (cenario_id, area, produto, texto, prioridade, origem, criado_por, criado_nome)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7)
     RETURNING id, cenario_id, area, produto, texto, prioridade, origem, criado_nome, criado_em`,
    [
      id, areaInformada,
      String(produto == null || produto === '' ? '— cenário —' : produto).trim(),
      textoInformado, prio, usuario.id, usuario.nome,
    ]
  );
  await eventoCenario(id, usuario, 'direcionamento', {
    acao: 'inclusao', requisito: 'RF-009 · RF-088',
    direcionamentoId: rows[0].id,
    area: areaInformada, produto: rows[0].produto,
    prioridade: prio, texto: textoInformado,
    statusCenario: cenario.status,
  });
  return { direcionamento: rows[0], ...respostaCenario(cenario, cenario.dados || {}) };
}

/** RF-009 — remove direcionamento manual (os automáticos derivam do cálculo). */
async function removerDirecionamento(idBruto, didBruto, usuario) {
  const id = idNumerico(idBruto, 'Cenário');
  const did = idNumerico(didBruto, 'Direcionamento');
  const cenario = await obterCenario(id);   // garante existência (404)
  const { rows } = await query(
    `DELETE FROM direcionamentos
      WHERE id = $1 AND cenario_id = $2 AND origem = 'manual'
      RETURNING id, area, produto, texto, prioridade`,
    [did, id]
  );
  if (!rows[0]) {
    const e = new Error(
      `Direcionamento manual #${did} não encontrado neste cenário. Os direcionamentos automáticos ` +
      `são derivados do resultado e dos alertas e não podem ser removidos (RF-088).`
    );
    e.status = 404;
    throw e;
  }
  await eventoCenario(id, usuario, 'direcionamento', {
    acao: 'exclusao', requisito: 'RF-009',
    direcionamentoId: did, area: rows[0].area, texto: rows[0].texto,
  });
  return { removido: rows[0], ...respostaCenario(cenario, cenario.dados || {}) };
}

module.exports = {
  carregarParametros,
  congelarCenario,
  consolidarCenario,
  definirBase,
  submeterValidacao,
  historicoValidacoes,
  decidirValidacao,
  situacaoValidacao,
  listarDirecionamentos,
  criarDirecionamento,
  removerDirecionamento,
};
