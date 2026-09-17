'use strict';
/**
 * Contrato dos conectores de fonte de dados (RF-090/091/092).
 * Um conector recebe a configuração da fonte (host, porta, base, usuário,
 * senha decifrada e opções) e expõe:
 *   test(cfg)                          → { ok, mensagem }
 *   fetchRows(cfg, { tabela, campos }) → linhas [{ variavel: valor }]
 * `campos` mapeia variável do simulador → campo/coluna na origem.
 * Os conectores executam SOMENTE leitura — nenhuma operação altera a
 * origem (RNF-06).
 */

const RE_IDENT = /^[A-Za-z0-9_][A-Za-z0-9_.$-]*$/;

/** Valida identificador de tabela/campo para montagem segura de SELECT. */
function identificador(nome, tipo) {
  const v = String(nome || '').trim();
  if (!RE_IDENT.test(v)) {
    throw new Error(`${tipo} inválido no mapeamento: "${nome}". Use apenas letras, números, ponto e sublinhado.`);
  }
  return v;
}

/** Cita identificador possivelmente qualificado (schema.tabela). */
function citar(nome, aspas = '"') {
  return identificador(nome, 'Identificador')
    .split('.')
    .map((p) => aspas + p.replace(new RegExp(aspas, 'g'), '') + aspas)
    .join('.');
}

/** Monta SELECT campo AS variavel, ... FROM tabela (dialeto simples). */
function montarSelect({ tabela, campos, aspas = '"', limite }) {
  const cols = Object.entries(campos)
    .map(([variavel, campo]) => `${citar(campo, aspas)} AS ${aspas}${variavel}${aspas}`)
    .join(', ');
  const lim = limite ? ` LIMIT ${parseInt(limite, 10)}` : '';
  return `SELECT ${cols} FROM ${citar(tabela, aspas)}${lim}`;
}

function requireOpcional(pacote, rotulo) {
  try {
    return require(pacote);
  } catch (err) {
    const e = new Error(
      `Driver ${rotulo} não instalado neste servidor. Execute "npm install ${pacote}" na pasta da aplicação e reinicie o serviço.`
    );
    e.driverAusente = true;
    throw e;
  }
}

module.exports = { identificador, citar, montarSelect, requireOpcional };
