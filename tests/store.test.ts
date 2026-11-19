import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, createMemoryStore } from '../server/store';
import type { MatchRecord } from '../server/types';
import type { PlayerIdentity } from '../src/shared/protocol';

const P = (id: string, name = id, avatarUrl: string | null = null): PlayerIdentity => ({
  userId: id, name, avatarUrl, accountId: null, workspaceId: null,
});
let n = 0;
const M = (w: PlayerIdentity, b: PlayerIdentity, o: Partial<MatchRecord> = {}): MatchRecord => ({
  id: `m${n++}`, roomId: 'R', white: w, black: b, result: 'w', reason: 'checkmate', moves: 30,
  counted: true, whiteDelta: 10, blackDelta: -5, endedAt: Date.now(), ...o,
});
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chess-')), 'sub', 'chess.json');

test('grava partida e atualiza agregados', async () => {
  const s = createMemoryStore();
  await s.recordMatch(M(P('a'), P('b')));
  await s.recordMatch(M(P('a'), P('b'), { result: 'b', whiteDelta: -5, blackDelta: 10 }));
  await s.recordMatch(M(P('a'), P('b'), { result: 'draw', whiteDelta: 2, blackDelta: 2 }));
  assert.deepEqual(await s.getStats('a'), { userId: 'a', name: 'a', avatarUrl: null, points: 7, wins: 1, losses: 1, draws: 1 });
  assert.deepEqual(await s.getStats('b'), { userId: 'b', name: 'b', avatarUrl: null, points: 7, wins: 1, losses: 1, draws: 1 });
  assert.equal(await s.getStats('zz'), null);
  assert.equal((await s.recentMatches(10)).length, 3);
  assert.equal((await s.recentMatches(1)).length, 1);
});

test('partida nao pontuada e gravada mas nao altera agregados', async () => {
  const s = createMemoryStore();
  await s.recordMatch(M(P('a'), P('b'), { counted: false, whiteDelta: 0, blackDelta: 0 }));
  const st = await s.getStats('a');
  assert.equal(st?.points, 0);
  assert.equal(st?.wins, 0);
  assert.equal((await s.recentMatches(5)).length, 1);
  assert.equal(await s.countPairToday('a', 'b'), 0);
});

test('ranking, desempate e rank 1-based', async () => {
  const s = createMemoryStore();
  // c: 20 pts 2 vitorias; a: 20 pts 1 vitoria (via empate+vitoria); b e d empatados em tudo por nome
  await s.recordMatch(M(P('c', 'Cris'), P('x', 'Xavi'), { whiteDelta: 10, blackDelta: 0 }));
  await s.recordMatch(M(P('c', 'Cris'), P('x', 'Xavi'), { whiteDelta: 10, blackDelta: 0 }));
  await s.recordMatch(M(P('a', 'Ana'), P('y', 'Yuri'), { whiteDelta: 15, blackDelta: 0 }));
  await s.recordMatch(M(P('a', 'Ana'), P('y', 'Yuri'), { result: 'draw', whiteDelta: 5, blackDelta: 0 }));
  const top = await s.getTop(10);
  assert.deepEqual(top.map((t) => [t.rank, t.userId]), [[1, 'c'], [2, 'a'], [3, 'x'], [4, 'y']]);
  assert.equal(top[0].points, 20);
  assert.equal((await s.getTop(2)).length, 2);
  assert.equal(await s.getRank('a'), 2);
  assert.equal(await s.getRank('nope'), null);
});

test('desempate final por nome', async () => {
  const s = createMemoryStore();
  await s.recordMatch(M(P('1', 'Zed'), P('2', 'Abel'), { result: 'draw', whiteDelta: 3, blackDelta: 3 }));
  assert.deepEqual((await s.getTop(5)).map((t) => t.name), ['Abel', 'Zed']);
});

test('countPairToday em qualquer ordem, so pontuadas e so hoje', async () => {
  const s = createMemoryStore();
  await s.recordMatch(M(P('a'), P('b')));
  await s.recordMatch(M(P('b'), P('a')));
  await s.recordMatch(M(P('a'), P('b'), { counted: false }));
  await s.recordMatch(M(P('a'), P('c')));
  await s.recordMatch(M(P('a'), P('b'), { endedAt: Date.now() - 3 * 86400_000 }));
  assert.equal(await s.countPairToday('a', 'b'), 2);
  assert.equal(await s.countPairToday('b', 'a'), 2);
  assert.equal(await s.countPairToday('b', 'c'), 0);
});

test('snapshot de nome/avatar atualizado a cada partida', async () => {
  const s = createMemoryStore();
  await s.recordMatch(M(P('a', 'Velho'), P('b')));
  await s.recordMatch(M(P('a', 'Novo', 'http://av'), P('b'), { counted: false }));
  const st = await s.getStats('a');
  assert.equal(st?.name, 'Novo');
  assert.equal(st?.avatarUrl, 'http://av');
});

test('escrita concorrente de 50 partidas sem perda', async () => {
  const file = tmp();
  const s = createStore(file);
  await Promise.all(Array.from({ length: 50 }, () => s.recordMatch(M(P('a'), P('b')))));
  assert.equal((await s.getStats('a'))?.wins, 50);
  assert.equal((await s.getStats('a'))?.points, 500);
  const s2 = createStore(file);
  assert.equal((await s2.getStats('b'))?.losses, 50);
  assert.equal((await s2.recentMatches(100)).length, 50);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('persistencia entre instancias e criacao da pasta', async () => {
  const file = tmp();
  await createStore(file).recordMatch(M(P('a', 'Ana'), P('b')));
  const s = createStore(file);
  assert.equal((await s.getStats('a'))?.name, 'Ana');
  assert.equal(await s.countPairToday('b', 'a'), 1);
  await s.recordMatch(M(P('a', 'Ana'), P('b')));
  assert.equal((await createStore(file).getStats('a'))?.wins, 2);
});

test('arquivo corrompido: comeca vazio e faz backup', async () => {
  const file = tmp();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ nao e json');
  const s = createStore(file);
  assert.deepEqual(await s.getTop(5), []);
  const baks = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.bak'));
  assert.equal(baks.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), baks[0]), 'utf8'), '{ nao e json');
  await s.recordMatch(M(P('a'), P('b')));
  assert.equal((await createStore(file).getStats('a'))?.wins, 1);
});

test('arquivo ausente: comeca vazio', async () => {
  const s = createStore(tmp());
  assert.deepEqual(await s.getTop(5), []);
  assert.deepEqual(await s.recentMatches(5), []);
});
