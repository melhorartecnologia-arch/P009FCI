'use strict';
/**
 * Simulação e estrutura do cenário.
 *
 * Cobre a substituição controlada de componentes (RF-015 a RF-024), o modo
 * avançado de alteração da receita (RF-011 · RF-012 · RF-034 · RF-035), as
 * premissas de origem, conteúdo de importação, custo e câmbio do insumo
 * (RF-046 a RF-055 · RF-058 · RF-059), os volumes e destinos de saída
 * (RF-066 a RF-071) e as alterações em massa por grupo de insumo
 * (RF-040 a RF-045).
 *
 * Regra de ouro da arquitetura: TODA regra de cálculo vive no motor
 * compartilhado (shared/engine.mjs). Este serviço apenas orquestra — carrega o
 * cenário, delega ao motor, grava o snapshot JSONB e registra o evento de
 * auditoria (RNF-04 · RNF-10). Nenhuma base de origem é alterada (RNF-06).
 */
const { query, transacao } = require('../db');
const { eventoCenario } = require('../audit');
const { engine } = require('../engine');
const { obterCenario } = require('./cenario.service');

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
 * RN-10 — cenário congelado (RF-005) ou consolidado (RF-008) recusa qualquer
 * edição: as premissas ficam travadas para rastreabilidade.
 */
function garantirEditavel(cenario) {
  if (cenario.status === 'congelado' || cenario.status === 'consolidado') {
    const situacao = cenario.status === 'congelado' ? 'congelado' : 'consolidado';
    throw erro(
      409,
      `Cenário ${cenario.codigo} está ${situacao} — as premissas estão travadas para rastreabilidade e ` +
      'nenhuma edição é aceita. Duplique o cenário como nova versão para continuar simulando (RN-10).'
    );
  }
}

/**
 * RF-034 · RF-011 · RF-012 — a receita padrão só é editável no modo avançado.
 * No modo padrão o campo permanece bloqueado com indicação do motivo.
 */
function garantirModoAvancado(cenario, oque, requisito) {
  if (String(cenario.modo || 'padrao') !== 'avancado') {
    throw erro(
      422,
      `${oque} está bloqueado no modo padrão: o cenário simula sobre a receita padrão carregada do ERP, ` +
      'que permanece protegida. Alterne o cenário para o modo avançado para liberar o campo ' +
      `(${requisito} · RF-034).`
    );
  }
}

/** Parâmetros mestres consumidos pelo motor (RF-096 a RF-099). */
async function carregarParametros() {
  const { rows } = await query('SELECT chave, valor FROM parametros');
  const p = Object.fromEntries(rows.map((r) => [r.chave, r.valor || {}]));
  const st = p.st || { mva: 30, aliqInterna: 18, aliqNormal: 12 };
  return {
    gatilho: Number(p.gatilho_reemissao && p.gatilho_reemissao.pp) > 0 ? Number(p.gatilho_reemissao.pp) : 5,
    st,
    aliqNormal: Number(st.aliqNormal) > 0 ? Number(st.aliqNormal) : 12,
    versaoFormula: p.motor ? p.motor.versaoFormula : undefined,
    faixas: p.faixas, aliquotas: p.aliquotas, moedas: p.moedas,
  };
}

/** RF-060 — base do denominador vigente no cenário. */
function baseDe(cenario) {
  return cenario.base_calculo || (cenario.dados || {}).base || 'saida';
}

function acharProdutoOu404(E, dados, prodId) {
  const prod = E.acharProduto(dados, prodId);
  if (!prod) throw erro(404, `Produto «${prodId}» não encontrado na estrutura deste cenário.`);
  return prod;
}

function acharComponenteOu404(prod, idx) {
  const comp = (prod.componentes || [])[idx];
  if (!comp) {
    throw erro(404, `Posição ${idx} não existe na ficha técnica de «${prod.nome}» — recarregue a estrutura.`);
  }
  return comp;
}

function acharInsumoOu404(E, dados, ref) {
  const ins = E.acharInsumo(dados, ref);
  if (!ins) throw erro(404, `Insumo «${ref}» não encontrado no cadastro deste cenário.`);
  return ins;
}

/**
 * Executa uma edição do cenário.
 *
 * A linha do cenário é travada (SELECT ... FOR UPDATE) para que leitura,
 * aplicação da regra e gravação do snapshot JSONB ocorram sem perda de
 * alterações concorrentes — o isolamento entre cenários exigido pelo RF-007 é
 * garantido porque só esta linha é escrita.
 *
 * `fn(cenario, dadosAntes, E)` devolve:
 *   { dados, modo?, tipo, detalhe?, extras? }
 *
 * A resposta segue o contrato da seção 4.2: { cenario, validacao, confronto }
 * acrescida dos campos de apoio da operação (RF-031 · RF-032).
 */
async function editar(id, usuario, fn) {
  const E = engine();

  const feito = await transacao(async (client) => {
    const r = await client.query('SELECT * FROM cenarios WHERE id = $1 FOR UPDATE', [id]);
    const atual = r.rows[0];
    if (!atual) throw erro(404, 'Cenário não encontrado.');
    garantirEditavel(atual);

    const dadosAntes = atual.dados || {};
    const res = await fn(atual, dadosAntes, E);
    const dados = res.dados || dadosAntes;

    // Nova edição devolve o cenário calculado ao estado de rascunho, para que o
    // recálculo e a validação sejam refeitos antes de congelar ou consolidar.
    const up = await client.query(
      `UPDATE cenarios
          SET dados = $2,
              modo = COALESCE($3, modo),
              status = CASE WHEN status = 'calculado' THEN 'rascunho' ELSE status END,
              atualizado_em = now()
        WHERE id = $1
        RETURNING *`,
      [id, JSON.stringify(dados), res.modo == null ? null : String(res.modo)]
    );

    return { cenario: up.rows[0], dadosAntes, dados, res };
  });

  // RNF-04 — toda alteração relevante gera evento rastreável no cenário
  await eventoCenario(id, usuario, feito.res.tipo, feito.res.detalhe || {});

  // Contrato da seção 4.2: os campos cenario/validacao/confronto são escritos
  // DEPOIS dos extras, para que nenhum campo de apoio da operação possa
  // sobrescrever a resposta padrão de uma rota de alteração (RF-031 · RF-032).
  return {
    ...(feito.res.extras || {}),
    cenario: feito.cenario,
    validacao: E.diagnostico(feito.dados, { modo: feito.cenario.modo }),                        // RF-032
    confronto: E.confrontarEdicao(feito.dadosAntes, feito.dados, { modo: feito.cenario.modo }), // RF-031
  };
}

// ---------------------------------------------------------------------------
// Substituição controlada de componentes (RF-015 a RF-024)
// ---------------------------------------------------------------------------

/**
 * RF-020 — alternativas elegíveis para a posição, com as do mesmo grupo de
 * insumo em primeiro lugar e a natureza da troca sinalizada. Operação apenas de
 * leitura: nada é gravado.
 */
async function opcoesSubstituicao(id, prodId, idx) {
  const E = engine();
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};
  const prod = acharProdutoOu404(E, dados, prodId);
  acharComponenteOu404(prod, idx);

  const opcoes = E.opcoesSubstituicao(dados, prodId, idx);
  return {
    prodId, idx,
    produto: { id: prod.id, sku: prod.sku || prod.id, nome: prod.nome, tipo: prod.tipo || 'PA' },
    atual: opcoes.atual,
    mesmoGrupo: opcoes.mesmoGrupo,
    outros: opcoes.outros,
    nOpcoes: opcoes.mesmoGrupo.length + opcoes.outros.length,
    classes: E.CLASSES,                     // RF-046 — legenda das classificações
    somenteSubstituicao: true,              // RF-015 — não há exclusão livre de componente
  };
}

/**
 * RF-022 — prévia do efeito antes da confirmação: CI% atual, CI% simulado,
 * faixa resultante e variação em pontos percentuais. NÃO grava nada.
 */
async function previaSubstituicao(id, { prodId, idx, refSubstituto, modo, pct }) {
  const E = engine();
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};
  const prod = acharProdutoOu404(E, dados, prodId);
  acharComponenteOu404(prod, idx);

  const params = await carregarParametros();
  const base = baseDe(cenario);
  const opcoes = { refSubstituto, modo: modo === 'parcial' ? 'parcial' : 'integral', pct };
  const previa = E.previaSubstituicao(dados, prodId, idx, opcoes, base, params);

  return { prodId, idx, opcoes, base, previa };
}

/**
 * RF-015 a RF-018 · RF-021 — aplica a substituição e grava o cenário.
 * O item original permanece listado (RF-016 · RF-019), a proporção do par é
 * complementada automaticamente (RF-017) e a quantidade total da receita não é
 * alterada (RF-018).
 */
async function aplicarSubstituicao(id, { prodId, idx, refSubstituto, modo, pct }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const prod = acharProdutoOu404(E, dadosAntes, prodId);
    const comp = acharComponenteOu404(prod, idx);
    const refOriginal = E.mixOf(comp)[0].ref;
    const base = baseDe(cenario);
    const opcoes = { refSubstituto, modo: modo === 'parcial' ? 'parcial' : 'integral', pct };

    // RF-022 — a prévia é recalculada sobre os dados gravados para registrar na
    // auditoria exatamente o efeito confirmado pelo usuário.
    const previa = comoRegra(() => E.previaSubstituicao(dadosAntes, prodId, idx, opcoes, base, params));
    if (previa.aplicavel === false) throw erro(422, previa.erro || 'Substituição não aplicável a esta posição.');

    const dados = comoRegra(() => E.aplicarSubstituicao(dadosAntes, prodId, idx, opcoes));
    const compNovo = E.acharProduto(dados, prodId).componentes[idx];

    return {
      dados,
      tipo: 'substituicao',
      detalhe: {
        requisito: 'RF-015 · RF-016 · RF-017 · RF-018 · RF-021',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId, idx,
        original: E.nomeDe(dadosAntes, refOriginal), refOriginal,
        substituto: E.nomeDe(dados, refSubstituto), refSubstituto,
        modo: opcoes.modo, pct: E.n(previa.quantidades[1].pct),
        ciAntes: previa.ciAtual, ciDepois: previa.ciSimulado, deltaPp: previa.deltaPp,
        mudaFaixa: previa.mudaFaixa,
        faixaAntes: previa.faixaAtual && previa.faixaAtual.label,
        faixaDepois: previa.faixaSimulada && previa.faixaSimulada.label,
      },
      extras: {
        previa,
        // RF-019 — original e substituto permanecem visíveis, inclusive com 0%
        mix: E.mixOf(compNovo).map((m) => ({
          ref: m.ref, nome: E.nomeDe(dados, m.ref), pct: E.n(m.pct),
          qtd: E.n(compNovo.qtd) * E.n(m.pct) / 100,
          utilizado: E.n(m.pct) > 0,
        })),
        resultado: E.resultadoProduto(dados, prodId, base, params),
      },
    };
  });
}

/**
 * RF-017 · RF-023 — ajuste da proporção diretamente na estrutura. Com duas
 * alternativas, a outra é complementada automaticamente para totalizar 100%.
 */
async function ajustarProporcao(id, { prodId, idx, mi, pct }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const prod = acharProdutoOu404(E, dadosAntes, prodId);
    const comp = acharComponenteOu404(prod, idx);
    const mixAntes = E.mixOf(comp);
    if (mi < 0 || mi >= mixAntes.length) {
      throw erro(422, `Alternativa ${mi} não existe neste componente — há ${mixAntes.length} alternativa(s).`);
    }

    const dados = comoRegra(() => E.ajustarProporcao(dadosAntes, prodId, idx, mi, pct));
    const compNovo = E.acharProduto(dados, prodId).componentes[idx];
    const total = E.mixOf(compNovo).reduce((a, m) => a + E.n(m.pct), 0);
    const base = baseDe(cenario);

    return {
      dados,
      tipo: 'proporcao',
      detalhe: {
        requisito: 'RF-017 · RF-023',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId, idx,
        item: E.nomeDe(dados, mixAntes[mi].ref),
        de: E.n(mixAntes[mi].pct), para: E.n(pct), total,
      },
      extras: {
        mix: E.mixOf(compNovo).map((m) => ({
          ref: m.ref, nome: E.nomeDe(dados, m.ref), pct: E.n(m.pct),
          qtd: E.n(compNovo.qtd) * E.n(m.pct) / 100,
          utilizado: E.n(m.pct) > 0,
        })),
        total,
        // RF-023 — total diferente de 100% é sinalizado para normalização
        exigeNormalizacao: Math.abs(total - 100) > 0.01,
        resultado: E.resultadoProduto(dados, prodId, base, params),
      },
    };
  });
}

/** RF-023 — normaliza as proporções redistribuindo proporcionalmente até 100%. */
async function normalizarProporcoes(id, { prodId, idx }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const prod = acharProdutoOu404(E, dadosAntes, prodId);
    const comp = acharComponenteOu404(prod, idx);
    const totalAntes = E.mixOf(comp).reduce((a, m) => a + E.n(m.pct), 0);

    const dados = comoRegra(() => E.normalizarProporcoes(dadosAntes, prodId, idx));
    const compNovo = E.acharProduto(dados, prodId).componentes[idx];
    const total = E.mixOf(compNovo).reduce((a, m) => a + E.n(m.pct), 0);
    const base = baseDe(cenario);

    return {
      dados,
      tipo: 'normalizacao',
      detalhe: {
        requisito: 'RF-023',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId, idx,
        totalAntes, totalDepois: total,
      },
      extras: {
        mix: E.mixOf(compNovo).map((m) => ({
          ref: m.ref, nome: E.nomeDe(dados, m.ref), pct: E.n(m.pct),
          qtd: E.n(compNovo.qtd) * E.n(m.pct) / 100,
          utilizado: E.n(m.pct) > 0,
        })),
        total,
        resultado: E.resultadoProduto(dados, prodId, base, params),
      },
    };
  });
}

/**
 * RF-024 — reverte a substituição: a estrutura retorna ao componente original
 * com 100% e sem alternativas residuais.
 */
async function reverterSubstituicao(id, { prodId, idx }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const prod = acharProdutoOu404(E, dadosAntes, prodId);
    const comp = acharComponenteOu404(prod, idx);
    if (!E.temSubstituicao(comp)) {
      throw erro(422, `O componente «${E.nomeDe(dadosAntes, E.mixOf(comp)[0].ref)}» não possui substituição a reverter (RF-024).`);
    }
    const mixAntes = E.mixOf(comp).map((m) => `${E.nomeDe(dadosAntes, m.ref)} ${E.num(m.pct, 0)}%`).join(' · ');
    const refOriginal = E.mixOf(comp)[0].ref;

    const dados = comoRegra(() => E.reverterSubstituicao(dadosAntes, prodId, idx));
    const base = baseDe(cenario);

    return {
      dados,
      tipo: 'reversao',
      detalhe: {
        requisito: 'RF-024',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId, idx,
        de: mixAntes, para: `${E.nomeDe(dados, refOriginal)} 100%`,
      },
      extras: {
        original: { ref: refOriginal, nome: E.nomeDe(dados, refOriginal), pct: 100 },
        resultado: E.resultadoProduto(dados, prodId, base, params),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Modo avançado: receita e custo industrial (RF-011 · RF-012 · RF-034 · RF-035)
// ---------------------------------------------------------------------------

/**
 * RF-011 — alteração da quantidade de um componente da receita, condicionada ao
 * modo avançado e ao perfil de acesso. A quantidade padrão da carga é
 * preservada em `qtdPadrao` para a rastreabilidade e a validação técnica
 * (RF-036 · RF-038).
 */
async function alterarQtdComponente(id, { prodId, idx, qtd }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    garantirModoAvancado(cenario, 'A alteração da quantidade da receita', 'RF-011');

    const dados = E.clonar(dadosAntes);
    const prod = acharProdutoOu404(E, dados, prodId);
    const comp = acharComponenteOu404(prod, idx);
    const anterior = E.n(comp.qtd);
    const nova = E.n(qtd);
    if (!(nova > 0)) {
      throw erro(422, 'A quantidade do componente deve ser maior que zero — quantidade zerada invalida a estrutura (RF-028).');
    }

    if (comp.qtdPadrao == null) comp.qtdPadrao = anterior;   // RF-036 — referência da carga
    comp.qtd = nova;
    const base = baseDe(cenario);

    return {
      dados,
      tipo: 'quantidade',
      detalhe: {
        requisito: 'RF-011',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId, idx,
        item: E.nomeDe(dados, E.mixOf(comp)[0].ref),
        de: anterior, para: nova, padrao: E.n(comp.qtdPadrao),
        unidade: E.unidadeDe(dados, E.mixOf(comp)[0].ref),
        modoCenario: 'avancado',
        exigeValidacaoTecnica: true,         // RN-11 · RF-038
      },
      extras: {
        componente: {
          idx, qtd: nova, qtdPadrao: E.n(comp.qtdPadrao),
          unidade: E.unidadeDe(dados, E.mixOf(comp)[0].ref),
          alteradaVsPadrao: Math.abs(nova - E.n(comp.qtdPadrao)) > 1e-9,
        },
        // RN-11 — alteração de receita exige validação técnica antes de consolidar
        exigeValidacaoTecnica: E.exigeValidacaoTecnica(dados),
        resultado: E.resultadoProduto(dados, prodId, base, params),
      },
    };
  });
}

/**
 * RF-012 — parametrização de mão de obra e custos industriais (overhead) por
 * produto. O overhead compõe o custo total e não integra a parcela importada.
 */
async function alterarOverhead(id, { prodId, overhead }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    garantirModoAvancado(cenario, 'A parametrização do custo industrial (overhead)', 'RF-012');

    const dados = E.clonar(dadosAntes);
    const prod = acharProdutoOu404(E, dados, prodId);
    const anterior = E.n(prod.overhead);
    const novo = E.n(overhead);
    if (!(novo >= 0)) {
      throw erro(422, 'O custo industrial (overhead) deve ser um valor igual ou maior que zero.');
    }

    if (prod.overheadPadrao == null) prod.overheadPadrao = anterior;   // RF-036
    prod.overhead = novo;
    const base = baseDe(cenario);
    const resultado = E.resultadoProduto(dados, prodId, base, params);

    return {
      dados,
      tipo: 'overhead',
      detalhe: {
        requisito: 'RF-012',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId,
        de: anterior, para: novo, padrao: E.n(prod.overheadPadrao),
        modoCenario: 'avancado',
        exigeValidacaoTecnica: true,         // RN-11 · RF-038
      },
      extras: {
        produto: {
          id: prod.id, overhead: novo, overheadPadrao: E.n(prod.overheadPadrao),
          alteradoVsPadrao: Math.abs(novo - E.n(prod.overheadPadrao)) > 1e-9,
        },
        // RF-012 — o overhead compõe o custo total sem integrar a parcela importada
        composicao: {
          custoTotal: resultado.custo,
          parcelaImportada: resultado.parcela,
          overhead: novo,
          nota: 'O custo industrial compõe o custo total da mercadoria e não integra a parcela importada (RF-012).',
        },
        exigeValidacaoTecnica: E.exigeValidacaoTecnica(dados),
        resultado,
      },
    };
  });
}

/**
 * RF-034 · RF-035 — alternância explícita entre modo padrão e modo avançado.
 * A troca altera o bloqueio dos campos de receita (quantidade e overhead) e é
 * registrada na trilha de auditoria do cenário.
 */
async function alternarModo(id, { modo }, usuario) {
  if (modo !== 'padrao' && modo !== 'avancado') {
    throw erro(422, 'Modo inválido: informe «padrao» (receita protegida) ou «avancado» (receita editável) — RF-034.');
  }

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const anterior = String(cenario.modo || 'padrao');
    if (anterior === modo) {
      throw erro(422, `O cenário já está no modo ${modo === 'avancado' ? 'avançado' : 'padrão'}.`);
    }

    return {
      dados: dadosAntes,
      modo,
      tipo: 'modo',
      detalhe: { requisito: 'RF-034 · RF-035', de: anterior, para: modo },
      extras: {
        modo,
        camposReceitaLiberados: modo === 'avancado',
        nota: modo === 'avancado'
          ? 'Modo avançado ativo: a quantidade dos componentes (RF-011) e o custo industrial (RF-012) ficam editáveis. ' +
            'Alterações de receita exigem validação técnica antes da consolidação (RF-036 · RN-11).'
          : 'Modo padrão ativo: a simulação ocorre sobre a receita padrão do ERP; quantidade e custo industrial ' +
            'permanecem bloqueados (RF-011 · RF-012).',
        // RN-11 — alterações de receita já existentes continuam exigindo validação
        exigeValidacaoTecnica: E.exigeValidacaoTecnica(dadosAntes),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Premissas do insumo: origem, conteúdo, custo e câmbio
// (RF-046 a RF-055 · RF-058 · RF-059)
// ---------------------------------------------------------------------------

/**
 * Campos editáveis do insumo no cenário.
 *   ci  → conteúdo de importação — bloqueado em item nacional (RF-049)
 *   imp → componentes do valor aduaneiro — bloqueados em item nacional (RF-049)
 */
const CAMPOS_INSUMO = {
  classSim:      { tipo: 'classe',     rotulo: 'classificação de origem' },                  // RF-046 · RF-051
  ciModo:        { tipo: 'ciModo',     rotulo: 'modo do conteúdo de importação' },            // RF-048
  ciFaixa:       { tipo: 'faixa',      rotulo: 'faixa de conteúdo de importação', ci: true }, // RF-048
  ciPct:         { tipo: 'pct',        rotulo: 'percentual de conteúdo de importação', ci: true },
  cstOrigem:     { tipo: 'texto',      rotulo: 'CST de origem' },                             // RF-050
  moeda:         { tipo: 'moeda',      rotulo: 'moeda do insumo' },                           // RF-053
  fob:           { tipo: 'valor',      rotulo: 'FOB na moeda do insumo', imp: true },          // RF-059
  freteInt:      { tipo: 'valor',      rotulo: 'frete internacional', imp: true },
  seguroInt:     { tipo: 'valor',      rotulo: 'seguro internacional', imp: true },
  ii:            { tipo: 'valor',      rotulo: 'imposto de importação (II)', imp: true },
  ipiImp:        { tipo: 'valor',      rotulo: 'IPI de importação', imp: true },
  pisCofinsImp:  { tipo: 'valor',      rotulo: 'PIS/COFINS de importação', imp: true },
  precoNacional: { tipo: 'valor',      rotulo: 'valor total de entrada' },                     // RF-058
  icms:          { tipo: 'valor',      rotulo: 'ICMS destacado' },
  ipi:           { tipo: 'valor',      rotulo: 'IPI destacado' },
  fornecedorId:  { tipo: 'fornecedor', rotulo: 'fornecedor' },                                 // RF-020 · RF-055
};

/** Campos que alteram o CST de origem sugerido (RF-050). */
const CAMPOS_CST = ['classSim', 'ciModo', 'ciFaixa', 'ciPct'];

/** Normaliza e valida um campo do insumo, em português (RNF-03). */
function normalizarCampoInsumo(E, dados, campo, valor) {
  const def = CAMPOS_INSUMO[campo];
  switch (def.tipo) {
    case 'classe': {
      const v = String(valor == null ? '' : valor);
      if (!E.CLASSES[v]) {
        throw erro(422, `Classificação de origem inválida: «${valor}». Classificações aceitas (RF-046): ` +
          Object.entries(E.CLASSES).map(([k, c]) => `${k} (${c.label})`).join(', ') + '.');
      }
      return v;
    }
    case 'ciModo': {
      const v = String(valor == null ? '' : valor);
      if (v !== 'pct' && v !== 'faixa') {
        throw erro(422, 'Modo do conteúdo de importação deve ser «pct» (percentual informado) ou «faixa» (faixa aplicável) — RF-048.');
      }
      return v;
    }
    case 'faixa': {
      const v = String(valor == null ? '' : valor);
      if (!E.FAIXAS[v]) {
        throw erro(422, `Faixa de conteúdo inválida: «${valor}». Faixas legais (RF-098): ` +
          Object.values(E.FAIXAS).map((f) => `${f.id} (${f.label})`).join(', ') + '.');
      }
      return v;
    }
    case 'pct': {
      const v = E.n(valor, NaN);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        throw erro(422, 'O percentual de conteúdo de importação deve ser um número entre 0 e 100 (RF-048).');
      }
      return v;
    }
    case 'moeda': {
      const v = String(valor == null ? '' : valor).toUpperCase();
      if (!E.MOEDAS[v]) {
        throw erro(422, `Moeda não parametrizada: «${valor}». Moedas disponíveis (RF-052): ${Object.keys(E.MOEDAS).join(', ')}.`);
      }
      return v;
    }
    case 'valor': {
      const v = E.n(valor, NaN);
      if (!Number.isFinite(v) || v < 0) {
        throw erro(422, `O campo «${def.rotulo}» exige um valor numérico igual ou maior que zero.`);
      }
      return v;
    }
    case 'texto':
      return String(valor == null ? '' : valor).trim();
    case 'fornecedor': {
      if (valor == null || valor === '') return null;
      const v = String(valor);
      if (!(dados.fornecedores || []).some((f) => f.id === v)) {
        throw erro(422, `Fornecedor «${valor}» não consta no cadastro de fornecedores deste cenário.`);
      }
      return v;
    }
    default:
      return valor;
  }
}

/**
 * RF-049 — para itens efetivamente nacionais, os campos não aplicáveis ficam
 * bloqueados: conteúdo de importação e custos de importação não são editáveis.
 */
function bloquearCamposNaoAplicaveis(classEfetiva, campos) {
  if (classEfetiva !== 'nacional') return;
  const bloqueados = Object.keys(campos)
    .filter((c) => CAMPOS_INSUMO[c] && (CAMPOS_INSUMO[c].ci || CAMPOS_INSUMO[c].imp));
  if (!bloqueados.length) return;
  throw erro(
    422,
    'Item classificado como nacional não permite edição de conteúdo de importação nem de custos de importação. ' +
    `Campos bloqueados nesta solicitação: ${bloqueados.map((c) => CAMPOS_INSUMO[c].rotulo).join(', ')}. ` +
    'Para liberá-los, altere antes a classificação de origem para «nacional com conteúdo de importação» ou ' +
    '«importado diretamente» (RF-049 · RF-051).'
  );
}

/** Campos do insumo bloqueados para a classificação vigente — apoio da tela (RF-049). */
function camposBloqueadosDe(classEfetiva) {
  if (classEfetiva !== 'nacional') return [];
  return Object.keys(CAMPOS_INSUMO).filter((c) => CAMPOS_INSUMO[c].ci || CAMPOS_INSUMO[c].imp);
}

/** Retrato do insumo devolvido à tela, com CI adotado, CST e custo FCI. */
function retratoInsumo(E, dados, ins) {
  const info = E.nodeInfo(ins);
  const sugerido = E.cstSugerido(ins.classSim, ins.ciFaixa, ins.ciPct, ins.ciModo);
  const informado = String(ins.cstOrigem == null ? '' : ins.cstOrigem).trim();
  return {
    insumo: ins,
    classe: E.CLASSES[ins.classSim] || null,
    // RF-048 — o CI adotado é exibido, qualquer que seja o modo
    ciAdotado: info.ci, ciLabel: info.ciLabel, ciModoAdotado: info.modo, fator: info.fator,
    // RF-050 — CST sugerido pela classificação/faixa e sinalização da divergência manual
    cstSugerido: sugerido,
    cstInformado: informado,
    divergenciaCst: !!(informado && informado !== sugerido),
    // RF-047 — origem do cadastro exibida ao lado da classificação adotada
    origemCadastro: { origemErp: ins.origemErp, origemCad: ins.origemCad, classPadrao: ins.classPadrao },
    divergenciaOrigem: !!(ins.classPadrao && ins.classPadrao !== ins.classSim),
    // RF-058 · RF-059 — custo FCI e sua memória de cálculo
    custoFCI: E.custoFCI(ins, dados.cambio),
    memoriaCusto: E.memoriaCustoFCI(ins, dados.cambio),
    valorAduaneiro: ins.classSim === 'importado_direto' ? E.valorAduaneiro(ins, dados.cambio) : null,
    fornecedor: E.fornecedorDe(dados, ins),
    camposBloqueados: camposBloqueadosDe(ins.classSim),
    camposAduaneiros: E.CAMPOS_ADUANEIROS,
  };
}

/**
 * RF-046 a RF-051 · RF-058 · RF-059 — atualiza as premissas de um insumo do
 * cenário: classificação de origem, conteúdo de importação (percentual ou
 * faixa), CST, moeda, componentes do valor aduaneiro, preço de entrada,
 * tributos destacados e fornecedor.
 *
 * Origem do item e percentual de conteúdo são variáveis distintas, tratadas em
 * campos próprios e editáveis de forma independente (RF-051).
 */
async function atualizarInsumo(id, { ref, campos }, usuario) {
  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const pedidos = {};
    for (const [campo, valor] of Object.entries(campos || {})) {
      if (!CAMPOS_INSUMO[campo]) {
        throw erro(422, `Campo não editável no insumo: «${campo}». Campos aceitos: ${Object.keys(CAMPOS_INSUMO).join(', ')}.`);
      }
      pedidos[campo] = valor;
    }
    if (!Object.keys(pedidos).length) throw erro(422, 'Informe ao menos um campo a atualizar no insumo.');

    const dados = E.clonar(dadosAntes);
    const ins = acharInsumoOu404(E, dados, ref);

    // Classificação efetiva depois da edição — base do bloqueio do RF-049
    const classEfetiva = pedidos.classSim != null
      ? normalizarCampoInsumo(E, dados, 'classSim', pedidos.classSim)
      : (ins.classSim || 'nacional');
    bloquearCamposNaoAplicaveis(classEfetiva, pedidos);

    const alteracoes = [];
    for (const [campo, valor] of Object.entries(pedidos)) {
      const novo = normalizarCampoInsumo(E, dados, campo, valor);
      const anterior = ins[campo] == null ? null : ins[campo];
      if (anterior !== novo) {
        alteracoes.push({ campo, rotulo: CAMPOS_INSUMO[campo].rotulo, de: anterior, para: novo });
      }
      ins[campo] = novo;
    }

    // RF-049 · RN-04 — item nacional não carrega conteúdo de importação adotado
    if (ins.classSim === 'nacional') ins.ciPct = 0;

    const retrato = retratoInsumo(E, dados, ins);
    const mexeuCst = Object.keys(pedidos).some((c) => CAMPOS_CST.includes(c));

    return {
      dados,
      tipo: 'premissa_insumo',
      detalhe: {
        requisito: 'RF-046 · RF-047 · RF-048 · RF-049 · RF-050 · RF-051 · RF-058 · RF-059',
        insumo: `${ins.nome} (${ins.codigo || ins.id})`, ref: ins.id,
        alteracoes,
        ciAdotado: retrato.ciAdotado,
        cstSugerido: retrato.cstSugerido,
        custoFCI: retrato.custoFCI,
      },
      extras: {
        ...retrato,
        alteracoes,
        // RF-050 — a alteração de classificação/CI atualiza o CST sugerido
        cstRecalculado: mexeuCst,
        cstSugerido: retrato.cstSugerido,
        // RF-054 — insumos afetados pela moeda, para o painel de câmbio
        moedas: pedidos.moeda != null ? E.insumosPorMoeda(dados) : undefined,
      },
    };
  });
}

/**
 * RF-055 — alternativa cadastral: inclui no cenário um NOVO insumo derivado de
 * um item existente (novo fornecedor, nova moeda, nova origem), identificado
 * com `alt: true` e código prefixado «ALT-». O cadastro oficial não é alterado
 * e a alternativa não aparece em nenhum outro cenário (RF-007 · RNF-06).
 */
async function criarAlternativaInsumo(id, corpo, usuario) {
  const { base, nome } = corpo || {};

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const dados = E.clonar(dadosAntes);
    const original = acharInsumoOu404(E, dados, base);
    const rotulo = String(nome == null ? '' : nome).trim();
    if (!rotulo) throw erro(422, 'Informe o nome da alternativa cadastral (RF-055).');

    // Identificador único prefixado, estável dentro do cenário
    const usados = new Set((dados.insumos || []).map((i) => i.id));
    let seq = 1;
    let novoId = `ALT-${original.id}-${seq}`;
    while (usados.has(novoId)) { seq += 1; novoId = `ALT-${original.id}-${seq}`; }

    const novo = E.clonar(original);
    novo.id = novoId;
    novo.codigo = String(corpo.codigo == null || corpo.codigo === '' ? `${original.codigo || original.id}·ALT${seq}` : corpo.codigo).trim();
    novo.nome = rotulo;
    novo.alt = true;                      // RF-055 — identificada como alternativa do cenário
    novo.baseRef = original.id;
    novo.unidade = String(corpo.unidade == null || corpo.unidade === '' ? original.unidade : corpo.unidade);
    novo.grupo = String(corpo.grupo == null || corpo.grupo === '' ? original.grupo : corpo.grupo);
    novo.classFiscal = String(corpo.classFiscal == null ? (original.classFiscal || '') : corpo.classFiscal);
    novo.criadaEm = new Date().toISOString();
    novo.criadaPor = usuario ? usuario.nome : '';

    // Premissas informadas na criação passam pela mesma validação do RF-049
    const pedidos = {};
    for (const [campo, valor] of Object.entries(corpo)) {
      if (CAMPOS_INSUMO[campo] && valor !== undefined) pedidos[campo] = valor;
    }
    const classEfetiva = pedidos.classSim != null
      ? normalizarCampoInsumo(E, dados, 'classSim', pedidos.classSim)
      : (novo.classSim || 'nacional');
    bloquearCamposNaoAplicaveis(classEfetiva, pedidos);
    for (const [campo, valor] of Object.entries(pedidos)) {
      novo[campo] = normalizarCampoInsumo(E, dados, campo, valor);
    }
    if (novo.classSim === 'nacional') novo.ciPct = 0;

    // A alternativa não tem contrapartida no ERP: o próprio valor adotado é a
    // referência, de modo que o diff aponte a inclusão e não uma alteração
    // inexistente do cadastro oficial (RF-036).
    novo.classPadrao = novo.classSim;
    novo.ciPadrao = E.n(novo.ciPct);
    novo.precoPadrao = E.n(novo.precoNacional);
    novo.origemCad = 'alternativa_cenario';

    dados.insumos = [...(dados.insumos || []), novo];

    return {
      dados,
      tipo: 'alternativa_insumo',
      detalhe: {
        requisito: 'RF-055',
        base: `${original.nome} (${original.codigo || original.id})`, baseRef: original.id,
        alternativa: `${novo.nome} (${novo.codigo})`, ref: novo.id,
        classSim: novo.classSim, moeda: novo.moeda, fornecedorId: novo.fornecedorId,
        nota: 'Alternativa cadastral válida apenas neste cenário — o cadastro oficial não foi alterado (RF-055 · RNF-06).',
      },
      extras: {
        ...retratoInsumo(E, dados, novo),
        criada: true,
        moedas: E.insumosPorMoeda(dados),
        nota: 'A alternativa está disponível como substituto nas estruturas deste cenário (RF-020) e não aparece ' +
              'nos demais cenários (RF-007 · RF-055).',
      },
    };
  });
}

/**
 * RF-052 · RF-053 · RF-054 — altera a cotação de uma moeda do cenário e
 * recalcula em lote todos os insumos vinculados a ela. A cotação da carga
 * permanece em `cambioPadrao` como referência da variação (RF-036).
 */
async function atualizarCambio(id, { moeda, cotacao }, usuario) {
  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const cod = String(moeda == null ? '' : moeda).toUpperCase();
    if (!E.MOEDAS[cod]) {
      throw erro(422, `Moeda não parametrizada: «${moeda}». Moedas disponíveis (RF-052): ${Object.keys(E.MOEDAS).join(', ')}.`);
    }
    if (cod === 'BRL') {
      throw erro(422, 'O Real é a moeda de referência do cenário e não possui cotação editável (RF-052).');
    }
    const valor = E.n(cotacao, NaN);
    if (!Number.isFinite(valor) || valor <= 0) {
      throw erro(422, 'Informe a cotação da moeda como um número maior que zero.');
    }

    const dados = E.clonar(dadosAntes);
    dados.cambio = Object.assign({}, dados.cambio || {});
    if (!dados.cambioPadrao) dados.cambioPadrao = Object.assign({}, dados.cambio);
    if (dados.cambioPadrao[cod] == null) dados.cambioPadrao[cod] = E.n(dados.cambio[cod], valor);
    const anterior = E.n(dados.cambio[cod]);
    dados.cambio[cod] = valor;

    // RF-053 · RF-054 — painel de câmbio com os insumos vinculados e o custo
    // FCI já recalculado pelo motor para toda a moeda.
    const moedas = E.insumosPorMoeda(dados);
    const painel = moedas.find((m) => m.moeda === cod) || { insumos: [], nInsumos: 0 };
    const antesPorRef = new Map(
      (E.insumosPorMoeda(dadosAntes).find((m) => m.moeda === cod) || { insumos: [] })
        .insumos.map((i) => [i.ref, i.custoFCI])
    );

    return {
      dados,
      tipo: 'cambio',
      detalhe: {
        requisito: 'RF-052 · RF-053 · RF-054',
        moeda: cod, de: anterior, para: valor,
        cotacaoPadrao: E.n(dados.cambioPadrao[cod]),
        nInsumosRecalculados: painel.nInsumos,
      },
      extras: {
        moeda: cod, cotacao: valor, cotacaoAnterior: anterior,
        cotacaoPadrao: E.n(dados.cambioPadrao[cod]),
        variacaoPct: E.n(dados.cambioPadrao[cod]) > 0
          ? (valor / E.n(dados.cambioPadrao[cod]) - 1) * 100 : 0,
        // RF-054 — todos os itens da moeda recalculados simultaneamente
        moedas,
        recalculados: painel.insumos.map((i) => ({
          ...i,
          custoAnterior: E.n(antesPorRef.get(i.ref)),
          deltaCusto: i.custoFCI - E.n(antesPorRef.get(i.ref)),
        })),
        nRecalculados: painel.nInsumos,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Volumes, preços e destinos (RF-066 a RF-072)
// ---------------------------------------------------------------------------

/** RF-072 — escopo da saída declarado na tela de volumes e destinos. */
const NOTA_ESCOPO_SAIDA =
  'Considera-se a saída registrada pela empresa para a UF de destino; movimentações posteriores de ' +
  'distribuidores entre estados não são consideradas (RF-072). O resultado oficial do cenário usa a média ' +
  'ponderada nacional — a visão por UF é apoio à análise (RF-069).';

/** Normaliza e valida a lista de saídas informada pela tela (RF-066 · RF-068). */
function normalizarSaidas(E, lista) {
  if (!Array.isArray(lista)) throw erro(422, 'Envie «saidas» como uma lista de { uf, volume, preco }.');
  const vistas = new Set();
  return lista.map((s, i) => {
    const uf = String((s && s.uf) == null ? '' : s.uf).trim().toUpperCase();
    if (!E.UFS.includes(uf)) {
      throw erro(422, `UF inválida na linha ${i + 1}: «${(s && s.uf) || ''}». Informe uma unidade da Federação de destino (RF-066).`);
    }
    if (vistas.has(uf)) {
      throw erro(422, `UF ${uf} informada mais de uma vez — cada destino deve aparecer em uma única linha (RF-066).`);
    }
    vistas.add(uf);
    const volume = E.n(s.volume, NaN);
    const preco = E.n(s.preco, NaN);
    if (!Number.isFinite(volume) || volume < 0) {
      throw erro(422, `Volume inválido para ${uf}: informe um número igual ou maior que zero.`);
    }
    if (!Number.isFinite(preco) || preco < 0) {
      throw erro(422, `Preço inválido para ${uf}: informe um número igual ou maior que zero.`);
    }
    return { uf, volume, preco };
  });
}

/** Painel de volumes e destinos devolvido após cada edição (RF-066 a RF-072). */
function painelSaidas(E, dados, prodId, base, params) {
  const prod = E.acharProduto(dados, prodId);
  const resultado = E.resultadoProduto(dados, prodId, base, params);
  return {
    saidas: prod.saidas || [],
    // RF-070 — peso de cada UF no volume e no preço médio, totalizando 100%
    pesos: E.pesosUF(prod),
    volumeTotal: (prod.saidas || []).reduce((a, s) => a + E.n(s.volume), 0),
    // RF-066 · RF-069 — média ponderada nacional das saídas interestaduais
    precoMedio: E.precoMedio(prod),
    base, baseUsada: resultado.baseUsada, baseLabel: resultado.baseLabel,
    resultado,
    nota: NOTA_ESCOPO_SAIDA,
  };
}

/**
 * RF-066 · RF-068 — substitui as saídas do produto com os volumes e preços
 * ajustados no cenário. O valor da carga (volumePadrao/precoPadrao) é
 * preservado nas UFs que já existiam, para a rastreabilidade do RF-036.
 */
async function atualizarSaidas(id, { prodId, saidas }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const lista = normalizarSaidas(E, saidas);
    const dados = E.clonar(dadosAntes);
    const prod = acharProdutoOu404(E, dados, prodId);

    const anteriores = new Map((prod.saidas || []).map((s) => [String(s.uf).toUpperCase(), s]));
    const alteracoes = [];
    prod.saidas = lista.map((s) => {
      const antes = anteriores.get(s.uf);
      // RF-068 — a UF que já existia conserva a referência da carga
      const volumePadrao = antes && antes.volumePadrao != null ? E.n(antes.volumePadrao) : s.volume;
      const precoPadrao = antes && antes.precoPadrao != null ? E.n(antes.precoPadrao) : s.preco;
      if (!antes) {
        alteracoes.push({ uf: s.uf, acao: 'incluida', volume: s.volume, preco: s.preco });
      } else if (Math.abs(E.n(antes.volume) - s.volume) > 1e-9 || Math.abs(E.n(antes.preco) - s.preco) > 1e-9) {
        alteracoes.push({
          uf: s.uf, acao: 'ajustada',
          volumeDe: E.n(antes.volume), volumePara: s.volume,
          precoDe: E.n(antes.preco), precoPara: s.preco,
        });
      }
      return { uf: s.uf, volume: s.volume, preco: s.preco, volumePadrao, precoPadrao };
    });
    for (const uf of anteriores.keys()) {
      if (!lista.some((s) => s.uf === uf)) alteracoes.push({ uf, acao: 'removida' });
    }

    const base = baseDe(cenario);
    const painel = painelSaidas(E, dados, prodId, base, params);

    return {
      dados,
      tipo: 'saidas',
      detalhe: {
        requisito: 'RF-066 · RF-068 · RF-070',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId,
        nUFs: prod.saidas.length, alteracoes,
        precoMedio: painel.precoMedio, volumeTotal: painel.volumeTotal,
        ci: painel.resultado.ci,
      },
      extras: painel,
    };
  });
}

/**
 * RF-067 — carga dos volumes e preços do Sistema de Preços integrado, em duas
 * ações distintas:
 *   'substituir'   → troca toda a base de saídas do produto
 *   'complementar' → acrescenta APENAS as UFs ausentes, preservando os ajustes
 *                    já feitos no cenário
 * O staging é somente lido — nenhuma base de origem é alterada (RNF-06).
 */
async function cargaSaidas(id, { prodId, modo }, usuario) {
  if (modo !== 'substituir' && modo !== 'complementar') {
    throw erro(422, 'Informe o modo da carga: «substituir» (troca toda a base de saídas) ou «complementar» (apenas as UFs ausentes) — RF-067.');
  }
  const params = await carregarParametros();
  const E0 = engine();

  // A chave do Sistema de Preços é o SKU do produto no cenário
  const cenarioAtual = await obterCenario(id);
  // RN-10 — cenário congelado ou consolidado recusa a carga com 409 ANTES de
  // consultar o Sistema de Preços, para que a resposta seja o travamento das
  // premissas e não a ausência de volumes no staging.
  garantirEditavel(cenarioAtual);
  const prodAtual = acharProdutoOu404(E0, cenarioAtual.dados || {}, prodId);
  const sku = String(prodAtual.sku || prodAtual.id);

  const { rows } = await query(
    `SELECT s.payload, s.sync_em, f.codigo AS fonte_codigo, f.nome AS fonte_nome
       FROM stg_registros s
       JOIN fontes_dados f ON f.id = s.fonte_id
      WHERE s.entidade = 'saida_uf'
        AND upper(s.payload->>'sku') = upper($1)
      ORDER BY s.id`,
    [sku]
  );
  if (!rows.length) {
    throw erro(
      422,
      `O Sistema de Preços integrado não possui volumes para o SKU ${sku}. Sincronize a fonte de preço de saída ` +
      'antes de executar a carga (RF-067 · RF-090).'
    );
  }

  // Consolida eventuais linhas repetidas da mesma UF: volume somado e preço
  // ponderado pelo volume, para não duplicar destino.
  const porUF = new Map();
  for (const r of rows) {
    const uf = String(r.payload.uf || '').trim().toUpperCase();
    if (!E0.UFS.includes(uf)) continue;
    const volume = E0.n(r.payload.volume);
    const preco = E0.n(r.payload.preco);
    const acc = porUF.get(uf) || { uf, volume: 0, valor: 0 };
    acc.volume += volume;
    acc.valor += volume * preco;
    porUF.set(uf, acc);
  }
  const daCarga = [...porUF.values()].map((a) => ({
    uf: a.uf,
    volume: a.volume,
    preco: a.volume > 0 ? a.valor / a.volume : 0,
  })).sort((a, b) => b.volume - a.volume || a.uf.localeCompare(b.uf));

  if (!daCarga.length) {
    throw erro(422, `As linhas de saída do SKU ${sku} no staging não possuem UF de destino válida (RF-067).`);
  }

  const fontes = [...new Map(rows.map((r) => [r.fonte_codigo, {
    codigo: r.fonte_codigo, nome: r.fonte_nome, syncEm: r.sync_em,
  }])).values()];

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    const dados = E.clonar(dadosAntes);
    const prod = acharProdutoOu404(E, dados, prodId);
    const existentes = new Map((prod.saidas || []).map((s) => [String(s.uf).toUpperCase(), s]));

    let incluidas = [];
    let substituidas = [];
    let preservadas = [];

    if (modo === 'substituir') {
      // Toda a base de saídas passa a ser a do Sistema de Preços, e os valores
      // carregados tornam-se a nova referência de comparação (RF-036).
      prod.saidas = daCarga.map((s) => ({
        uf: s.uf, volume: s.volume, preco: s.preco,
        volumePadrao: s.volume, precoPadrao: s.preco,
      }));
      incluidas = daCarga.filter((s) => !existentes.has(s.uf)).map((s) => s.uf);
      substituidas = daCarga.filter((s) => existentes.has(s.uf)).map((s) => s.uf);
    } else {
      // RF-067 — complementar acrescenta somente as UFs ausentes; as UFs já
      // presentes mantêm integralmente o ajuste feito no cenário (RF-068).
      const ausentes = daCarga.filter((s) => !existentes.has(s.uf));
      prod.saidas = [
        ...(prod.saidas || []),
        ...ausentes.map((s) => ({
          uf: s.uf, volume: s.volume, preco: s.preco,
          volumePadrao: s.volume, precoPadrao: s.preco,
        })),
      ];
      incluidas = ausentes.map((s) => s.uf);
      preservadas = daCarga.filter((s) => existentes.has(s.uf)).map((s) => s.uf);
      if (!ausentes.length) {
        throw erro(
          422,
          `Nenhuma UF ausente a complementar: as ${daCarga.length} UFs do Sistema de Preços já constam nas saídas de ` +
          `«${prod.nome}». Use a ação «substituir» para trocar toda a base de saídas (RF-067).`
        );
      }
    }

    const base = baseDe(cenario);
    const painel = painelSaidas(E, dados, prodId, base, params);

    return {
      dados,
      tipo: 'carga_saidas',
      detalhe: {
        requisito: 'RF-067',
        produto: `${prod.nome} (${prod.sku || prod.id})`, prodId, sku, modo,
        fontes, nUFsCarga: daCarga.length,
        incluidas, substituidas, preservadas,
        precoMedio: painel.precoMedio, volumeTotal: painel.volumeTotal,
      },
      extras: {
        ...painel,
        modo, sku, fontes,
        resumoCarga: {
          modo,
          rotulo: modo === 'substituir'
            ? 'Base de saídas substituída integralmente pela carga do Sistema de Preços (RF-067).'
            : 'Carga complementar aplicada apenas às UFs ausentes — os ajustes do cenário foram preservados (RF-067).',
          nUFsCarga: daCarga.length,
          nIncluidas: incluidas.length,
          nSubstituidas: substituidas.length,
          nPreservadas: preservadas.length,
          incluidas, substituidas, preservadas,
        },
      },
    };
  });
}

/**
 * RF-071 — sensibilidade de preço por UF: efeito no CI% de uma variação
 * percentual aplicada ao preço de cada destino, mantidas as demais premissas.
 * Operação apenas de leitura.
 */
async function sensibilidadeUF(id, prodId, variacao) {
  const E = engine();
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};
  const prod = acharProdutoOu404(E, dados, prodId);
  const params = await carregarParametros();
  const base = baseDe(cenario);
  const v = E.n(variacao, 5);
  if (!Number.isFinite(v) || v === 0) {
    throw erro(422, 'Informe a variação percentual de preço a simular (por exemplo, 5 para +5%) — RF-071.');
  }

  const linhas = E.sensibilidadeUF(dados, prodId, v, base);
  const resultado = E.resultadoProduto(dados, prodId, base, params);

  return {
    prodId,
    produto: { id: prod.id, sku: prod.sku || prod.id, nome: prod.nome },
    variacaoPct: v,
    linhas,
    // RF-070 — pesos por UF como apoio à leitura da sensibilidade
    pesos: E.pesosUF(prod),
    precoMedio: E.precoMedio(prod),
    ciAtual: resultado.ci,
    base, baseUsada: resultado.baseUsada, baseLabel: resultado.baseLabel,
    maiorImpacto: linhas[0] || null,
    nota: NOTA_ESCOPO_SAIDA,
  };
}

// ---------------------------------------------------------------------------
// Alterações em massa por grupo de insumo (RF-040 a RF-045)
// ---------------------------------------------------------------------------

/**
 * RF-040 — grupos de insumo existentes na ficha técnica, com os itens elegíveis
 * como substituto e todas as posições que utilizam cada grupo.
 */
async function gruposMassa(id) {
  const E = engine();
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};

  const grupos = E.gruposDeInsumo(dados).map((g) => ({
    grupo: g.grupo,
    posicoes: g.posicoes,
    nEstruturas: g.nEstruturas,
    estruturas: g.estruturas,
    refs: g.itens,                                 // referências já usadas no grupo
    itens: E.itensDoGrupo(dados, g.grupo),         // candidatos a substituto (RF-040)
    posicoesDetalhe: E.posicoesDoGrupo(dados, g.grupo),
  }));

  return {
    grupos,
    nGrupos: grupos.length,
    // RF-044 — a substituição pontual por SKU permanece disponível na estrutura
    nota: 'A substituição individual por SKU continua disponível na estrutura, independente da operação em lote (RF-044).',
  };
}

/**
 * RF-043 · RF-045 — prévia da alteração em massa: produtos e estruturas
 * afetados, CI% antes e depois, variação em p.p. e mudança de faixa, antes de
 * aplicar. Nada é gravado.
 */
async function previaMassa(id, { grupo, refSubstituto, pct, prodIds }) {
  const E = engine();
  const cenario = await obterCenario(id);
  const dados = cenario.dados || {};
  const params = await carregarParametros();
  const base = baseDe(cenario);

  if (!E.acharInsumo(dados, refSubstituto) && !E.acharProduto(dados, refSubstituto)) {
    throw erro(404, `Item substituto «${refSubstituto}» não encontrado no cenário.`);
  }
  const posicoes = E.posicoesDoGrupo(dados, grupo);
  if (!posicoes.length) {
    throw erro(404, `Nenhuma posição da ficha técnica utiliza o grupo de insumo «${grupo}» (RF-040).`);
  }

  const previa = E.previaMassa(dados, { grupo, refSubstituto, pct, prodIds }, base, params);
  const { dadosSimulados, ...resumo } = previa;

  return {
    ...resumo,
    base,
    // RF-031 — inconsistências que a operação em lote introduziria
    confronto: E.confrontarEdicao(dados, dadosSimulados, { modo: cenario.modo }),
    // RF-045 — a ação fica indisponível quando não há substituição a realizar
    aplicavel: previa.aplicavel,
    motivoIndisponivel: previa.motivoIndisponivel,
  };
}

/**
 * RF-041 · RF-042 — aplica a proporção informada uniformemente às estruturas
 * selecionadas; as demais permanecem intactas. A substituição individual por
 * SKU segue disponível depois da operação (RF-044).
 */
async function aplicarMassa(id, { grupo, refSubstituto, pct, prodIds }, usuario) {
  const params = await carregarParametros();

  return editar(id, usuario, (cenario, dadosAntes, E) => {
    if (!E.acharInsumo(dadosAntes, refSubstituto) && !E.acharProduto(dadosAntes, refSubstituto)) {
      throw erro(404, `Item substituto «${refSubstituto}» não encontrado no cenário.`);
    }
    if (!E.posicoesDoGrupo(dadosAntes, grupo).length) {
      throw erro(404, `Nenhuma posição da ficha técnica utiliza o grupo de insumo «${grupo}» (RF-040).`);
    }

    const base = baseDe(cenario);
    const aplicado = comoRegra(() => E.aplicarMassa(dadosAntes, { grupo, refSubstituto, pct, prodIds }, base, params));
    const { dadosSimulados, ...resumo } = aplicado.previa;

    return {
      dados: aplicado.dados,
      tipo: 'massa',
      detalhe: {
        requisito: 'RF-040 · RF-041 · RF-042',
        grupo, refSubstituto, substituto: resumo.nomeSubstituto, pct: resumo.pct,
        // RF-042 — apenas as estruturas selecionadas são alteradas
        selecao: Array.isArray(prodIds) && prodIds.length ? prodIds : 'todas as estruturas do grupo',
        nPosicoes: resumo.nPosicoes, nAplicadas: resumo.nAplicadas,
        estruturasAfetadas: resumo.aplicadas.map((p) => `${p.prodNome} (${p.prodSku}) · posição ${p.idx}`),
        impactos: resumo.impactos.map((i) => ({
          produto: `${i.nome} (${i.sku})`, ciAntes: i.ciAntes, ciDepois: i.ciDepois,
          deltaPp: i.deltaPp, mudaFaixa: i.mudaFaixa,
        })),
      },
      extras: {
        lote: resumo,
        base,
        nota: 'A substituição individual por SKU permanece disponível na estrutura após a operação em lote (RF-044).',
      },
    };
  });
}

module.exports = {
  // apoio
  carregarParametros, baseDe,
  // RF-015 a RF-024
  opcoesSubstituicao, previaSubstituicao, aplicarSubstituicao,
  ajustarProporcao, normalizarProporcoes, reverterSubstituicao,
  // RF-011 · RF-012 · RF-034 · RF-035
  alterarQtdComponente, alterarOverhead, alternarModo,
  // RF-046 a RF-055 · RF-058 · RF-059
  atualizarInsumo, criarAlternativaInsumo, atualizarCambio, CAMPOS_INSUMO,
  // RF-066 a RF-072
  atualizarSaidas, cargaSaidas, sensibilidadeUF,
  // RF-040 a RF-045
  gruposMassa, previaMassa, aplicarMassa,
};
