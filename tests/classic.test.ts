import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMove,
  cloneState,
  createInitialState,
  getAvailableSquadSpecials,
  getConvocationOffer,
} from '../src/game/engine';
import type { GameState } from '../src/game/types';

function withPawnOnFifthRank(classic: boolean): GameState {
  const s = createInitialState(true, classic);
  s.board[6][0] = null;
  s.board[1][0] = null;
  s.board[3][0] = { id: 'w_p_test', color: 'w', kind: 'p', hasMoved: true };
  return s;
}

test('modo classico: estado inicial marca classic e nao oferece especiais', () => {
  const s = createInitialState(true, true);
  assert.equal(s.classic, true);
  assert.deepEqual(getAvailableSquadSpecials(s, 'w'), []);
  assert.deepEqual(getConvocationOffer(s, 'b'), []);
  assert.equal(createInitialState(true).classic, undefined);
});

test('modo classico: peao na 6a fileira nao convoca e a vez passa', () => {
  const s = withPawnOnFifthRank(true);
  const next = applyMove(s, { kind: 'move', from: { row: 3, col: 0 }, to: { row: 2, col: 0 } });
  assert.notEqual(next, s);
  assert.equal(next.pendingConvocation, null);
  assert.equal(next.turn, 'b');
  assert.equal(next.classic, true);
});

test('modo Bold: o mesmo lance abre a convocacao', () => {
  const s = withPawnOnFifthRank(false);
  const next = applyMove(s, { kind: 'move', from: { row: 3, col: 0 }, to: { row: 2, col: 0 } });
  assert.ok(next.pendingConvocation);
  assert.ok(next.pendingConvocation!.availableSpecials.length > 0);
});

test('modo classico: cloneState preserva a flag', () => {
  assert.equal(cloneState(createInitialState(true, true)).classic, true);
  assert.equal(cloneState(createInitialState(true)).classic, undefined);
});
