'use strict';
const { query } = require('./db');

/** Evento de auditoria de cenário (RC-010 · RNF-04). */
async function eventoCenario(cenarioId, usuario, tipo, detalhe) {
  await query(
    `INSERT INTO cenario_eventos (cenario_id, usuario_id, usuario_nome, tipo, detalhe)
     VALUES ($1, $2, $3, $4, $5)`,
    [cenarioId, usuario ? usuario.id : null, usuario ? usuario.nome : 'sistema', tipo, JSON.stringify(detalhe || {})]
  );
}

/** Histórico de alteração de parâmetro mestre (RNF-04). */
async function historicoParametro(chave, valorAntes, valorDepois, usuario) {
  await query(
    `INSERT INTO parametros_hist (chave, valor_antes, valor_depois, usuario_id)
     VALUES ($1, $2, $3, $4)`,
    [chave, valorAntes == null ? null : JSON.stringify(valorAntes), JSON.stringify(valorDepois), usuario ? usuario.id : null]
  );
}

module.exports = { eventoCenario, historicoParametro };
