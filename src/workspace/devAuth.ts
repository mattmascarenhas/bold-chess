// Logica pura (sem SDK/DOM pesado) do modo dev e da deteccao de ambiente.
import { DEV_TOKEN_PREFIX } from '../shared/protocol';

export const DEV_ID_STORAGE_KEY = 'bold-chess:devUserId';
export const DEFAULT_DEV_NAME = 'Jogador';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Remove ':' e caracteres de controle, pois o token dev usa ':' como separador. */
export function sanitizeDevField(value: string, max = 40): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === ':' || code < 32) continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}

export function buildDevToken(userId: string, name: string): string {
  const id = sanitizeDevField(userId, 64) || 'anon';
  const nm = sanitizeDevField(name) || DEFAULT_DEV_NAME;
  return `${DEV_TOKEN_PREFIX}${id}:${nm}`;
}

export function randomDevId(rand: () => number = Math.random): string {
  let s = '';
  while (s.length < 8) s += Math.floor(rand() * 36).toString(36);
  return `u${s}`;
}

export interface DevIdentityInput {
  search: string;
  storage?: KeyValueStorage | null;
  rand?: () => number;
}

/** ?devUser=ID&devName=NOME; sem devUser usa id aleatorio persistido (se o storage existir). */
export function resolveDevIdentity(input: DevIdentityInput): { userId: string; name: string } {
  const params = new URLSearchParams(input.search);
  const name = sanitizeDevField(params.get('devName') ?? '') || DEFAULT_DEV_NAME;
  const fromUrl = sanitizeDevField(params.get('devUser') ?? '', 64);
  if (fromUrl) return { userId: fromUrl, name };

  let stored: string | null = null;
  try {
    stored = input.storage?.getItem(DEV_ID_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored) return { userId: stored, name };
  const fresh = randomDevId(input.rand);
  try {
    input.storage?.setItem(DEV_ID_STORAGE_KEY, fresh);
  } catch {
    /* storage indisponivel: id vale so para esta sessao */
  }
  return { userId: fresh, name };
}

export function isDevAuthAllowed(
  env: { DEV?: boolean; VITE_ALLOW_DEV_AUTH?: string } | undefined
): boolean {
  return Boolean(env?.DEV) || env?.VITE_ALLOW_DEV_AUTH === '1';
}

export type AuthMode = 'embedded' | 'dev' | 'login';

export function decideAuthMode(embedded: boolean, devAllowed: boolean): AuthMode {
  if (embedded) return 'embedded';
  return devAllowed ? 'dev' : 'login';
}

export function detectEmbedded(win: { self: unknown; top: unknown } | undefined): boolean {
  if (!win) return false;
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}
