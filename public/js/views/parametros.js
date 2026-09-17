import { esc, num, dataHora } from '../format.js';

const CORES_FAIXA = [
  { fg: '#2f6b46', bg: '#e9f1eb' },
  { fg: '#8a5e12', bg: '#f6ecd6' },
  { fg: '#a03d2c', bg: '#f5e5e0' },
];

export async function telaParametros(el, ctx) {
  ctx.definirTopo('Parâmetros mestres',
    'RF-096 MV_FCI e CFOPs · RF-097 alíquotas · RF-098 faixas legais · RF-099 gatilho de reemissão');

  const { parametros, somenteLeitura } = await ctx.api.get('/parametros');
  const motor = parametros.motor ? parametros.motor.valor : { mv: [], versaoFormula: '' };
  const aliquotas = parametros.aliquotas ? [...parametros.aliquotas.valor.lista] : [];
  const faixas = parametros.faixas ? parametros.faixas.valor.lista : [];
  const gatilho = parametros.gatilho_reemissao ? parametros.gatilho_reemissao.valor.pp : 5;
  const moedas = parametros.moedas ? parametros.moedas.valor.lista : [];
  const dis = somenteLeitura ? 'disabled' : '';

  el.innerHTML = `
  <div class="pagina" style="max-width:1180px;display:flex;flex-direction:column;gap:16px;">
    ${somenteLeitura ? '<div class="aviso-restricao" style="margin-bottom:0;">🔒 Edição de parâmetros mestres restrita ao perfil <b>Administrador (TI)</b>. Visualização liberada (RF-100).</div>' : ''}

    <div class="card card-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Faixas legais e fator da cascata <span class="tag-semana">RF-098</span></h3>
        <span style="font-size:11px;color:var(--ink-3);" class="mono">${esc(motor.versaoFormula || '')}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
        ${faixas.map((f, i) => `
          <div class="faixa-card" style="background:${CORES_FAIXA[i].bg};">
            <div class="lim" style="color:${CORES_FAIXA[i].fg};">${esc(f.lim)}</div>
            <div class="classe" style="color:${CORES_FAIXA[i].fg};">${esc(f.classe)}</div>
            <div class="linha" style="color:${CORES_FAIXA[i].fg};">
              <div>Fator cascata <b class="mono">×${String(f.fator).replace('.', ',')}</b></div>
              <div>ICMS <b class="mono">${esc(f.aliq)}</b></div>
            </div>
          </div>`).join('')}
      </div>
      <div class="nota-rodape">Enquadramento conforme RN-05/RN-06/RN-07 · Convênio ICMS 38/2013 e Res. SF 13/2012. CI% &gt; 40% implica alíquota interestadual de 4%.</div>
    </div>

    <div class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">MV_FCIALIQ <span class="tag-semana">RF-097</span></h3>
        <span style="font-size:11px;color:var(--ink-3);">Alíquotas de ICMS aceitas no motor (%)</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;" id="aliq-lista">
        ${aliquotas.map((a, i) => `
          <div class="aliq-chip">
            <input type="number" step="0.5" value="${a}" data-aliq="${i}" ${dis}>
            <span style="color:var(--ink-3);font-size:12px;">%</span>
            <button data-aliq-rm="${i}" ${dis} title="Excluir alíquota">×</button>
          </div>`).join('')}
        ${somenteLeitura ? '' : '<button class="btn btn-mini" id="aliq-add" style="border:1px dashed var(--gold);color:var(--gold-d);background:var(--panel);font-weight:600;">＋</button>'}
        ${somenteLeitura ? '' : '<button class="btn btn-ouro btn-mini" id="aliq-salvar" style="margin-left:8px;">Salvar alíquotas</button>'}
      </div>
    </div>

    <div class="card card-pad" style="display:flex;align-items:center;gap:16px;">
      <div style="flex:1;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Gatilho de reemissão da FCI <span class="tag-semana">RF-099</span></h3>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;">Variação do CI% (p.p.) vs FCI vigente que dispara o alerta de reemissão (RN-08 · padrão 5 p.p.). A alteração reflete imediatamente nos alertas.</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="number" step="0.5" min="0.5" value="${gatilho}" id="inp-gatilho" ${dis}
          style="width:80px;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-family:var(--mono);font-size:16px;font-weight:600;text-align:right;background:var(--panel);">
        <span style="font-size:13px;color:var(--ink-2);font-weight:500;">p.p.</span>
        ${somenteLeitura ? '' : '<button class="btn btn-ouro btn-mini" id="gatilho-salvar">Salvar</button>'}
      </div>
    </div>

    <div class="card" style="overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line-2);">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Parâmetros do motor · MV_FCI <span class="tag-semana">RF-096</span></h3>
        <div style="font-size:11px;color:var(--ink-3);margin-top:2px;">Espelhados dos parâmetros do Protheus (Frutal — Grupo 30): classificações, CFOP de saída interestadual/interna/transferência e NF de complemento — editáveis e persistidos.</div>
      </div>
      ${motor.mv.map((m, i) => `
        <div class="mv-linha">
          <div>
            <div class="id">${esc(m.id)}</div>
            <div class="desc">${esc(m.desc)}</div>
          </div>
          <div>
            ${m.tipo === 'lista'
              ? `<textarea data-mv="${i}" ${dis}>${esc(m.val)}</textarea>`
              : `<input data-mv="${i}" value="${esc(m.val)}" ${dis}>`}
          </div>
        </div>`).join('')}
      ${somenteLeitura ? '' : '<div style="padding:12px 18px;border-top:1px solid var(--line-2);display:flex;justify-content:flex-end;"><button class="btn btn-ouro btn-mini" id="mv-salvar">Salvar parâmetros MV_FCI</button></div>'}
    </div>

    <div class="card card-pad">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;">
        <h3 style="margin:0;font-size:13px;font-weight:600;">Moedas parametrizáveis <span class="tag-semana">BASE S1 · COTAÇÃO POR CENÁRIO S2 (RF-052)</span></h3>
      </div>
      <table class="tabela">
        <thead><tr><th>MOEDA</th><th>NOME</th><th class="num">COTAÇÃO BASE (R$)</th></tr></thead>
        <tbody>${moedas.map((m) => `<tr><td class="mono"><b>${esc(m.codigo)}</b> ${esc(m.simbolo)}</td><td>${esc(m.nome)}</td><td class="num">${num(m.cotacaoBase, 2)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="nota-rodape">Dólar, euro, libra esterlina e franco suíço (decisão E-06), com flexibilidade para novos fornecedores.</div>
    </div>

    <div class="card card-pad">
      <h3 style="margin:0 0 8px;font-size:13px;font-weight:600;">Histórico de alterações <span class="tag-semana">RNF-04</span></h3>
      <div id="param-hist" style="font-size:11.5px;color:var(--ink-3);">Carregando…</div>
    </div>
  </div>`;

  // ---- alíquotas (RF-097): edição local + persistência explícita
  const renderAliquotas = () => {
    const box = el.querySelector('#aliq-lista');
    if (!box) return;
    box.innerHTML = `
      ${aliquotas.map((a, i) => `
        <div class="aliq-chip">
          <input type="number" step="0.5" value="${a}" data-aliq="${i}" ${dis}>
          <span style="color:var(--ink-3);font-size:12px;">%</span>
          <button data-aliq-rm="${i}" ${dis} title="Excluir alíquota">×</button>
        </div>`).join('')}
      ${somenteLeitura ? '' : '<button class="btn btn-mini" id="aliq-add" style="border:1px dashed var(--gold);color:var(--gold-d);background:var(--panel);font-weight:600;">＋</button>'}
      ${somenteLeitura ? '' : '<button class="btn btn-ouro btn-mini" id="aliq-salvar" style="margin-left:8px;">Salvar alíquotas</button>'}`;
    box.querySelectorAll('[data-aliq]').forEach((inp) => inp.addEventListener('change', () => {
      aliquotas[Number(inp.dataset.aliq)] = Number(inp.value);
    }));
    box.querySelectorAll('[data-aliq-rm]').forEach((b) => b.addEventListener('click', () => {
      aliquotas.splice(Number(b.dataset.aliqRm), 1);
      renderAliquotas();
    }));
    box.querySelector('#aliq-add')?.addEventListener('click', () => {
      aliquotas.push(0);
      renderAliquotas();
    });
    box.querySelector('#aliq-salvar')?.addEventListener('click', async () => {
      try {
        await ctx.api.put('/parametros/aliquotas', { valor: { lista: aliquotas.map(Number).filter((n) => Number.isFinite(n)) } });
        ctx.toast('Relação de alíquotas atualizada (RF-097).', 'ok');
        telaParametros(el, ctx);
      } catch (err) { ctx.toast(err.message, 'erro'); }
    });
  };
  renderAliquotas();

  // ---- gatilho (RF-099)
  el.querySelector('#gatilho-salvar')?.addEventListener('click', async () => {
    try {
      const pp = Number(el.querySelector('#inp-gatilho').value);
      await ctx.api.put('/parametros/gatilho_reemissao', { valor: { pp } });
      ctx.toast(`Gatilho de reemissão atualizado para ${num(pp, 1)} p.p. — os alertas passam a refletir o novo limite (RF-099).`, 'ok');
      telaParametros(el, ctx);
    } catch (err) { ctx.toast(err.message, 'erro'); }
  });

  // ---- MV_FCI (RF-096)
  el.querySelectorAll('[data-mv]').forEach((inp) => inp.addEventListener('change', () => {
    motor.mv[Number(inp.dataset.mv)].val = inp.value;
  }));
  el.querySelector('#mv-salvar')?.addEventListener('click', async () => {
    try {
      await ctx.api.put('/parametros/motor', { valor: motor });
      ctx.toast('Parâmetros MV_FCI persistidos (RF-096).', 'ok');
      telaParametros(el, ctx);
    } catch (err) { ctx.toast(err.message, 'erro'); }
  });

  // ---- histórico
  carregarHistorico(el, ctx);
}

async function carregarHistorico(el, ctx) {
  const alvo = el.querySelector('#param-hist');
  if (!alvo) return;
  try {
    const chaves = ['gatilho_reemissao', 'aliquotas', 'motor', 'faixas'];
    const listas = await Promise.all(chaves.map((c) => ctx.api.get(`/parametros/${c}/historico`).then((r) => r.historico.map((h) => ({ ...h, chave: c })))));
    const todos = listas.flat().sort((a, b) => new Date(b.registrado_em) - new Date(a.registrado_em)).slice(0, 8);
    alvo.innerHTML = todos.length
      ? todos.map((h) => `<div style="padding:5px 0;border-top:1px solid var(--line-2);">
          <b class="mono" style="color:var(--gold-d);">${esc(h.chave)}</b> alterado por <b>${esc(h.usuario || 'sistema')}</b> em ${dataHora(h.registrado_em)}
        </div>`).join('')
      : 'Nenhuma alteração registrada desde a carga inicial.';
  } catch {
    alvo.textContent = 'Histórico indisponível.';
  }
}
