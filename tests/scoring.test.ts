import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, MAX_PAIR_MATCHES_PER_DAY, MIN_MOVES_TO_COUNT, type ScoreInput } from '../src/shared/scoring';

const base: ScoreInput = {
  whiteId: 'a',
  blackId: 'b',
  result: 'w',
  whitePoints: 0,
  blackPoints: 0,
  moves: 20,
  pairMatchesToday: 0,
};
const run = (o: Partial<ScoreInput>) => computeScore({ ...base, ...o });

test('vitoria das brancas: +30 / +10', () => {
  assert.deepEqual(run({ result: 'w' }), { counted: true, white: 30, black: 10 });
});

test('vitoria das pretas: +10 / +30', () => {
  assert.deepEqual(run({ result: 'b' }), { counted: true, white: 10, black: 30 });
});

test('empate: +15 para cada, sem bonus', () => {
  assert.deepEqual(run({ result: 'draw', whitePoints: 100, blackPoints: 0 }), { counted: true, white: 15, black: 15 });
});

test('bonus +5 quando perdedor tem estritamente mais pontos (brancas vencem)', () => {
  assert.equal(run({ result: 'w', whitePoints: 10, blackPoints: 11 }).white, 35);
});

test('bonus +5 quando perdedor tem estritamente mais pontos (pretas vencem)', () => {
  assert.equal(run({ result: 'b', whitePoints: 50, blackPoints: 10 }).black, 35);
});

test('sem bonus quando pontos iguais ou vencedor tem mais', () => {
  assert.equal(run({ result: 'w', whitePoints: 10, blackPoints: 10 }).white, 30);
  assert.equal(run({ result: 'w', whitePoints: 20, blackPoints: 10 }).white, 30);
  assert.equal(run({ result: 'b', whitePoints: 10, blackPoints: 10 }).black, 30);
});

test('perdedor nunca recebe bonus', () => {
  assert.equal(run({ result: 'w', whitePoints: 10, blackPoints: 99 }).black, 10);
});

test('limite de jogadas: 9 nao conta, 10 conta', () => {
  assert.equal(MIN_MOVES_TO_COUNT, 10);
  assert.deepEqual(run({ moves: 9 }), { counted: false, reason: 'too_short', white: 0, black: 0 });
  assert.equal(run({ moves: 10 }).counted, true);
});

test('limite por dupla: 4 conta, 5 nao', () => {
  assert.equal(MAX_PAIR_MATCHES_PER_DAY, 5);
  assert.equal(run({ pairMatchesToday: 4 }).counted, true);
  assert.deepEqual(run({ pairMatchesToday: 5 }), { counted: false, reason: 'pair_limit', white: 0, black: 0 });
});

test('mesmo usuario nunca pontua (prioridade sobre os outros motivos)', () => {
  assert.deepEqual(run({ blackId: 'a', moves: 1, pairMatchesToday: 9 }), {
    counted: false,
    reason: 'same_user',
    white: 0,
    black: 0,
  });
});
