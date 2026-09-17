import { esc, pct } from '../format.js';
import { resumoCenario } from '../engine.js';

export async function telaComparacao(el, ctx) {
  ctx.definirTopo('Comparação de cenários', 'Entrega S6 · 19–23/10 (RF-073 a RF-079) — prévia com CI% médio por cenário');

  const { cenarios } = await ctx.api.get('/cenarios');
  const linhas = cenarios.slice(0, 10).map((c) => {
    const r = resumoCenario(c.dados || {});
    return { c, r };
  });

  el.innerHTML = `
  <div class="pagina" style="max-width:1100px;">
    <div class="card card-pad" style="margin-bottom:16px;">
      <h3 style="margin:0 0 10px;font-size:13px;font-weight:600;">CI% médio ponderado por cenário <span class="tag-semana">PRÉVIA</span></h3>
      <table class="tabela">
        <thead><tr><th>CENÁRIO</th><th>STATUS</th><th class="num">PRODUTOS</th><th class="num">&gt; 40%</th><th class="num">CI% MÉDIO</th></tr></thead>
        <tbody>
          ${linhas.map(({ c, r }) => `
          <tr>
            <td><b>${esc(c.codigo)}</b> · ${esc(c.nome)} <span style="color:var(--ink-3);">v${c.versao}</span></td>
            <td>${esc(c.status)}</td>
            <td class="num">${r.nProdutos}</td>
            <td class="num" style="color:${r.acima40 ? 'var(--err)' : 'inherit'};">${r.acima40}</td>
            <td class="num" style="font-weight:700;color:${r.ciMedio > 40 ? 'var(--err)' : 'var(--ok-fg)'};">${pct(r.ciMedio)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="nota-rodape">Limite de dez cenários simultâneos na comparação (RF-073 · decisão E-13).</div>
    </div>
    <div class="roadmap-box">
      <div class="titulo">Matriz comparativa completa — entrega Semana 6 (19–23/10)</div>
      <div style="max-width:680px;margin:0 auto 8px;">
        Matriz de CI% por produto × cenário com faixa por cor e amplitude em p.p. (RF-074) ·
        drill-down até o insumo (RF-075) · grau de impacto em p.p. (RF-076) ·
        sensibilidade entre cenários (RF-077) · edição sem sair da comparação (RF-078) ·
        recálculo ao vivo da matriz (RF-079) · análise assistida por conversa (RF-080 a RF-082).
      </div>
      <span class="tag-semana">RC-006 · RC-007 · RC-008 · RC-017</span>
    </div>
  </div>`;
}
