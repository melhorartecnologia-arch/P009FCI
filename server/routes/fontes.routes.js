'use strict';
/**
 * Integrações e fontes de dados (RF-090..RF-095 · RF-100).
 * GET liberado a todos os perfis autenticados (modo consulta);
 * criação/edição/teste/sincronização restritos ao Administrador (TI).
 */
const express = require('express');
const { query } = require('../db');
const { exigirLogin, exigirAcao } = require('../auth');
const { cifrar, MASCARA } = require('../crypto');
const { pode } = require('../permissions');
const { listarConectores } = require('../connectors');
const { VARIAVEIS } = require('../services/catalogo');
const sync = require('../services/sync.service');

const router = express.Router();
router.use(exigirLogin);

// RNF-05: credencial jamais retorna em texto claro.
function publicar(fonte, usuario) {
  return {
    id: fonte.id,
    codigo: fonte.codigo,
    nome: fonte.nome,
    icone: fonte.icone,
    descricao: fonte.descricao,
    fontesLabel: fonte.fontes_label,
    conector: fonte.conector,
    sgbdLabel: fonte.sgbd_label,
    host: fonte.host,
    porta: fonte.porta,
    base: fonte.base,
    usuario: fonte.usuario,
    possuiCredencial: !!fonte.credencial_enc,
    credencialMascarada: fonte.credencial_enc ? MASCARA : '',
    opcoes: fonte.opcoes || {},
    syncFreq: fonte.sync_freq,
    syncHora: fonte.sync_hora,
    syncAtiva: fonte.sync_ativa,
    freqDescricao: sync.descricaoFreq(fonte),
    status: fonte.status,
    testadoEm: fonte.testado_em,
    testeOk: fonte.teste_ok,
    testeMsg: fonte.teste_msg,
    lastSyncAt: fonte.last_sync_at,
    lastSyncOk: fonte.last_sync_ok,
    lastError: fonte.last_error,
    somenteLeitura: !pode(usuario, 'integracoes'),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM fontes_dados ORDER BY id');
    const mapas = await query('SELECT fonte_id, variavel, tabela, campo FROM mapeamentos ORDER BY ordem, variavel');
    const porFonte = new Map();
    for (const m of mapas.rows) {
      if (!porFonte.has(m.fonte_id)) porFonte.set(m.fonte_id, []);
      porFonte.get(m.fonte_id).push({ variavel: m.variavel, tabela: m.tabela, campo: m.campo });
    }
    res.json({
      fontes: rows.map((f) => Object.assign(publicar(f, req.usuario), { mapeamentos: porFonte.get(f.id) || [] })),
      conectores: listarConectores(),
      somenteLeitura: !pode(req.usuario, 'integracoes'),
    });
  } catch (err) { next(err); }
});

router.get('/catalogo', (req, res) => {
  res.json({ variaveis: VARIAVEIS });
});

// Resumo do staging — dá visibilidade da última carga válida (RF-095/RNF-07)
router.get('/staging/resumo', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.codigo AS fonte, s.entidade, count(*)::int AS registros, max(s.sync_em) AS ultima_carga
         FROM stg_registros s JOIN fontes_dados f ON f.id = s.fonte_id
        GROUP BY f.codigo, s.entidade ORDER BY f.codigo, s.entidade`
    );
    res.json({ resumo: rows });
  } catch (err) { next(err); }
});

/**
 * RF-093 — tenta agendar a fonte e devolve o aviso quando não for possível.
 * A gravação já aconteceu; o agendamento é efeito colateral e não pode
 * invalidá-la nem deixar a interface num estado sem saída.
 */
async function agendarSemDerrubar(fonte) {
  try {
    await sync.reagendarFonte(fonte);
    return null;
  } catch (err) {
    console.error(`[fontes] falha ao agendar a fonte ${fonte.codigo || fonte.id}: ${err.message}`);
    return `A fonte foi salva, mas a sincronização programada não pôde ser agendada: ${err.message}. `
         + 'Revise a frequência e o horário.';
  }
}

function validarCorpo(body) {
  const erros = [];
  if (!body.nome || !String(body.nome).trim()) erros.push('Nome é obrigatório.');
  if (!body.conector) erros.push('Conector é obrigatório.');
  if (body.porta != null && body.porta !== '' && !(Number(body.porta) > 0 && Number(body.porta) < 65536)) {
    erros.push('Porta inválida.');
  }
  // RF-093 — o horário vira expressão cron: recusar aqui evita gravar uma fonte
  // que o agendador não consegue programar.
  if (String(body.syncFreq || '') === 'diaria') {
    const hora = String(body.syncHora == null ? '' : body.syncHora).trim();
    if (hora && !sync.horaValida(hora)) {
      erros.push(`Horário inválido: «${hora}». Informe no formato HH:MM, de 00:00 a 23:59.`);
    }
  }
  return erros;
}

router.post('/', exigirAcao('integracoes'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const erros = validarCorpo(b);
    if (erros.length) return res.status(422).json({ erro: erros.join(' ') });
    const codigo = String(b.codigo || b.nome).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const { rows } = await query(
      `INSERT INTO fontes_dados
         (codigo, nome, icone, descricao, fontes_label, conector, sgbd_label, host, porta, base, usuario,
          credencial_enc, opcoes, sync_freq, sync_hora, sync_ativa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        codigo, b.nome, b.icone || '🗄', b.descricao || '', b.fontesLabel || '',
        b.conector, b.sgbdLabel || '', b.host || '', b.porta ? Number(b.porta) : null,
        b.base || '', b.usuario || '',
        b.credencial ? cifrar(b.credencial) : null,
        JSON.stringify(b.opcoes || {}),
        b.syncFreq || 'manual', b.syncHora || '06:00', !!b.syncAtiva,
      ]
    );
    // A fonte já está gravada: uma falha de agendamento é registrada e
    // reportada no corpo, nunca transformada em erro que esconde o sucesso da
    // persistência e deixa a tela sem caminho de saída.
    const avisoAgenda = await agendarSemDerrubar(rows[0]);
    res.status(201).json({ fonte: publicar(rows[0], req.usuario), ...(avisoAgenda ? { aviso: avisoAgenda } : {}) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'Já existe uma fonte com esse código.' });
    next(err);
  }
});

router.put('/:id', exigirAcao('integracoes'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const erros = validarCorpo(b);
    if (erros.length) return res.status(422).json({ erro: erros.join(' ') });
    const atual = await sync.carregarFonte(req.params.id);
    // Credencial: string vazia mantém a atual; null remove; valor novo cifra.
    let credencialEnc = atual.credencial_enc;
    if (b.credencial === null) credencialEnc = null;
    else if (b.credencial != null && b.credencial !== '' && b.credencial !== MASCARA) credencialEnc = cifrar(b.credencial);
    const { rows } = await query(
      `UPDATE fontes_dados SET
         nome=$2, icone=$3, descricao=$4, fontes_label=$5, conector=$6, sgbd_label=$7,
         host=$8, porta=$9, base=$10, usuario=$11, credencial_enc=$12, opcoes=$13,
         sync_freq=$14, sync_hora=$15, sync_ativa=$16, atualizado_em=now()
       WHERE id=$1 RETURNING *`,
      [
        atual.id, b.nome, b.icone || atual.icone, b.descricao ?? atual.descricao,
        b.fontesLabel ?? atual.fontes_label, b.conector, b.sgbdLabel ?? atual.sgbd_label,
        b.host || '', b.porta ? Number(b.porta) : null, b.base || '', b.usuario || '',
        credencialEnc, JSON.stringify(b.opcoes || atual.opcoes || {}),
        b.syncFreq || atual.sync_freq, b.syncHora || atual.sync_hora,
        b.syncAtiva != null ? !!b.syncAtiva : atual.sync_ativa,
      ]
    );
    // A fonte já está gravada: uma falha de agendamento é registrada e
    // reportada no corpo, nunca transformada em erro que esconde o sucesso da
    // persistência e deixa a tela sem caminho de saída.
    const avisoAgenda = await agendarSemDerrubar(rows[0]);
    res.json({ fonte: publicar(rows[0], req.usuario), ...(avisoAgenda ? { aviso: avisoAgenda } : {}) });
  } catch (err) { next(err); }
});

router.delete('/:id', exigirAcao('integracoes'), async (req, res, next) => {
  try {
    const fonte = await sync.carregarFonte(req.params.id);
    await query('DELETE FROM fontes_dados WHERE id = $1', [fonte.id]);
    await sync.reagendarFonte({ ...fonte, sync_ativa: false });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// RF-092 — teste de conexão acionável
router.post('/:id/testar', exigirAcao('integracoes'), async (req, res, next) => {
  try {
    const r = await sync.testarConexao(req.params.id);
    res.json(r);
  } catch (err) { next(err); }
});

// RF-093 — sincronização manual
router.post('/:id/sincronizar', exigirAcao('integracoes'), async (req, res, next) => {
  try {
    const r = await sync.sincronizar(req.params.id, { disparo: 'manual', usuarioId: req.usuario.id });
    res.json(r);
  } catch (err) { next(err); }
});

// RF-091 — mapeamento variável → tabela · campo
router.get('/:id/mapeamentos', async (req, res, next) => {
  try {
    const fonte = await sync.carregarFonte(req.params.id);
    const mapeamentos = await sync.mapeamentosDe(fonte.id);
    res.json({ mapeamentos, variaveis: VARIAVEIS });
  } catch (err) { next(err); }
});

router.put('/:id/mapeamentos', exigirAcao('integracoes'), async (req, res, next) => {
  try {
    const fonte = await sync.carregarFonte(req.params.id);
    const lista = Array.isArray(req.body && req.body.mapeamentos) ? req.body.mapeamentos : null;
    if (!lista) return res.status(422).json({ erro: 'Envie a lista de mapeamentos.' });
    const validas = new Set(VARIAVEIS.map((v) => v.variavel));
    for (const m of lista) {
      if (!validas.has(m.variavel)) return res.status(422).json({ erro: `Variável desconhecida: ${m.variavel}` });
      if (!m.tabela || !m.campo) return res.status(422).json({ erro: `Tabela e campo são obrigatórios (${m.variavel}).` });
    }
    await query('DELETE FROM mapeamentos WHERE fonte_id = $1', [fonte.id]);
    for (let i = 0; i < lista.length; i++) {
      const m = lista[i];
      await query(
        `INSERT INTO mapeamentos (fonte_id, variavel, tabela, campo, ordem) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (fonte_id, variavel, tabela) DO UPDATE SET campo = EXCLUDED.campo, ordem = EXCLUDED.ordem`,
        [fonte.id, m.variavel, String(m.tabela).trim(), String(m.campo).trim(), i]
      );
    }
    const mapeamentos = await sync.mapeamentosDe(fonte.id);
    res.json({ mapeamentos });
  } catch (err) { next(err); }
});

// Execuções de sincronização (rastreabilidade)
router.get('/:id/execucoes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.disparo, e.status, e.mensagem, e.registros, e.iniciado_em, e.concluido_em, u.nome AS usuario
         FROM sync_execucoes e LEFT JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.fonte_id = $1 ORDER BY e.id DESC LIMIT 30`,
      [req.params.id]
    );
    res.json({ execucoes: rows });
  } catch (err) { next(err); }
});

module.exports = router;
