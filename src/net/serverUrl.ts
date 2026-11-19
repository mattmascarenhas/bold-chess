// URL do servidor do jogo (WebSocket + API). Em dev/producao com servidor na mesma origem
// nao precisa configurar. Quando o frontend e hospedado separado (ex.: Vercel) e o servidor
// em outro host, defina VITE_SERVER_URL=https://seu-servidor.exemplo.com
function base(): string {
  const raw = (import.meta.env?.VITE_SERVER_URL as string | undefined)?.trim();
  return raw ? raw.replace(/\/+$/, '') : '';
}

/** Base HTTP do servidor (polling). Vazio => mesma origem. */
export function httpBase(): string {
  return base();
}

export function apiUrl(path: string): string {
  return `${base()}${path}`;
}

export function wsUrl(): string {
  const b = base();
  if (b) return `${b.replace(/^http/i, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
