'use strict';
/**
 * Sincronização das fontes de dados (RF-092 teste · RF-093 manual/agendada ·
 * RF-094 status · RF-095 falha sem parada · RNF-06/07).
 *
 * A carga substitui o snapshot da entidade em transação: se a origem falhar,
 * o ROLLBACK preserva a última carga válida e o cenário continua operável
 * sobre os dados já carregados (RF-095). As origens nunca são alteradas.
 */
const cron = require('node-cron');
const { query, transacao } = require('../db');
const { decifrar } = require('../crypto');
const { obterConector } = require('../connectors');
const { porVariavel } = require('./catalogo');

const tarefasAgendadas = new Map(); // fonte_id -> cron task

// ---------------------------------------------------------------------------
// Acesso à fonte
// ---------------------------------------------------------------------------
async function carregarFonte(id) {
  const { rows } = await query('SELECT * FROM fontes_dados WHERE id = $1', [id]);
  if (!rows[0]) { const e = new Error('Fonte de dados não encontrada.'); e.status = 404; throw e; }
  return rows[0];
}

function configConexao(fonte) {
  return {
    host: fonte.host,
    porta: fonte.porta,
    base: fonte.base,
    usuario: fonte.usuario,
    senha: fonte.credencial_enc ? decifrar(fonte.credencial_enc) : '',
    opcoes: fonte.opcoes || {},
  };
}

async function mapeamentosDe(fonteId) {
  const { rows } = await query(
    'SELECT variavel, tabela, campo FROM mapeamentos WHERE fonte_id = $1 ORDER BY ordem, variavel',
    [fonteId]
  );
  return rows;
}

/** Agrupa mapeamentos por entidade → { tabela, campos: {variavel: campo}, chaves: [] }. */
function planejarConsultas(mapeamentos) {
  const grupos = new Map();
  for (const m of mapeamentos) {
    const cat = porVariavel[m.variavel];
    if (!cat) continue; // variável fora do catálogo é ignorada com segurança
    const key = `${cat.entidade}::${m.tabela}`;
    if (!grupos.has(key)) grupos.set(key, { entidade: cat.entidade, tabela: m.tabela, campos: {}, chaves: [] });
    const g = grupos.get(key);
    g.campos[m.variavel] = m.campo;
    if (cat.chave) g.chaves.push(m.variavel);
  }
  return [...grupos.values()];
}

// ---------------------------------------------------------------------------
// RF-092 — Teste de conexão: altera o status e registra o momento
// ---------------------------------------------------------------------------
async function testarConexao(fonteId) {
  const fonte = await carregarFonte(fonteId);
  const conector = obterConector(fonte.conector);
  let ok = false, mensagem = '';
  try {
    const r = await conector.test(configConexao(fonte));
    ok = !!r.ok;
    mensagem = r.mensagem || 'Conexão estabelecida.';
  } catch (err) {
    ok = false;
    mensagem = err.message || String(err);
  }
  const status = ok ? 'conectado' : 'erro';
  await query(
    `UPDATE fontes_dados
        SET status = $2, testado_em = now(), teste_ok = $3, teste_msg = $4,
            last_error = CASE WHEN $3 THEN last_error ELSE $4 END,
            atualizado_em = now()
      WHERE id = $1`,
    [fonteId, status, ok, mensagem]
  );
  return { ok, mensagem, status, testadoEm: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// RF-093/094/095 — Sincronização (manual ou agendada)
// ---------------------------------------------------------------------------
function chaveDe(linha, chaves, indice) {
  const partes = chaves.map((c) => String(linha[c] == null ? '' : linha[c]).trim()).filter(Boolean);
  return partes.length ? partes.join('|') : `linha-${indice}`;
}

/** Remove o prefixo da entidade da variável (produto.codigo → codigo). */
function payloadDe(linha) {
  const out = {};
  for (const [variavel, valor] of Object.entries(linha)) {
    out[variavel.includes('.') ? variavel.split('.').slice(1).join('.') : variavel] = valor;
  }
  return out;
}

async function sincronizar(fonteId, { disparo = 'manual', usuarioId = null } = {}) {
  const fonte = await carregarFonte(fonteId);
  if (fonte.status === 'sincronizando') {
    const e = new Error('Sincronização já em andamento para esta integração.');
    e.status = 409; throw e;
  }
  const conector = obterConector(fonte.conector);
  const mapeamentos = await mapeamentosDe(fonteId);
  const consultas = planejarConsultas(mapeamentos);
  if (!consultas.length) {
    const e = new Error('Nenhum mapeamento de variável configurado para esta fonte (RF-091).');
    e.status = 422; throw e;
  }

  // status visível imediatamente (RF-094: estado "sincronizando")
  await query(`UPDATE fontes_dados SET status = 'sincronizando', atualizado_em = now() WHERE id = $1`, [fonteId]);
  const exec = await query(
    `INSERT INTO sync_execucoes (fonte_id, disparo, usuario_id) VALUES ($1, $2, $3) RETURNING id`,
    [fonteId, disparo, usuarioId]
  );
  const execId = exec.rows[0].id;

  let totalRegistros = 0;
  const detalhes = [];
  try {
    const cfg = configConexao(fonte);

    // 1ª fase — busca TODAS as consultas antes de gravar qualquer registro:
    // qualquer falha aborta sem tocar o staging e a última carga válida
    // permanece disponível (RF-095 / RNF-07).
    const resultados = [];
    for (const consulta of consultas) {
      const linhas = await conector.fetchRows(cfg, { tabela: consulta.tabela, campos: consulta.campos });
      resultados.push({ consulta, linhas });
    }

    // 2ª fase — snapshot transacional único: substitui cada entidade e
    // mescla payloads quando a mesma entidade vem de mais de uma tabela.
    await transacao(async (client) => {
      const entidadesLimpas = new Set();
      for (const { consulta, linhas } of resultados) {
        if (!entidadesLimpas.has(consulta.entidade)) {
          await client.query('DELETE FROM stg_registros WHERE fonte_id = $1 AND entidade = $2', [fonteId, consulta.entidade]);
          entidadesLimpas.add(consulta.entidade);
        }
        for (let i = 0; i < linhas.length; i++) {
          const linha = linhas[i];
          await client.query(
            `INSERT INTO stg_registros (fonte_id, entidade, chave, payload)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (fonte_id, entidade, chave)
             DO UPDATE SET payload = stg_registros.payload || EXCLUDED.payload, sync_em = now()`,
            [fonteId, consulta.entidade, chaveDe(linha, consulta.chaves, i), JSON.stringify(payloadDe(linha))]
          );
        }
        totalRegistros += linhas.length;
        detalhes.push(`${consulta.entidade} (${consulta.tabela}): ${linhas.length} registro(s)`);
      }
    });

    await query(
      `UPDATE fontes_dados
          SET status = 'conectado', last_sync_at = now(), last_sync_ok = TRUE,
              last_error = NULL, atualizado_em = now()
        WHERE id = $1`,
      [fonteId]
    );
    await query(
      `UPDATE sync_execucoes SET concluido_em = now(), status = 'ok', registros = $2, mensagem = $3 WHERE id = $1`,
      [execId, totalRegistros, detalhes.join(' · ')]
    );
    return { ok: true, registros: totalRegistros, detalhes };
  } catch (err) {
    const mensagem = err.message || String(err);
    // RF-095: a integração fica destacada em erro, mas os dados já carregados
    // permanecem no staging e o cenário continua operável.
    await query(
      `UPDATE fontes_dados
          SET status = 'erro', last_sync_ok = FALSE, last_error = $2, atualizado_em = now()
        WHERE id = $1`,
      [fonteId, mensagem]
    );
    await query(
      `UPDATE sync_execucoes SET concluido_em = now(), status = 'erro', registros = $2, mensagem = $3 WHERE id = $1`,
      [execId, totalRegistros, mensagem]
    );
    const e = new Error(`Falha na sincronização: ${mensagem}`);
    e.status = 502;
    e.parcial = { registros: totalRegistros, detalhes };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// RF-093 — Agendamento por frequência (manual | 15min | horaria | diaria)
// ---------------------------------------------------------------------------
const HORA_PADRAO = '06:00';

/** Horário diário aceito: HH:MM em 24 horas. Usado pela rota e pelo agendador. */
function horaValida(valor) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(valor == null ? '' : valor).trim());
}

function cronDe(fonte) {
  switch (fonte.sync_freq) {
    case '15min': return '*/15 * * * *';
    case 'horaria': return '0 * * * *';
    case 'diaria': {
      // Um horário fora do formato nunca pode virar expressão cron: interpolar
      // «undefined» derruba o node-cron e, com ele, a gravação da fonte e a
      // própria partida da aplicação. Fora do formato, cai no padrão.
      const bruto = String(fonte.sync_hora || '').trim();
      const usado = horaValida(bruto) ? bruto : HORA_PADRAO;
      if (bruto && !horaValida(bruto)) {
        console.warn(`[sync] fonte ${fonte.codigo || fonte.id}: horário «${bruto}» fora do formato HH:MM — agendando às ${HORA_PADRAO}.`);
      }
      const [h, m] = usado.split(':').map((x) => parseInt(x, 10));
      return `${m} ${h} * * *`;
    }
    default: return null;
  }
}

function descricaoFreq(fonte) {
  switch (fonte.sync_freq) {
    case '15min': return 'A cada 15 minutos';
    case 'horaria': return 'Horária';
    case 'diaria': return `Diária · ${fonte.sync_hora || '06:00'}`;
    default: return 'Manual';
  }
}

async function reagendarFonte(fonte) {
  const existente = tarefasAgendadas.get(fonte.id);
  if (existente) { existente.stop(); tarefasAgendadas.delete(fonte.id); }
  if (!fonte.sync_ativa) return;
  const expr = cronDe(fonte);
  if (!expr) return;
  const task = cron.schedule(expr, () => {
    sincronizar(fonte.id, { disparo: 'agendada' }).catch((err) => {
      console.error(`[sync agendada] fonte ${fonte.codigo || fonte.id}: ${err.message}`);
    });
  });
  tarefasAgendadas.set(fonte.id, task);
}

/**
 * RF-093 · RNF-07 — uma fonte com agendamento inválido não pode impedir a
 * partida da aplicação: o erro é registrado e as demais seguem agendadas.
 */
async function iniciarAgendador() {
  const { rows } = await query('SELECT * FROM fontes_dados WHERE sync_ativa = TRUE');
  let agendadas = 0;
  for (const fonte of rows) {
    try {
      await reagendarFonte(fonte);
      agendadas += 1;
    } catch (err) {
      console.error(`[sync] fonte ${fonte.codigo || fonte.id} não pôde ser agendada: ${err.message}`);
    }
  }
  return agendadas;
}

function pararAgendador() {
  for (const task of tarefasAgendadas.values()) task.stop();
  tarefasAgendadas.clear();
}

module.exports = {
  horaValida,
  HORA_PADRAO,
  cronDe,
  carregarFonte,
  mapeamentosDe,
  testarConexao,
  sincronizar,
  reagendarFonte,
  iniciarAgendador,
  pararAgendador,
  descricaoFreq,
};
