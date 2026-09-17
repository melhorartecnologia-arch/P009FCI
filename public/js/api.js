/** Cliente da API do Simulador FCI. */
const CHAVE_TOKEN = 'fci.token';
const CHAVE_USUARIO = 'fci.usuario';

export function tokenAtual() { return localStorage.getItem(CHAVE_TOKEN) || ''; }
export function usuarioAtual() {
  try { return JSON.parse(localStorage.getItem(CHAVE_USUARIO) || 'null'); }
  catch { return null; }
}
export function guardarSessao(token, usuario) {
  localStorage.setItem(CHAVE_TOKEN, token);
  localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario));
}
export function limparSessao() {
  localStorage.removeItem(CHAVE_TOKEN);
  localStorage.removeItem(CHAVE_USUARIO);
}

export class ErroApi extends Error {
  constructor(mensagem, status, corpo) {
    super(mensagem);
    this.status = status;
    this.corpo = corpo;
  }
}

async function requisicao(metodo, caminho, corpo) {
  const opts = { method: metodo, headers: {} };
  const token = tokenAtual();
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(corpo);
  }
  const resp = await fetch(`/api${caminho}`, opts);
  let json = null;
  try { json = await resp.json(); } catch { /* corpo vazio */ }
  if (!resp.ok) {
    if (resp.status === 401 && caminho !== '/auth/login') {
      limparSessao();
      window.location.hash = '#/login';
    }
    throw new ErroApi((json && json.erro) || `Erro ${resp.status}`, resp.status, json);
  }
  return json;
}

export const api = {
  get: (c) => requisicao('GET', c),
  post: (c, corpo) => requisicao('POST', c, corpo),
  put: (c, corpo) => requisicao('PUT', c, corpo),
  del: (c) => requisicao('DELETE', c),
};
