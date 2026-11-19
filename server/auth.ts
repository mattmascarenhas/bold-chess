// Verificacao de identidade: SSO do Bold Workspace (real) ou token dev local.
import { BoldIframeSSOToken } from '@bold-workspace/sdk/sso';
import { DEV_TOKEN_PREFIX, type PlayerIdentity } from '../src/shared/protocol';
import { AuthError, type VerifyToken } from './types';

export interface SsoPayload {
  id: string;
  name: string;
  email?: string;
  accountId?: string | null;
  workspaceId?: string | null;
  avatarUrl?: string | null;
  avatar?: string | null;
  [k: string]: unknown;
}

export interface VerifyTokenOptions {
  /** Sobrescreve process.env (testes). */
  env?: Record<string, string | undefined>;
  /** Verificador injetavel (testes sem rede). */
  verifier?: (token: string) => Promise<SsoPayload>;
}

const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 40;

function parseDevToken(token: string): PlayerIdentity {
  const parts = token.slice(DEV_TOKEN_PREFIX.length).split(':');
  const [userId = '', name = '', accountId = '', workspaceId = ''] = parts;
  if (parts.length > 4) throw new AuthError('invalid_token');
  const n = name.trim();
  if (!USER_ID_RE.test(userId) || !n || n.length > MAX_NAME) throw new AuthError('invalid_token');
  if (/[\u0000-\u001f\u007f]/.test(n)) throw new AuthError('invalid_token');
  return {
    userId,
    name: n,
    avatarUrl: null,
    accountId: accountId || null,
    workspaceId: workspaceId || null,
  };
}

function mapSdkError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  const e = err as { code?: unknown; message?: unknown; constructor?: { name?: string } } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  const ctor = e?.constructor?.name ?? '';
  if (ctor === 'BoldNetworkError') return new AuthError('auth_unavailable');
  if (/expired/i.test(code)) return new AuthError('expired_token');
  if (code === 'sso_verify_failed') return new AuthError('auth_unavailable');
  if (code === 'sso_token_missing' || code === 'sso_token_invalid' || ctor === 'BoldSSOError') {
    // mensagem padrao do SDK ("invalid or expired") e ambigua: trata como invalida
    if (/expired/i.test(message) && !/invalid or expired/i.test(message)) return new AuthError('expired_token');
    return new AuthError('invalid_token');
  }
  return new AuthError('auth_unavailable');
}

function mapPayload(p: SsoPayload): PlayerIdentity {
  if (!p || typeof p.id !== 'string' || !p.id) throw new AuthError('invalid_token');
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id;
  const avatar = p.avatarUrl ?? p.avatar ?? null;
  return {
    userId: p.id,
    name,
    avatarUrl: typeof avatar === 'string' && avatar ? avatar : null,
    accountId: p.accountId ?? null,
    workspaceId: p.workspaceId ?? null,
  };
}

export function createVerifyToken(opts: VerifyTokenOptions = {}): VerifyToken {
  const env = opts.env ?? process.env;
  // Credenciais sao OPCIONAIS: o modo real fica sempre ativo e so envia o que existir.
  const clientId = env.BOLD_CLIENT_ID || undefined;
  const clientSecret = env.BOLD_CLIENT_SECRET || undefined;
  const hasCreds = !!(clientId && clientSecret);
  const prodLike = env.NODE_ENV === 'production' || !!env.VERCEL;
  const allowDevFlag = env.ALLOW_DEV_AUTH === '1';
  // Tokens `dev:` (identidade sem verificacao):
  // - producao/Vercel COM credenciais reais: nunca, mesmo com ALLOW_DEV_AUTH=1 (seguranca);
  // - ALLOW_DEV_AUTH=1 explicito: aceito (dev/E2E/preview sem credenciais);
  // - sem flag: so fora de producao/Vercel e sem credenciais reais.
  const devEnabled = prodLike && hasCreds ? false : allowDevFlag || (!prodLike && !hasCreds);

  let verifier = opts.verifier;
  let sso: BoldIframeSSOToken | null = null;
  if (!verifier) {
    verifier = (t) => {
      sso ??= new BoldIframeSSOToken({
        boldBaseUrl: env.BOLD_BASE_URL || 'https://app.boldworkspace.com.br',
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      } as never);
      return sso.verify(t) as unknown as Promise<SsoPayload>;
    };
  }

  return async (token: string): Promise<PlayerIdentity> => {
    if (typeof token !== 'string' || !token || token.length > 4096) throw new AuthError('invalid_token');
    if (token.startsWith(DEV_TOKEN_PREFIX)) {
      if (!devEnabled) throw new AuthError('invalid_token');
      return parseDevToken(token);
    }
    let payload: SsoPayload;
    try {
      payload = await verifier!(token);
    } catch (err) {
      throw mapSdkError(err);
    }
    return mapPayload(payload);
  };
}

export const verifyToken: VerifyToken = createVerifyToken();
