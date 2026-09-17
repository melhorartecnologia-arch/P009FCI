'use strict';
/**
 * Matriz de permissões por área (RF-100 · RC-009 · RNF-09).
 * Semana 1 entrega a restrição de administração: integrações e parâmetros
 * mestres editáveis apenas pelo perfil Administrador (TI); demais áreas em
 * modo consulta. A matriz completa (modo avançado, lote, validação) é S5.
 */
const AREAS = [
  'Custos', 'Controladoria', 'Fiscal', 'Pricing', 'Compras',
  'Industrial', 'PCP', 'SGI/CGI', 'Negócio', 'TI',
];

const PERMS = {
  'Custos':        { perfil: 'Simulador',     acoes: ['abrir', 'criarCenario', 'editarPremissas', 'calcular', 'consolidar', 'editarSaida', 'editarFornecedor', 'salvar', 'massa'] },
  'Controladoria': { perfil: 'Validador',     acoes: ['abrir', 'criarCenario', 'editarPremissas', 'calcular', 'consolidar', 'congelar', 'baseCalculo', 'editarSaida', 'editarFornecedor', 'editarFiscal', 'salvar', 'massa', 'modoAvancado', 'editarEstrutura', 'aprovar', 'validarTecnico'] },
  'Fiscal':        { perfil: 'Simulador',     acoes: ['calcular', 'editarFiscal', 'salvar'] },
  'Pricing':       { perfil: 'Simulador',     acoes: ['calcular', 'editarSaida', 'salvar', 'massa'] },
  'Compras':       { perfil: 'Simulador',     acoes: ['calcular', 'editarFornecedor', 'editarPremissas', 'salvar', 'massa'] },
  'Industrial':    { perfil: 'Especialista',  acoes: ['calcular', 'editarEstrutura', 'modoAvancado', 'salvar', 'massa', 'validarTecnico'] },
  'PCP':           { perfil: 'Especialista',  acoes: ['calcular', 'editarEstrutura', 'modoAvancado', 'salvar', 'massa', 'validarTecnico', 'validarEstrutura'] },
  'SGI/CGI':       { perfil: 'Validador',     acoes: ['calcular', 'validarTecnico', 'validarEstrutura', 'aprovar'] },
  'Negócio':       { perfil: 'Aprovador',     acoes: ['abrir', 'calcular', 'consolidar', 'aprovar'] },
  'TI':            { perfil: 'Administrador', acoes: ['integracoes', 'parametros', 'usuarios', 'calcular', 'criarCenario', 'abrir', 'salvar'] },
};

function permissoesDe(area) {
  return PERMS[area] || { perfil: '—', acoes: [] };
}

function pode(usuario, acao) {
  if (!usuario) return false;
  if (usuario.is_admin) {
    // Administrador sempre gerencia integrações, parâmetros e usuários.
    if (['integracoes', 'parametros', 'usuarios'].includes(acao)) return true;
  }
  return permissoesDe(usuario.area).acoes.includes(acao);
}

module.exports = { AREAS, PERMS, permissoesDe, pode };
