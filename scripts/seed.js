'use strict';
/**
 * Seed inicial do Simulador FCI:
 *  - usuários por área (RF-100) — senha inicial definida em SEED_SENHA (.env)
 *  - parâmetros mestres (RF-096/097/098/099)
 *  - fontes de dados apontando para o schema de demonstração erp_demo
 *    (mesma instância PostgreSQL) com mapeamentos SB1/SD1/SG1/CFD (RF-090/091)
 *  - sincronização inicial das fontes (RF-093) para habilitar o RF-002
 * Reexecutável: usa UPSERT e não duplica registros.
 */
const bcrypt = require('bcryptjs');
const { pool, query } = require('../server/db');
const { exigirSegredos, config } = require('../server/config');
const { cifrar } = require('../server/crypto');
const { permissoesDe } = require('../server/permissions');
const sync = require('../server/services/sync.service');

const SENHA_PADRAO = process.env.SEED_SENHA || 'cci@2026';

async function seedUsuarios() {
  const usuarios = [
    { nome: 'Administrador TI',   email: 'ti@cci.local',            area: 'TI',            admin: true },
    { nome: 'Ana Ribeiro',        email: 'custos@cci.local',        area: 'Custos' },
    { nome: 'Lindomar Oliveira',  email: 'controladoria@cci.local', area: 'Controladoria' },
    { nome: 'Wagner Sobral',      email: 'fiscal@cci.local',        area: 'Fiscal' },
    { nome: 'Márcio Godoi',       email: 'pricing@cci.local',       area: 'Pricing' },
    { nome: 'Cleyton Reis',       email: 'compras@cci.local',       area: 'Compras' },
    { nome: 'Equipe Industrial',  email: 'industrial@cci.local',    area: 'Industrial' },
    { nome: 'Equipe PCP',         email: 'pcp@cci.local',           area: 'PCP' },
    { nome: 'Equipe SGI/CGI',     email: 'sgi@cci.local',           area: 'SGI/CGI' },
    { nome: 'Direção de Negócio', email: 'negocio@cci.local',       area: 'Negócio' },
  ];
  const hash = await bcrypt.hash(SENHA_PADRAO, 10);
  for (const u of usuarios) {
    await query(
      `INSERT INTO usuarios (nome, email, senha_hash, area, perfil, is_admin)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, area = EXCLUDED.area,
         perfil = EXCLUDED.perfil, is_admin = EXCLUDED.is_admin`,
      [u.nome, u.email, hash, u.area, permissoesDe(u.area).perfil, !!u.admin]
    );
  }
  console.log(`Usuários: ${usuarios.length} (senha inicial "${SENHA_PADRAO}" — troque no primeiro acesso).`);
}

async function seedParametros() {
  // Listas de CFOP conforme parâmetros MV_FCI do Protheus (Frutal — Grupo 30)
  const cl = "'100','110','120','170','190','200','210','220','270','290','300','310','320','370','390','510','500','010','040','020','000','520','540','570','590','090','070','140','240','340'";
  const ve = "'6107','6101','6103','6105','6109','6111','6113','6116','6118','6122','6124','6125','6401','6402','6403','6404','6920','6927','6102','6108','6405','6949','6910'";
  const vi = "'5107','5101','5103','5105','5109','5111','5113','5116','5118','5122','5124','5125','5401','5402','5403','5404','5553','5949','5102','5108','5405','5927','5910'";
  const tr = "'1151','1152','1408','1409','2151','2152','2408','2409','1557','2557','1552','2552'";

  const parametros = {
    motor: {
      versaoFormula: 'CI% v1 · Convênio ICMS 38/2013',
      mv: [
        { id: 'MV_FCICL',   desc: 'Classificações fiscais (origem/CST) consideradas na apuração', val: cl,    tipo: 'lista' },
        { id: 'MV_FCIVE',   desc: 'CFOP de saída interestadual',                                  val: ve,    tipo: 'lista' },
        { id: 'MV_FCIVI',   desc: 'CFOP de saída interna',                                        val: vi,    tipo: 'lista' },
        { id: 'MV_FCITR',   desc: 'CFOP de transferência',                                        val: tr,    tipo: 'lista' },
        { id: 'MV_FCICOMP', desc: 'Considera NF de complemento de preço',                         val: '.T.', tipo: 'bool' },
        { id: 'MV_FCINTHD', desc: 'Processamento multithread (nº de threads)',                    val: '5',   tipo: 'num' },
      ],
    },
    aliquotas: { lista: [4, 6, 7, 11, 12, 18, 23, 25] },
    faixas: {
      lista: [
        { id: 'ate40',   lim: 'CI% ≤ 40%',       fator: 0,   aliq: '7% / 12%', classe: 'Nacional' },
        { id: 'de40a70', lim: '40% < CI% ≤ 70%', fator: 0.5, aliq: '4%',       classe: 'Nacional c/ CI > 40%' },
        { id: 'acima70', lim: 'CI% > 70%',       fator: 1,   aliq: '4%',       classe: 'Equiparado a importado' },
      ],
    },
    gatilho_reemissao: { pp: 5 },
    moedas: {
      lista: [
        { codigo: 'USD', nome: 'Dólar americano', simbolo: 'US$', cotacaoBase: 5.42 },
        { codigo: 'EUR', nome: 'Euro',            simbolo: '€',   cotacaoBase: 5.88 },
        { codigo: 'GBP', nome: 'Libra esterlina', simbolo: '£',   cotacaoBase: 6.95 },
        { codigo: 'CHF', nome: 'Franco suíço',    simbolo: 'CHF', cotacaoBase: 6.12 },
      ],
    },
    st: { mva: 30, aliqInterna: 18, aliqNormal: 12 },
  };

  for (const [chave, valor] of Object.entries(parametros)) {
    await query(
      `INSERT INTO parametros (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO NOTHING`,
      [chave, JSON.stringify(valor)]
    );
  }
  console.log('Parâmetros mestres registrados (MV_FCI, alíquotas, faixas, gatilho 5 p.p., moedas).');
}

async function seedFontes() {
  // As fontes de demonstração apontam para o schema erp_demo NA MESMA instância
  // PostgreSQL. Em produção o administrador (TI) apenas reaponta a conexão.
  const conexaoLocal = {
    conector: 'postgres',
    host: config.db.host,
    porta: config.db.port,
    base: config.db.database,
    usuario: config.db.user,
    credencial: config.db.password || '',
  };

  const fontes = [
    {
      codigo: 'protheus', nome: 'ERP Protheus (TOTVS)', icone: '🗄',
      sgbdLabel: 'PostgreSQL (demo local — em produção: Oracle 19c)',
      descricao: 'Cadastro de itens, estrutura/lista técnica, origem e CST.',
      fontesLabel: 'Variáveis 1–4 · SB1 · SG1 · SD1 · CFD',
      syncFreq: 'diaria', syncHora: '06:00', syncAtiva: true,
      mapeamentos: [
        { variavel: 'produto.codigo',      tabela: 'erp_demo.sb1', campo: 'b1_cod' },
        { variavel: 'produto.descricao',   tabela: 'erp_demo.sb1', campo: 'b1_desc' },
        { variavel: 'produto.origem',      tabela: 'erp_demo.sb1', campo: 'b1_origem' },
        { variavel: 'produto.tipo',        tabela: 'erp_demo.sb1', campo: 'b1_tipo' },
        { variavel: 'produto.unidade',     tabela: 'erp_demo.sb1', campo: 'b1_um' },
        { variavel: 'produto.grupo',       tabela: 'erp_demo.sb1', campo: 'b1_grupo' },
        { variavel: 'produto.ncm',         tabela: 'erp_demo.sb1', campo: 'b1_posipi' },
        { variavel: 'produto.volume',         tabela: 'erp_demo.sb1', campo: 'b1_conv' },
        { variavel: 'produto.unidade_volume', tabela: 'erp_demo.sb1', campo: 'b1_segum' },
        { variavel: 'produto.overhead',       tabela: 'erp_demo.sb1', campo: 'b1_custd' },
        { variavel: 'produto.codigo',      tabela: 'erp_demo.cfd', campo: 'cfd_cod' },
        { variavel: 'produto.fci_vigente', tabela: 'erp_demo.cfd', campo: 'cfd_conimp' },
        { variavel: 'estrutura.pai',        tabela: 'erp_demo.sg1', campo: 'g1_cod' },
        { variavel: 'estrutura.componente', tabela: 'erp_demo.sg1', campo: 'g1_comp' },
        { variavel: 'estrutura.quantidade', tabela: 'erp_demo.sg1', campo: 'g1_quant' },
        { variavel: 'cst.item', tabela: 'erp_demo.sd1', campo: 'd1_cod' },
        { variavel: 'cst.cst',  tabela: 'erp_demo.sd1', campo: 'd1_clasfis' },
      ],
    },
    {
      codigo: 'portal_custos', nome: 'Portal de Custos', icone: '📈',
      sgbdLabel: 'PostgreSQL (demo local — em produção: SQL Server 2019)',
      descricao: 'Preço de entrada e valores monetários por item.',
      fontesLabel: 'Variável 5 · vw_CustoEntrada',
      syncFreq: 'diaria', syncHora: '05:30', syncAtiva: true,
      mapeamentos: [
        { variavel: 'custo.item',           tabela: 'erp_demo.vw_custo_entrada', campo: 'coditem' },
        { variavel: 'custo.valor_total',    tabela: 'erp_demo.vw_custo_entrada', campo: 'vlrtotal' },
        { variavel: 'custo.icms',           tabela: 'erp_demo.vw_custo_entrada', campo: 'vlricms' },
        { variavel: 'custo.ipi',            tabela: 'erp_demo.vw_custo_entrada', campo: 'vlripi' },
        { variavel: 'custo.moeda',          tabela: 'erp_demo.vw_custo_entrada', campo: 'moeda' },
        { variavel: 'custo.fornecedor',     tabela: 'erp_demo.vw_custo_entrada', campo: 'fornecedor' },
        { variavel: 'custo.fob',            tabela: 'erp_demo.vw_custo_entrada', campo: 'vlrfob' },
        { variavel: 'custo.frete_int',      tabela: 'erp_demo.vw_custo_entrada', campo: 'vlrfreteint' },
        { variavel: 'custo.seguro_int',     tabela: 'erp_demo.vw_custo_entrada', campo: 'vlrseguroint' },
        { variavel: 'custo.ii',             tabela: 'erp_demo.vw_custo_entrada', campo: 'vlrii' },
        { variavel: 'custo.ipi_imp',        tabela: 'erp_demo.vw_custo_entrada', campo: 'vlripiimp' },
        { variavel: 'custo.piscofins_imp',  tabela: 'erp_demo.vw_custo_entrada', campo: 'vlrpiscofinsimp' },
      ],
    },
    {
      codigo: 'precos', nome: 'Sistema de Preços (Pricing)', icone: '🏷',
      sgbdLabel: 'PostgreSQL (demo local)',
      descricao: 'Volumes e preços por UF — denominador do CI%.',
      fontesLabel: 'Variáveis 8–9 · precos_saida',
      syncFreq: 'horaria', syncHora: '06:00', syncAtiva: true,
      mapeamentos: [
        { variavel: 'saida.sku',    tabela: 'erp_demo.precos_saida', campo: 'sku' },
        { variavel: 'saida.uf',     tabela: 'erp_demo.precos_saida', campo: 'uf' },
        { variavel: 'saida.volume', tabela: 'erp_demo.precos_saida', campo: 'volume' },
        { variavel: 'saida.preco',  tabela: 'erp_demo.precos_saida', campo: 'preco_liquido' },
      ],
    },
    {
      codigo: 'cambio', nome: 'Câmbio · Financeiro', icone: '💱',
      sgbdLabel: 'PostgreSQL (demo local — alternativa: REST BACEN PTAX)',
      descricao: 'Cotações de venda das moedas parametrizáveis.',
      fontesLabel: 'Variável 6 · cotacoes',
      syncFreq: 'diaria', syncHora: '13:00', syncAtiva: true,
      mapeamentos: [
        { variavel: 'cambio.moeda',   tabela: 'erp_demo.cotacoes', campo: 'moeda' },
        { variavel: 'cambio.cotacao', tabela: 'erp_demo.cotacoes', campo: 'cotacao_venda' },
      ],
    },
    {
      codigo: 'compras', nome: 'Compras / Contratos', icone: '🛍',
      sgbdLabel: 'PostgreSQL (demo local — alternativa: REST API)',
      descricao: 'Cadastro de fornecedores e contratos.',
      fontesLabel: 'Variáveis 6–7 · fornecedores',
      syncFreq: 'diaria', syncHora: '04:00', syncAtiva: true,
      mapeamentos: [
        { variavel: 'fornecedor.codigo', tabela: 'erp_demo.fornecedores', campo: 'id' },
        { variavel: 'fornecedor.nome',   tabela: 'erp_demo.fornecedores', campo: 'nome' },
        { variavel: 'fornecedor.pais',   tabela: 'erp_demo.fornecedores', campo: 'pais' },
      ],
    },
  ];

  for (const f of fontes) {
    const { rows } = await query(
      `INSERT INTO fontes_dados
         (codigo, nome, icone, descricao, fontes_label, conector, sgbd_label, host, porta, base, usuario,
          credencial_enc, opcoes, sync_freq, sync_hora, sync_ativa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}',$13,$14,$15)
       ON CONFLICT (codigo) DO UPDATE SET atualizado_em = now()
       RETURNING id`,
      [
        f.codigo, f.nome, f.icone, f.descricao, f.fontesLabel,
        conexaoLocal.conector, f.sgbdLabel,
        conexaoLocal.host, conexaoLocal.porta, conexaoLocal.base, conexaoLocal.usuario,
        conexaoLocal.credencial ? cifrar(conexaoLocal.credencial) : null,
        f.syncFreq, f.syncHora, f.syncAtiva,
      ]
    );
    const fonteId = rows[0].id;
    for (let i = 0; i < f.mapeamentos.length; i++) {
      const m = f.mapeamentos[i];
      await query(
        `INSERT INTO mapeamentos (fonte_id, variavel, tabela, campo, ordem)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (fonte_id, variavel, tabela) DO UPDATE SET campo = EXCLUDED.campo, ordem = EXCLUDED.ordem`,
        [fonteId, m.variavel, m.tabela, m.campo, i]
      );
    }
  }
  console.log(`Fontes de dados: ${fontes.length} configuradas (conector postgres → schema erp_demo).`);
  return fontes.map((f) => f.codigo);
}

async function sincronizarFontes(codigos) {
  for (const codigo of codigos) {
    const { rows } = await query('SELECT id FROM fontes_dados WHERE codigo = $1', [codigo]);
    if (!rows[0]) continue;
    try {
      const r = await sync.sincronizar(rows[0].id, { disparo: 'manual' });
      console.log(`Sincronização inicial "${codigo}": ${r.registros} registro(s).`);
    } catch (err) {
      console.warn(`Sincronização inicial "${codigo}" falhou: ${err.message}`);
    }
  }
}

async function main() {
  exigirSegredos();
  await seedUsuarios();
  await seedParametros();
  const codigos = await seedFontes();
  await sincronizarFontes(codigos);
  await pool.end();
  console.log('Seed concluído.');
}

main().catch((err) => { console.error('Falha no seed:', err); process.exit(1); });
