import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifyToken } from '../server/auth';
import { createMemoryStore } from '../server/store';
import { createInitialState, resolveConvocation } from '../src/game/engine';

const idn = (id: string) => ({ userId: id, name: id, avatarUrl: null, accountId: null, workspaceId: null });

test('producao + credenciais reais + ALLOW_DEV_AUTH=1 NAO aceita token dev', async () => {
  const v = createVerifyToken({
    env: { NODE_ENV: 'production', BOLD_CLIENT_ID: 'x', BOLD_CLIENT_SECRET: 'y', ALLOW_DEV_AUTH: '1' } as any,
    verifier: async () => { throw new Error('invalid'); },
  });
  await assert.rejects(() => v('dev:vitima:Fulano'));
});

test('producao sem credenciais e sem flag nao aceita token dev', async () => {
  const v = createVerifyToken({ env: { NODE_ENV: 'production' } as any });
  await assert.rejects(() => v('dev:a:b'));
});

test('promocao na 8a fileira so aceita q/r/b/n', () => {
  const s = createInitialState(true);
  s.board[0][0] = { kind: 'p', color: 'w' } as any;
  s.pendingConvocation = { color: 'w', pos: { row: 0, col: 0 }, isLastRank: true, availableSpecials: [] } as any;
  for (const bad of ['k', 'x', 'p']) {
    const r = resolveConvocation(s, bad as any);
    assert.equal(r, s, `deve rejeitar ${bad}`);
  }
  assert.notEqual(resolveConvocation(s, 'q'), s);
});

test('userId __proto__ nao polui Object.prototype no store', async () => {
  const store = createMemoryStore();
  await store.recordMatch({
    id: 'm1', roomId: 'R', white: idn('__proto__'), black: idn('b'), result: 'w', reason: 'resign',
    moves: 12, counted: true, whiteDelta: 30, blackDelta: 10, endedAt: Date.now(),
  });
  assert.equal(({} as any).points, undefined);
  assert.equal((await store.getStats('b'))?.points, 10);
});
