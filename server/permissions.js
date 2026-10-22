'use strict';
/**
 * Matriz de permissões por área e perfil (RF-034 · RF-035 · RF-039 · RF-100 · RNF-09).
 *
 * Reproduz a tabela "Atores e perfis de acesso" da ERS v1.0 (seção 4):
 *   Custos          · Simulador     — abre cenários, define premissas, calcula e consolida
 *   Controladoria   · Validador     — valida, aprova, congela e define a base do denominador
 *   Fiscal/Tributário · Simulador   — classifica origem, CST e conteúdo; avalia enquadramento
 *   Pricing         · Simulador     — mantém preço de saída, volumes e mix de UF
 *   Compras         · Simulador     — mantém fornecedor, FOB, frete, seguro, contratos e moeda
 *   Industrial/PCP  · Especialista  — altera estrutura e receita em modo avançado; valida
 *   SGI/CGI         · Validador     — valida tecnicamente a estrutura e aprova cenários avançados
 *   Negócio         · Aprovador     — aprova e consolida para decisão executiva
 *   TI              · Administrador — configura integrações, fontes de dados e parâmetros
 */

const AREAS = [
  'Custos', 'Controladoria', 'Fiscal', 'Pricing', 'Compras',
  'Industrial', 'PCP', 'SGI/CGI', 'Negócio', 'TI',
];

/** Capacidades controladas, com o rótulo exibido na matriz (RF-039). */
const CAPACIDADES = [
  { chave: 'abrir',             rotulo: 'Abrir cenário',            grupo: 'Cenário' },
  { chave: 'criarCenario',      rotulo: 'Criar e duplicar cenário', grupo: 'Cenário' },
  { chave: 'salvar',            rotulo: 'Salvar alterações',        grupo: 'Cenário' },
  { chave: 'editarPremissas',   rotulo: 'Editar premissas gerais',  grupo: 'Premissas' },
  { chave: 'editarFornecedor',  rotulo: 'Fornecedor, FOB e câmbio', grupo: 'Premissas' },
  { chave: 'editarSaida',       rotulo: 'Preço, volume e UF',       grupo: 'Premissas' },
  { chave: 'editarFiscal',      rotulo: 'Origem, CST e conteúdo',   grupo: 'Premissas' },
  { chave: 'substituir',        rotulo: 'Substituir componente',    grupo: 'Estrutura' },
  { chave: 'massa',             rotulo: 'Alteração em lote',        grupo: 'Estrutura' },
  { chave: 'editarEstrutura',   rotulo: 'Alterar a receita',        grupo: 'Estrutura' },
  { chave: 'modoAvancado',      rotulo: 'Modo avançado',            grupo: 'Estrutura' },
  { chave: 'submeterValidacao', rotulo: 'Submeter à validação',     grupo: 'Governança' },
  { chave: 'validarTecnico',    rotulo: 'Decidir validação técnica',grupo: 'Governança' },
  { chave: 'baseCalculo',       rotulo: 'Definir base do denominador', grupo: 'Governança' },
  { chave: 'congelar',          rotulo: 'Congelar premissas',       grupo: 'Governança' },
  { chave: 'consolidar',        rotulo: 'Consolidar para decisão',  grupo: 'Governança' },
  { chave: 'aprovar',           rotulo: 'Aprovar cenário',          grupo: 'Governança' },
  { chave: 'relatorio',         rotulo: 'Emitir relatório',         grupo: 'Governança' },
  { chave: 'integracoes',       rotulo: 'Integrações e fontes',     grupo: 'Dados mestres' },
  { chave: 'parametros',        rotulo: 'Parâmetros mestres',       grupo: 'Dados mestres' },
  { chave: 'usuarios',          rotulo: 'Usuários e perfis',        grupo: 'Dados mestres' },
];

const PERMS = {
  'Custos': {
    perfil: 'Simulador',
    atribuicao: 'Abre cenários, define premissas, calcula e consolida para decisão.',
    acoes: ['abrir', 'criarCenario', 'salvar', 'editarPremissas', 'editarFornecedor', 'editarSaida',
            'substituir', 'massa', 'submeterValidacao', 'consolidar', 'relatorio'],
  },
  'Controladoria': {
    perfil: 'Validador',
    atribuicao: 'Valida, aprova, congela premissas e define a base de cálculo do denominador.',
    acoes: ['abrir', 'criarCenario', 'salvar', 'editarPremissas', 'editarFornecedor', 'editarSaida',
            'editarFiscal', 'substituir', 'massa', 'editarEstrutura', 'modoAvancado',
            'submeterValidacao', 'validarTecnico', 'baseCalculo', 'congelar', 'consolidar',
            'aprovar', 'relatorio'],
  },
  'Fiscal': {
    perfil: 'Simulador',
    atribuicao: 'Classifica origem, CST e conteúdo de importação; avalia enquadramento e reemissão.',
    acoes: ['abrir', 'salvar', 'editarFiscal', 'relatorio'],
  },
  'Pricing': {
    perfil: 'Simulador',
    atribuicao: 'Mantém preço de saída, volumes e mix de UF de destino.',
    acoes: ['abrir', 'salvar', 'editarSaida', 'massa', 'relatorio'],
  },
  'Compras': {
    perfil: 'Simulador',
    atribuicao: 'Mantém fornecedor, FOB, frete e seguro internacional, contratos e moeda.',
    acoes: ['abrir', 'salvar', 'editarPremissas', 'editarFornecedor', 'substituir', 'massa', 'relatorio'],
  },
  'Industrial': {
    perfil: 'Especialista',
    atribuicao: 'Altera a estrutura e a receita padrão em modo avançado; valida tecnicamente.',
    acoes: ['abrir', 'salvar', 'substituir', 'massa', 'editarEstrutura', 'modoAvancado',
            'submeterValidacao', 'validarTecnico', 'relatorio'],
  },
  'PCP': {
    perfil: 'Especialista',
    atribuicao: 'Altera a estrutura e a receita padrão em modo avançado; valida tecnicamente.',
    acoes: ['abrir', 'salvar', 'substituir', 'massa', 'editarEstrutura', 'modoAvancado',
            'submeterValidacao', 'validarTecnico', 'relatorio'],
  },
  'SGI/CGI': {
    perfil: 'Validador',
    atribuicao: 'Valida tecnicamente alterações de estrutura e aprova cenários avançados.',
    acoes: ['abrir', 'validarTecnico', 'aprovar', 'relatorio'],
  },
  'Negócio': {
    perfil: 'Aprovador',
    atribuicao: 'Aprova e consolida o cenário para decisão executiva.',
    acoes: ['abrir', 'consolidar', 'aprovar', 'relatorio'],
  },
  'TI': {
    perfil: 'Administrador',
    atribuicao: 'Configura integrações, fontes de dados e parâmetros mestres.',
    acoes: ['abrir', 'criarCenario', 'salvar', 'integracoes', 'parametros', 'usuarios', 'relatorio'],
  },
};

/** Ações exclusivas do perfil Administrador (RF-100). */
const ACOES_ADMIN = ['integracoes', 'parametros', 'usuarios'];

function permissoesDe(area) {
  return PERMS[area] || { perfil: '—', atribuicao: '', acoes: [] };
}

function pode(usuario, acao) {
  if (!usuario) return false;
  if (usuario.is_admin && ACOES_ADMIN.includes(acao)) return true;
  return permissoesDe(usuario.area).acoes.includes(acao);
}

/** Matriz completa para exibição ao usuário (RF-039). */
function matrizPermissoes(areaAtiva) {
  return {
    capacidades: CAPACIDADES,
    areas: AREAS.map((area) => {
      const p = permissoesDe(area);
      return {
        area, perfil: p.perfil, atribuicao: p.atribuicao,
        ativa: area === areaAtiva,
        permissoes: Object.fromEntries(CAPACIDADES.map((c) => [c.chave, p.acoes.includes(c.chave)])),
      };
    }),
  };
}

/** Rótulo legível da ação, usado nas mensagens de impedimento (RF-035 · RF-100). */
function rotuloAcao(acao) {
  const c = CAPACIDADES.find((x) => x.chave === acao);
  return c ? c.rotulo.toLowerCase() : acao;
}

module.exports = { AREAS, CAPACIDADES, PERMS, ACOES_ADMIN, permissoesDe, pode, matrizPermissoes, rotuloAcao };
