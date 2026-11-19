// Roda apenas com TEST_DATABASE_URL apontando para um Postgres descartavel (ex.: branch do Neon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPgStore } from '../server/store-pg';

const url = process.env.TEST_DATABASE_URL;
const idn = (id: string, name = id) => ({ userId: id, name, avatarUrl: null, accountId: 'acc', workspaceId: 'ws' });

test('PgStore: partida, agregados, ranking e par do dia', { skip: !url }, async () => {
  const store = createPgStore(url!);
  const tag = `t${Date.now()}`;
  const a = `${tag}_a`;
  const b = `${tag}_b`;
  try {
    await store.recordMatch({
      id: `${tag}_1`, roomId: 'R', white: idn(a, 'Ana'), black: idn(b, 'Bruno'), result: 'w', reason: 'resign',
      moves: 12, counted: true, whiteDelta: 30, blackDelta: 10, endedAt: Date.now(),
    });
    await store.recordMatch({
      id: `${tag}_2`, roomId: 'R', white: idn(b), black: idn(a), result: 'draw', reason: 'stalemate',
      moves: 3, counted: false, whiteDelta: 0, blackDelta: 0, endedAt: Date.now(),
    });
    const sa = await store.getStats(a);
    assert.equal(sa?.points, 30);
    assert.equal(sa?.wins, 1);
    assert.equal((await store.getStats(b))?.losses, 1);
    assert.equal(await store.countPairToday(a, b), 1); // so a pontuada conta
    assert.equal(await store.countPairToday(b, a), 1);
    assert.ok((await store.getRank(a))! < (await store.getRank(b))!);
    assert.ok((await store.getTop(5)).length >= 1);
    assert.ok((await store.recentMatches(2)).length >= 1);
  } finally {
    await store.close();
  }
});

test('PgStore: partida contra a IA pontua so o humano e conta o dia', { skip: !url }, async () => {
  const store = createPgStore(url!);
  const u = 't' + Date.now() + '_ai';
  try {
    const ai = { userId: 'ai:deus', name: 'IA Modo Deus', avatarUrl: null, accountId: null, workspaceId: null };
    const mk = (id: string, delta: number, result: 'w' | 'b', counted = true) => ({
      id, roomId: 'ia', white: idn(u, 'Humano'), black: ai, result, reason: 'checkmate', moves: 20, counted, whiteDelta: delta, blackDelta: 0, endedAt: Date.now(),
    });
    await store.recordMatch(mk(u + '1', 80, 'w'));
    await store.recordMatch(mk(u + '2', 5, 'b'));
    await store.recordMatch(mk(u + '3', 0, 'w', false));
    const s = await store.getStats(u);
    assert.deepEqual({ p: s?.points, w: s?.wins, l: s?.losses }, { p: 85, w: 1, l: 1 });
    assert.equal(await store.getStats('ai:deus'), null); // IA nunca entra no ranking
    assert.deepEqual(await store.countAiToday(u), { games: 2, points: 85 }); // so as pontuadas
  } finally {
    await store.close();
  }
});
