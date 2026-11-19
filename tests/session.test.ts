import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionError, signSession, verifySession } from '../server/serverless/session';

const me = { userId: 'u1', name: 'Ana', avatarUrl: null, accountId: 'a', workspaceId: null };
const S = 'segredo-de-teste';
const code = (c: string) => (e: unknown) => e instanceof SessionError && e.code === c;

test('assina e verifica; devolve a identidade', () => {
  const { token, expiresAt } = signSession(me, S, 1000, 5000);
  assert.equal(expiresAt, 6000);
  assert.deepEqual(verifySession(token, S, 5500), me);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('expirada', () => {
  const { token } = signSession(me, S, 1000, 5000);
  assert.throws(() => verifySession(token, S, 6000), code('expired_session'));
});

test('segredo errado, adulteracao e lixo => invalid_session', () => {
  const { token } = signSession(me, S, 1000, 5000);
  assert.throws(() => verifySession(token, 'outro', 5100), code('invalid_session'));
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...me, userId: 'admin', exp: 9e15 })).toString('base64url');
  assert.throws(() => verifySession(`${forged}.${sig}`, S, 5100), code('invalid_session'));
  assert.throws(() => verifySession(`${body}.${sig.slice(0, -2)}AA`, S, 5100), code('invalid_session'));
  for (const t of ['', 'a', 'a.b.c', '.', 'x.y', undefined as unknown as string]) {
    assert.throws(() => verifySession(t, S, 5100), code('invalid_session'), String(t));
  }
});
