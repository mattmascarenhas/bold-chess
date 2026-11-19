import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_MAX_GAMES_PER_DAY, AI_MAX_POINTS_PER_DAY, AI_POINTS, computeAiScore } from '../src/shared/scoring';
import { verifyAiGame } from '../server/serverless/aiMatch';
import { createLeaderboard } from '../server/leaderboard';
import { createMemoryStore } from '../server/store';
import type { AiAction, PlayerIdentity } from '../src/shared/protocol';

const m = (f: [number, number], t: [number, number], d = 'move'): AiAction => ({ k: 'm', f, t, d });
// 1.e4 f6 2.d4 g5 3.Dh5# (brancas = jogador vencem)
const WIN: AiAction[] = [m([6, 4], [4, 4]), m([1, 5], [2, 5]), m([6, 3], [4, 3]), m([1, 6], [3, 6]), m([7, 3], [3, 7])];
// mate do louco: 1.f3 e5 2.g4 Dh4# (jogador perde)
const LOSS: AiAction[] = [m([6, 5], [5, 5]), m([1, 4], [3, 4]), m([6, 6], [4, 6]), m([0, 3], [4, 7])];

const user: PlayerIdentity = { userId: 'u1', name: 'Ana', avatarUrl: null, accountId: 'acc', workspaceId: 'ws' };

test('pontos por dificuldade: vitoria cresce com o nivel; derrota contra a IA nao pontua', () => {
  const levels = ['facil', 'medio', 'dificil', 'mestre', 'deus'] as const;
  for (let i = 1; i < levels.length; i++) {
    assert.ok(AI_POINTS[levels[i]].win > AI_POINTS[levels[i - 1]].win);
    assert.ok(AI_POINTS[levels[i]].draw > AI_POINTS[levels[i - 1]].draw);
  }
  for (const l of levels) {
    const p = AI_POINTS[l];
    assert.ok(p.win > p.draw && p.draw > 0);
    assert.equal(p.loss, 0);
  }
});

test('computeAiScore: minimo de jogadas, limite diario e teto de pontos', () => {
  const base = { level: 'deus', outcome: 'win', moves: 20, gamesToday: 0, pointsToday: 0 } as const;
  assert.deepEqual(computeAiScore(base), { counted: true, delta: 80 });
  assert.deepEqual(computeAiScore({ ...base, moves: 9 }), { counted: false, delta: 0, reason: 'too_short' });
  assert.equal(computeAiScore({ ...base, gamesToday: AI_MAX_GAMES_PER_DAY }).reason, 'daily_limit');
  assert.equal(computeAiScore({ ...base, pointsToday: AI_MAX_POINTS_PER_DAY }).reason, 'daily_limit');
  assert.equal(computeAiScore({ ...base, pointsToday: AI_MAX_POINTS_PER_DAY - 30 }).delta, 30);
  assert.deepEqual(computeAiScore({ ...base, level: 'deus', outcome: 'loss' }), { counted: true, delta: 0 });
});

test('verifyAiGame: repete a partida e deduz vitoria, derrota e desistencia', () => {
  assert.deepEqual(verifyAiGame(WIN), { ok: true, outcome: 'win', reason: 'checkmate', moves: 2 });
  assert.deepEqual(verifyAiGame(LOSS), { ok: true, outcome: 'loss', reason: 'checkmate', moves: 2 });
  const partial = WIN.slice(0, 3);
  assert.deepEqual(verifyAiGame(partial), { ok: false, why: 'incomplete' });
  assert.deepEqual(verifyAiGame(partial, 'resign'), { ok: true, outcome: 'loss', reason: 'resign', moves: 1 });
  assert.deepEqual(verifyAiGame(partial, 'timeout'), { ok: true, outcome: 'loss', reason: 'timeout', moves: 1 });
});

test('verifyAiGame: rejeita lances ilegais, partida adulterada e formato invalido', () => {
  const why = (v: unknown) => (v as { why?: string }).why;
  assert.equal(why(verifyAiGame([m([6, 4], [3, 4])])), 'illegal_move');
  assert.equal(why(verifyAiGame([...WIN, m([6, 0], [5, 0])])), 'after_end');
  assert.equal((verifyAiGame([...WIN.slice(0, 4), m([7, 3], [2, 7])]) as { ok: boolean }).ok, false);
  assert.equal(why(verifyAiGame([])), 'actions');
  assert.equal(why(verifyAiGame('x')), 'actions');
  assert.equal(why(verifyAiGame([m([9, 9], [4, 4])])), 'shape');
  assert.equal(why(verifyAiGame([{ k: 'z' }])), 'shape');
  assert.equal(why(verifyAiGame([{ k: 'c', c: 'q' }])), 'no_convocation');
  assert.equal(why(verifyAiGame(Array(800).fill(WIN[0]))), 'actions');
  // o tabuleiro manda: informar 'resign' num mate dado ao adversario continua sendo derrota
  assert.equal((verifyAiGame(LOSS, 'resign') as { outcome?: string }).outcome, 'loss');
});

test('verifyAiGame: partida longa jogada pela propria IA e conferida', async () => {
  const { createInitialState, applyMove, resolveConvocation } = await import('../src/game/engine');
  const { searchBestMove, chooseConvocation } = await import('../src/game/ai');
  let st = createInitialState(true);
  const log: AiAction[] = [];
  let guard = 0;
  while (!st.winner && guard++ < 160) {
    if (st.pendingConvocation) {
      const color = st.pendingConvocation.color;
      const ch = chooseConvocation(st, color, 'facil', { timeBudgetMs: 30 });
      log.push({ k: 'c', c: ch, o: [...st.pendingConvocation.availableSpecials] });
      st = resolveConvocation(st, ch);
      continue;
    }
    const r = searchBestMove(st, st.turn, 'medio', { timeBudgetMs: 40 });
    if (!r.move) break;
    log.push({
      k: 'm',
      f: [r.move.from.row, r.move.from.col],
      t: [r.move.to.row, r.move.to.col],
      d: r.move.kind,
      ...(r.move.promoteTo ? { p: r.move.promoteTo } : {}),
      ...(st.offerSeed !== undefined ? { s: st.offerSeed } : {}),
    });
    st = applyMove(st, r.move);
  }
  const v = verifyAiGame(log, st.winner ? undefined : 'resign');
  assert.ok(v.ok, JSON.stringify(v));
  if (v.ok) {
    assert.equal(v.moves, st.fullMoveNumber - 1);
    if (st.winner) assert.equal(v.outcome, st.winner === 'w' ? 'win' : st.winner === 'b' ? 'loss' : 'draw');
  }
});

test('finishAiMatch: pontua por nivel, grava a partida e nao poe a IA no ranking', async () => {
  const store = createMemoryStore();
  const lb = createLeaderboard(store);
  const a = await lb.finishAiMatch({ user, level: 'deus', outcome: 'win', reason: 'checkmate', moves: 25 });
  assert.deepEqual({ d: a.delta, t: a.total, c: a.counted }, { d: 80, t: 80, c: true });
  const b = await lb.finishAiMatch({ user, level: 'facil', outcome: 'win', reason: 'checkmate', moves: 25 });
  assert.equal(b.delta, 5);
  assert.equal(b.total, 85);
  const c = await lb.finishAiMatch({ user, level: 'mestre', outcome: 'loss', reason: 'checkmate', moves: 25 });
  assert.deepEqual({ d: c.delta, t: c.total, c: c.counted }, { d: 0, t: 85, c: true }); // derrota: 0 pontos, mas conta como derrota
  const d = await lb.finishAiMatch({ user, level: 'deus', outcome: 'win', reason: 'checkmate', moves: 4 });
  assert.deepEqual({ c: d.counted, r: d.reason }, { c: false, r: 'too_short' });
  const e = await lb.finishAiMatch({ user, level: 'nivel-falso', outcome: 'win', reason: 'x', moves: 30 });
  assert.equal(e.counted, false);

  const top = await store.getTop(10);
  assert.deepEqual(top.map((x) => x.userId), ['u1']); // so o jogador, sem 'ai:...'
  assert.equal(top[0].points, 85);
  assert.equal(top[0].wins, 2);
  assert.equal(top[0].losses, 1);
  const recent = await store.recentMatches(10);
  assert.ok(recent.some((r) => r.black.userId === 'ai:deus' && r.counted));
});

test('finishAiMatch: limite diario de partidas pontuadas contra a IA', async () => {
  const store = createMemoryStore();
  const lb = createLeaderboard(store);
  let counted = 0;
  for (let i = 0; i < AI_MAX_GAMES_PER_DAY + 5; i++) {
    const r = await lb.finishAiMatch({ user, level: 'facil', outcome: 'win', reason: 'checkmate', moves: 15 });
    if (r.counted) counted++;
    else assert.equal(r.reason, 'daily_limit');
  }
  assert.equal(counted, AI_MAX_GAMES_PER_DAY);
  assert.deepEqual(await store.countAiToday('u1'), { games: AI_MAX_GAMES_PER_DAY, points: AI_MAX_GAMES_PER_DAY * 5 });
});
