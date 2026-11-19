import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { LeaderboardEntry, PlayerIdentity } from '../src/shared/protocol';
import type { MatchRecord, PlayerStats, Store } from '../server/types';
import { createLeaderboard, registerLeaderboardRoutes } from '../server/leaderboard';

function ident(id: string): PlayerIdentity {
  return { userId: id, name: `Nome ${id}`, avatarUrl: null, accountId: `acc-${id}`, workspaceId: `ws-${id}` };
}

function fakeStore(opts: { pairToday?: number; fail?: boolean } = {}) {
  const stats = new Map<string, PlayerStats>();
  const matches: MatchRecord[] = [];
  const store: Store & { stats: Map<string, PlayerStats>; matches: MatchRecord[]; lastLimit: number } = {
    stats,
    matches,
    lastLimit: 0,
    async recordMatch(rec) {
      if (opts.fail) throw new Error('boom');
      matches.push(rec);
      if (!rec.counted) return;
      for (const [p, d, win, loss] of [
        [rec.white, rec.whiteDelta, rec.result === 'w', rec.result === 'b'],
        [rec.black, rec.blackDelta, rec.result === 'b', rec.result === 'w'],
      ] as const) {
        const s = stats.get(p.userId) ?? { userId: p.userId, name: p.name, avatarUrl: p.avatarUrl, points: 0, wins: 0, losses: 0, draws: 0 };
        s.points += d;
        if (win) s.wins++;
        else if (loss) s.losses++;
        else s.draws++;
        stats.set(p.userId, s);
      }
    },
    async getStats(id) {
      if (opts.fail) throw new Error('boom');
      return stats.get(id) ?? null;
    },
    async getTop(limit) {
      store.lastLimit = limit;
      return [...stats.values()]
        .sort((a, b) => b.points - a.points)
        .slice(0, limit)
        .map((s, i): LeaderboardEntry => ({ rank: i + 1, ...s }));
    },
    async getRank(id) {
      const sorted = [...stats.values()].sort((a, b) => b.points - a.points);
      const i = sorted.findIndex((s) => s.userId === id);
      return i < 0 ? null : i + 1;
    },
    async countPairToday() {
      return opts.pairToday ?? 0;
    },
    async recentMatches(limit) {
      store.lastLimit = limit;
      return matches.slice(-limit).reverse();
    },
  };
  return store;
}

const finish = (lb: ReturnType<typeof createLeaderboard>, o: Partial<Parameters<ReturnType<typeof createLeaderboard>['finishMatch']>[0]> = {}) =>
  lb.finishMatch({ roomId: 'ROOM22', white: ident('a'), black: ident('b'), result: 'w', reason: 'checkmate', moves: 25, ...o });

test('finishMatch: jogador faltando -> vs_ai, nada gravado', async () => {
  const store = fakeStore();
  const lb = createLeaderboard(store);
  const r = await finish(lb, { black: null });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { userId: 'a', delta: 0, total: 0, counted: false, reason: 'vs_ai' });
  assert.equal(store.matches.length, 0);
  const r2 = await finish(lb, { white: null, black: null });
  assert.deepEqual(r2, []);
});

test('finishMatch: mesmo usuario -> same_user, nada gravado', async () => {
  const store = fakeStore();
  const r = await finish(createLeaderboard(store), { black: ident('a') });
  assert.ok(r.length >= 1 && r.every((x) => !x.counted && x.reason === 'same_user'));
  assert.equal(store.matches.length, 0);
});

test('finishMatch: totais corretos e bonus de zebra acumulando', async () => {
  const store = fakeStore();
  const lb = createLeaderboard(store);
  let r = await finish(lb, { result: 'w' });
  assert.deepEqual(r, [
    { userId: 'a', delta: 30, total: 30, counted: true, reason: undefined },
    { userId: 'b', delta: 10, total: 10, counted: true, reason: undefined },
  ]);
  // b (10) vence a (30)? a tem mais pontos -> bonus
  r = await finish(lb, { result: 'b' });
  assert.equal(r[0].delta, 10);
  assert.equal(r[0].total, 40);
  assert.equal(r[1].delta, 35);
  assert.equal(r[1].total, 45);
  assert.equal(store.matches.length, 2);
  assert.equal(store.matches[1].whiteDelta, 10);
  assert.equal(store.matches[1].blackDelta, 35);
  assert.match(store.matches[1].id, /^[0-9a-f-]{36}$/);
});

test('finishMatch: partida curta e limite de dupla sao gravadas como nao pontuadas', async () => {
  const s1 = fakeStore();
  const r1 = await finish(createLeaderboard(s1), { moves: 9 });
  assert.deepEqual(r1.map((x) => [x.counted, x.reason, x.delta]), [[false, 'too_short', 0], [false, 'too_short', 0]]);
  assert.equal(s1.matches.length, 1);
  assert.equal(s1.matches[0].counted, false);

  const s2 = fakeStore({ pairToday: 5 });
  const r2 = await finish(createLeaderboard(s2));
  assert.ok(r2.every((x) => !x.counted && x.reason === 'pair_limit'));
  assert.equal(s2.matches.length, 1);
});

test('finishMatch: falha do store nao lanca', async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await finish(createLeaderboard(fakeStore({ fail: true })));
    assert.deepEqual(r.map((x) => [x.userId, x.counted, x.delta]), [['a', false, 0], ['b', false, 0]]);
  } finally {
    console.error = orig;
  }
});

async function withServer(store: Store, fn: (base: string) => Promise<void>) {
  const app = express();
  registerLeaderboardRoutes(app, store);
  const server: Server = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

test('rotas: leaderboard, limites e parametros invalidos', async () => {
  const store = fakeStore();
  await finish(createLeaderboard(store));
  await withServer(store, async (base) => {
    let r = await fetch(`${base}/api/leaderboard`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { entries: LeaderboardEntry[] };
    assert.equal(body.entries.length, 2);
    assert.equal(body.entries[0].userId, 'a');
    assert.equal(store.lastLimit, 50);

    await fetch(`${base}/api/leaderboard?limit=100`);
    assert.equal(store.lastLimit, 100);
    await fetch(`${base}/api/leaderboard?limit=1`);
    assert.equal(store.lastLimit, 1);

    for (const bad of ['0', '101', '-1', 'abc', '1.5', '']) {
      r = await fetch(`${base}/api/leaderboard?limit=${bad}`);
      assert.equal(r.status, 400, `limit=${bad}`);
    }
    r = await fetch(`${base}/api/matches/recent?limit=101`);
    assert.equal(r.status, 400);
  });
});

test('rotas: /me', async () => {
  const store = fakeStore();
  await finish(createLeaderboard(store));
  await withServer(store, async (base) => {
    let r = await fetch(`${base}/api/leaderboard/me?userId=b`);
    assert.deepEqual(((await r.json()) as { rank: number }).rank, 2);
    r = await fetch(`${base}/api/leaderboard/me?userId=ninguem`);
    assert.deepEqual(await r.json(), { rank: null, stats: null });
    r = await fetch(`${base}/api/leaderboard/me`);
    assert.equal(r.status, 400);
    r = await fetch(`${base}/api/leaderboard/me?userId=a&userId=b`);
    assert.equal(r.status, 400);
  });
});

test('rotas: matches/recent nao expoe accountId/workspaceId', async () => {
  const store = fakeStore();
  await finish(createLeaderboard(store));
  await withServer(store, async (base) => {
    const r = await fetch(`${base}/api/matches/recent?limit=5`);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!/accountId|workspaceId|acc-|ws-/.test(text));
    const { matches } = JSON.parse(text) as { matches: Array<{ white: { userId: string; name: string }; result: string }> };
    assert.equal(matches.length, 1);
    assert.equal(matches[0].white.userId, 'a');
    assert.equal(store.lastLimit, 5);
  });
});
