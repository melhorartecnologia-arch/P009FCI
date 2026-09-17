'use strict';
/**
 * Registro dos conectores disponíveis (RF-090).
 * A fonte de dados escolhe o conector pelo campo `conector`; trocar de SGBD
 * é trocar esse campo e os dados de conexão — o restante da aplicação
 * permanece intacto (abstração exigida pela integração configurável).
 */
const postgres = require('./postgres');
const mysql = require('./mysql');
const mssql = require('./mssql');
const oracle = require('./oracle');
const rest = require('./rest');
const arquivo = require('./arquivo');

const REGISTRO = { postgres, mysql, mssql, oracle, rest, arquivo };

function obterConector(tipo) {
  const c = REGISTRO[tipo];
  if (!c) throw new Error(`Conector desconhecido: "${tipo}". Disponíveis: ${Object.keys(REGISTRO).join(', ')}.`);
  return c;
}

function listarConectores() {
  return Object.values(REGISTRO).map((c) => ({ tipo: c.tipo, rotulo: c.rotulo }));
}

module.exports = { obterConector, listarConectores };
