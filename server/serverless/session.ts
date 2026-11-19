// Sessao propria (stateless) assinada com HMAC-SHA256: base64url(payload).base64url(hmac).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlayerIdentity } from '../../src/shared/protocol';
import { SESSION_TTL_MS } from '../../src/shared/http-protocol';

export class SessionError extends Error {
  constructor(public code: 'invalid_session' | 'expired_session') {
    super(code);
  }
}

interface Payload {
  userId: string;
  name: string;
  avatarUrl: string | null;
  accountId: string | null;
  workspaceId: string | null;
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest();

export function signSession(
  identity: PlayerIdentity,
  secret: string,
  ttlMs: number = SESSION_TTL_MS,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  if (!secret) throw new Error('session secret ausente');
  const expiresAt = now + ttlMs;
  const payload: Payload = {
    userId: identity.userId,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    accountId: identity.accountId,
    workspaceId: identity.workspaceId,
    exp: expiresAt,
  };
  const body = b64(JSON.stringify(payload));
  return { token: `${body}.${b64(mac(body, secret))}`, expiresAt };
}

export function verifySession(token: string, secret: string, now: number = Date.now()): PlayerIdentity {
  if (typeof token !== 'string' || token.length > 4096 || !secret) throw new SessionError('invalid_session');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new SessionError('invalid_session');
  const [body, sig] = parts;
  const given = Buffer.from(sig, 'base64url');
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new SessionError('invalid_session');
  let p: Partial<Payload>;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new SessionError('invalid_session');
  }
  if (!p || typeof p.userId !== 'string' || !p.userId || typeof p.name !== 'string' || typeof p.exp !== 'number') {
    throw new SessionError('invalid_session');
  }
  if (now >= p.exp) throw new SessionError('expired_session');
  return {
    userId: p.userId,
    name: p.name,
    avatarUrl: typeof p.avatarUrl === 'string' ? p.avatarUrl : null,
    accountId: typeof p.accountId === 'string' ? p.accountId : null,
    workspaceId: typeof p.workspaceId === 'string' ? p.workspaceId : null,
  };
}
