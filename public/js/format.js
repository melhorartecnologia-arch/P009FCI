/** Formatação pt-BR (RNF-03). */
export const brl = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const num = (n, d = 2) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
export const dataHora = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/* ---------------------------------------------- trilha de auditoria (RF-006) */

/**
 * `cenario_eventos` guarda `{ usuario_nome, tipo, detalhe, registrado_em }`,
 * com `detalhe` em JSONB — estruturado, não textual. As duas telas que exibem a
 * trilha (Cenários ▸ Histórico e Simulação ▸ Governança) compartilham estas
 * duas funções para que a mesma gravação seja lida da mesma forma nos dois
 * lugares.
 */
const ROTULO_EVENTO = {
  criacao:             'Cenário criado',
  carga:               'Estrutura carregada da integração',
  duplicacao:          'Nova versão criada por duplicação',
  edicao:              'Edição de premissas',
  salvo:               'Premissas salvas',
  substituicao:        'Substituição de componente',
  reversao:            'Substituição revertida',
  massa:               'Alteração em massa aplicada',
  quantidade:          'Quantidade da receita alterada',
  proporcao:           'Proporção entre alternativas alterada',
  normalizacao:        'Proporções normalizadas',
  overhead:            'Custo industrial alterado',
  premissa_insumo:     'Origem e conteúdo do insumo alterados',
  cambio:              'Premissa cambial alterada',
  saidas:              'Volumes e preços de saída alterados',
  carga_saidas:        'Volumes e preços recarregados da integração',
  base:                'Base do denominador alterada',
  modo:                'Modo de edição alterado',
  validacao:           'Validação técnica',
  status:              'Mudança de situação',
  direcionamento:      'Direcionamento por área',
  relatorio:           'Relatório executivo emitido',
  'comparacao-painel': 'Alteração aplicada pelo painel de comparação',
};

/** Rótulo do evento, refinado pelo conteúdo quando o tipo é genérico. */
export function rotuloEvento(tipo, detalhe) {
  const d = detalhe || {};
  if (tipo === 'status') {
    if (d.acao === 'congelamento') return 'Premissas congeladas';
    if (d.acao === 'consolidacao') return 'Cenário consolidado para decisão';
    return `Situação alterada para «${d.para || '—'}»`;
  }
  if (tipo === 'validacao') {
    if (d.acao === 'decisao') return `Validação técnica ${d.decisao || 'decidida'}`;
    if (d.acao === 'submissao') return 'Alteração submetida à validação técnica';
    return 'Validação técnica';
  }
  if (tipo === 'direcionamento') {
    return d.acao === 'remocao' ? 'Direcionamento removido' : 'Direcionamento registrado';
  }
  return ROTULO_EVENTO[tipo] || (tipo ? String(tipo) : 'Evento do cenário');
}

/** Resumo legível do `detalhe` JSONB — nunca interpola o objeto cru. */
export function resumoEvento(tipo, detalhe) {
  const d = detalhe || {};
  const alvo = d.produto || d.insumo || d.item || d.sku || d.ref || '';
  const dePara = (de, para, sufixo = '') =>
    `${de != null ? de : '—'} → ${para != null ? para : '—'}${sufixo}`;

  switch (tipo) {
    case 'criacao':      return `${d.nome || 'cenário'} — estrutura carregada das fontes integradas`;
    case 'duplicacao':   return `Derivado de ${d.origem || '—'}, versão ${d.versao != null ? d.versao : '—'}`;
    case 'cambio':       return `${d.moeda || 'moeda'}: ${dePara(d.de, d.para)}`
                              + (d.nInsumosRecalculados ? ` · ${d.nInsumosRecalculados} insumo(s) recalculado(s)` : '');
    case 'base':         return `${dePara(d.de, d.para)}${d.rotulo ? ` (${d.rotulo})` : ''}`;
    case 'modo':         return dePara(d.de, d.para);
    case 'status':       return `${dePara(d.de, d.para)}${d.avisos ? ` · ${d.avisos} aviso(s) em aberto` : ''}`;
    case 'quantidade':   return `${alvo}: ${dePara(d.de, d.para, d.unidade ? ` ${d.unidade}` : '')}`;
    case 'overhead':     return `${alvo}: ${dePara(d.de, d.para)}`;
    case 'proporcao':    return `${alvo}: ${dePara(d.de, d.para, '%')} · total ${d.total != null ? d.total : '—'}%`;
    case 'normalizacao': return `${alvo}: total ${dePara(d.totalAntes, d.totalDepois, '%')}`;
    case 'reversao':     return `${alvo}: ${dePara(d.de, d.para)}`;
    case 'substituicao': return `${alvo}${d.modo ? ` · ${d.modo}` : ''}`
                              + (d.pct != null ? ` ${d.pct}%` : '')
                              + (d.deltaPp != null ? ` · ${d.deltaPp > 0 ? '+' : ''}${num(d.deltaPp, 2)} p.p. no CI%` : '');
    case 'massa':        return `Grupo ${d.grupo || '—'} · ${d.selecao || 'seleção'}`
                              + (Array.isArray(d.impactos) ? ` · ${d.impactos.length} produto(s) afetado(s)` : '');
    case 'premissa_insumo': return `${alvo}`
                              + (d.ciAdotado != null ? ` · CI adotado ${num(d.ciAdotado, 1)}%` : '')
                              + (d.custoFCI != null ? ` · custo FCI ${num(d.custoFCI, 4)}` : '');
    case 'saidas':       return `${alvo}${d.nUFs != null ? ` · ${d.nUFs} UF(s)` : ''}`
                              + (d.ci != null ? ` · CI% ${num(d.ci, 2)}` : '');
    case 'carga_saidas': return `${alvo}${d.modo ? ` · ${d.modo}` : ''}`;
    case 'carga':        return Array.isArray(d.fontes) ? `${d.fontes.length} fonte(s): ${d.fontes.map((f) => f.nome).join(' · ')}` : '';
    case 'validacao':    return `${d.area ? `${d.area} · ` : ''}${d.decisao || d.acao || ''}`
                              + (d.nPontos != null ? ` · ${d.nPontos} ponto(s)` : '')
                              + (d.notas ? ` — ${d.notas}` : '');
    case 'direcionamento': return `${d.area || '—'}${d.produto ? ` · ${d.produto}` : ''}${d.texto ? ` — ${d.texto}` : ''}`;
    case 'relatorio':    return `${String(d.formato || '').toUpperCase()} · versão ${d.versao != null ? d.versao : '—'}`
                              + (d.ciMedio != null ? ` · CI% médio ${num(d.ciMedio, 1)}` : '')
                              + (d.nAlertas != null ? ` · ${d.nAlertas} alerta(s)` : '');
    case 'comparacao-painel': return `${d.rotulo || d.tipo || 'alteração'} aplicada ao cenário`;
    case 'edicao':       return d.resumo || '';
    default: {
      // tipo novo: mostra os campos simples do detalhe, nunca o objeto cru
      const pares = Object.entries(d)
        .filter(([k, v]) => k !== 'requisito' && (typeof v === 'string' || typeof v === 'number'))
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${v}`);
      return pares.join(' · ');
    }
  }
}

/** Requisito citado na gravação do evento, quando houver (RNF-04). */
export const requisitoEvento = (detalhe) => (detalhe && detalhe.requisito) || '';
