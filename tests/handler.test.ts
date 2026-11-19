import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../server/serverless/handler';
import { signSession } from '../server/serverless/session';
import { createMemoryStore } from '../server/store';
import { AuthError } from '../server/types';
import type { Game } from '../server/serverless/game';

const SECRET = 'segredo';
const idn = (id: string) => ({ userId: id, name: id, avatarUrl: null, accountId: 'ACC', workspaceId: 'WS' });
const POS = { roomId: null, sv: 0, pv: 0, cursor: 0 };

const calls: any[] = [];
const game = {
  async login(me: any) { calls.push(['login', me]); return { resumeRoomId: 'r1' }; },
  async send(me: any, msg: any, pos: any) { calls.push(['send', me, msg, pos]); return { messages: [{ type: 'pong' }], pos }; },
  async poll(me: any, pos: any, active: any) { calls.push(['poll', me, pos, active]); return { messages: [], pos }; },
} as unknown as Game;

const store = createMemoryStore();
let now = 1_000_000;
let server: http.Server;
let base = '';

before(async () => {
  await store.recordMatch({
    id: 'm1', roomId: 'r', white: idn('w1'), black: idn('b1'), result: 'w', reason: 'checkmate',
    moves: 20, counted: true, whiteDelta: 10, blackDelta: -5, endedAt: 1,
  });
  const h = createHandler({
    game,
    store,
    sessionSecret: SECRET,
    now: () => now,
    verifyToken: async (t) => {
      if (t === 'bad') throw new AuthError('invalid_token');
      if (t === 'exp') throw new AuthError('expired_token');
      if (t === 'down') throw new AuthError('auth_unavailable');
      if (t === 'boom') throw new Error('segredo interno stack');
      return idn('u1');
    },
    audioManifest: () => ({ files: ['a.mp3'], config: null }),
    authLimitPerMin: 5,
  });
  server = http.createServer((q, r) => void h(q, r));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown, headers: Record<string, string> = {}, raw = false) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
const bearer = () => ({ authorization: `Bearer ${signSession(idn('u1'), SECRET, 60_000, now).token}` });

test('auth ok devolve sessao valida e resume', async () => {
  const r = await post('/api/auth', { ssoToken: 'good' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const j: any = await r.json();
  assert.equal(j.me.userId, 'u1');
  assert.equal(j.resumeRoomId, 'r1');
  assert.equal(j.expiresAt, now + 6 * 3600_000);
  assert.deepEqual(j.pollMs, { game: 1000, lobby: 2000, idle: 8000 });
  assert.ok(typeof j.session === 'string');
});

test('auth: erros mapeados', async () => {
  let r = await post('/api/auth', { ssoToken: 'bad' });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'invalid_token' });
  r = await post('/api/auth', { ssoToken: 'exp' });
  assert.deepEqual(await r.json(), { error: 'expired_token' });
  r = await post('/api/auth', { ssoToken: 'down' });
  assert.equal(r.status, 503);
  r = await post('/api/auth', {});
  assert.equal(r.status, 400);
});

test('erro interno => 500 sem vazar detalhes', async () => {
  now += 120_000;
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await post('/api/auth', { ssoToken: 'boom' });
    assert.equal(r.status, 500);
    const t = await r.text();
    assert.deepEqual(JSON.parse(t), { error: 'internal_error' });
    assert.ok(!t.includes('segredo'));
  } finally {
    console.error = orig;
  }
});

test('401 sem sessao, invalida e expirada', async () => {
  let r = await post('/api/poll', { pos: POS });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'invalid_session' });
  r = await post('/api/send', { msg: { type: 'ping' }, pos: POS }, { authorization: 'Bearer lixo' });
  assert.equal(r.status, 401);
  const old = signSession(idn('u1'), SECRET, 10, now - 1000).token;
  r = await post('/api/poll', { pos: POS }, { authorization: `Bearer ${old}` });
  assert.deepEqual(await r.json(), { error: 'expired_session' });
});

test('send/poll usam a identidade da sessao, nao a do corpo', async () => {
  calls.length = 0;
  let r = await post('/api/send', { msg: { type: 'ping' }, pos: POS, me: idn('hacker'), userId: 'hacker' }, bearer());
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as any).messages, [{ type: 'pong' }]);
  r = await post('/api/poll', { pos: { ...POS, cursor: 3 }, active: false, me: idn('hacker') }, bearer());
  assert.equal(r.status, 200);
  assert.equal(calls[0][0], 'send');
  assert.equal(calls[0][1].userId, 'u1');
  assert.deepEqual(calls[0][2], { type: 'ping' });
  assert.equal(calls[1][0], 'poll');
  assert.equal(calls[1][1].userId, 'u1');
  assert.equal(calls[1][2].cursor, 3);
  assert.equal(calls[1][3], false);
});

test('validacoes de corpo', async () => {
  const bad: [string, unknown][] = [
    ['/api/send', { pos: POS }],
    ['/api/send', { msg: { type: 5 }, pos: POS }],
    ['/api/send', { msg: { type: 'auth' }, pos: POS }],
    ['/api/send', { msg: { type: 'ping' } }],
    ['/api/poll', { pos: { roomId: 5, sv: 0, pv: 0, cursor: 0 } }],
    ['/api/poll', { pos: { roomId: null, sv: -1, pv: 0, cursor: 0 } }],
    ['/api/poll', { pos: { roomId: null, sv: 'x', pv: 0, cursor: 0 } }],
    ['/api/poll', []],
  ];
  for (const [p, b] of bad) assert.equal((await post(p, b, bearer())).status, 400, JSON.stringify(b));
  assert.equal((await post('/api/poll', '{nao json', bearer(), true)).status, 400);
  assert.equal((await post('/api/poll', { pos: POS, x: 'a'.repeat(40_000) }, bearer())).status, 413);
  const r = await fetch(base + '/api/poll', { method: 'POST', headers: { ...bearer(), 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
});

test('rate limit no /api/auth', async () => {
  now += 120_000; // nova janela
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) statuses.push((await post('/api/auth', { ssoToken: 'good' })).status);
  assert.equal(statuses.filter((s) => s === 429).length, 3);
  now += 120_000;
});

test('leaderboard: formatos, limites e sem accountId', async () => {
  let r = await fetch(base + '/api/matches/recent?limit=5');
  const j: any = await r.json();
  assert.equal(j.matches.length, 1);
  assert.deepEqual(Object.keys(j.matches[0].white).sort(), ['avatarUrl', 'name', 'userId']);
  assert.ok(!JSON.stringify(j).includes('ACC'));
  assert.ok(!JSON.stringify(j).includes('accountId'));
  r = await fetch(base + '/api/leaderboard?limit=10');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(((await r.json()) as any).entries));
  for (const q of ['limit=0', 'limit=101', 'limit=abc']) {
    assert.equal((await fetch(base + '/api/leaderboard?' + q)).status, 400);
    assert.equal((await fetch(base + '/api/matches/recent?' + q)).status, 400);
  }
  r = await fetch(base + '/api/leaderboard/me?userId=w1');
  const me: any = await r.json();
  assert.equal(me.rank, 1);
  assert.equal(me.stats.userId, 'w1');
  assert.equal((await fetch(base + '/api/leaderboard/me')).status, 400);
});

test('audio-manifest', async () => {
  const r = await fetch(base + '/api/audio-manifest');
  assert.deepEqual(await r.json(), { files: ['a.mp3'], config: null });
});

test('CORS/OPTIONS, 404, 405 e roteamento via __p', async () => {
  let r = await fetch(base + '/api/poll', { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-headers') ?? '', /Authorization/i);
  assert.equal((await fetch(base + '/api/nada')).status, 404);
  assert.equal((await fetch(base + '/outra')).status, 404);
  assert.equal((await fetch(base + '/api/auth')).status, 405);
  assert.equal((await fetch(base + '/api/send')).status, 405);
  assert.equal((await post('/api/leaderboard', {})).status, 405);
  r = await fetch(base + '/api/game?__p=leaderboard&limit=3');
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + '/api/game')).status, 404);
});
