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
