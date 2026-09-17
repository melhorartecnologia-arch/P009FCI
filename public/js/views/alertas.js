import { esc, num, pct } from '../format.js';
import { alertasCenario, resultadoProduto } from '../engine.js';

export async function telaAlertas(el, ctx) {
  ctx.definirTopo('Alertas', 'Gatilho de reemissão parametrizável (RF-099 · S1) — alertas completos na entrega S6 (RF-083 a RF-086)');

  const [{ cenarios }, { parametros }] = await Promise.all([
    ctx.api.get('/cenarios'),
    ctx.api.get('/parametros'),
  ]);
  const gatilho = (parametros.gatilho_reemissao && parametros.gatilho_reemissao.valor.pp) || 5;

  const opcoes = cenarios.map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`).join('');
  const cenario = cenarios[0];
  const render = (cen) => {
    const alertas = cen ? alertasCenario(cen.dados || {}, gatilho) : [];
    ctx.definirAlertas(alertas.length);
    const corpo = el.querySelector('#alertas-corpo');
    if (!corpo) return;
    corpo.innerHTML = alertas.length ? alertas.map((a) => {
      const r = resultadoProduto(cen.dados, a.produto.id);
      const cor = a.sev === 'erro' ? { bg: 'var(--err-bg)', fg: 'var(--err-fg)', bd: '#e0a898' } : { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', bd: '#e3cfa4' };
      const icone = a.tipo === 'reemissao' ? '🔁' : a.tipo === 'faixa' ? '⇅' : '⚖';
      return `
      <div style="background:${cor.bg};border:1px solid ${cor.bd};border-radius:10px;padding:13px 16px;display:flex;gap:13px;align-items:flex-start;">
        <span style="font-size:16px;">${icone}</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:12.5px;color:${cor.fg};">${esc(a.produto.sku)} · ${esc(a.produto.nome)} — CI% atual ${pct(r.ci)}</div>
          <div style="font-size:12px;color:${cor.fg};margin-top:3px;line-height:1.5;">${esc(a.msg)}</div>
          <div style="font-size:10.5px;color:${cor.fg};opacity:.8;margin-top:5px;">Área responsável pelo tratamento: <b>${esc(a.area)}</b> (RF-086 · S6)</div>
        </div>
      </div>`;
    }).join('') : `
      <div class="roadmap-box">
        <div class="titulo">Nenhum alerta para o gatilho de ${num(gatilho, 1)} p.p.</div>
        Alerta de mudança de faixa, reemissão da FCI, risco fiscal acima de 40% e encaminhamento por área são entregues na S6 (19–21/10). Esta prévia já reflete o gatilho parametrizado na S1 (RF-099).
      </div>`;
  };

  el.innerHTML = `
  <div class="pagina" style="max-width:1000px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
      <div class="campo" style="min-width:320px;"><span>CENÁRIO</span><select id="sel-cen">${opcoes}</select></div>
      <div style="flex:1;"></div>
      <span style="font-size:11.5px;color:var(--ink-3);">Gatilho de reemissão vigente: <b class="mono" style="color:var(--ink-2);">${num(gatilho, 1)} p.p.</b> · <a href="#/parametros">ajustar</a></span>
    </div>
    <div id="alertas-corpo" style="display:flex;flex-direction:column;gap:10px;"></div>
    <div class="nota-rodape">Prévia gerencial sem validade fiscal (RN-12). O conjunto completo de alertas — faixa, reemissão, risco fiscal e encaminhamento — é entrega da Semana 6 (RF-083 a RF-086).</div>
  </div>`;

  render(cenario);
  el.querySelector('#sel-cen')?.addEventListener('change', (e) => {
    render(cenarios.find((c) => String(c.id) === e.target.value));
  });
}
