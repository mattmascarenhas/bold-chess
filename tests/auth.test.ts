import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifyToken } from '../server/auth';
import { AuthError } from '../server/types';

const code = (c: string) => (e: unknown) => e instanceof AuthError && e.code === c;
const dev = createVerifyToken({ env: { NODE_ENV: 'development' } });

test('dev: token valido simples e completo', async () => {
  assert.deepEqual(await dev('dev:u1:Ana'), { userId: 'u1', name: 'Ana', avatarUrl: null, accountId: null, workspaceId: null });
  assert.deepEqual(await dev('dev:u_2-x:Bob Silva:acc:ws'), {
    userId: 'u_2-x', name: 'Bob Silva', avatarUrl: null, accountId: 'acc', workspaceId: 'ws',
  });
});

test('dev: tokens invalidos', async () => {
  for (const t of ['', 'dev:', 'dev:u1', 'dev:u1:', 'dev::Ana', 'dev:u 1:Ana', 'dev:u/1:Ana', 'dev:u1:' + 'x'.repeat(41), 'dev:a:b:c:d:e', 'lixo']) {
    await assert.rejects(dev(t), code('invalid_token'), t);
  }
  await assert.rejects(dev('dev:' + 'a'.repeat(65) + ':Ana'), code('invalid_token'));
  await assert.rejects(dev('dev:u1:An\u0001a'), code('invalid_token'));
  await assert.rejects(dev(undefined as unknown as string), code('invalid_token'));
});

test('dev: nome com 40 chars e aceito', async () => {
  assert.equal((await dev('dev:u1:' + 'x'.repeat(40))).name.length, 40);
});

test('dev bloqueado em producao com credenciais', async () => {
  const v = createVerifyToken({ env: { NODE_ENV: 'production', BOLD_CLIENT_ID: 'a', BOLD_CLIENT_SECRET: 'b' } });
  await assert.rejects(v('dev:u1:Ana'), code('invalid_token'));
});

test('dev bloqueado em producao sem credenciais, salvo ALLOW_DEV_AUTH', async () => {
  await assert.rejects(createVerifyToken({ env: { NODE_ENV: 'production' } })('dev:u1:Ana'), code('invalid_token'));
  const ok = createVerifyToken({ env: { NODE_ENV: 'production', ALLOW_DEV_AUTH: '1' } });
  assert.equal((await ok('dev:u1:Ana')).userId, 'u1');
});

test('credenciais em dev: dev: so com ALLOW_DEV_AUTH', async () => {
  const base = { NODE_ENV: 'development', BOLD_CLIENT_ID: 'a', BOLD_CLIENT_SECRET: 'b' };
  await assert.rejects(createVerifyToken({ env: base })('dev:u1:Ana'), code('invalid_token'));
  assert.equal((await createVerifyToken({ env: { ...base, ALLOW_DEV_AUTH: '1' } })('dev:u1:Ana')).userId, 'u1');
});

test('mapeamento do payload SSO', async () => {
  const v = createVerifyToken({
    env: { NODE_ENV: 'production', BOLD_CLIENT_ID: 'a', BOLD_CLIENT_SECRET: 'b' },
    verifier: async () => ({ id: 'U9', name: 'Carla', email: 'c@x.com', accountId: 'A1', workspaceId: 'W1' }),
  });
  assert.deepEqual(await v('jwt'), { userId: 'U9', name: 'Carla', avatarUrl: null, accountId: 'A1', workspaceId: 'W1' });
  const v2 = createVerifyToken({
    env: { NODE_ENV: 'production' },
    verifier: async () => ({ id: 'U9', name: 'Carla', avatarUrl: 'http://img' }),
  });
  assert.equal((await v2('jwt')).avatarUrl, 'http://img');
});

test('mapeamento de erros do SDK', async () => {
  const mk = (err: unknown) =>
    createVerifyToken({ env: { NODE_ENV: 'production' }, verifier: async () => { throw err; } });
  class BoldSSOError extends Error { constructor(m: string, public code: string) { super(m); } }
  class BoldNetworkError extends Error {}
  await assert.rejects(mk(new BoldSSOError('x', 'sso_token_expired'))('t'), code('expired_token'));
  await assert.rejects(mk(new BoldSSOError('Token has expired', 'sso_token_invalid'))('t'), code('expired_token'));
  await assert.rejects(mk(new BoldSSOError('SSO token is invalid or expired.', 'sso_token_invalid'))('t'), code('invalid_token'));
  await assert.rejects(mk(new BoldSSOError('bad', 'sso_token_invalid'))('t'), code('invalid_token'));
  await assert.rejects(mk(new BoldSSOError('http 500', 'sso_verify_failed'))('t'), code('auth_unavailable'));
  await assert.rejects(mk(new BoldNetworkError('down'))('t'), code('auth_unavailable'));
  await assert.rejects(mk(new Error('boom'))('t'), code('auth_unavailable'));
});

test('payload sem id e invalido', async () => {
  const v = createVerifyToken({ env: { NODE_ENV: 'production' }, verifier: async () => ({}) as never });
  await assert.rejects(v('t'), code('invalid_token'));
});

test('token real sem credenciais: modo real ativo (sem auth_unavailable por falta de credencial)', async () => {
  const v = createVerifyToken({
    env: { NODE_ENV: 'production' },
    verifier: async () => ({ id: 'U1', name: 'Ana' }),
  });
  assert.equal((await v('jwt')).userId, 'U1');
});

test('dev: VERCEL sem flag rejeita; com flag aceita; com credenciais rejeita mesmo com flag', async () => {
  await assert.rejects(createVerifyToken({ env: { VERCEL: '1' } })('dev:u1:Ana'), code('invalid_token'));
  assert.equal((await createVerifyToken({ env: { VERCEL: '1', ALLOW_DEV_AUTH: '1' } })('dev:u1:Ana')).userId, 'u1');
  const withCreds = createVerifyToken({ env: { VERCEL: '1', ALLOW_DEV_AUTH: '1', BOLD_CLIENT_ID: 'a', BOLD_CLIENT_SECRET: 'b' } });
  await assert.rejects(withCreds('dev:u1:Ana'), code('invalid_token'));
});

test('sem NODE_ENV/credenciais/VERCEL: dev aceito', async () => {
  assert.equal((await createVerifyToken({ env: {} })('dev:u1:Ana')).userId, 'u1');
});
