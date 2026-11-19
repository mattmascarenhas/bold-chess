// IA do Bold Chess: busca negamax com poda alfa-beta, aprofundamento iterativo, tabela de transposicao,
// quiescencia, ordenacao de lances (captura/killer/historico) e avaliacao posicional.
// Funciona com as regras da variante (pecas especiais, habilidades, convocacao) usando o motor do jogo.
import {
  PIECE_VALUES,
  applyMoveFast,
  collectCandidateMoves,
  computePositionKey,
  getAllLegalMoves,
  isInsufficientMaterial,
  isKingInCheck,
  moveKeepsKingSafe,
  oppositeColor,
  resolveConvocationFast,
} from './engine';
import { ClassicKind, Color, GameState, MoveOption, Piece, SpecialId, isSpecialKind } from './types';

export type AIDifficulty = 'facil' | 'medio' | 'dificil' | 'mestre' | 'deus';

export interface AILevel {
  id: AIDifficulty;
  label: string;
  tagline: string;
  description: string;
  maxDepth: number;
  /** tempo maximo de pensamento por jogada (ms) */
  timeMs: number;
  /** ruido (em centipeoes) somado a cada lance na escolha: quanto maior, mais erros */
  noise: number;
  /** chance de jogar um lance aleatorio qualquer */
  blunder: number;
  /** busca todos os lances na raiz (necessario para aplicar ruido) */
  scoreAllRootMoves: boolean;
}

export const AI_LEVELS: AILevel[] = [
  {
    id: 'facil',
    label: 'Fácil',
    tagline: 'Para aprender',
    description: 'Enxerga só o próximo lance e comete erros com frequência.',
    maxDepth: 1,
    timeMs: 150,
    noise: 260,
    blunder: 0.18,
    scoreAllRootMoves: true,
  },
  {
    id: 'medio',
    label: 'Médio',
    tagline: 'Desafio leve',
    description: 'Calcula dois lances à frente e ainda erra de vez em quando.',
    maxDepth: 2,
    timeMs: 500,
    noise: 90,
    blunder: 0.04,
    scoreAllRootMoves: true,
  },
  {
    id: 'dificil',
    label: 'Difícil',
    tagline: 'Joga a sério',
    description: 'Calcula vários lances, protege as peças e pune descuidos.',
    maxDepth: 5,
    timeMs: 1500,
    noise: 0,
    blunder: 0,
    scoreAllRootMoves: false,
  },
  {
    id: 'mestre',
    label: 'Mestre',
    tagline: 'Muito forte',
    description: 'Busca profunda e boa noção de posição. Poucos jogadores vencem.',
    maxDepth: 9,
    timeMs: 4000,
    noise: 0,
    blunder: 0,
    scoreAllRootMoves: false,
  },
  {
    id: 'deus',
    label: 'Modo Deus',
    tagline: 'Quase imbatível',
    description: 'Pensa o máximo que puder em cada jogada. Sem erros, sem piedade.',
    maxDepth: 24,
    timeMs: 9000,
    noise: 0,
    blunder: 0,
    scoreAllRootMoves: false,
  },
];

export const DEFAULT_AI_LEVEL: AIDifficulty = 'medio';

export function getAILevel(id: AIDifficulty | undefined): AILevel {
  return AI_LEVELS.find((l) => l.id === id) ?? AI_LEVELS[1];
}

export interface AIResult {
  move: MoveOption | null;
  /** profundidade completa alcancada */
  depth: number;
  /** pontuacao em centipeoes do ponto de vista de quem joga */
  score: number;
  nodes: number;
  ms: number;
}

export interface SearchOptions {
  /** limite extra de tempo (ex.: pouco tempo restante no relogio) */
  timeBudgetMs?: number;
  /** relogio injetavel para testes */
  now?: () => number;
  /** gerador aleatorio injetavel para testes */
  random?: () => number;
  /** limite de nos (testes) */
  maxNodes?: number;
}

const MATE = 100_000;
const INF = 1_000_000;

// ---------------------------------------------------------------------------
// Avaliacao
// ---------------------------------------------------------------------------
// Tabelas de posicao (visao das brancas: linha 0 = ultima fileira das pretas).
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0,
    20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15,
    5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30,
    -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10,
    -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0,
    -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0,
    5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  kMid: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30,
    -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0,
    0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30,
    40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

/** Bonus por habilidade ainda disponivel (so vale enquanto nao foi usada). */
const ABILITY_BONUS: Partial<Record<string, number>> = { gabigol: 70, pm: 25, ministro: 25, marcola: 15 };

/** Avaliacao estatica do ponto de vista de `color` (positivo = bom para `color`). */
export function evaluate(state: GameState, color: Color): number {
  if (state.winner === color) return MATE;
  if (state.winner === oppositeColor(color)) return -MATE;
  if (state.winner === 'draw') return 0;

  let white = 0;
  let black = 0;
  let nonPawn = 0; // material "pesado" de ambos os lados (define meio-jogo x final)
  let pieces = 0;
  const pawnsOnFile: Record<Color, number[]> = { w: new Array(8).fill(0), b: new Array(8).fill(0) };
  const pawnRows: Record<Color, number[][]> = { w: [[], [], [], [], [], [], [], []], b: [[], [], [], [], [], [], [], []] };
  const bishops: Record<Color, number> = { w: 0, b: 0 };
  const kings: Record<Color, { r: number; c: number } | null> = { w: null, b: null };

  for (let r = 0; r < 8; r++) {
    const row = state.board[r];
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (!p) continue;
      pieces++;
      if (p.kind === 'p') {
        pawnsOnFile[p.color][c]++;
        pawnRows[p.color][c].push(r);
      } else if (p.kind !== 'k') nonPawn += PIECE_VALUES[p.kind];
      if (p.kind === 'b') bishops[p.color]++;
      if (p.kind === 'k') kings[p.color] = { r, c };
    }
  }
  const endgame = nonPawn < 2600;

  for (let r = 0; r < 8; r++) {
    const row = state.board[r];
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (!p) continue;
      const idx = (p.color === 'w' ? r : 7 - r) * 8 + c;
      let v = PIECE_VALUES[p.kind];
      if (p.kind === 'k') {
        v = (endgame ? PST.kEnd : PST.kMid)[idx];
      } else if (PST[p.kind]) {
        v += PST[p.kind][idx];
      } else {
        // pecas especiais: bonus de centro e de avanco leve
        const centerDist = Math.abs(3.5 - r) + Math.abs(3.5 - c);
        v += Math.round((7 - centerDist) * 5);
        if (!p.abilityUsed && ABILITY_BONUS[p.kind]) v += ABILITY_BONUS[p.kind]!;
      }
      if (p.frozenTurns && p.frozenTurns > 0) v -= 70;
      if (p.color === 'w') white += v;
      else black += v;
    }
  }

  for (const col of ['w', 'b'] as Color[]) {
    let s = 0;
    if (bishops[col] >= 2) s += 30;
    for (let c = 0; c < 8; c++) {
      const n = pawnsOnFile[col][c];
      if (n > 1) s -= 12 * (n - 1);
      if (n > 0) {
        const left = c > 0 ? pawnsOnFile[col][c - 1] : 0;
        const right = c < 7 ? pawnsOnFile[col][c + 1] : 0;
        if (left === 0 && right === 0) s -= 10;
        // peao passado: nenhum peao adversario a frente na coluna e nas vizinhas
        const rowsMine = pawnRows[col][c];
        const advRow = col === 'w' ? Math.min(...rowsMine) : Math.max(...rowsMine);
        const opp = oppositeColor(col);
        let passed = true;
        for (let dc = -1; dc <= 1 && passed; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc > 7) continue;
          for (const orow of pawnRows[opp][cc]) {
            if (col === 'w' ? orow < advRow : orow > advRow) {
              passed = false;
              break;
            }
          }
        }
        if (passed) {
          const adv = col === 'w' ? 6 - advRow : advRow - 1; // 0..5
          s += 10 + adv * adv * 4 + (endgame ? adv * 8 : 0);
        }
      }
    }
    // seguranca do rei no meio-jogo: peoes de escudo
    const k = kings[col];
    if (k && !endgame) {
      const dir = col === 'w' ? -1 : 1;
      let shield = 0;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = k.c + dc;
        if (cc < 0 || cc > 7) continue;
        const rr = k.r + dir;
        if (rr >= 0 && rr < 8) {
          const q = state.board[rr][cc];
          if (q && q.color === col && q.kind === 'p') shield++;
        }
        if (pawnsOnFile[col][cc] === 0) s -= 12; // coluna aberta perto do rei
      }
      s += shield * 10;
    }
    if (col === 'w') white += s;
    else black += s;
  }

  if (pieces <= 4 && isInsufficientMaterial(state)) return 0;

  const diff = white - black + (state.turn === 'w' ? 10 : -10);
  return color === 'w' ? diff : -diff;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------
const KIND_IDX: Record<string, number> = {
  move: 0,
  castling: 1,
  enpassant: 2,
  promotion: 3,
  convocation: 4,
  push: 5,
  kick: 6,
  arrest: 7,
  decree: 8,
  pass: 9,
};

function moveKey(m: MoveOption): number {
  const base = (m.from.row * 8 + m.from.col) * 64 + m.to.row * 8 + m.to.col;
  let promo = 0;
  if (m.promoteTo) {
    let h = 0;
    for (let i = 0; i < m.promoteTo.length; i++) h = (h * 31 + m.promoteTo.charCodeAt(i)) % 97;
    promo = 1 + h;
  }
  return base + 4096 * ((KIND_IDX[m.kind] ?? 0) + 10 * promo);
}

interface TTEntry {
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // exato, limite inferior, limite superior
  move: number; // moveKey ou -1
}

class Stop extends Error {}

interface Ctx {
  now: () => number;
  deadline: number;
  nodes: number;
  maxNodes: number;
  tt: Map<string, TTEntry>;
  killers: number[][];
  history: Int32Array;
  gameCounts: Map<string, number>;
  path: string[];
}

function genMoves(state: GameState, color: Color): MoveOption[] {
  const out: MoveOption[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.color === color && !(p.frozenTurns && p.frozenTurns > 0)) {
        const ms = collectCandidateMoves(state, { row: r, col: c }, p);
        for (let i = 0; i < ms.length; i++) out.push(ms[i]);
      }
    }
  }
  return out;
}

/** Valor da peca capturada pelo lance (0 se nao captura). */
function captureValue(state: GameState, m: MoveOption, mover: Color): number {
  if (m.kind === 'arrest' || m.kind === 'decree' || m.kind === 'pass' || m.kind === 'castling') return 0;
  const pos = m.capturePos ?? m.to;
  const v = state.board[pos.row][pos.col];
  if (!v || v.color === mover) return 0;
  if (m.kind === 'push' && !m.pushOffBoard) return 0;
  return PIECE_VALUES[v.kind];
}

function orderMoves(ctx: Ctx, state: GameState, moves: MoveOption[], ttMove: number, ply: number): MoveOption[] {
  const mover = state.turn;
  const scored = moves.map((m) => {
    const key = moveKey(m);
    let s = 0;
    if (key === ttMove) s = 10_000_000;
    else {
      const cap = captureValue(state, m, mover);
      const att = state.board[m.from.row][m.from.col];
      if (cap > 0) s = 1_000_000 + cap * 10 - (att ? Math.min(PIECE_VALUES[att.kind], 1000) : 0);
      else if (m.kind === 'promotion') s = 900_000 + (m.promoteTo ? (PIECE_VALUES[m.promoteTo] ?? 0) : 0);
      else if (ctx.killers[ply]?.[0] === key) s = 800_000;
      else if (ctx.killers[ply]?.[1] === key) s = 700_000;
      else {
        s = ctx.history[(mover === 'w' ? 0 : 4096) + m.from.row * 512 + m.from.col * 64 + m.to.row * 8 + m.to.col];
        if (m.kind === 'kick' || m.kind === 'push') s += 5000;
      }
    }
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

/** Depois de um lance que abre convocacao, escolhe (de forma barata) a melhor opcao para quem convocou. */
function settleConvocation(child: GameState, mover: Color): GameState {
  const pc = child.pendingConvocation;
  if (!pc) return child;
  const choices: Array<SpecialId | ClassicKind | 'keep_pawn'> = [...pc.availableSpecials];
  if (pc.isLastRank) choices.push('q');
  else choices.push('keep_pawn');
  let best: GameState | null = null;
  let bestScore = -INF;
  for (const ch of choices) {
    const r = resolveConvocationFast(child, ch);
    if (r === child) continue;
    const sc = evaluate(r, mover);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return best ?? child;
}

function childOf(state: GameState, m: MoveOption, mover: Color): GameState {
  const c = applyMoveFast(state, m);
  return c.pendingConvocation ? settleConvocation(c, mover) : c;
}

/** True se `color` tem alguma peca alem de rei e peoes (evita lance nulo em finais de zugzwang). */
function hasHeavyMaterial(state: GameState, color: Color): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p.color === color && p.kind !== 'p' && p.kind !== 'k') return true;
    }
  }
  return false;
}

function checkStop(ctx: Ctx) {
  if ((ctx.nodes & 255) === 0 && (ctx.now() > ctx.deadline || ctx.nodes > ctx.maxNodes)) throw new Stop();
}

function quiesce(ctx: Ctx, state: GameState, alpha: number, beta: number, ply: number, qdepth: number): number {
  ctx.nodes++;
  checkStop(ctx);
  const color = state.turn;
  const stand = evaluate(state, color);
  if (qdepth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;

  const moves = genMoves(state, color);
  const caps: Array<{ m: MoveOption; s: number }> = [];
  for (const m of moves) {
    const cap = captureValue(state, m, color);
    if (cap === 0 && m.kind !== 'promotion') continue;
    // poda por delta: nem capturando esta peca se alcanca alpha
    if (stand + cap + 200 < alpha && m.kind !== 'promotion') continue;
    const att = state.board[m.from.row][m.from.col];
    caps.push({ m, s: cap * 10 - (att ? Math.min(PIECE_VALUES[att.kind], 1000) : 0) + (m.kind === 'promotion' ? 5000 : 0) });
  }
  caps.sort((a, b) => b.s - a.s);

  for (const { m } of caps) {
    const piece = state.board[m.from.row][m.from.col] as Piece;
    if (!moveKeepsKingSafe(state, m, piece)) continue;
    const score = -quiesce(ctx, childOf(state, m, color), -beta, -alpha, ply + 1, qdepth - 1);
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(
  ctx: Ctx,
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  nullOk = true
): number {
  ctx.nodes++;
  checkStop(ctx);
  const color = state.turn;

  if (state.halfMoveClock >= 100) return 0;

  const key = computePositionKey(state);
  if ((ctx.gameCounts.get(key) ?? 0) >= 2 || ctx.path.includes(key)) return 0; // repeticao = empate

  const alphaOrig = alpha;
  const tt = ctx.tt.get(key);
  let ttMove = -1;
  if (tt) {
    ttMove = tt.move;
    if (tt.depth >= depth) {
      let sc = tt.score;
      if (sc > MATE - 1000) sc -= ply;
      else if (sc < -MATE + 1000) sc += ply;
      if (tt.flag === 0) return sc;
      if (tt.flag === 1 && sc > alpha) alpha = sc;
      else if (tt.flag === 2 && sc < beta) beta = sc;
      if (alpha >= beta) return sc;
    }
  }

  const inCheck = isKingInCheck(state, color);
  if (inCheck && ply < 40) depth++; // extensao de xeque
  if (depth <= 0) return quiesce(ctx, state, alpha, beta, ply, 6);

  // Lance nulo: se passar a vez ainda supera beta, a posicao e muito boa (poda). Evita finais sem pecas pesadas.
  if (nullOk && !inCheck && depth >= 3 && beta < MATE - 1000 && hasHeavyMaterial(state, color)) {
    const skip: GameState = { ...state, turn: oppositeColor(color), enPassantTarget: null };
    ctx.path.push(key);
    let sc: number;
    try {
      sc = -negamax(ctx, skip, depth - 1 - (depth >= 6 ? 3 : 2), -beta, -beta + 1, ply + 1, false);
    } finally {
      ctx.path.pop();
    }
    if (sc >= beta) return sc;
  }

  const futile = depth <= 2 && !inCheck && alpha > -MATE + 1000 && beta < MATE - 1000 && evaluate(state, color) + 140 * depth + 60 <= alpha;

  const moves = orderMoves(ctx, state, genMoves(state, color), ttMove, ply);
  ctx.path.push(key);
  let best = -INF;
  let bestMove = -1;
  let legal = 0;
  try {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const piece = state.board[m.from.row][m.from.col] as Piece;
      if (!moveKeepsKingSafe(state, m, piece)) continue;
      legal++;
      const isCap = captureValue(state, m, color) > 0;
      // poda por futilidade: lance tranquilo sem chance de recuperar a diferenca
      if (futile && legal > 1 && !isCap && m.kind === 'move' && !m.promoteTo) continue;
      const child = childOf(state, m, color);
      let score: number;
      if (legal === 1) {
        score = -negamax(ctx, child, depth - 1, -beta, -alpha, ply + 1);
      } else {
        // reducao de lances tardios + busca de janela nula
        let red = 0;
        if (depth >= 3 && legal > 4 && !isCap && !inCheck && m.kind === 'move') red = legal > 10 ? 2 : 1;
        score = -negamax(ctx, child, depth - 1 - red, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && red > 0) score = -negamax(ctx, child, depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta) score = -negamax(ctx, child, depth - 1, -beta, -alpha, ply + 1);
      }
      if (score > best) {
        best = score;
        bestMove = moveKey(m);
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!isCap) {
          const k = ctx.killers[ply] ?? (ctx.killers[ply] = []);
          if (k[0] !== bestMove) {
            k[1] = k[0];
            k[0] = bestMove;
          }
          ctx.history[(color === 'w' ? 0 : 4096) + m.from.row * 512 + m.from.col * 64 + m.to.row * 8 + m.to.col] += depth * depth;
        }
        break;
      }
    }
  } finally {
    ctx.path.pop();
  }

  if (legal === 0) return inCheck ? -MATE + ply : 0;

  if (ctx.tt.size > 400_000) ctx.tt.clear();
  let store = best;
  if (store > MATE - 1000) store += ply;
  else if (store < -MATE + 1000) store -= ply;
  ctx.tt.set(key, { depth, score: store, flag: best <= alphaOrig ? 2 : best >= beta ? 1 : 0, move: bestMove });
  return best;
}

function newCtx(state: GameState, opts: SearchOptions, timeMs: number): Ctx {
  const now = opts.now ?? (() => performance.now());
  const counts = new Map<string, number>();
  for (const k of state.positionHistory ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
  return {
    now,
    deadline: now() + timeMs,
    nodes: 0,
    maxNodes: opts.maxNodes ?? Infinity,
    tt: new Map(),
    killers: [],
    history: new Int32Array(8192),
    gameCounts: counts,
    path: [],
  };
}

function effectiveTime(level: AILevel, opts: SearchOptions): number {
  return Math.max(30, Math.min(level.timeMs, opts.timeBudgetMs ?? level.timeMs));
}

/** Melhor lance para `color` no nivel pedido. */
export function searchBestMove(
  state: GameState,
  color: Color,
  levelOrId: AILevel | AIDifficulty = DEFAULT_AI_LEVEL,
  opts: SearchOptions = {}
): AIResult {
  const level = typeof levelOrId === 'string' ? getAILevel(levelOrId) : levelOrId;
  const rnd = opts.random ?? Math.random;
  // Abertura: posicoes de livro nao pedem tanto tempo
  const timeMs = effectiveTime(level, opts) * (state.fullMoveNumber <= 2 ? 0.5 : 1);
  const ctx = newCtx(state, opts, timeMs);
  const t0 = ctx.now();

  if (state.pendingConvocation && state.pendingConvocation.color === color) {
    return { move: null, depth: 0, score: 0, nodes: 0, ms: 0 };
  }
  const rootMoves = getAllLegalMoves(state, color); // exato: so lances realmente legais
  if (rootMoves.length === 0) return { move: null, depth: 0, score: 0, nodes: 0, ms: 0 };
  if (rootMoves.length === 1) return { move: rootMoves[0], depth: 0, score: 0, nodes: 0, ms: ctx.now() - t0 };

  const done = (move: MoveOption, depth: number, score: number): AIResult => ({
    move,
    depth,
    score,
    nodes: ctx.nodes,
    ms: ctx.now() - t0,
  });

  // Erro deliberado nos niveis baixos
  if (level.blunder > 0 && rnd() < level.blunder) {
    return done(rootMoves[Math.floor(rnd() * rootMoves.length)], 0, 0);
  }

  const shuffled = rootMoves
    .map((m) => ({ m, r: rnd() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.m);
  let ordered = orderMoves(ctx, state, shuffled, -1, 0);

  // Niveis baixos: pontua todos os lances (janela cheia) e escolhe com ruido.
  if (level.scoreAllRootMoves) {
    const scores = new Map<MoveOption, number>();
    try {
      for (let d = 1; d <= level.maxDepth; d++) {
        for (const m of ordered) {
          const s = -negamax(ctx, childOf(state, m, color), d - 1, -INF, INF, 1);
          scores.set(m, s);
        }
        ordered = [...ordered].sort((a, b) => (scores.get(b) ?? -INF) - (scores.get(a) ?? -INF));
      }
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
    }
    let pick = ordered[0];
    let pickScore = -INF;
    for (const m of ordered) {
      const base = scores.get(m);
      if (base === undefined) continue;
      const noisy = base + (rnd() + rnd() + rnd() - 1.5) * level.noise * 1.4;
      if (noisy > pickScore) {
        pickScore = noisy;
        pick = m;
      }
    }
    return done(pick, level.maxDepth, scores.get(pick) ?? 0);
  }

  // Niveis altos: aprofundamento iterativo com PVS.
  let bestMove = ordered[0];
  let bestScore = -INF;
  let reached = 0;
  try {
    for (let depth = 1; depth <= level.maxDepth; depth++) {
      let alpha = -INF;
      const beta = INF;
      let iterBest: MoveOption | null = null;
      let iterScore = -INF;
      const results: Array<{ m: MoveOption; s: number }> = [];
      for (let i = 0; i < ordered.length; i++) {
        const m = ordered[i];
        const child = childOf(state, m, color);
        let s: number;
        try {
          if (i === 0) s = -negamax(ctx, child, depth - 1, -beta, -alpha, 1);
          else {
            s = -negamax(ctx, child, depth - 1, -alpha - 1, -alpha, 1);
            if (s > alpha) s = -negamax(ctx, child, depth - 1, -beta, -alpha, 1);
          }
        } catch (e) {
          if (e instanceof Stop) {
            // iteracao incompleta: aceita um lance que ja superou o melhor da iteracao anterior
            if (iterBest && iterScore > bestScore) {
              bestMove = iterBest;
              bestScore = iterScore;
            }
            throw e;
          }
          throw e;
        }
        results.push({ m, s });
        if (s > iterScore) {
          iterScore = s;
          iterBest = m;
        }
        if (s > alpha) alpha = s;
      }
      // iteracao completa
      bestMove = iterBest ?? bestMove;
      bestScore = iterScore;
      reached = depth;
      // proxima iteracao comeca pelo melhor lance e segue a ordem dos resultados
      results.sort((a, b) => b.s - a.s);
      ordered = results.map((r) => r.m);
      if (bestScore > MATE - 1000) break; // mate encontrado
      if (bestScore < -MATE + 1000 && depth >= 4) break; // perdido de qualquer forma
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  return done(bestMove, reached, bestScore);
}

/** Escolha da peca na convocacao/promocao, conforme o nivel. */
export function chooseConvocation(
  state: GameState,
  color: Color,
  levelOrId: AILevel | AIDifficulty = DEFAULT_AI_LEVEL,
  opts: SearchOptions = {}
): SpecialId | ClassicKind | 'keep_pawn' {
  const level = typeof levelOrId === 'string' ? getAILevel(levelOrId) : levelOrId;
  const rnd = opts.random ?? Math.random;
  const pc = state.pendingConvocation;
  if (!pc || pc.color !== color) return 'keep_pawn';
  const choices: Array<SpecialId | ClassicKind | 'keep_pawn'> = [...pc.availableSpecials];
  if (pc.isLastRank) choices.push('q', 'r', 'b', 'n');
  else choices.push('keep_pawn');

  if (level.id === 'facil') {
    const specials = choices.filter((c) => isSpecialKind(c as never));
    const pool = specials.length ? specials : choices;
    return pool[Math.floor(rnd() * pool.length)];
  }

  // cada opcao vira um estado; avalia com busca curta (quanto mais forte o nivel, mais fundo)
  const depth = level.id === 'medio' ? 1 : level.id === 'dificil' ? 3 : level.id === 'mestre' ? 5 : 7;
  const perChoice = Math.max(60, Math.floor(effectiveTime(level, opts) / (choices.length * 2)));
  let best = choices[0];
  let bestScore = -INF;
  for (const ch of choices) {
    const after = resolveConvocationFast(state, ch);
    if (after === state) continue;
    let score: number;
    if (after.winner) score = evaluate(after, color);
    else {
      const ctx = newCtx(after, opts, perChoice);
      try {
        score = -negamax(ctx, after, depth, -INF, INF, 1);
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        score = evaluate(after, color);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = ch;
    }
  }
  return best;
}
