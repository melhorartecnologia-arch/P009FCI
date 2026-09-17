import { esc, dataHora } from '../format.js';

const STATUS = {
  conectado:       { label: 'Conectado',       bg: '#e9f1eb', fg: '#2f6b46', dot: '#3f7d54' },
  sincronizando:   { label: 'Sincronizando…',  bg: '#f6ecd6', fg: '#8a5e12', dot: '#b07d1e', girando: true },
  erro:            { label: 'Erro',            bg: '#f5e5e0', fg: '#a03d2c', dot: '#a03d2c' },
  nao_configurado: { label: 'Não configurado', bg: '#efeae0', fg: '#8b8681', dot: '#8b8681' },
};

export async function telaIntegracoes(el, ctx) {
  ctx.definirTopo('Integrações e fontes de dados',
    'RF-090 a RF-095 — conexão, mapeamento SB1/SD1, teste, sincronização e status por fonte');

  const [{ fontes, conectores, somenteLeitura }, { variaveis }, { resumo }] = await Promise.all([
    ctx.api.get('/fontes'),
    ctx.api.get('/fontes/catalogo'),
    ctx.api.get('/fontes/staging/resumo'),
  ]);

  const conectadas = fontes.filter((f) => f.status === 'conectado').length;
  const registrosPorFonte = new Map();
  for (const r of resumo) {
    const chave = r.fonte;
    if (!registrosPorFonte.has(chave)) registrosPorFonte.set(chave, []);
    registrosPorFonte.get(chave).push(r);
  }

  el.innerHTML = `
  <div class="pagina" style="max-width:1400px;">
    <div style="display:flex;gap:14px;margin-bottom:16px;align-items:stretch;flex-wrap:wrap;">
      <div class="card" style="padding:14px 18px;">
        <div style="font-size:11px;color:var(--ink-3);">Conexões ativas</div>
        <div style="font-size:24px;font-weight:600;" class="mono">${conectadas}/${fontes.length}</div>
      </div>
      <div class="card" style="flex:1;padding:14px 18px;display:flex;align-items:center;font-size:12px;color:var(--ink-2);line-height:1.5;min-width:300px;">
        Os dados mestres do simulador são obtidos por integração com bancos externos configuráveis — conector abstrato (PostgreSQL, Oracle, SQL Server, MySQL, REST, arquivo), mapeamento tabela/campo por variável e sincronização por fonte. Nenhuma operação altera os sistemas de origem (RNF-06).
      </div>
      ${somenteLeitura ? '' : '<button class="btn btn-ouro" id="btn-nova-fonte" style="align-self:center;">＋ Nova fonte de dados</button>'}
    </div>
    ${somenteLeitura ? '<div class="aviso-restricao">🔒 Edição de conexões restrita ao perfil <b>Administrador (TI)</b>. Visualização liberada para consulta (RF-100).</div>' : ''}
    <div style="display:flex;flex-direction:column;gap:14px;" id="lista-fontes">
      ${fontes.map((f) => cartaoFonte(f, registrosPorFonte.get(f.codigo) || [], somenteLeitura)).join('')}
    </div>
  </div>`;

  el.querySelector('#btn-nova-fonte')?.addEventListener('click', () => modalFonte(ctx, conectores, null, () => telaIntegracoes(el, ctx)));

  for (const f of fontes) {
    const card = el.querySelector(`[data-fonte="${f.id}"]`);
    if (!card) continue;

    card.querySelector('[data-acao="testar"]')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Testando…';
      try {
        const r = await ctx.api.post(`/fontes/${f.id}/testar`);
        ctx.toast(r.ok ? `✓ ${r.mensagem}` : `Falha no teste: ${r.mensagem}`, r.ok ? 'ok' : 'erro');
      } catch (err) { ctx.toast(err.message, 'erro'); }
      telaIntegracoes(el, ctx);
    });

    card.querySelector('[data-acao="sincronizar"]')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Sincronizando…';
      const chipEl = card.querySelector('.chip-status');
      if (chipEl) chipEl.outerHTML = chipStatus('sincronizando');
      try {
        const r = await ctx.api.post(`/fontes/${f.id}/sincronizar`);
        ctx.toast(`Sincronização concluída: ${r.registros} registro(s) · ${r.detalhes.join(' · ')}`, 'ok');
      } catch (err) {
        ctx.toast(`${err.message} A última carga válida permanece disponível e o cenário segue operável (RF-095).`, 'erro');
      }
      telaIntegracoes(el, ctx);
    });

    card.querySelector('[data-acao="editar"]')?.addEventListener('click', () => modalFonte(ctx, conectores, f, () => telaIntegracoes(el, ctx)));
    card.querySelector('[data-acao="mapear"]')?.addEventListener('click', () => modalMapeamentos(ctx, f, variaveis, somenteLeitura, () => telaIntegracoes(el, ctx)));
    card.querySelector('[data-acao="historico"]')?.addEventListener('click', async () => {
      const { execucoes } = await ctx.api.get(`/fontes/${f.id}/execucoes`);
      modalHistorico(ctx, f, execucoes);
    });
    card.querySelector('[data-acao="excluir"]')?.addEventListener('click', async () => {
      if (!window.confirm(`Excluir a fonte "${f.nome}"? Os dados já carregados no staging desta fonte serão removidos.`)) return;
      try {
        await ctx.api.del(`/fontes/${f.id}`);
        ctx.toast('Fonte removida.', 'ok');
        telaIntegracoes(el, ctx);
      } catch (err) { ctx.toast(err.message, 'erro'); }
    });
  }
}

function chipStatus(status) {
  const s = STATUS[status] || STATUS.nao_configurado;
  return `<span class="chip-status" style="background:${s.bg};color:${s.fg};">
    <span class="ponto ${s.girando ? 'girando' : ''}" style="background:${s.dot};"></span>${s.label}
  </span>`;
}

function cartaoFonte(f, staging, somenteLeitura) {
  const totalStg = staging.reduce((a, r) => a + r.registros, 0);
  return `
  <div class="int-card" data-fonte="${f.id}">
    <div class="cabeca">
      <div class="icone">${esc(f.icone)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;">${esc(f.nome)}</div>
        <div style="font-size:11px;color:var(--ink-3);">${esc(f.sgbdLabel || f.conector)} · ${esc(f.fontesLabel || f.descricao)}</div>
      </div>
      ${totalStg ? `<span style="font-size:10.5px;color:var(--ink-3);background:var(--panel-2);border:1px solid var(--line);border-radius:7px;padding:4px 10px;" title="Última carga válida disponível para os cenários (RNF-07)">📦 ${totalStg} registro(s) no staging</span>` : ''}
      ${chipStatus(f.status)}
    </div>
    <div class="conexao">
      ${campoLeitura('HOST / ENDPOINT', f.host)}
      ${campoLeitura('PORTA', f.porta || '—')}
      ${campoLeitura('BASE / DATABASE', f.base || '—')}
      ${campoLeitura('USUÁRIO', f.usuario || '—')}
      ${campoLeitura('CREDENCIAL', f.possuiCredencial ? f.credencialMascarada : '— sem credencial —', true)}
      ${campoLeitura('CONECTOR', f.conector)}
    </div>
    <div class="mapa">
      <div class="titulo">MAPEAMENTO · VARIÁVEL → TABELA · CAMPO (RF-091)</div>
      ${(f.mapeamentos || []).slice(0, 5).map((m) => `
        <div class="mapa-linha" style="grid-template-columns:1.5fr 1fr 1.7fr;">
          <div style="color:var(--ink-2);">${esc(m.variavel)}</div>
          <div class="mono" style="color:var(--gold-d);font-weight:500;">${esc(m.tabela)}</div>
          <div class="mono" style="color:var(--ink-3);">${esc(m.campo)}</div>
        </div>`).join('')}
      ${(f.mapeamentos || []).length > 5 ? `<div style="font-size:10.5px;color:var(--ink-3);padding:5px 0;">… e mais ${f.mapeamentos.length - 5} variável(is) mapeada(s)</div>` : ''}
      ${!(f.mapeamentos || []).length ? '<div style="font-size:11px;color:var(--warn-fg);padding:5px 0;">⚠ Nenhuma variável mapeada — a sincronização exige o mapeamento (RF-091).</div>' : ''}
    </div>
    ${f.status === 'erro' && f.lastError ? `<div class="int-erro"><b>Falha registrada:</b> ${esc(f.lastError)}<br><span style="color:#8a4030;">A última carga válida permanece no staging e os cenários seguem operáveis (RF-095 · RNF-07).</span></div>` : ''}
    <div class="rodape">
      <button class="btn btn-borda btn-mini" data-acao="testar" ${somenteLeitura ? 'disabled' : ''}>Testar conexão</button>
      <button class="btn btn-escuro btn-mini" data-acao="sincronizar" ${somenteLeitura ? 'disabled' : ''}>Sincronizar agora</button>
      <button class="btn btn-borda btn-mini" data-acao="mapear">${somenteLeitura ? 'Ver mapeamento' : 'Mapeamento…'}</button>
      <button class="btn btn-borda btn-mini" data-acao="historico">Execuções</button>
      ${somenteLeitura ? '' : `<button class="btn btn-borda btn-mini" data-acao="editar">Editar conexão…</button>
      <button class="btn btn-borda btn-mini" data-acao="excluir" style="color:var(--err);">Excluir</button>`}
      <div style="flex:1;"></div>
      <span style="font-size:11px;color:var(--ink-3);">
        ${f.testadoEm ? `Teste: <b class="mono" style="color:${f.testeOk ? 'var(--ok-fg)' : 'var(--err)'};">${dataHora(f.testadoEm)}</b> · ` : ''}
        Última sync: <b class="mono" style="color:var(--ink-2);">${f.lastSyncAt ? dataHora(f.lastSyncAt) : 'nunca'}</b> · ${esc(f.freqDescricao)}${f.syncAtiva ? '' : ' (agendamento desativado)'}
      </span>
    </div>
  </div>`;
}

function campoLeitura(rotulo, valor, mono = false) {
  return `<div class="campo"><span>${rotulo}</span>
    <input value="${esc(valor == null ? '' : valor)}" disabled class="${mono ? 'mono' : ''}" style="font-family:var(--mono);font-size:11px;"></div>`;
}

/* -------- Modal: criar/editar fonte (RF-090) -------- */
function modalFonte(ctx, conectores, fonte, aoSalvar) {
  const f = fonte || {};
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:17px;">🗄</div>
      <div style="flex:1;">
        <h2>${fonte ? 'Editar fonte de dados' : 'Nova fonte de dados'}</h2>
        <div class="sub">Host/endpoint, porta, base, usuário e credencial editáveis; a credencial é cifrada e nunca exibida em texto claro (RF-090 · RNF-05).</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;">
        <div class="campo"><span>NOME DA FONTE</span><input id="f-nome" value="${esc(f.nome || '')}" placeholder="ex.: ERP Protheus (TOTVS)"></div>
        <div class="campo"><span>ÍCONE</span><input id="f-icone" value="${esc(f.icone || '🗄')}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="campo"><span>CONECTOR (SGBD)</span>
          <select id="f-conector">${conectores.map((c) => `<option value="${c.tipo}" ${f.conector === c.tipo ? 'selected' : ''}>${esc(c.rotulo)}</option>`).join('')}</select>
        </div>
        <div class="campo"><span>RÓTULO DO SGBD (EXIBIÇÃO)</span><input id="f-sgbd" value="${esc(f.sgbdLabel || '')}" placeholder="ex.: Oracle 19c"></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr .7fr 1.3fr;gap:12px;">
        <div class="campo"><span>HOST / ENDPOINT</span><input id="f-host" class="mono" value="${esc(f.host || '')}" placeholder="ex.: protheus-db.cci.local"></div>
        <div class="campo"><span>PORTA</span><input id="f-porta" class="mono" type="number" value="${esc(f.porta || '')}" placeholder="1521"></div>
        <div class="campo"><span>BASE / DATABASE / SERVICE</span><input id="f-base" class="mono" value="${esc(f.base || '')}" placeholder="ex.: PROTHEUSPRD"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="campo"><span>USUÁRIO</span><input id="f-usuario" class="mono" value="${esc(f.usuario || '')}" autocomplete="off"></div>
        <div class="campo"><span>CREDENCIAL ${fonte && f.possuiCredencial ? '(deixe em branco para manter a atual)' : ''}</span>
          <input id="f-credencial" class="mono" type="password" value="" placeholder="${fonte && f.possuiCredencial ? '••••••••  (armazenada cifrada)' : 'senha / token / api-key'}" autocomplete="new-password"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div class="campo"><span>SINCRONIZAÇÃO (RF-093)</span>
          <select id="f-freq">
            <option value="manual" ${f.syncFreq === 'manual' ? 'selected' : ''}>Somente manual</option>
            <option value="15min" ${f.syncFreq === '15min' ? 'selected' : ''}>A cada 15 minutos</option>
            <option value="horaria" ${f.syncFreq === 'horaria' ? 'selected' : ''}>Horária</option>
            <option value="diaria" ${(f.syncFreq || 'diaria') === 'diaria' ? 'selected' : ''}>Diária</option>
          </select>
        </div>
        <div class="campo"><span>HORÁRIO (SE DIÁRIA)</span><input id="f-hora" class="mono" value="${esc(f.syncHora || '06:00')}" placeholder="06:00"></div>
        <div class="campo"><span>AGENDAMENTO</span>
          <select id="f-ativa"><option value="true" ${f.syncAtiva !== false ? 'selected' : ''}>Ativo</option><option value="false" ${f.syncAtiva === false ? 'selected' : ''}>Desativado</option></select>
        </div>
      </div>
      <div class="campo"><span>DESCRIÇÃO / VARIÁVEIS ATENDIDAS</span><input id="f-fontes" value="${esc(f.fontesLabel || '')}" placeholder="ex.: Variáveis 1–4 · SB1 · SG1 · SD1"></div>
    </div>
    <div class="rodape">
      <button class="btn btn-borda" data-m="fechar">Cancelar</button>
      <button class="btn btn-ouro" id="f-salvar">${fonte ? 'Salvar conexão' : 'Criar fonte'}</button>
    </div>`);
  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => b.onclick = ctx.fecharModal);
  wrap.querySelector('#f-salvar').onclick = async () => {
    const corpo = {
      nome: v(wrap, '#f-nome'), icone: v(wrap, '#f-icone'), conector: v(wrap, '#f-conector'),
      sgbdLabel: v(wrap, '#f-sgbd'), host: v(wrap, '#f-host'),
      porta: v(wrap, '#f-porta') ? Number(v(wrap, '#f-porta')) : null,
      base: v(wrap, '#f-base'), usuario: v(wrap, '#f-usuario'),
      credencial: wrap.querySelector('#f-credencial').value || '',
      syncFreq: v(wrap, '#f-freq'), syncHora: v(wrap, '#f-hora'),
      syncAtiva: v(wrap, '#f-ativa') === 'true',
      fontesLabel: v(wrap, '#f-fontes'),
    };
    try {
      if (fonte) await ctx.api.put(`/fontes/${fonte.id}`, corpo);
      else await ctx.api.post('/fontes', corpo);
      ctx.fecharModal();
      ctx.toast('Fonte de dados salva. Use “Testar conexão” para validar (RF-092).', 'ok');
      aoSalvar();
    } catch (err) { ctx.toast(err.message, 'erro'); }
  };
}

/* -------- Modal: mapeamento variável → tabela · campo (RF-091) -------- */
function modalMapeamentos(ctx, fonte, variaveis, somenteLeitura, aoSalvar) {
  let linhas = (fonte.mapeamentos || []).map((m) => ({ ...m }));
  const wrap = ctx.abrirModal('<div></div>');
  const render = () => {
    wrap.querySelector('.modal').innerHTML = `
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--gold-soft);border:1px solid #e6d6b6;display:flex;align-items:center;justify-content:center;font-size:15px;">⇢</div>
      <div style="flex:1;">
        <h2>Mapeamento de dados · ${esc(fonte.nome)}</h2>
        <div class="sub">Cada variável do simulador aponta a tabela e o campo de origem — ex.: SB1.B1_COD, SB1.B1_DESC, SB1.B1_ORIGEM, SD1.D1_CLASFIS (RF-091).</div>
      </div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo" style="max-height:52vh;overflow-y:auto;">
      <div class="mapa-linha" style="border:none;font-size:9.5px;font-weight:700;color:var(--ink-3);letter-spacing:.4px;">
        <div>VARIÁVEL DO SIMULADOR</div><div>TABELA / RECURSO</div><div>CAMPO / COLUNA</div><div></div>
      </div>
      ${linhas.map((m, i) => `
      <div class="mapa-linha">
        <select data-i="${i}" data-c="variavel" ${somenteLeitura ? 'disabled' : ''}>
          ${variaveis.map((vr) => `<option value="${vr.variavel}" ${vr.variavel === m.variavel ? 'selected' : ''}>${esc(vr.variavel)} — ${esc(vr.rotulo)}</option>`).join('')}
        </select>
        <input data-i="${i}" data-c="tabela" value="${esc(m.tabela)}" ${somenteLeitura ? 'disabled' : ''} placeholder="SB1">
        <input data-i="${i}" data-c="campo" value="${esc(m.campo)}" ${somenteLeitura ? 'disabled' : ''} placeholder="B1_COD">
        ${somenteLeitura ? '<span></span>' : `<button class="btn btn-borda btn-mini" data-remover="${i}" style="color:var(--err);padding:2px 8px;">×</button>`}
      </div>`).join('')}
      ${somenteLeitura ? '' : '<button class="btn btn-borda btn-mini" id="m-add" style="margin-top:10px;">＋ Adicionar variável</button>'}
    </div>
    <div class="rodape">
      <span style="font-size:10.5px;color:var(--ink-3);flex:1;text-align:left;">${linhas.length} variável(is) mapeada(s)</span>
      <button class="btn btn-borda" data-m="fechar">${somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
      ${somenteLeitura ? '' : '<button class="btn btn-ouro" id="m-salvar">Salvar mapeamento</button>'}
    </div>`;
    wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => b.onclick = ctx.fecharModal);
    wrap.querySelectorAll('[data-i]').forEach((inp) => inp.addEventListener('change', () => {
      linhas[Number(inp.dataset.i)][inp.dataset.c] = inp.value;
    }));
    wrap.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
      linhas.splice(Number(b.dataset.remover), 1); render();
    }));
    wrap.querySelector('#m-add')?.addEventListener('click', () => {
      const usadas = new Set(linhas.map((l) => l.variavel));
      const proxima = variaveis.find((vr) => !usadas.has(vr.variavel)) || variaveis[0];
      linhas.push({ variavel: proxima.variavel, tabela: proxima.padrao.tabela, campo: proxima.padrao.campo });
      render();
    });
    wrap.querySelector('#m-salvar')?.addEventListener('click', async () => {
      try {
        await ctx.api.put(`/fontes/${fonte.id}/mapeamentos`, { mapeamentos: linhas });
        ctx.fecharModal();
        ctx.toast('Mapeamento salvo (RF-091). Sincronize a fonte para aplicar a carga.', 'ok');
        aoSalvar();
      } catch (err) { ctx.toast(err.message, 'erro'); }
    });
  };
  render();
}

/* -------- Modal: histórico de execuções -------- */
function modalHistorico(ctx, fonte, execucoes) {
  const wrap = ctx.abrirModal(`
    <div class="cabeca">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:15px;">🕓</div>
      <div style="flex:1;"><h2>Execuções de sincronização · ${esc(fonte.nome)}</h2>
      <div class="sub">Rastreabilidade das cargas manual e agendada (RF-093 · RNF-04).</div></div>
      <button class="fechar" data-m="fechar">×</button>
    </div>
    <div class="corpo" style="max-height:56vh;overflow-y:auto;">
      ${execucoes.length ? `<table class="tabela"><thead><tr><th>INÍCIO</th><th>DISPARO</th><th>STATUS</th><th class="num">REGISTROS</th><th>DETALHE</th></tr></thead>
      <tbody>${execucoes.map((e) => `
        <tr>
          <td class="mono" style="font-size:11px;">${dataHora(e.iniciado_em)}</td>
          <td>${e.disparo === 'agendada' ? 'Agendada' : `Manual${e.usuario ? ' · ' + esc(e.usuario) : ''}`}</td>
          <td><span class="chip" style="background:${e.status === 'ok' ? 'var(--ok-bg)' : e.status === 'erro' ? 'var(--err-bg)' : 'var(--line-2)'};color:${e.status === 'ok' ? 'var(--ok-fg)' : e.status === 'erro' ? 'var(--err-fg)' : 'var(--ink-3)'};">${e.status.toUpperCase()}</span></td>
          <td class="num">${e.registros}</td>
          <td style="font-size:11px;color:var(--ink-3);max-width:280px;">${esc(e.mensagem || '')}</td>
        </tr>`).join('')}</tbody></table>` : '<div style="font-size:12px;color:var(--ink-3);">Nenhuma execução registrada ainda.</div>'}
    </div>
    <div class="rodape"><button class="btn btn-borda" data-m="fechar">Fechar</button></div>`);
  wrap.querySelectorAll('[data-m="fechar"]').forEach((b) => b.onclick = ctx.fecharModal);
}

function v(wrap, sel) { return wrap.querySelector(sel).value.trim(); }
