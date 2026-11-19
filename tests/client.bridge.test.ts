import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEV_ID_STORAGE_KEY,
  buildDevToken,
  decideAuthMode,
  detectEmbedded,
  isDevAuthAllowed,
  resolveDevIdentity,
} from '../src/workspace/devAuth';

function memStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

test('buildDevToken monta dev:<id>:<nome> e remove ":"', () => {
  assert.equal(buildDevToken('ana', 'Ana Silva'), 'dev:ana:Ana Silva');
  assert.equal(buildDevToken('a:b', 'Jo:ao'), 'dev:ab:Joao');
  assert.equal(buildDevToken('x', ''), 'dev:x:Jogador');
});

test('resolveDevIdentity usa devUser/devName da URL', () => {
  const r = resolveDevIdentity({ search: '?devUser=42&devName=Bia', storage: memStorage() });
  assert.deepEqual(r, { userId: '42', name: 'Bia' });
});

test('resolveDevIdentity gera id aleatorio persistido e nome padrao', () => {
  const st = memStorage();
  const r1 = resolveDevIdentity({ search: '', storage: st, rand: () => 0.5 });
  assert.equal(r1.name, 'Jogador');
  assert.equal(st.data[DEV_ID_STORAGE_KEY], r1.userId);
  const r2 = resolveDevIdentity({ search: '', storage: st, rand: () => 0.9 });
  assert.equal(r2.userId, r1.userId);
});

test('resolveDevIdentity tolera storage que lanca erro', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const r = resolveDevIdentity({ search: '', storage: broken });
  assert.ok(r.userId.length > 3);
  const none = resolveDevIdentity({ search: '', storage: null });
  assert.ok(none.userId.length > 3);
});

test('decisao de modo: embutido, dev ou login', () => {
  assert.equal(decideAuthMode(true, false), 'embedded');
  assert.equal(decideAuthMode(true, true), 'embedded');
  assert.equal(decideAuthMode(false, true), 'dev');
  assert.equal(decideAuthMode(false, false), 'login');
});

test('isDevAuthAllowed: DEV ou VITE_ALLOW_DEV_AUTH=1', () => {
  assert.equal(isDevAuthAllowed({ DEV: true }), true);
  assert.equal(isDevAuthAllowed({ VITE_ALLOW_DEV_AUTH: '1' }), true);
  assert.equal(isDevAuthAllowed({ DEV: false, VITE_ALLOW_DEV_AUTH: '0' }), false);
  assert.equal(isDevAuthAllowed(undefined), false);
});

test('detectEmbedded: self !== top, ou excecao cross-origin', () => {
  const a = {};
  assert.equal(detectEmbedded({ self: a, top: a }), false);
  assert.equal(detectEmbedded({ self: a, top: {} }), true);
  const throwing = {
    self: {},
    get top(): unknown {
      throw new Error('cross-origin');
    },
  };
  assert.equal(detectEmbedded(throwing), true);
  assert.equal(detectEmbedded(undefined), false);
});
