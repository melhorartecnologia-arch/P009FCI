'use strict';
/**
 * Relatório executivo consolidado e exportação em PDF.
 *
 *   RF-087  relatório executivo por produto — CI%, enquadramento, alíquota,
 *           variação vs FCI vigente e obrigatoriedade da FCI, identificando
 *           cenário, ciclo, versão, status, autor, data de emissão, origem dos
 *           dados, base de cálculo do denominador, versão da fórmula e câmbio
 *   RF-088  direcionamentos para decisão em blocos distintos por área
 *           (Compras · Pricing · Fiscal/Tributário), automáticos + manuais
 *   RF-089  exportação em PDF mantendo cabeçalho e rodapé de identificação do
 *           cenário e da versão em TODAS as páginas
 *   RF-083 a RF-086  alertas com tipo, produto, mensagem e área responsável
 *   RN-12   documento gerencial, sem validade fiscal (ressalva obrigatória)
 *
 * Regra de ouro: toda regra de negócio vive no motor compartilhado
 * (shared/engine.mjs). Este serviço apenas orquestra — carrega o cenário,
 * chama o motor, mescla os direcionamentos manuais, registra a emissão e
 * desenha o documento (RNF-04 · RNF-10).
 */
const { query } = require('../db');
const { eventoCenario } = require('../audit');
const { engine } = require('../engine');
const { obterCenario } = require('./cenario.service');

const BASES_VALIDAS = ['saida', 'custo'];                     // RF-060 · RN-02
const FORMATOS_VALIDOS = ['pdf', 'tela'];                     // RF-087 · RF-089
const AREAS_RELATORIO = ['Compras', 'Pricing', 'Fiscal/Tributário'];  // RF-088

const ROTULO_STATUS = {
  rascunho: 'Rascunho', calculado: 'Calculado',
  congelado: 'Congelado (premissas travadas - RN-10)',
  consolidado: 'Consolidado para decisão (RF-008)',
};
const ROTULO_TIPO = { orcamento: 'Orçamento anual', revisao: 'Revisão mensal / what-if' };
const ROTULO_FAIXA = {
  nacional: '100% nacional (CI% = 0%)',
  baixo: 'Nacional com conteúdo de importação (CI% de 0% a 40%)',
  medio: 'Nacional com CI acima de 40% (CI% de 40% a 70%)',
  alto: 'Equiparado a importado (CI% acima de 70%)',
};
const ROTULO_PRIORIDADE = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' };

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

/** Data e hora em formato brasileiro (RNF-03). */
function dataBr(valor) {
  if (!valor) return '-';
  try {
    return new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (err) {
    return String(valor);
  }
}

/**
 * Parâmetros mestres consumidos pelo motor (RF-096 a RF-099):
 * gatilho de reemissão, premissas de ICMS-ST, alíquota normal do destino e
 * versão da fórmula vigente.
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

/** Base solicitada na emissão — somente 'saida' ou 'custo' (RF-060). */
function baseSolicitada(cenario, base) {
  const pedida = String(base == null ? '' : base).trim();
  if (!pedida) return baseDe(cenario);
  if (!BASES_VALIDAS.includes(pedida)) {
    const e = new Error(
      `Base de cálculo inválida: «${pedida}». Informe «saida» (média ponderada das saídas interestaduais) ` +
      `ou «custo» (custo total da mercadoria) — RF-060.`
    );
    e.status = 422;
    throw e;
  }
  return pedida;
}

// ---------------------------------------------------------------------------
// Direcionamentos (RF-088 · RF-009)
// ---------------------------------------------------------------------------

/** Direcionamentos manuais registrados pela equipe durante a consolidação. */
async function listarManuais(id) {
  const { rows } = await query(
    `SELECT id, area, produto, texto, prioridade, origem, criado_nome, criado_em
       FROM direcionamentos
      WHERE cenario_id = $1
      ORDER BY area, criado_em DESC, id DESC`,
    [id]
  );
  return rows;
}

/**
 * RF-088 — mescla os direcionamentos automáticos (derivados do cálculo pelo
 * motor) com os manuais da tabela «direcionamentos», mantendo blocos distintos
 * por área e preservando a origem de cada item para exibição e auditoria.
 */
function mesclarDirecionamentos(automaticos, manuais) {
  const blocos = new Map();

  const bloco = (area) => {
    const chave = String(area || '').trim() || 'Fiscal/Tributário';
    if (!blocos.has(chave)) blocos.set(chave, { area: chave, itens: [] });
    return blocos.get(chave);
  };

  for (const area of AREAS_RELATORIO) bloco(area);          // blocos sempre presentes

  for (const b of automaticos || []) {
    const destino = bloco(b.area);
    for (const item of b.itens || []) {
      destino.itens.push({
        produto: item.produto,
        prioridade: item.prioridade || 'media',
        texto: item.texto,
        origem: 'automatico',
      });
    }
  }

  for (const m of manuais || []) {
    bloco(m.area).itens.push({
      id: m.id,
      produto: m.produto,
      prioridade: m.prioridade || 'media',
      texto: m.texto,
      origem: 'manual',
      autor: m.criado_nome,
      criadoEm: m.criado_em,
    });
  }

  const peso = { alta: 0, media: 1, baixa: 2 };
  const ordemArea = (area) => {
    const i = AREAS_RELATORIO.indexOf(area);
    return i >= 0 ? i : AREAS_RELATORIO.length;
  };

  return [...blocos.values()]
    .sort((a, b) => ordemArea(a.area) - ordemArea(b.area) || a.area.localeCompare(b.area, 'pt-BR'))
    .map((b) => {
      const itens = b.itens.slice().sort(
        (x, y) => (peso[x.prioridade] ?? 1) - (peso[y.prioridade] ?? 1)
          || (x.origem === y.origem ? 0 : x.origem === 'manual' ? -1 : 1)
      );
      return {
        area: b.area,
        itens,
        total: itens.length,
        nManuais: itens.filter((i) => i.origem === 'manual').length,
        nAutomaticos: itens.filter((i) => i.origem === 'automatico').length,
      };
    });
}

// ---------------------------------------------------------------------------
// Montagem do relatório (RF-087)
// ---------------------------------------------------------------------------

/** Emissões anteriores do relatório deste cenário (RF-089 — rastreabilidade). */
async function historicoEmissoes(id) {
  const { rows } = await query(
    `SELECT id, versao, formato, gerado_nome, gerado_em
       FROM relatorios
      WHERE cenario_id = $1
      ORDER BY gerado_em DESC, id DESC
      LIMIT 50`,
    [id]
  );
  return rows;
}

/**
 * RF-087 · RF-088 — relatório executivo do cenário: identificação completa,
 * indicadores, resultado por produto, alertas por área e direcionamentos
 * (automáticos do motor + manuais registrados). Não registra emissão: o
 * histórico em «relatorios» é gravado apenas na exportação em PDF (RF-089).
 */
async function montarRelatorio(idBruto, { base, usuario } = {}) {
  const E = engine();
  const id = idNumerico(idBruto, 'Cenário');
  const cenario = await obterCenario(id);
  const params = await carregarParametros();
  const baseVigente = baseSolicitada(cenario, base);

  const relatorio = E.relatorioExecutivo(cenario, { ...params, base: baseVigente });

  // RF-088 — direcionamentos manuais mesclados aos automáticos do motor
  const manuais = await listarManuais(id);
  relatorio.direcionamentos = mesclarDirecionamentos(relatorio.direcionamentos, manuais);

  // RF-036 · RF-052 — referência cambial da carga, para confronto no relatório
  relatorio.cabecalho.cambioPadrao = (cenario.dados || {}).cambioPadrao || {};

  // RF-087 — data de emissão e responsável pela emissão
  relatorio.emissao = {
    em: new Date().toISOString(),
    emBr: dataBr(new Date()),
    por: (usuario && usuario.nome) || 'sistema',
    area: (usuario && usuario.area) || '-',
  };
  relatorio.rotulos = {
    status: ROTULO_STATUS[cenario.status] || cenario.status,
    tipo: ROTULO_TIPO[cenario.tipo] || cenario.tipo,
    faixas: ROTULO_FAIXA,
  };

  return {
    relatorio,
    base: baseVigente,
    parametros: params,
    direcionamentosManuais: manuais,
    emissoes: await historicoEmissoes(id),
    cenario: {
      id: cenario.id, codigo: cenario.codigo, nome: cenario.nome,
      versao: cenario.versao, status: cenario.status, tipo: cenario.tipo,
      ciclo: cenario.ciclo, autor: cenario.autor_nome,
      origemDados: cenario.origem_dados,
      criadoEm: cenario.criado_em, atualizadoEm: cenario.atualizado_em,
      congeladoEm: cenario.congelado_em || null,
      consolidadoEm: cenario.consolidado_em || null,
      baseCalculo: baseVigente,
    },
  };
}

/**
 * RF-089 — registra a emissão do relatório na tabela «relatorios» e gera o
 * evento de auditoria do cenário (RNF-04). Chamado somente no formato pdf.
 */
async function registrarEmissao(pacote, usuario, formato = 'pdf') {
  const fmt = String(formato || 'pdf').trim().toLowerCase();
  if (!FORMATOS_VALIDOS.includes(fmt)) {
    const e = new Error(`Formato de relatório inválido: «${fmt}». Formatos aceitos: ${FORMATOS_VALIDOS.join(' · ')}.`);
    e.status = 422;
    throw e;
  }
  const rel = pacote.relatorio;
  const meta = pacote.cenario;
  const resumo = {
    requisito: 'RF-087 · RF-088 · RF-089',
    cabecalho: {
      codigo: meta.codigo, cenario: meta.nome, versao: meta.versao,
      status: meta.status, ciclo: meta.ciclo, tipo: meta.tipo,
      baseCalculo: rel.cabecalho.baseCalculo,
      baseCalculoLabel: rel.cabecalho.baseCalculoLabel,
      versaoFormula: rel.cabecalho.versaoFormula,
      cambio: rel.cabecalho.cambio,
      origemDados: meta.origemDados,
      gatilhoReemissao: rel.cabecalho.gatilhoReemissao,
    },
    indicadores: rel.indicadores,
    nProdutos: (rel.produtos || []).length,
    nAlertas: (rel.alertas || []).length,
    direcionamentos: (rel.direcionamentos || []).map((b) => ({
      area: b.area, total: b.total, manuais: b.nManuais, automaticos: b.nAutomaticos,
    })),
    ressalva: rel.ressalva,
  };

  const { rows } = await query(
    `INSERT INTO relatorios (cenario_id, versao, formato, resumo, gerado_por, gerado_nome)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, cenario_id, versao, formato, gerado_nome, gerado_em`,
    [
      meta.id, meta.versao, fmt, JSON.stringify(resumo),
      usuario ? usuario.id : null, usuario ? usuario.nome : 'sistema',
    ]
  );

  await eventoCenario(meta.id, usuario, 'relatorio', {
    requisito: 'RF-089',
    relatorioId: rows[0].id,
    formato: fmt,
    versao: meta.versao,
    status: meta.status,
    baseCalculo: rel.cabecalho.baseCalculo,
    ciMedio: rel.indicadores.ciMedio,
    nProdutos: (rel.produtos || []).length,
    nAlertas: (rel.alertas || []).length,
  });

  rel.emissao = { ...rel.emissao, relatorioId: rows[0].id, formato: fmt };
  return rows[0];
}

/** Nome do arquivo exportado — somente caracteres seguros (RF-089). */
function nomeArquivo(pacote) {
  const meta = pacote.cenario;
  const codigo = String(meta.codigo || 'CEN').replace(/[^A-Za-z0-9_-]/g, '_');
  return `Relatorio_FCI_${codigo}_v${meta.versao}.pdf`;
}

// ---------------------------------------------------------------------------
// Exportação em PDF (RF-089)
// ---------------------------------------------------------------------------
// A fonte padrão Helvetica do pdfkit cobre Latin-1: todo texto passa por
// textoSeguro() antes de ser escrito, trocando símbolos fora dessa faixa.
// A paginação é controlada manualmente para que o cabeçalho e o rodapé de
// identificação (desenhados no final, página por página) nunca se sobreponham
// ao conteúdo, mesmo com muitos produtos.

const PAG = { largura: 595.28, altura: 841.89, margem: 40 };
const X0 = PAG.margem;                        // 40
const X1 = PAG.largura - PAG.margem;          // 555,28
const LARG = X1 - X0;                         // 515,28
const TOPO_CONTEUDO = 54;                     // abaixo da faixa de cabeçalho
const LIMITE_CONTEUDO = 790;                  // acima da faixa de rodapé
const Y_CABECALHO = 20;
const Y_LINHA_CABECALHO = 36;
const Y_LINHA_RODAPE = 804;
const Y_RODAPE = 810;

const COR = {
  dourado: '#B38335', tinta: '#23201c', suave: '#6d665c', linha: '#d9d2c5',
  fundo: '#f4f1ea', zebra: '#faf8f4', branco: '#ffffff', escuro: '#2b2b2b',
  verde: '#2f6b46', ambar: '#8a5e12', vermelho: '#a03d2c',
};

const COR_FAIXA = { nacional: COR.verde, baixo: COR.verde, medio: COR.ambar, alto: COR.vermelho };

/** Símbolos fora de Latin-1 trocados por equivalentes suportados pela fonte. */
const TROCAS = [
  [/[→⇒➡➔]/g, '-'],
  [/≤/g, '<='], [/≥/g, '>='], [/≠/g, '<>'],
  [/[–—―]/g, '-'],
  [/[“”„]/g, '"'], [/[‘’‚]/g, "'"],
  [/…/g, '...'], [/•/g, '-'],
  [/[Σ∑]/g, 'Soma de'], [/[Δ∆]/g, 'variação de'],
  [/[   ]/g, ' '],
  [/™/g, '(TM)'], [/€/g, 'EUR'],
];

/** Texto pronto para a fonte Helvetica (Latin-1) — RNF-03 preservado. */
function textoSeguro(valor) {
  let s = valor == null ? '' : String(valor);
  for (const [re, sub] of TROCAS) s = s.replace(re, sub);
  return s.replace(/[^\x00-\xFF]/g, '?');
}

/** Encurta o texto para caber em uma linha de cabeçalho. */
function cortar(valor, max) {
  const s = textoSeguro(valor);
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 3)) + '...';
}

/** Sim/Não em português (RNF-03). */
function simNao(v) { return v ? 'Sim' : 'Não'; }

/** Nova página de conteúdo quando a altura necessária não couber. */
function garantirEspaco(doc, altura) {
  if (doc.y + altura > LIMITE_CONTEUDO) {
    doc.addPage();
    return true;
  }
  return false;
}

/**
 * Cabeçalho e rodapé são desenhados FORA da área útil (acima da margem
 * superior e abaixo da inferior). O pdfkit pagina sozinho quando a escrita
 * passa de page.maxY(), o que criaria páginas em branco a cada faixa
 * desenhada; zerar a margem inferior durante o desenho impede isso.
 */
function semPaginacao(doc, desenhar) {
  const margens = doc.page.margins;
  const topo = margens.top;
  const base = margens.bottom;
  margens.top = 0;
  margens.bottom = 0;
  try {
    desenhar();
  } finally {
    margens.top = topo;
    margens.bottom = base;
  }
}

/** RF-089 — cabeçalho de identificação do cenário e da versão. */
function desenharCabecalho(doc, rel) {
  const c = rel.cabecalho;
  semPaginacao(doc, () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.tinta)
      .text('SIMULADOR FCI · CERVEJARIA CIDADE IMPERIAL', X0, Y_CABECALHO,
        { width: LARG * 0.46, align: 'left', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(COR.suave)
      .text(`${cortar(c.codigo, 22)} · ${cortar(c.cenario, 44)} · v${textoSeguro(c.versao)}`,
        X0 + LARG * 0.46, Y_CABECALHO, { width: LARG * 0.54, align: 'right', lineBreak: false });
    doc.save().lineWidth(1).strokeColor(COR.dourado)
      .moveTo(X0, Y_LINHA_CABECALHO).lineTo(X1, Y_LINHA_CABECALHO).stroke().restore();
  });
}

/** RF-089 · RN-12 — rodapé de classificação e paginação. */
function desenharRodape(doc, pagina, total) {
  semPaginacao(doc, () => {
    doc.save().lineWidth(0.5).strokeColor(COR.linha)
      .moveTo(X0, Y_LINHA_RODAPE).lineTo(X1, Y_LINHA_RODAPE).stroke().restore();
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave)
      .text('CLASSIFICAÇÃO: USO INTERNO · Documento gerencial sem validade fiscal (RN-12)',
        X0, Y_RODAPE, { width: LARG * 0.7, align: 'left', lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave)
      .text(`Página ${pagina} de ${total}`, X0 + LARG * 0.7, Y_RODAPE,
        { width: LARG * 0.3, align: 'right', lineBreak: false });
  });
}

/** Título de seção com régua dourada. */
function tituloSecao(doc, titulo, requisito) {
  garantirEspaco(doc, 46);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COR.tinta)
    .text(textoSeguro(titulo), X0, y, { width: LARG * 0.7 });
  const yFim = doc.y;
  if (requisito) {
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave)
      .text(textoSeguro(requisito), X0 + LARG * 0.7, y + 3,
        { width: LARG * 0.3, align: 'right', lineBreak: false });
  }
  const yLinha = Math.max(yFim, y + 13) + 2;
  doc.save().lineWidth(1).strokeColor(COR.dourado)
    .moveTo(X0, yLinha).lineTo(X1, yLinha).stroke().restore();
  doc.x = X0;
  doc.y = yLinha + 8;
}

/** Subtítulo de bloco (áreas de direcionamento). */
function subTitulo(doc, titulo, cor) {
  doc.font('Helvetica-Bold').fontSize(9.5);
  const h = doc.heightOfString(textoSeguro(titulo), { width: LARG }) + 5;
  garantirEspaco(doc, h + 14);
  const y = doc.y;
  doc.fillColor(cor || COR.tinta).text(textoSeguro(titulo), X0, y, { width: LARG });
  doc.y = Math.max(doc.y, y + h);
  doc.x = X0;
}

/** Parágrafo corrido com quebra de página controlada. */
function paragrafo(doc, conteudo, opcoes = {}) {
  const tamanho = opcoes.tamanho || 8.5;
  const cor = opcoes.cor || COR.tinta;
  const fonte = opcoes.negrito ? 'Helvetica-Bold' : 'Helvetica';
  const recuo = opcoes.recuo || 0;
  const largura = LARG - recuo;
  const s = textoSeguro(conteudo);
  doc.font(fonte).fontSize(tamanho);
  const h = doc.heightOfString(s, { width: largura }) + (opcoes.espaco == null ? 3 : opcoes.espaco);
  garantirEspaco(doc, Math.min(h, LIMITE_CONTEUDO - TOPO_CONTEUDO));
  const y = doc.y;
  doc.fillColor(cor).text(s, X0 + recuo, y, { width: largura });
  doc.y = Math.max(doc.y, y) + (opcoes.espaco == null ? 3 : opcoes.espaco);
  doc.x = X0;
}

/** Linha «rótulo: valor» do bloco de identificação (RF-087). */
function linhaCampo(doc, rotulo, valor) {
  const LR = 158, PAD = 4;
  const v = textoSeguro(valor == null || valor === '' ? '-' : valor);
  doc.font('Helvetica').fontSize(8.5);
  const h = Math.max(13, doc.heightOfString(v, { width: LARG - LR - PAD }) + 4);
  garantirEspaco(doc, h);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.suave)
    .text(textoSeguro(rotulo), X0, y + 1, { width: LR - PAD, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.tinta)
    .text(v, X0 + LR, y + 1, { width: LARG - LR });
  doc.save().lineWidth(0.3).strokeColor(COR.linha)
    .moveTo(X0, y + h - 1).lineTo(X1, y + h - 1).stroke().restore();
  doc.x = X0;
  doc.y = y + h;
}

/** 1 · Título e identificação completa do cenário (RF-087). */
function secaoIdentificacao(doc, E, pacote) {
  const rel = pacote.relatorio;
  const c = rel.cabecalho;
  const meta = pacote.cenario;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(COR.tinta)
    .text('Relatório Executivo · Simulador FCI', X0, doc.y, { width: LARG });
  doc.font('Helvetica').fontSize(9).fillColor(COR.suave)
    .text(textoSeguro(`${c.cenario} (${c.codigo}) · versão ${c.versao} · ${rel.rotulos.status}`),
      X0, doc.y + 2, { width: LARG });
  const yLinha = doc.y + 4;
  doc.save().lineWidth(1.5).strokeColor(COR.dourado)
    .moveTo(X0, yLinha).lineTo(X1, yLinha).stroke().restore();
  doc.x = X0;
  doc.y = yLinha + 12;

  tituloSecao(doc, 'Identificação do cenário', 'RF-087');
  linhaCampo(doc, 'Cenário', c.cenario);
  linhaCampo(doc, 'Código', c.codigo);
  linhaCampo(doc, 'Ciclo de análise', c.ciclo);
  linhaCampo(doc, 'Tipo de cenário', rel.rotulos.tipo);
  linhaCampo(doc, 'Versão', `v${c.versao}`);
  linhaCampo(doc, 'Status', rel.rotulos.status);
  linhaCampo(doc, 'Autor do cenário', c.autor);
  linhaCampo(doc, 'Criado em', dataBr(meta.criadoEm));
  linhaCampo(doc, 'Última atualização', dataBr(meta.atualizadoEm));
  if (meta.congeladoEm) linhaCampo(doc, 'Congelado em', dataBr(meta.congeladoEm));
  if (meta.consolidadoEm) linhaCampo(doc, 'Consolidado em', dataBr(meta.consolidadoEm));
  linhaCampo(doc, 'Data de emissão', `${rel.emissao.emBr} · emitido por ${rel.emissao.por} (${rel.emissao.area})`);
  linhaCampo(doc, 'Origem dos dados', c.origemDados);
  linhaCampo(doc, 'Base de cálculo do denominador', `${c.baseCalculo === 'saida' ? 'Saídas interestaduais' : 'Custo total'} - ${c.baseCalculoLabel}`);
  linhaCampo(doc, 'Versão da fórmula', c.versaoFormula);
  linhaCampo(doc, 'Gatilho de reemissão', `${E.num(c.gatilhoReemissao, 1)} p.p. (RN-08)`);
  linhaCampo(doc, 'Modo de edição', c.modo === 'avancado' ? 'Avançado (RF-034)' : 'Padrão');

  // RF-052 · RF-087 — câmbio adotado por moeda, com a referência da carga
  const moedas = Object.keys(c.cambio || {}).sort();
  if (!moedas.length) {
    linhaCampo(doc, 'Câmbio adotado', 'Cenário sem moeda estrangeira parametrizada');
  } else {
    const padrao = c.cambioPadrao || {};
    for (const m of moedas) {
      const cot = E.n(c.cambio[m]);
      const ref = E.n(padrao[m]);
      const sufixo = ref > 0 && Math.abs(cot - ref) > 1e-9
        ? ` (referência da carga ${E.num(ref, 4)} · ${E.pct((cot / ref - 1) * 100, 2)})`
        : '';
      linhaCampo(doc, `Câmbio adotado - ${m}`, `${E.num(cot, 4)}${sufixo}`);
    }
  }
  doc.y += 6;
}

/** 2 · Indicadores consolidados (RF-004 · RF-087). */
function secaoIndicadores(doc, E, rel) {
  tituloSecao(doc, 'Indicadores do cenário', 'RF-004 · RF-087');
  const ind = rel.indicadores || {};
  const cartoes = [
    { rotulo: 'CI% médio ponderado', valor: E.pct(ind.ciMedio, 1), cor: COR.tinta },
    { rotulo: 'Produtos acabados', valor: E.num(ind.nProdutos, 0), cor: COR.tinta },
    { rotulo: 'Acima de 40%', valor: E.num(ind.acima40, 0), cor: E.n(ind.acima40) > 0 ? COR.vermelho : COR.verde },
    { rotulo: 'Alertas', valor: E.num(ind.nAlertas, 0), cor: E.n(ind.nAlertas) > 0 ? COR.ambar : COR.verde },
    { rotulo: 'Reemissões exigidas', valor: E.num(ind.nReemissao, 0), cor: E.n(ind.nReemissao) > 0 ? COR.vermelho : COR.verde },
  ];
  const vao = 6;
  const larguraCartao = (LARG - vao * (cartoes.length - 1)) / cartoes.length;
  const altura = 46;
  garantirEspaco(doc, altura + 30);
  const y = doc.y;
  cartoes.forEach((c, i) => {
    const x = X0 + i * (larguraCartao + vao);
    doc.save().roundedRect(x, y, larguraCartao, altura, 3)
      .fillAndStroke(COR.fundo, COR.linha).restore();
    doc.font('Helvetica-Bold').fontSize(13).fillColor(c.cor)
      .text(textoSeguro(c.valor), x + 3, y + 8, { width: larguraCartao - 6, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(6.6).fillColor(COR.suave)
      .text(textoSeguro(c.rotulo), x + 3, y + 27, { width: larguraCartao - 6, align: 'center' });
  });
  doc.x = X0;
  doc.y = y + altura + 8;

  const dist = ind.dist || {};
  const linhas = Object.keys(ROTULO_FAIXA)
    .map((k) => `${ROTULO_FAIXA[k]}: ${E.num(dist[k] || 0, 0)}`)
    .join('   |   ');
  paragrafo(doc, `Distribuição por faixa de enquadramento - ${linhas}`, { tamanho: 8, cor: COR.suave });
  paragrafo(doc, `Diagnóstico de validação: ${E.num(ind.nErros || 0, 0)} erro(s) e ${E.num(ind.nAvisos || 0, 0)} aviso(s) (RF-025 · RF-032).`,
    { tamanho: 8, cor: COR.suave, espaco: 8 });
}

/** Colunas da tabela por produto (RF-087). */
const COLUNAS = [
  { titulo: 'SKU', largura: 56, alinha: 'left' },
  { titulo: 'Produto', largura: 111, alinha: 'left' },
  { titulo: 'CI%', largura: 42, alinha: 'right' },
  { titulo: 'Enquadramento', largura: 98, alinha: 'left' },
  { titulo: 'Alíquota', largura: 34, alinha: 'right' },
  { titulo: 'FCI vigente', largura: 42, alinha: 'right' },
  { titulo: 'Variação p.p.', largura: 48, alinha: 'right' },
  { titulo: 'FCI obrig.', largura: 40, alinha: 'center' },
  { titulo: 'Reemissão', largura: 44, alinha: 'center' },
];

/** Cabeçalho da tabela — redesenhado em cada quebra de página. */
function desenharCabecalhoTabela(doc) {
  const PAD = 3;
  doc.font('Helvetica-Bold').fontSize(6.8);
  const altura = Math.max(
    ...COLUNAS.map((c) => doc.heightOfString(textoSeguro(c.titulo), { width: c.largura - 2 * PAD }))
  ) + 6;
  const y = doc.y;
  doc.save().rect(X0, y, LARG, altura).fill(COR.escuro).restore();
  let x = X0;
  for (const c of COLUNAS) {
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(COR.branco)
      .text(textoSeguro(c.titulo), x + PAD, y + 3, { width: c.largura - 2 * PAD, align: c.alinha });
    x += c.largura;
  }
  doc.x = X0;
  doc.y = y + altura;
}

/** Linha da tabela, com quebra de página e repetição do cabeçalho. */
function desenharLinhaTabela(doc, celulas, cores, zebra) {
  const PAD = 3;
  doc.font('Helvetica').fontSize(7.6);
  const altura = Math.max(
    12,
    Math.max(...COLUNAS.map((c, i) => doc.heightOfString(textoSeguro(celulas[i]), { width: c.largura - 2 * PAD }))) + 5
  );
  if (doc.y + altura > LIMITE_CONTEUDO) {
    doc.addPage();
    desenharCabecalhoTabela(doc);
  }
  const y = doc.y;
  if (zebra) doc.save().rect(X0, y, LARG, altura).fill(COR.zebra).restore();
  let x = X0;
  COLUNAS.forEach((c, i) => {
    doc.font(i === 0 || i === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.6)
      .fillColor(cores[i] || COR.tinta)
      .text(textoSeguro(celulas[i]), x + PAD, y + 2.5, { width: c.largura - 2 * PAD, align: c.alinha });
    x += c.largura;
  });
  doc.save().lineWidth(0.4).strokeColor(COR.linha)
    .moveTo(X0, y + altura).lineTo(X1, y + altura).stroke().restore();
  doc.x = X0;
  doc.y = y + altura;
}

/** 3 · Resultado por produto (RF-087 · RF-061 · RF-083 · RF-084). */
function secaoProdutos(doc, E, rel) {
  tituloSecao(doc, 'Resultado por produto', 'RF-087 · RF-061');
  const produtos = rel.produtos || [];
  if (!produtos.length) {
    paragrafo(doc, 'Cenário sem produtos acabados carregados. Recarregue a estrutura integrada (RF-002).',
      { cor: COR.suave, espaco: 8 });
    return;
  }
  desenharCabecalhoTabela(doc);
  produtos.forEach((p, i) => {
    const celulas = [
      p.sku,
      p.nome,
      E.pct(p.ci, 1),
      p.enquadramento,
      `${E.num(p.aliquota, 0)}%`,
      E.pct(p.fciVigente, 1),
      E.pp(p.deltaVigente, 1),
      simNao(p.fciObrigatoria),
      simNao(p.exigeReemissao),
    ];
    const corFaixa = COR_FAIXA[(p.faixa || {}).key] || COR.tinta;
    const cores = [
      COR.tinta, COR.tinta, corFaixa, corFaixa, COR.tinta, COR.suave,
      Math.abs(E.n(p.deltaVigente)) > 0 ? (E.n(p.deltaVigente) > 0 ? COR.vermelho : COR.verde) : COR.suave,
      p.fciObrigatoria ? COR.tinta : COR.suave,
      p.exigeReemissao ? COR.vermelho : COR.suave,
    ];
    desenharLinhaTabela(doc, celulas, cores, i % 2 === 1);
  });
  doc.y += 4;
  paragrafo(doc,
    'CI% = parcela importada / denominador x 100 (RN-01). Alíquota de 4% quando CI% supera 40% '
    + '(Resolução SF 13/2012 · RN-07). «Reemissão» indica variação superior ao gatilho parametrizado (RN-08).',
    { tamanho: 7.5, cor: COR.suave, espaco: 8 });
}

/** 4 · Alertas com área responsável (RF-083 a RF-086). */
function secaoAlertas(doc, E, rel) {
  tituloSecao(doc, 'Alertas do cenário', 'RF-083 a RF-086');
  const lista = rel.alertas || [];
  if (!lista.length) {
    paragrafo(doc, 'Nenhum alerta gerado: não há mudança de faixa, exigência de reemissão nem CI% acima de 40% neste cenário.',
      { cor: COR.verde, espaco: 8 });
    return;
  }
  for (const a of lista) {
    const cor = a.sev === 'erro' ? COR.vermelho : COR.ambar;
    const titulo = `[${a.sev === 'erro' ? 'CRÍTICO' : 'ATENÇÃO'}] ${a.titulo} - ${a.produto}`;
    const corpo = a.msg || '';
    const rodape = `Área responsável: ${a.area || 'Fiscal/Tributário'}`
      + (a.acao ? ` · Encaminhamento: ${a.acao}` : '')
      + (a.baseLegal ? ` · Base legal: ${a.baseLegal}` : '');
    const largura = LARG - 14;

    doc.font('Helvetica-Bold').fontSize(8.5);
    const h1 = doc.heightOfString(textoSeguro(titulo), { width: largura });
    doc.font('Helvetica').fontSize(8);
    const h2 = doc.heightOfString(textoSeguro(corpo), { width: largura });
    doc.font('Helvetica').fontSize(7.5);
    const h3 = doc.heightOfString(textoSeguro(rodape), { width: largura });
    const altura = h1 + h2 + h3 + 14;

    garantirEspaco(doc, Math.min(altura, LIMITE_CONTEUDO - TOPO_CONTEUDO));
    const y = doc.y;
    doc.save().rect(X0, y, 3, altura - 8).fill(cor).restore();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(cor)
      .text(textoSeguro(titulo), X0 + 12, y, { width: largura });
    doc.font('Helvetica').fontSize(8).fillColor(COR.tinta)
      .text(textoSeguro(corpo), X0 + 12, y + h1 + 2, { width: largura });
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave)
      .text(textoSeguro(rodape), X0 + 12, y + h1 + h2 + 5, { width: largura });
    doc.x = X0;
    doc.y = y + altura;
  }
  doc.y += 4;
}

/** 5 · Direcionamentos por área, em blocos distintos (RF-088 · RF-009). */
function secaoDirecionamentos(doc, E, rel) {
  tituloSecao(doc, 'Direcionamentos para decisão por área', 'RF-088 · RF-009');
  const blocos = rel.direcionamentos || [];
  for (const b of blocos) {
    subTitulo(doc, `${b.area} - ${E.num(b.total, 0)} direcionamento(s) · ${E.num(b.nAutomaticos, 0)} automático(s) · ${E.num(b.nManuais, 0)} manual(is)`, COR.dourado);
    if (!b.itens.length) {
      paragrafo(doc, 'Sem direcionamentos para esta área neste cenário.',
        { tamanho: 8, cor: COR.suave, recuo: 12, espaco: 5 });
      continue;
    }
    for (const it of b.itens) {
      const prefixo = `[${ROTULO_PRIORIDADE[it.prioridade] || 'MÉDIA'}] ${it.produto}: `;
      const sufixo = it.origem === 'manual'
        ? ` (direcionamento manual de ${it.autor || 'equipe'} em ${dataBr(it.criadoEm)})`
        : ' (derivado do cálculo do cenário)';
      const largura = LARG - 12;
      const texto = prefixo + (it.texto || '') + sufixo;
      doc.font('Helvetica').fontSize(8);
      const altura = doc.heightOfString(textoSeguro(texto), { width: largura - 8 }) + 6;
      garantirEspaco(doc, Math.min(altura, LIMITE_CONTEUDO - TOPO_CONTEUDO));
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8)
        .fillColor(it.prioridade === 'alta' ? COR.vermelho : COR.suave)
        .text('-', X0 + 12, y, { width: 6, lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(COR.tinta)
        .text(textoSeguro(texto), X0 + 20, y, { width: largura - 8 });
      doc.x = X0;
      doc.y = Math.max(doc.y, y) + 3;
    }
    doc.y += 4;
  }
}

/** 6 · Ressalva de uso gerencial (RF-082 · RN-12). */
function secaoRessalva(doc, E, rel) {
  const conteudo = rel.ressalva || E.RESSALVA_GERENCIAL;
  doc.font('Helvetica').fontSize(8);
  const altura = doc.heightOfString(textoSeguro(conteudo), { width: LARG - 20 }) + 28;
  garantirEspaco(doc, altura);
  const y = doc.y;
  doc.save().roundedRect(X0, y, LARG, altura, 3)
    .fillAndStroke('#fbf7ee', COR.dourado).restore();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.dourado)
    .text('RESSALVA DE USO GERENCIAL', X0 + 10, y + 7, { width: LARG - 20, lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(COR.tinta)
    .text(textoSeguro(conteudo), X0 + 10, y + 19, { width: LARG - 20 });
  doc.x = X0;
  doc.y = y + altura + 4;
}

/**
 * RF-089 — escreve todo o conteúdo do relatório no documento pdfkit recebido
 * (criado com bufferPages: true) e, ao final, desenha o cabeçalho e o rodapé
 * de identificação em TODAS as páginas. Quem chama faz o doc.pipe(res) antes
 * e o doc.end() depois.
 */
function escreverPdf(doc, pacote) {
  const E = engine();
  const rel = pacote.relatorio;

  // toda página nova começa abaixo da faixa de cabeçalho
  doc.on('pageAdded', () => { doc.x = X0; doc.y = TOPO_CONTEUDO; });
  doc.x = X0;
  doc.y = TOPO_CONTEUDO;

  secaoIdentificacao(doc, E, pacote);   // 1
  secaoIndicadores(doc, E, rel);        // 2
  secaoProdutos(doc, E, rel);           // 3
  secaoAlertas(doc, E, rel);            // 4
  secaoDirecionamentos(doc, E, rel);    // 5
  secaoRessalva(doc, E, rel);           // 6

  // RF-089 — identificação do cenário e da versão em todas as páginas
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    desenharCabecalho(doc, rel);
    desenharRodape(doc, i - range.start + 1, range.count);
  }
  return range.count;
}

module.exports = {
  montarRelatorio,
  registrarEmissao,
  historicoEmissoes,
  nomeArquivo,
  escreverPdf,
  carregarParametros,
  mesclarDirecionamentos,
  textoSeguro,
};
