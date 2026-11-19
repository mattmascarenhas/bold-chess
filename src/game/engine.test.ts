import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  chooseBestAIMove,
  createInitialState,
  draftPick,
  getLegalMoves,
  isKingInCheck,
  resolveConvocation,
} from './engine';
import { GameState, Piece } from './types';

function emptyPlayableState(): GameState {
  const s = createInitialState(true);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      s.board[r][c] = null;
    }
  }
  s.board[7][4] = { id: 'wk', color: 'w', kind: 'k', hasMoved: true };
  s.board[0][4] = { id: 'bk', color: 'b', kind: 'k', hasMoved: true };
  return s;
}

function place(state: GameState, row: number, col: number, piece: Partial<Piece> & Pick<Piece, 'color' | 'kind'>) {
  state.board[row][col] = {
    id: `${piece.color}_${piece.kind}_${row}_${col}`,
    hasMoved: false,
    ...piece,
  };
}

test('Match starts directly in playing phase with up to 3 special choices from all 10', () => {
  const s = createInitialState();
  assert.equal(s.draft.phase, 'playing');
  assert.equal(s.turn, 'w');
  assert.equal(s.usedSpecials.w.length, 0);
});

test('Classic Fool Mate checkmate detection works', () => {
  let s = createInitialState(true);
  // 1. f3 e5 2. g4 Qh4#
  s = applyMove(s, { kind: 'move', from: { row: 6, col: 5 }, to: { row: 5, col: 5 } });
  s = applyMove(s, { kind: 'move', from: { row: 1, col: 4 }, to: { row: 3, col: 4 } });
  s = applyMove(s, { kind: 'move', from: { row: 6, col: 6 }, to: { row: 4, col: 6 } });
  s = applyMove(s, { kind: 'move', from: { row: 0, col: 3 }, to: { row: 4, col: 7 } });

  assert.equal(s.winner, 'b');
  assert.equal(s.endReason, 'checkmate');
  assert.equal(s.inCheck, 'w');
});

test('Gabigol moves like knight, has 1x Chute a Gol, and counts as check while unused', () => {
  const s = emptyPlayableState();
  place(s, 4, 4, { color: 'w', kind: 'gabigol' });
  place(s, 2, 4, { color: 'b', kind: 'r' }); // 2 squares north -> valid kick target!
  // Black King is at (0, 4) blocked by (2, 4) rook. If rook wasn't there, (4, 4) -> (0, 4) is distance 4!
  assert.equal(isKingInCheck(s, 'b'), false);

  const moves = getLegalMoves(s, { row: 4, col: 4 });
  const kickMove = moves.find((m) => m.kind === 'kick' && m.to.row === 2 && m.to.col === 4);
  assert.ok(kickMove, 'Gabigol should have Chute a Gol at (2,4)');

  const s2 = applyMove(s, kickMove);
  // Gabigol stays at (4,4), rook at (2,4) captured, abilityUsed = true
  assert.equal(s2.board[4][4]?.kind, 'gabigol');
  assert.equal(s2.board[4][4]?.abilityUsed, true);
  assert.equal(s2.board[2][4], null);
  // Now path to Black king at (0,4) is open, BUT Gabigol already used Chute -> NOT check!
  assert.equal(isKingInCheck(s2, 'b'), false);

  // If unused Gabigol is within 4 squares unobstructed of Black King, it IS check
  const sCheck = emptyPlayableState();
  place(sCheck, 4, 4, { color: 'w', kind: 'gabigol', abilityUsed: false });
  assert.equal(isKingInCheck(sCheck, 'b'), true);
});

test('Salles Forte pushes enemy 1 square, captures off-board, and cannot be captured by pawns', () => {
  const s = emptyPlayableState();
  place(s, 4, 3, { color: 'w', kind: 'salles' });
  place(s, 3, 2, { color: 'b', kind: 'p' }); // Diagonal pawn cannot capture Salles!
  place(s, 4, 2, { color: 'b', kind: 'n' }); // Adjacent enemy knight to push left to col 1

  const wMoves = getLegalMoves(s, { row: 4, col: 3 });
  const pushMove = wMoves.find((m) => m.kind === 'push' && m.to.row === 4 && m.to.col === 2);
  assert.ok(pushMove);
  const s2 = applyMove(s, pushMove);
  assert.equal(s2.board[4][2]?.kind, 'salles');
  assert.equal(s2.board[4][1]?.kind, 'n');

  // Black pawn at (3,2) diagonally adjacent to Salles at (4,2) CANNOT capture Salles
  const bPawnMoves = getLegalMoves(s2, { row: 3, col: 2 });
  assert.equal(
    bPawnMoves.some((m) => m.to.row === 4 && m.to.col === 2),
    false
  );

  // Pushing to edge (4, 0) then off-board when enemy is on edge
  const sEdge = emptyPlayableState();
  place(sEdge, 4, 1, { color: 'w', kind: 'salles' });
  place(sEdge, 4, 0, { color: 'b', kind: 'n' });
  const pushOff = getLegalMoves(sEdge, { row: 4, col: 1 }).find(
    (m) => m.kind === 'push' && m.to.row === 4 && m.to.col === 0
  );
  assert.ok(pushOff?.pushOffBoard);
  const s3 = applyMove(sEdge, pushOff!);
  assert.equal(s3.board[4][0]?.kind, 'salles');
  assert.ok(s3.capturedBy.w.includes('n'));
});

test('H-Barril rolls until hitting edge or piece', () => {
  const s = emptyPlayableState();
  s.board[7][4] = null;
  s.board[7][0] = { id: 'wk', color: 'w', kind: 'k', hasMoved: true }; // Unpin col 4
  place(s, 4, 4, { color: 'w', kind: 'hbarril' });
  place(s, 4, 1, { color: 'w', kind: 'p' }); // Friendly pawn at col 1 -> must stop at col 2!
  place(s, 1, 4, { color: 'b', kind: 'r' }); // Enemy rook at row 1 -> must capture at row 1!

  const moves = getLegalMoves(s, { row: 4, col: 4 });
  const leftMoves = moves.filter((m) => m.to.row === 4 && m.to.col < 4);
  assert.equal(leftMoves.length, 1);
  assert.equal(leftMoves[0].to.col, 2);

  const upMoves = moves.filter((m) => m.to.col === 4 && m.to.row < 4);
  assert.equal(upMoves.length, 1);
  assert.equal(upMoves[0].to.row, 1);
  assert.ok(upMoves[0].capturePos);
});

test('PM - Pulica freezes enemy piece for 2 turns via Abordagem', () => {
  const s = emptyPlayableState();
  place(s, 4, 4, { color: 'w', kind: 'pm' });
  place(s, 3, 4, { color: 'b', kind: 'q' });

  const arrest = getLegalMoves(s, { row: 4, col: 4 }).find((m) => m.kind === 'arrest');
  assert.ok(arrest);
  const s2 = applyMove(s, arrest!);
  assert.equal(s2.board[3][4]?.frozenTurns, 2);
  assert.equal(getLegalMoves(s2, { row: 3, col: 4 }).length, 0);
});

test('Ministro forbids empty square with Decreto and blocks movement', () => {
  const s = emptyPlayableState();
  place(s, 5, 4, { color: 'w', kind: 'ministro' });
  place(s, 2, 2, { color: 'b', kind: 'r' });

  const decree = getLegalMoves(s, { row: 5, col: 4 }).find(
    (m) => m.kind === 'decree' && m.to.row === 2 && m.to.col === 4
  );
  assert.ok(decree);
  const s2 = applyMove(s, decree!);
  assert.equal(s2.forbiddenSquares.length, 1);
  // Black rook at (2,2) cannot move to or past (2,4)!
  const rookMoves = getLegalMoves(s2, { row: 2, col: 2 });
  assert.equal(rookMoves.some((m) => m.to.row === 2 && m.to.col >= 4), false);
});

test('Vitin jumps exactly 2 squares or steps 1 orthogonal without capture', () => {
  const s = emptyPlayableState();
  place(s, 4, 4, { color: 'w', kind: 'vitin' });
  place(s, 3, 4, { color: 'b', kind: 'p' }); // 1 step orthogonal enemy -> CANNOT capture
  place(s, 2, 4, { color: 'b', kind: 'r' }); // 2 steps orthogonal jumping over (3,4) -> CAN capture!

  const moves = getLegalMoves(s, { row: 4, col: 4 });
  assert.equal(moves.some((m) => m.to.row === 3 && m.to.col === 4), false);
  assert.ok(moves.some((m) => m.to.row === 2 && m.to.col === 4 && m.capturePos));
  assert.ok(moves.some((m) => m.to.row === 5 && m.to.col === 4 && !m.capturePos));
});

test('Marcola swaps places with friendly non-king piece via Passe', () => {
  const s = emptyPlayableState();
  place(s, 6, 2, { color: 'w', kind: 'marcola' });
  place(s, 3, 5, { color: 'w', kind: 'r' }); // Same diagonal!

  const passMove = getLegalMoves(s, { row: 6, col: 2 }).find(
    (m) => m.kind === 'pass' && m.to.row === 3 && m.to.col === 5
  );
  assert.ok(passMove);
  const s2 = applyMove(s, passMove!);
  assert.equal(s2.board[3][5]?.kind, 'marcola');
  assert.equal(s2.board[6][2]?.kind, 'r');
});

test('Eminnym mirrors opponent last moved piece', () => {
  const s = emptyPlayableState();
  place(s, 5, 5, { color: 'w', kind: 'eminnym' });
  // Opponent hasn't moved -> Eminnym stays still
  assert.equal(getLegalMoves(s, { row: 5, col: 5 }).length, 0);

  s.lastMovedKind.b = 'n';
  const knightMoves = getLegalMoves(s, { row: 5, col: 5 });
  assert.ok(knightMoves.some((m) => m.to.row === 3 && m.to.col === 4));
});

test('Jac bounces off lateral edge once along diagonal', () => {
  const s = emptyPlayableState();
  place(s, 5, 2, { color: 'w', kind: 'jac' }); // c3 -> b4(4,1) -> a5(3,0) -> bounce -> b6(2,1) -> c7(1,2) -> d8(0,3)
  place(s, 1, 2, { color: 'b', kind: 'n' }); // After bounce target!

  const moves = getLegalMoves(s, { row: 5, col: 2 });
  assert.ok(moves.some((m) => m.to.row === 3 && m.to.col === 0));
  assert.ok(moves.some((m) => m.to.row === 2 && m.to.col === 1));
  const bounceCapture = moves.find((m) => m.to.row === 1 && m.to.col === 2);
  assert.ok(bounceCapture?.capturePos, 'Jac should capture after bouncing off lateral edge');
  // Should stop after capturing at (1,2)
  assert.equal(moves.some((m) => m.to.row === 0 && m.to.col === 3), false);
});

test('UIU slides minimum 3 squares in 8 directions', () => {
  const s = emptyPlayableState();
  place(s, 6, 3, { color: 'w', kind: 'uiu' });

  const moves = getLegalMoves(s, { row: 6, col: 3 });
  assert.equal(moves.some((m) => m.to.row === 5 && m.to.col === 3), false);
  assert.equal(moves.some((m) => m.to.row === 4 && m.to.col === 3), false);
  assert.ok(moves.some((m) => m.to.row === 3 && m.to.col === 3));
});

test('6th rank convocation allows choosing from 10 specials up to 3 times per match', () => {
  const s = emptyPlayableState();
  place(s, 3, 2, { color: 'w', kind: 'p' });
  const s2 = applyMove(s, { kind: 'move', from: { row: 3, col: 2 }, to: { row: 2, col: 2 } });
  assert.ok(s2.pendingConvocation);
  assert.equal(s2.pendingConvocation?.isLastRank, false);
  assert.equal(s2.pendingConvocation?.availableSpecials.length, 10);

  const s3 = resolveConvocation(s2, 'gabigol');
  assert.equal(s3.board[2][2]?.kind, 'gabigol');
  assert.equal(s3.usedSpecials.w.length, 1);
  assert.equal(s3.pendingConvocation, null);
  assert.equal(s3.turn, 'b');

  // Cannot summon a second friendly special while one is active on the board
  s3.turn = 'w';
  place(s3, 3, 5, { color: 'w', kind: 'p' });
  const s4 = applyMove(s3, { kind: 'move', from: { row: 3, col: 5 }, to: { row: 2, col: 5 } });
  assert.equal(s4.pendingConvocation, null);

  // If 3 specials have already been used (and none active), cannot summon a 4th
  const sMax = emptyPlayableState();
  sMax.usedSpecials.w = ['gabigol', 'salles', 'jac'];
  place(sMax, 3, 2, { color: 'w', kind: 'p' });
  const sAfterMax = applyMove(sMax, { kind: 'move', from: { row: 3, col: 2 }, to: { row: 2, col: 2 } });
  assert.equal(sAfterMax.pendingConvocation, null);
});

test('AI chooses a legal move cleanly', () => {
  const s = createInitialState(true);
  const move = chooseBestAIMove(s, 'w', 2);
  assert.ok(move);
  const s2 = applyMove(s, move!);
  assert.equal(s2.turn, 'b');
});

test('Declares draw when neither player can win (insufficient material)', () => {
  // K + B vs K after capturing last enemy pawn -> K + B vs K draw!
  const s1 = emptyPlayableState();
  place(s1, 5, 4, { color: 'w', kind: 'b' });
  place(s1, 4, 3, { color: 'b', kind: 'n' });
  const cap = getLegalMoves(s1, { row: 5, col: 4 }).find(
    (m) => m.to.row === 4 && m.to.col === 3
  );
  assert.ok(cap);
  const after1 = applyMove(s1, cap!);
  assert.equal(after1.winner, 'draw');
  assert.equal(after1.endReason, 'insufficient_material');

  // K + Jac vs K + B on same square color -> draw!
  const s2 = emptyPlayableState();
  place(s2, 4, 2, { color: 'w', kind: 'jac' }); // (4+2)%2 = 0 (light)
  place(s2, 3, 3, { color: 'b', kind: 'b' }); // (3+3)%2 = 0 (light)
  const jacMove = getLegalMoves(s2, { row: 4, col: 2 }).find(
    (m) => m.to.row === 5 && m.to.col === 1
  );
  assert.ok(jacMove);
  const after2 = applyMove(s2, jacMove!);
  assert.equal(after2.winner, 'draw');
  assert.equal(after2.endReason, 'insufficient_material');

  // K + H-Barril vs K is NOT insufficient material (H-Barril can checkmate)
  const s3 = emptyPlayableState();
  place(s3, 4, 4, { color: 'w', kind: 'hbarril' });
  const hbMove = getLegalMoves(s3, { row: 4, col: 4 }).find((m) => m.to.row === 4 && m.to.col === 0);
  assert.ok(hbMove);
  const after3 = applyMove(s3, hbMove!);
  assert.equal(after3.winner, null);
});

test('Declares draw on threefold repetition and 50-move rule', () => {
  const s = emptyPlayableState();
  place(s, 3, 0, { color: 'w', kind: 'r' });
  // Shuffle kings back and forth 3 times
  let curr = s;
  for (let i = 0; i < 2; i++) {
    curr = applyMove(curr, { kind: 'move', from: { row: 7, col: 4 }, to: { row: 7, col: 3 } });
    curr = applyMove(curr, { kind: 'move', from: { row: 0, col: 4 }, to: { row: 0, col: 3 } });
    curr = applyMove(curr, { kind: 'move', from: { row: 7, col: 3 }, to: { row: 7, col: 4 } });
    curr = applyMove(curr, { kind: 'move', from: { row: 0, col: 3 }, to: { row: 0, col: 4 } });
  }
  assert.equal(curr.winner, 'draw');
  assert.equal(curr.endReason, 'threefold');

  // 50-move rule (halfMoveClock reaches 100)
  const s50 = emptyPlayableState();
  place(s50, 3, 0, { color: 'w', kind: 'r' });
  s50.halfMoveClock = 99;
  const after50 = applyMove(s50, { kind: 'move', from: { row: 7, col: 4 }, to: { row: 7, col: 3 } });
  assert.equal(after50.winner, 'draw');
  assert.equal(after50.endReason, 'fifty_move');
});
