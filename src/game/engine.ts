import {
  ClassicKind,
  Color,
  GameState,
  MoveKind,
  MoveOption,
  Piece,
  PieceKind,
  Pos,
  SPECIAL_ROSTER,
  SpecialId,
  getPieceDisplayName,
  isSpecialKind,
} from './types';

export const DRAFT_ORDER: Color[] = ['w', 'b', 'b', 'w', 'w', 'b'];

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function posToAlgebraic(pos: Pos): string {
  return `${FILES[pos.col]}${8 - pos.row}`;
}

export function oppositeColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function cloneBoard(board: (Piece | null)[][]): (Piece | null)[][] {
  return board.map((r) => r.map((p) => (p ? { ...p } : null)));
}

export function cloneState(state: GameState): GameState {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    draft: {
      phase: state.draft.phase,
      order: [...state.draft.order],
      step: state.draft.step,
      squads: {
        w: [...state.draft.squads.w],
        b: [...state.draft.squads.b],
      },
    },
    usedSpecials: {
      w: [...state.usedSpecials.w],
      b: [...state.usedSpecials.b],
    },
    enPassantTarget: state.enPassantTarget ? { ...state.enPassantTarget } : null,
    forbiddenSquares: state.forbiddenSquares.map((f) => ({ ...f })),
    lastMovedKind: { ...state.lastMovedKind },
    lastMove: state.lastMove
      ? {
          from: { ...state.lastMove.from },
          to: { ...state.lastMove.to },
          kind: state.lastMove.kind,
        }
      : null,
    pendingConvocation: state.pendingConvocation
      ? {
          ...state.pendingConvocation,
          pos: { ...state.pendingConvocation.pos },
          availableSpecials: [...state.pendingConvocation.availableSpecials],
        }
      : null,
    winner: state.winner,
    endReason: state.endReason,
    inCheck: state.inCheck,
    halfMoveClock: state.halfMoveClock,
    fullMoveNumber: state.fullMoveNumber,
    capturedBy: {
      w: [...state.capturedBy.w],
      b: [...state.capturedBy.b],
    },
    history: [...state.history],
    positionHistory: state.positionHistory ? [...state.positionHistory] : [],
  };
}

export function createInitialBoard(): (Piece | null)[][] {
  const board: (Piece | null)[][] = Array.from({ length: 8 }, () =>
    Array<Piece | null>(8).fill(null)
  );
  const backRank: ClassicKind[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

  for (let col = 0; col < 8; col++) {
    board[0][col] = {
      id: `b_${backRank[col]}_${col}`,
      color: 'b',
      kind: backRank[col],
      hasMoved: false,
    };
    board[1][col] = {
      id: `b_p_${col}`,
      color: 'b',
      kind: 'p',
      hasMoved: false,
    };
    board[6][col] = {
      id: `w_p_${col}`,
      color: 'w',
      kind: 'p',
      hasMoved: false,
    };
    board[7][col] = {
      id: `w_${backRank[col]}_${col}`,
      color: 'w',
      kind: backRank[col],
      hasMoved: false,
    };
  }
  return board;
}

export const MAX_SPECIALS_PER_PLAYER = 3;

export function createInitialState(_skipDraftWithDefault = true): GameState {
  return {
    board: createInitialBoard(),
    turn: 'w',
    draft: {
      phase: 'playing',
      order: [...DRAFT_ORDER],
      step: DRAFT_ORDER.length,
      squads: {
        w: [],
        b: [],
      },
    },
    usedSpecials: { w: [], b: [] },
    enPassantTarget: null,
    forbiddenSquares: [],
    lastMovedKind: { w: null, b: null },
    lastMove: null,
    pendingConvocation: null,
    winner: null,
    endReason: null,
    inCheck: null,
    halfMoveClock: 0,
    fullMoveNumber: 1,
    capturedBy: { w: [], b: [] },
    history: [],
    positionHistory: [],
  };
}

export function isSquareForbidden(state: GameState, row: number, col: number): boolean {
  return state.forbiddenSquares.some((f) => f.row === row && f.col === col && f.halfTurnsLeft > 0);
}

export function draftPick(state: GameState, color: Color, specialId: SpecialId): GameState {
  if (state.draft.phase !== 'draft') return state;
  const expected = state.draft.order[state.draft.step];
  if (expected !== color) return state;

  const alreadyTaken =
    state.draft.squads.w.includes(specialId) || state.draft.squads.b.includes(specialId);
  if (alreadyTaken) return state;

  const next = cloneState(state);
  next.draft.squads[color].push(specialId);
  next.draft.step += 1;
  if (next.draft.step >= next.draft.order.length) {
    next.draft.phase = 'playing';
  }
  return next;
}

export function autoDraftRemaining(state: GameState): GameState {
  let curr = cloneState(state);
  const pool = SPECIAL_ROSTER.map((s) => s.id);
  while (curr.draft.phase === 'draft') {
    const color = curr.draft.order[curr.draft.step];
    const available = pool.filter(
      (id) => !curr.draft.squads.w.includes(id) && !curr.draft.squads.b.includes(id)
    );
    if (available.length === 0) break;
    // Deterministic balanced pick
    const pick = available[0];
    curr = draftPick(curr, color, pick);
  }
  return curr;
}

export function hasActiveFriendlySpecial(state: GameState, color: Color): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.color === color && isSpecialKind(p.kind)) return true;
    }
  }
  return false;
}

/** Quantas pecas especiais sao oferecidas por convocacao/promocao. */
export const CONVOCATION_OFFER_SIZE = 3;

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Oferta deterministica de ate 3 especiais para o jogador na posicao atual.
 * Deterministica (semente = estado) para cliente, motor e servidor concordarem
 * sem guardar estado extra; muda a cada jogada.
 */
export function getConvocationOffer(state: GameState, color: Color): SpecialId[] {
  const avail = getAvailableSquadSpecials(state, color);
  if (avail.length <= CONVOCATION_OFFER_SIZE) return avail;
  let seed = hashSeed(
    `${color}|${state.history.length}|${state.fullMoveNumber}|${state.usedSpecials[color].join(',')}`
  );
  const pool = [...avail];
  const out: SpecialId[] = [];
  while (out.length < CONVOCATION_OFFER_SIZE && pool.length > 0) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out;
}

export function getAvailableSquadSpecials(state: GameState, color: Color): SpecialId[] {
  if (hasActiveFriendlySpecial(state, color)) return [];
  const used = state.usedSpecials[color];
  if (used.length >= MAX_SPECIALS_PER_PLAYER) return [];
  return SPECIAL_ROSTER.map((s) => s.id).filter((id) => !used.includes(id));
}

export function findKingPos(board: (Piece | null)[][], color: Color): Pos | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color && p.kind === 'k') {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

function getEffectiveKind(state: GameState, piece: Piece): PieceKind {
  if (piece.kind !== 'eminnym') return piece.kind;
  const opp = oppositeColor(piece.color);
  const copied = state.lastMovedKind[opp];
  if (!copied) return 'eminnym';
  // Prevent mirror recursion if opponent also last moved Eminnym
  if (copied === 'eminnym') return 'eminnym';
  return copied;
}

/**
 * Generates pseudo-legal moves for a piece (before filtering for self-check).
 * Note: does NOT generate castling if `forAttackCheck` is true.
 */
function generatePseudoMoves(
  state: GameState,
  from: Pos,
  forAttackCheck = false
): MoveOption[] {
  const piece = state.board[from.row][from.col];
  if (!piece) return [];
  if (!forAttackCheck && (piece.frozenTurns ?? 0) > 0) return [];

  const moves: MoveOption[] = [];
  const effectiveKind = getEffectiveKind(state, piece);
  const isMirrored = piece.kind === 'eminnym';
  const color = piece.color;
  const opp = oppositeColor(color);

  const addSimpleMove = (
    toRow: number,
    toCol: number,
    allowCapture = true,
    allowEmpty = true
  ) => {
    if (!inBounds(toRow, toCol)) return;
    if (isSquareForbidden(state, toRow, toCol)) return;
    const target = state.board[toRow][toCol];
    if (!target) {
      if (allowEmpty) {
        moves.push({ kind: 'move', from, to: { row: toRow, col: toCol } });
      }
    } else if (target.color === opp && allowCapture) {
      moves.push({
        kind: 'move',
        from,
        to: { row: toRow, col: toCol },
        capturePos: { row: toRow, col: toCol },
      });
    }
  };

  const addSliderMoves = (dirs: [number, number][], minSteps = 1, maxSteps = 7) => {
    for (const [dr, dc] of dirs) {
      for (let step = 1; step <= maxSteps; step++) {
        const nr = from.row + dr * step;
        const nc = from.col + dc * step;
        if (!inBounds(nr, nc)) break;
        if (isSquareForbidden(state, nr, nc)) break;
        const target = state.board[nr][nc];
        if (!target) {
          if (step >= minSteps) {
            moves.push({ kind: 'move', from, to: { row: nr, col: nc } });
          }
        } else {
          if (target.color === opp && step >= minSteps) {
            moves.push({
              kind: 'move',
              from,
              to: { row: nr, col: nc },
              capturePos: { row: nr, col: nc },
            });
          }
          break;
        }
      }
    }
  };

  const orthoDirs: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const diagDirs: [number, number][] = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  const allDirs: [number, number][] = [...orthoDirs, ...diagDirs];

  switch (effectiveKind) {
    case 'p': {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const promoRow = color === 'w' ? 0 : 7;

      // Forward moves (not attacks)
      if (!forAttackCheck) {
        const r1 = from.row + dir;
        if (inBounds(r1, from.col) && !isSquareForbidden(state, r1, from.col) && !state.board[r1][from.col]) {
          if (r1 === promoRow) {
            (['q', 'r', 'b', 'n'] as ClassicKind[]).forEach((pk) => {
              moves.push({
                kind: 'promotion',
                from,
                to: { row: r1, col: from.col },
                promoteTo: pk,
              });
            });
          } else {
            moves.push({ kind: 'move', from, to: { row: r1, col: from.col } });
            const r2 = from.row + dir * 2;
            if (
              from.row === startRow &&
              inBounds(r2, from.col) &&
              !isSquareForbidden(state, r2, from.col) &&
              !state.board[r2][from.col]
            ) {
              moves.push({
                kind: 'move',
                from,
                to: { row: r2, col: from.col },
                isDoublePawnPush: true,
              });
            }
          }
        }
      }

      // Diagonal captures
      for (const dc of [-1, 1]) {
        const cr = from.row + dir;
        const cc = from.col + dc;
        if (!inBounds(cr, cc)) continue;
        if (isSquareForbidden(state, cr, cc)) continue;
        const target = state.board[cr][cc];
        // Salles Forte rule: "Peão não o captura"
        if (target && target.color === opp && target.kind !== 'salles') {
          if (cr === promoRow && !forAttackCheck) {
            (['q', 'r', 'b', 'n'] as ClassicKind[]).forEach((pk) => {
              moves.push({
                kind: 'promotion',
                from,
                to: { row: cr, col: cc },
                capturePos: { row: cr, col: cc },
                promoteTo: pk,
              });
            });
          } else {
            moves.push({
              kind: 'move',
              from,
              to: { row: cr, col: cc },
              capturePos: { row: cr, col: cc },
            });
          }
        } else if (forAttackCheck) {
          // For king-check detection, pawn still controls diagonal squares (king isn't Salles)
          moves.push({
            kind: 'move',
            from,
            to: { row: cr, col: cc },
          });
        } else if (
          state.enPassantTarget &&
          state.enPassantTarget.row === cr &&
          state.enPassantTarget.col === cc
        ) {
          const epVictimPos = { row: from.row, col: cc };
          const epVictim = state.board[epVictimPos.row][epVictimPos.col];
          if (epVictim && epVictim.color === opp && epVictim.kind === 'p') {
            moves.push({
              kind: 'enpassant',
              from,
              to: { row: cr, col: cc },
              capturePos: epVictimPos,
            });
          }
        }
      }
      break;
    }

    case 'n':
    case 'gabigol': {
      const jumps: [number, number][] = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      for (const [dr, dc] of jumps) {
        addSimpleMove(from.row + dr, from.col + dc);
      }

      // Gabigol's Chute a Gol (1x, only if not mirrored by Eminnym and not yet used)
      if (effectiveKind === 'gabigol' && !isMirrored && !piece.abilityUsed) {
        for (const [dr, dc] of orthoDirs) {
          for (let step = 1; step <= 4; step++) {
            const nr = from.row + dr * step;
            const nc = from.col + dc * step;
            if (!inBounds(nr, nc)) break;
            if (isSquareForbidden(state, nr, nc)) break;
            const target = state.board[nr][nc];
            if (target) {
              if (target.color === opp) {
                if (forAttackCheck && target.kind === 'k') {
                  // Unused Chute counts as check attack against enemy King!
                  moves.push({
                    kind: 'kick',
                    from,
                    to: { row: nr, col: nc },
                    capturePos: { row: nr, col: nc },
                  });
                } else if (!forAttackCheck && target.kind !== 'k') {
                  moves.push({
                    kind: 'kick',
                    from,
                    to: { row: nr, col: nc },
                    capturePos: { row: nr, col: nc },
                    label: 'Chute a Gol',
                  });
                }
              }
              break;
            }
          }
        }
      }
      break;
    }

    case 'b': {
      addSliderMoves(diagDirs);
      break;
    }

    case 'r': {
      addSliderMoves(orthoDirs);
      break;
    }

    case 'q': {
      addSliderMoves(allDirs);
      break;
    }

    case 'k': {
      for (const [dr, dc] of allDirs) {
        addSimpleMove(from.row + dr, from.col + dc);
      }
      // Castling is added separately in legal move generator
      break;
    }

    case 'salles': {
      for (const [dr, dc] of allDirs) {
        const nr = from.row + dr;
        const nc = from.col + dc;
        if (!inBounds(nr, nc)) continue;
        if (isSquareForbidden(state, nr, nc)) continue;
        const target = state.board[nr][nc];
        if (!target) {
          moves.push({ kind: 'move', from, to: { row: nr, col: nc } });
        } else if (target.color === opp) {
          // If mirrored by Eminnym, no Empurrão effect — normal 1-step capture
          if (isMirrored) {
            moves.push({
              kind: 'move',
              from,
              to: { row: nr, col: nc },
              capturePos: { row: nr, col: nc },
            });
          } else if (target.kind !== 'k') {
            // Empurrão: pushes enemy 1 square further in (dr, dc)
            const pr = nr + dr;
            const pc = nc + dc;
            if (!inBounds(pr, pc)) {
              // Pushed off the board -> captured!
              moves.push({
                kind: 'push',
                from,
                to: { row: nr, col: nc },
                capturePos: { row: nr, col: nc },
                pushOffBoard: true,
                label: 'Empurrão (Fora!)',
              });
            } else if (!isSquareForbidden(state, pr, pc) && !state.board[pr][pc]) {
              moves.push({
                kind: 'push',
                from,
                to: { row: nr, col: nc },
                pushTo: { row: pr, col: pc },
                label: 'Empurrão',
              });
            }
          } else if (forAttackCheck) {
            // Salles still attacks an adjacent king for check detection
            moves.push({
              kind: 'move',
              from,
              to: { row: nr, col: nc },
              capturePos: { row: nr, col: nc },
            });
          }
        }
      }
      break;
    }

    case 'hbarril': {
      // Rolls in straight line; cannot stop in the middle
      for (const [dr, dc] of orthoDirs) {
        let lastFree: Pos | null = null;
        for (let step = 1; step <= 7; step++) {
          const nr = from.row + dr * step;
          const nc = from.col + dc * step;
          if (!inBounds(nr, nc)) {
            if (lastFree) {
              moves.push({ kind: 'move', from, to: lastFree });
            }
            break;
          }
          if (isSquareForbidden(state, nr, nc)) {
            if (lastFree) {
              moves.push({ kind: 'move', from, to: lastFree });
            }
            break;
          }
          const target = state.board[nr][nc];
          if (!target) {
            lastFree = { row: nr, col: nc };
            if (step === 7 || !inBounds(nr + dr, nc + dc)) {
              moves.push({ kind: 'move', from, to: lastFree });
              break;
            }
          } else {
            if (target.color === opp) {
              moves.push({
                kind: 'move',
                from,
                to: { row: nr, col: nc },
                capturePos: { row: nr, col: nc },
              });
            } else if (lastFree) {
              moves.push({ kind: 'move', from, to: lastFree });
            }
            break;
          }
        }
      }
      break;
    }

    case 'pm': {
      for (const [dr, dc] of allDirs) {
        addSimpleMove(from.row + dr, from.col + dc);
      }
      // Abordagem (1x)
      if (!isMirrored && !piece.abilityUsed && !forAttackCheck) {
        for (const [dr, dc] of allDirs) {
          const nr = from.row + dr;
          const nc = from.col + dc;
          if (!inBounds(nr, nc)) continue;
          const target = state.board[nr][nc];
          if (target && target.color === opp && target.kind !== 'k') {
            moves.push({
              kind: 'arrest',
              from,
              to: { row: nr, col: nc },
              label: 'Abordagem',
            });
          }
        }
      }
      break;
    }

    case 'ministro': {
      addSliderMoves(allDirs, 1, 2);
      // Decreto (1x): empty square within Chebyshev distance <= 3
      if (!isMirrored && !piece.abilityUsed && !forAttackCheck) {
        for (let r = Math.max(0, from.row - 3); r <= Math.min(7, from.row + 3); r++) {
          for (let c = Math.max(0, from.col - 3); c <= Math.min(7, from.col + 3); c++) {
            if (r === from.row && c === from.col) continue;
            if (!state.board[r][c] && !isSquareForbidden(state, r, c)) {
              moves.push({
                kind: 'decree',
                from,
                to: { row: r, col: c },
                label: 'Decreto',
              });
            }
          }
        }
      }
      break;
    }

    case 'vitin': {
      // Jumps exactly 2 squares in any of 8 directions (can capture)
      for (const [dr, dc] of allDirs) {
        addSimpleMove(from.row + dr * 2, from.col + dc * 2, true, true);
      }
      // Also walks 1 square orthogonally WITHOUT capturing
      if (!forAttackCheck) {
        for (const [dr, dc] of orthoDirs) {
          addSimpleMove(from.row + dr, from.col + dc, false, true);
        }
      }
      break;
    }

    case 'marcola': {
      for (const [dr, dc] of allDirs) {
        addSimpleMove(from.row + dr, from.col + dc);
      }
      // Passe (1x): swap with any friendly piece (except King) on same row, col, or diagonal
      if (!isMirrored && !piece.abilityUsed && !forAttackCheck) {
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (r === from.row && c === from.col) continue;
            const dr = Math.abs(r - from.row);
            const dc = Math.abs(c - from.col);
            if (dr === 0 || dc === 0 || dr === dc) {
              const ally = state.board[r][c];
              if (ally && ally.color === color && ally.kind !== 'k') {
                moves.push({
                  kind: 'pass',
                  from,
                  to: { row: r, col: c },
                  label: 'Passe',
                });
              }
            }
          }
        }
      }
      break;
    }

    case 'eminnym': {
      // Opponent hasn't moved a copyable piece yet -> stays still
      break;
    }

    case 'jac': {
      // Bishop that bounces ONCE off lateral edge (col === 0 or col === 7)
      for (const [initDr, initDc] of diagDirs) {
        let r = from.row;
        let c = from.col;
        let dc = initDc;
        let bounced = false;

        for (let step = 0; step < 14; step++) {
          let nextC = c + dc;
          const nextR = r + initDr;
          if (nextC < 0 || nextC > 7) {
            if (bounced) break;
            bounced = true;
            dc = -dc;
            nextC = c + dc;
          }
          if (!inBounds(nextR, nextC)) break;
          if (isSquareForbidden(state, nextR, nextC)) break;

          r = nextR;
          c = nextC;
          const target = state.board[r][c];
          if (!target) {
            moves.push({ kind: 'move', from, to: { row: r, col: c } });
          } else {
            if (target.color === opp) {
              moves.push({
                kind: 'move',
                from,
                to: { row: r, col: c },
                capturePos: { row: r, col: c },
              });
            }
            break;
          }
        }
      }
      break;
    }

    case 'uiu': {
      // Slides in 8 directions, minimum 3 squares
      addSliderMoves(allDirs, 3, 7);
      break;
    }
  }

  return moves;
}

export function isSquareAttacked(
  state: GameState,
  row: number,
  col: number,
  byColor: Color
): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p || p.color !== byColor) continue;
      const attacks = generatePseudoMoves(state, { row: r, col: c }, true);
      if (attacks.some((m) => m.to.row === row && m.to.col === col)) {
        return true;
      }
    }
  }
  return false;
}

export function isKingInCheck(state: GameState, color: Color): boolean {
  const kPos = findKingPos(state.board, color);
  if (!kPos) return false;
  return isSquareAttacked(state, kPos.row, kPos.col, oppositeColor(color));
}

function applyMoveRaw(state: GameState, move: MoveOption): GameState {
  const next = cloneState(state);
  if (!next.positionHistory || next.positionHistory.length === 0) {
    next.positionHistory = [computePositionKey(state)];
  }
  const piece = next.board[move.from.row][move.from.col];
  if (!piece) return next;

  const color = piece.color;
  const opp = oppositeColor(color);

  // Tick down forbidden squares and frozen turns at end of move
  next.forbiddenSquares = next.forbiddenSquares
    .map((f) => ({ ...f, halfTurnsLeft: f.halfTurnsLeft - 1 }))
    .filter((f) => f.halfTurnsLeft > 0);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = next.board[r][c];
      if (p && p.color === color && p.frozenTurns && p.frozenTurns > 0) {
        p.frozenTurns -= 1;
      }
    }
  }

  next.enPassantTarget = null;
  let capturedKind: PieceKind | undefined;

  if (move.kind === 'kick') {
    // Gabigol shoots without moving
    piece.abilityUsed = true;
    const victim = next.board[move.to.row][move.to.col];
    if (victim) {
      capturedKind = victim.kind;
      next.capturedBy[color].push(victim.kind);
      next.board[move.to.row][move.to.col] = null;
    }
  } else if (move.kind === 'arrest') {
    // PM freezes adjacent enemy for 2 of that opponent's turns
    piece.abilityUsed = true;
    const target = next.board[move.to.row][move.to.col];
    if (target) {
      target.frozenTurns = 2;
    }
  } else if (move.kind === 'decree') {
    // Ministro forbids empty square for 3 full turn pairs (6 half-turns)
    piece.abilityUsed = true;
    next.forbiddenSquares.push({
      row: move.to.row,
      col: move.to.col,
      halfTurnsLeft: 6,
      owner: color,
    });
  } else if (move.kind === 'pass') {
    // Marcola swaps places with friendly piece
    piece.abilityUsed = true;
    const ally = next.board[move.to.row][move.to.col];
    if (ally) {
      next.board[move.to.row][move.to.col] = piece;
      next.board[move.from.row][move.from.col] = ally;
      piece.hasMoved = true;
      ally.hasMoved = true;
    }
  } else if (move.kind === 'push') {
    // Salles Forte pushes enemy piece
    const victim = next.board[move.to.row][move.to.col];
    if (victim) {
      if (move.pushOffBoard) {
        capturedKind = victim.kind;
        next.capturedBy[color].push(victim.kind);
      } else if (move.pushTo) {
        next.board[move.pushTo.row][move.pushTo.col] = victim;
        victim.hasMoved = true;
      }
    }
    next.board[move.to.row][move.to.col] = piece;
    next.board[move.from.row][move.from.col] = null;
    piece.hasMoved = true;
  } else if (move.kind === 'castling') {
    next.board[move.to.row][move.to.col] = piece;
    next.board[move.from.row][move.from.col] = null;
    piece.hasMoved = true;
    if (move.rookFrom && move.rookTo) {
      const rook = next.board[move.rookFrom.row][move.rookFrom.col];
      if (rook) {
        next.board[move.rookTo.row][move.rookTo.col] = rook;
        next.board[move.rookFrom.row][move.rookFrom.col] = null;
        rook.hasMoved = true;
      }
    }
  } else {
    // Normal move, en passant, or promotion
    if (move.capturePos) {
      const victim = next.board[move.capturePos.row][move.capturePos.col];
      if (victim) {
        capturedKind = victim.kind;
        next.capturedBy[color].push(victim.kind);
        next.board[move.capturePos.row][move.capturePos.col] = null;
      }
    }

    next.board[move.to.row][move.to.col] = piece;
    next.board[move.from.row][move.from.col] = null;
    piece.hasMoved = true;

    if (move.isDoublePawnPush) {
      const midRow = (move.from.row + move.to.row) / 2;
      next.enPassantTarget = { row: midRow, col: move.from.col };
    }

    if (move.kind === 'promotion' && move.promoteTo) {
      piece.kind = move.promoteTo;
      piece.abilityUsed = false;
      if (isSpecialKind(move.promoteTo) && !next.usedSpecials[color].includes(move.promoteTo)) {
        next.usedSpecials[color].push(move.promoteTo);
      }
    }
  }

  next.lastMovedKind[color] = piece.kind;
  next.lastMove = { from: move.from, to: move.to, kind: move.kind };

  // Check if pawn landed on 6th rank (White row 2, Black row 5) and player has available specials
  const sixthRankRow = color === 'w' ? 2 : 5;
  const lastRankRow = color === 'w' ? 0 : 7;
  const canConvocateSixth =
    piece.kind === 'p' &&
    move.kind !== 'promotion' &&
    move.to.row === sixthRankRow &&
    getAvailableSquadSpecials(next, color).length > 0;

  if (canConvocateSixth) {
    next.pendingConvocation = {
      color,
      pos: { ...move.to },
      isLastRank: false,
      availableSpecials: getConvocationOffer(next, color),
    };
    // Do NOT advance turn yet until convocation choice is resolved!
    next.inCheck = isKingInCheck(next, opp) ? opp : null;
    return next;
  }

  // If pawn landed on last rank via promotion move, note it was already handled in move.promoteTo
  if (piece.kind === 'p' && move.to.row === lastRankRow && move.kind !== 'promotion') {
    next.pendingConvocation = {
      color,
      pos: { ...move.to },
      isLastRank: true,
      availableSpecials: getConvocationOffer(next, color),
    };
    next.inCheck = isKingInCheck(next, opp) ? opp : null;
    return next;
  }

  finalizeTurnAfterMove(next, color, move, piece.kind, capturedKind);
  return next;
}

export function isInsufficientMaterial(state: GameState): boolean {
  const minors: { kind: PieceKind; squareColor: number }[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p || p.kind === 'k') continue;

      // Any piece capable of mating a lone King means mate is still possible
      if (
        p.kind === 'p' ||
        p.kind === 'q' ||
        p.kind === 'r' ||
        p.kind === 'hbarril' ||
        p.kind === 'ministro' ||
        p.kind === 'uiu' ||
        p.kind === 'salles' ||
        p.kind === 'pm' ||
        p.kind === 'marcola' ||
        p.kind === 'eminnym' ||
        (p.kind === 'gabigol' && !p.abilityUsed)
      ) {
        return false;
      }

      // Remaining minor pieces: b, n, jac, vitin, or gabigol with abilityUsed === true
      minors.push({ kind: p.kind, squareColor: (r + c) % 2 });
    }
  }

  // K vs K
  if (minors.length === 0) return true;
  // K + single minor vs K
  if (minors.length === 1) return true;

  // All remaining pieces are Bishops and/or Jacs on the exact same square color
  if (minors.every((m) => m.kind === 'b' || m.kind === 'jac')) {
    const firstColor = minors[0].squareColor;
    if (minors.every((m) => m.squareColor === firstColor)) {
      return true;
    }
  }

  return false;
}

export function computePositionKey(state: GameState): string {
  let rows = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) {
        rows += '.';
      } else {
        rows += `${p.color}${p.kind}${p.abilityUsed ? '1' : '0'}${p.frozenTurns ?? 0}`;
      }
      rows += ',';
    }
  }
  const ep = state.enPassantTarget ? `${state.enPassantTarget.row}${state.enPassantTarget.col}` : '-';
  const wk = state.board[7][4];
  const bk = state.board[0][4];
  const castling = [
    wk && !wk.hasMoved && state.board[7][7] && !state.board[7][7]!.hasMoved ? 'K' : '',
    wk && !wk.hasMoved && state.board[7][0] && !state.board[7][0]!.hasMoved ? 'Q' : '',
    bk && !bk.hasMoved && state.board[0][7] && !state.board[0][7]!.hasMoved ? 'k' : '',
    bk && !bk.hasMoved && state.board[0][0] && !state.board[0][0]!.hasMoved ? 'q' : '',
  ].join('');
  const forb = state.forbiddenSquares.map((f) => `${f.row}${f.col}`).sort().join('');
  return `${rows}|${state.turn}|${castling}|${ep}|${forb}`;
}

function finalizeTurnAfterMove(
  next: GameState,
  mover: Color,
  move: MoveOption,
  pieceKind: PieceKind,
  capturedKind?: PieceKind
) {
  const opp = oppositeColor(mover);
  next.turn = opp;
  if (mover === 'b') {
    next.fullMoveNumber += 1;
  }
  if (capturedKind || pieceKind === 'p') {
    next.halfMoveClock = 0;
  } else {
    next.halfMoveClock += 1;
  }

  const posKey = computePositionKey(next);
  if (!next.positionHistory) next.positionHistory = [];
  next.positionHistory.push(posKey);
  const repetitions = next.positionHistory.filter((k) => k === posKey).length;

  const oppInCheck = isKingInCheck(next, opp);
  next.inCheck = oppInCheck ? opp : null;

  const oppMoves = getAllLegalMoves(next, opp);
  let isCheckmate = false;
  if (oppMoves.length === 0) {
    if (oppInCheck) {
      next.winner = mover;
      next.endReason = 'checkmate';
      isCheckmate = true;
    } else {
      next.winner = 'draw';
      next.endReason = 'stalemate';
    }
  } else if (isInsufficientMaterial(next)) {
    next.winner = 'draw';
    next.endReason = 'insufficient_material';
  } else if (repetitions >= 3) {
    next.winner = 'draw';
    next.endReason = 'threefold';
  } else if (next.halfMoveClock >= 100) {
    next.winner = 'draw';
    next.endReason = 'fifty_move';
  }

  const notation = buildNotation(move, pieceKind, Boolean(capturedKind), oppInCheck, isCheckmate);
  next.history.push({
    moveNumber: next.fullMoveNumber - (mover === 'b' ? 1 : 0),
    color: mover,
    notation,
    kind: move.kind,
    pieceKind,
    capturedKind,
    from: move.from,
    to: move.to,
    isCheck: oppInCheck,
    isCheckmate,
  });
}

function buildNotation(
  move: MoveOption,
  pieceKind: PieceKind,
  isCapture: boolean,
  isCheck: boolean,
  isCheckmate: boolean
): string {
  const dest = posToAlgebraic(move.to);
  const src = posToAlgebraic(move.from);
  const suffix = isCheckmate ? '#' : isCheck ? '+' : '';
  if (move.kind === 'castling') {
    return (move.to.col === 6 ? 'O-O' : 'O-O-O') + suffix;
  }
  if (move.kind === 'kick') return `Gabigol ⚽×${dest}${suffix}`;
  if (move.kind === 'arrest') return `PM 🔒${dest}${suffix}`;
  if (move.kind === 'decree') return `Ministro ⛔${dest}${suffix}`;
  if (move.kind === 'pass') return `Marcola ⇄${dest}${suffix}`;
  if (move.kind === 'push') return `Salles 💪${dest}${suffix}`;

  const prefix = pieceKind === 'p' ? (isCapture ? src[0] : '') : getPieceDisplayName(pieceKind).slice(0, 2).toUpperCase();
  const sep = isCapture ? '×' : '';
  const promo = move.promoteTo ? `=${getPieceDisplayName(move.promoteTo)}` : '';
  return `${prefix}${sep}${dest}${promo}${suffix}`;
}

export function getLegalMoves(state: GameState, from: Pos): MoveOption[] {
  if (state.draft.phase !== 'playing' || state.winner || state.pendingConvocation) return [];
  const piece = state.board[from.row][from.col];
  if (!piece || piece.color !== state.turn) return [];
  if ((piece.frozenTurns ?? 0) > 0) return [];

  const pseudo = generatePseudoMoves(state, from, false);

  // Castling for King
  if (piece.kind === 'k' && !piece.hasMoved && !isKingInCheck(state, piece.color)) {
    const row = piece.color === 'w' ? 7 : 0;
    const opp = oppositeColor(piece.color);

    // Kingside
    const kRook = state.board[row][7];
    if (
      kRook &&
      kRook.color === piece.color &&
      kRook.kind === 'r' &&
      !kRook.hasMoved &&
      !state.board[row][5] &&
      !state.board[row][6] &&
      !isSquareForbidden(state, row, 5) &&
      !isSquareForbidden(state, row, 6) &&
      !isSquareAttacked(state, row, 5, opp) &&
      !isSquareAttacked(state, row, 6, opp)
    ) {
      pseudo.push({
        kind: 'castling',
        from,
        to: { row, col: 6 },
        rookFrom: { row, col: 7 },
        rookTo: { row, col: 5 },
      });
    }

    // Queenside
    const qRook = state.board[row][0];
    if (
      qRook &&
      qRook.color === piece.color &&
      qRook.kind === 'r' &&
      !qRook.hasMoved &&
      !state.board[row][1] &&
      !state.board[row][2] &&
      !state.board[row][3] &&
      !isSquareForbidden(state, row, 1) &&
      !isSquareForbidden(state, row, 2) &&
      !isSquareForbidden(state, row, 3) &&
      !isSquareAttacked(state, row, 3, opp) &&
      !isSquareAttacked(state, row, 2, opp)
    ) {
      pseudo.push({
        kind: 'castling',
        from,
        to: { row, col: 2 },
        rookFrom: { row, col: 0 },
        rookTo: { row, col: 3 },
      });
    }
  }

  // Also allow promotion to Special Piece on 8th rank if eligible
  const promoRow = piece.color === 'w' ? 0 : 7;
  if (piece.kind === 'p') {
    const avail = getConvocationOffer(state, piece.color);
    if (avail.length > 0) {
      const existingPromos = pseudo.filter((m) => m.kind === 'promotion' && m.promoteTo === 'q');
      for (const basePromo of existingPromos) {
        for (const sp of avail) {
          pseudo.push({
            ...basePromo,
            promoteTo: sp,
          });
        }
      }
    }
  }

  // Filter out moves that leave own king in check
  return pseudo.filter((move) => {
    // Temporarily simulate without triggering convocation lock
    const sim = cloneState(state);
    const p = sim.board[move.from.row][move.from.col];
    if (!p) return false;

    if (move.kind === 'kick') {
      sim.board[move.to.row][move.to.col] = null;
    } else if (move.kind === 'arrest') {
      // Board occupancy unchanged
    } else if (move.kind === 'decree') {
      sim.forbiddenSquares.push({
        row: move.to.row,
        col: move.to.col,
        halfTurnsLeft: 6,
        owner: p.color,
      });
    } else if (move.kind === 'pass') {
      const ally = sim.board[move.to.row][move.to.col];
      sim.board[move.to.row][move.to.col] = p;
      sim.board[move.from.row][move.from.col] = ally;
    } else if (move.kind === 'push') {
      const victim = sim.board[move.to.row][move.to.col];
      if (victim && !move.pushOffBoard && move.pushTo) {
        sim.board[move.pushTo.row][move.pushTo.col] = victim;
      }
      sim.board[move.to.row][move.to.col] = p;
      sim.board[move.from.row][move.from.col] = null;
    } else if (move.kind === 'castling') {
      sim.board[move.to.row][move.to.col] = p;
      sim.board[move.from.row][move.from.col] = null;
      if (move.rookFrom && move.rookTo) {
        sim.board[move.rookTo.row][move.rookTo.col] = sim.board[move.rookFrom.row][move.rookFrom.col];
        sim.board[move.rookFrom.row][move.rookFrom.col] = null;
      }
    } else {
      if (move.capturePos) {
        sim.board[move.capturePos.row][move.capturePos.col] = null;
      }
      sim.board[move.to.row][move.to.col] = p;
      sim.board[move.from.row][move.from.col] = null;
      if (move.kind === 'promotion' && move.promoteTo) {
        p.kind = move.promoteTo;
      }
    }

    // Also make sure a pawn moving to promoRow has valid promo
    if (p.kind === 'p' && move.to.row === promoRow && move.kind !== 'promotion') {
      return false;
    }

    return !isKingInCheck(sim, piece.color);
  });
}

export function getAllLegalMoves(state: GameState, color: Color): MoveOption[] {
  if (state.turn !== color || state.draft.phase !== 'playing' || state.winner) return [];
  const all: MoveOption[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.color === color) {
        all.push(...getLegalMoves(state, { row: r, col: c }));
      }
    }
  }
  return all;
}

export function applyMove(state: GameState, move: MoveOption): GameState {
  const legal = getLegalMoves(state, move.from);
  const matched = legal.find(
    (m) =>
      m.kind === move.kind &&
      m.to.row === move.to.row &&
      m.to.col === move.to.col &&
      m.promoteTo === move.promoteTo
  );
  if (!matched) return state;
  return applyMoveRaw(state, matched);
}

export function resolveConvocation(
  state: GameState,
  choice: SpecialId | ClassicKind | 'keep_pawn'
): GameState {
  const pending = state.pendingConvocation;
  if (!pending) return state;

  const next = cloneState(state);
  const piece = next.board[pending.pos.row][pending.pos.col];
  if (!piece || piece.color !== pending.color) return state;

  if (choice !== 'keep_pawn') {
    if (isSpecialKind(choice)) {
      if (!pending.availableSpecials.includes(choice)) return state;
      piece.kind = choice;
      piece.abilityUsed = false;
      next.usedSpecials[pending.color].push(choice);
    } else if (
      pending.isLastRank &&
      (choice === 'q' || choice === 'r' || choice === 'b' || choice === 'n')
    ) {
      piece.kind = choice;
    } else {
      // Cannot promote to classic piece on 6th rank, nem para rei/peao/valor invalido
      return state;
    }
  } else if (pending.isLastRank) {
    // Cannot stay pawn on 8th rank
    return state;
  }

  next.pendingConvocation = null;
  const lastMove = next.lastMove ?? {
    from: pending.pos,
    to: pending.pos,
    kind: 'convocation' as MoveKind,
  };
  finalizeTurnAfterMove(
    next,
    pending.color,
    {
      kind: choice === 'keep_pawn' ? lastMove.kind : 'convocation',
      from: lastMove.from,
      to: lastMove.to,
      promoteTo: choice === 'keep_pawn' ? undefined : choice,
    },
    piece.kind,
    undefined
  );
  return next;
}

const PIECE_VALUES: Record<PieceKind, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
  gabigol: 450,
  salles: 420,
  hbarril: 520,
  pm: 390,
  ministro: 540,
  vitin: 380,
  marcola: 370,
  eminnym: 460,
  jac: 430,
  uiu: 600,
};

export function evaluateBoard(state: GameState, perspective: Color): number {
  if (state.winner === perspective) return 100000;
  if (state.winner === oppositeColor(perspective)) return -100000;
  if (state.winner === 'draw') return 0;

  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      let val = PIECE_VALUES[p.kind];
      // Positional center bonus
      const centerDist = Math.abs(3.5 - r) + Math.abs(3.5 - c);
      val += Math.round((7 - centerDist) * 6);
      // Pawn advancement bonus
      if (p.kind === 'p') {
        const adv = p.color === 'w' ? 6 - r : r - 1;
        val += adv * 14;
      }
      if (p.frozenTurns && p.frozenTurns > 0) {
        val -= 60;
      }
      score += p.color === perspective ? val : -val;
    }
  }
  return score;
}

export function chooseBestAIMove(state: GameState, aiColor: Color, depth = 3): MoveOption | null {
  if (state.pendingConvocation && state.pendingConvocation.color === aiColor) {
    return null;
  }
  const moves = getAllLegalMoves(state, aiColor);
  if (moves.length === 0) return null;

  // Order captures and special abilities first for better alpha-beta pruning
  moves.sort((a, b) => {
    const scoreMove = (m: MoveOption) => {
      let s = 0;
      if (m.capturePos) {
        const v = state.board[m.capturePos.row][m.capturePos.col];
        s += v ? PIECE_VALUES[v.kind] : 100;
      }
      if (m.kind === 'promotion') s += 700;
      if (m.kind === 'kick' || m.kind === 'push') s += 350;
      return s;
    };
    return scoreMove(b) - scoreMove(a);
  });

  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    let next = applyMoveRaw(state, move);
    if (next.pendingConvocation && next.pendingConvocation.color === aiColor) {
      const avail = next.pendingConvocation.availableSpecials;
      const choice: SpecialId | ClassicKind =
        avail.length > 0 ? avail[0] : next.pendingConvocation.isLastRank ? 'q' : 'p';
      next = resolveConvocation(
        next,
        choice === 'p' ? 'keep_pawn' : choice
      );
    }
    const val = minimax(next, depth - 1, -Infinity, Infinity, false, aiColor);
    if (val > bestScore) {
      bestScore = val;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  aiColor: Color
): number {
  if (depth === 0 || state.winner !== null) {
    return evaluateBoard(state, aiColor);
  }

  const currColor = state.turn;
  const moves = getAllLegalMoves(state, currColor);
  if (moves.length === 0) {
    return evaluateBoard(state, aiColor);
  }

  // Cap branching slightly at deeper nodes for snappy response
  const ordered = moves.slice(0, depth >= 2 ? 28 : 18);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of ordered) {
      let next = applyMoveRaw(state, move);
      if (next.pendingConvocation) {
        const av = next.pendingConvocation.availableSpecials;
        next = resolveConvocation(
          next,
          av.length > 0 ? av[0] : next.pendingConvocation.isLastRank ? 'q' : 'keep_pawn'
        );
      }
      const ev = minimax(next, depth - 1, alpha, beta, false, aiColor);
      if (ev > maxEval) maxEval = ev;
      if (ev > alpha) alpha = ev;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of ordered) {
      let next = applyMoveRaw(state, move);
      if (next.pendingConvocation) {
        const av = next.pendingConvocation.availableSpecials;
        next = resolveConvocation(
          next,
          av.length > 0 ? av[0] : next.pendingConvocation.isLastRank ? 'q' : 'keep_pawn'
        );
      }
      const ev = minimax(next, depth - 1, alpha, beta, true, aiColor);
      if (ev < minEval) minEval = ev;
      if (ev < beta) beta = ev;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}
