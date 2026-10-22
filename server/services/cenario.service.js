'use strict';
/**
 * Cenários de simulação (RF-001 criação · RF-007 isolamento · RF-003 duplicação).
 * Cada cenário guarda um snapshot JSONB próprio dos dados — alterações em um
 * cenário nunca afetam outro cenário nem o staging integrado (RF-007/RNF-06).
 */
const { query, transacao } = require('../db');
const { eventoCenario } = require('../audit');
const { montarDadosDeOrigem } = require('./estrutura.service');

const STATUS_VALIDOS = ['rascunho', 'calculado', 'congelado', 'consolidado'];

async function proximoCodigo(client) {
  const r = await client.query(`SELECT nextval('cenario_codigo_seq') AS n`);
  return 'CEN-' + String(r.rows[0].n).padStart(3, '0');
}

async function cambioPadrao() {
  const { rows } = await query(`SELECT valor FROM parametros WHERE chave = 'moedas'`);
  const moedas = rows[0] ? rows[0].valor : null;
  if (!moedas || !Array.isArray(moedas.lista)) return null;
  const out = {};
  for (const m of moedas.lista) out[m.codigo] = m.cotacaoBase;
  return out;
}

/** RF-001 — cria cenário: código único, versão 1, status Rascunho, autor e data. */
async function criarCenario({ nome, tipo, ciclo }, usuario) {
  const dados = await montarDadosDeOrigem({ cambioPadrao: await cambioPadrao() });
  const origemDados = dados.origemCarga.length
    ? dados.origemCarga.map((f) => f.nome).join(' · ')
    : 'Sem carga integrada — sincronize as fontes de dados';

  const cenario = await transacao(async (client) => {
    const codigo = await proximoCodigo(client);
    const r = await client.query(
      `INSERT INTO cenarios (codigo, nome, tipo, ciclo, status, versao, autor_id, autor_nome, origem_dados, dados)
       VALUES ($1, $2, $3, $4, 'rascunho', 1, $5, $6, $7, $8)
       RETURNING *`,
      [codigo, nome, tipo || 'revisao', ciclo || '', usuario.id, usuario.nome, origemDados, JSON.stringify(dados)]
    );
    return r.rows[0];
  });
  await eventoCenario(cenario.id, usuario, 'criacao', {
    codigo: cenario.codigo, nome, versao: 1,
    carga: { fontes: dados.origemCarga, produtos: dados.produtos.length, insumos: dados.insumos.length },
  });
  return cenario;
}

/** RF-002 — recarrega a estrutura integrada em um cenário rascunho existente. */
async function recarregarEstrutura(id, usuario) {
  const atual = await obterCenario(id);
  if (atual.status === 'congelado' || atual.status === 'consolidado') {
    const e = new Error('Cenário congelado/consolidado não pode receber nova carga. Crie uma nova versão.');
    e.status = 409; throw e;
  }
  const dados = await montarDadosDeOrigem({ cambioPadrao: await cambioPadrao() });
  if (!dados.temDados) {
    const e = new Error('Nenhum dado integrado disponível no staging. Sincronize as fontes de dados antes da carga (RF-002).');
    e.status = 422; throw e;
  }
  const origemDados = dados.origemCarga.map((f) => f.nome).join(' · ');
  const { rows } = await query(
    `UPDATE cenarios SET dados = $2, origem_dados = $3, status = 'rascunho', atualizado_em = now()
      WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(dados), origemDados]
  );
  await eventoCenario(id, usuario, 'carga', {
    fontes: dados.origemCarga, produtos: dados.produtos.length, insumos: dados.insumos.length,
  });
  return rows[0];
}

async function listarCenarios() {
  const { rows } = await query(
    `SELECT id, codigo, nome, tipo, ciclo, status, versao, origem_id, autor_nome, modo,
            base_calculo, origem_dados, dados, criado_em, atualizado_em
       FROM cenarios ORDER BY id DESC`
  );
  return rows;
}

async function obterCenario(id) {
  const { rows } = await query('SELECT * FROM cenarios WHERE id = $1', [id]);
  if (!rows[0]) { const e = new Error('Cenário não encontrado.'); e.status = 404; throw e; }
  return rows[0];
}

/**
 * RF-007 — atualização isolada dos dados do cenário: só a linha do cenário é
 * alterada; staging e demais cenários permanecem intactos.
 */
async function salvarDados(id, dados, usuario, resumoAlteracao) {
  const atual = await obterCenario(id);
  if (atual.status === 'congelado' || atual.status === 'consolidado') {
    const e = new Error('Cenário congelado — premissas travadas para rastreabilidade. Crie uma nova versão para editar (RN-10).');
    e.status = 409; throw e;
  }
  const { rows } = await query(
    `UPDATE cenarios
        SET dados = $2, status = CASE WHEN status = 'calculado' THEN 'rascunho' ELSE status END,
            atualizado_em = now()
      WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(dados)]
  );
  await eventoCenario(id, usuario, 'edicao', { resumo: resumoAlteracao || 'Dados do cenário atualizados' });
  return rows[0];
}

async function mudarStatus(id, status, usuario) {
  if (!STATUS_VALIDOS.includes(status)) {
    const e = new Error(`Status inválido: ${status}`); e.status = 422; throw e;
  }
  const atual = await obterCenario(id);
  const { rows } = await query(
    'UPDATE cenarios SET status = $2, atualizado_em = now() WHERE id = $1 RETURNING *',
    [id, status]
  );
  await eventoCenario(id, usuario, 'status', { de: atual.status, para: status });
  return rows[0];
}

/** RF-003 (RC-002) — duplica como nova versão sem alterar o cenário de origem. */
async function duplicarCenario(id, usuario, nomeNovo, motivo) {
  const origem = await obterCenario(id);
  const cenario = await transacao(async (client) => {
    const codigo = await proximoCodigo(client);
    const r = await client.query(
      `INSERT INTO cenarios (codigo, nome, tipo, ciclo, status, versao, origem_id, autor_id, autor_nome, origem_dados, dados)
       VALUES ($1, $2, $3, $4, 'rascunho', $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        codigo,
        nomeNovo || origem.nome,
        origem.tipo, origem.ciclo,
        origem.versao + 1,
        origem.id,
        usuario.id, usuario.nome,
        origem.origem_dados,
        JSON.stringify(origem.dados), // cópia profunda via serialização
      ]
    );
    return r.rows[0];
  });
  await eventoCenario(cenario.id, usuario, 'duplicacao', {
    origem: origem.codigo, versao: cenario.versao,
    // RNF-04 — o motivo informado pela tela entra na trilha; sem ele a
    // duplicação de um cenário congelado (RN-10) ficaria sem justificativa.
    ...(motivo ? { resumo: String(motivo).slice(0, 400) } : {}),
  });
  return cenario;
}

async function eventosDe(id) {
  const { rows } = await query(
    `SELECT usuario_nome, tipo, detalhe, registrado_em
       FROM cenario_eventos WHERE cenario_id = $1 ORDER BY registrado_em DESC, id DESC LIMIT 200`,
    [id]
  );
  return rows;
}

module.exports = {
  criarCenario, recarregarEstrutura, listarCenarios, obterCenario,
  salvarDados, mudarStatus, duplicarCenario, eventosDe,
};
