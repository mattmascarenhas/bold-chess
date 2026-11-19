import type { MatchResult } from './protocol';

export const POINTS = {
  win: 30,
  /** derrota sem tempo medido (partidas antigas): valor fixo */
  loss: 10,
  draw: 15,
  upsetBonus: 5,
} as const;

export const MIN_MOVES_TO_COUNT = 10;

/** Derrota contra jogador: pontos pelo tempo jogado (1 por minuto, de 2 a 20). */
export const LOSS_MIN = 2;
export const LOSS_MAX = 20;

export function lossPointsForDuration(durationMs: number | undefined): number {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return POINTS.loss;
  return Math.min(LOSS_MAX, Math.max(LOSS_MIN, Math.floor(durationMs / 60_000)));
}
export const MAX_PAIR_MATCHES_PER_DAY = 5;

export interface ScoreInput {
  whiteId: string;
  blackId: string;
  result: MatchResult;
  /** Pontos atuais antes da partida */
  whitePoints: number;
  blackPoints: number;
  /** Jogadas completas (fullMoveNumber - 1) */
  moves: number;
  /** Partidas ja pontuadas hoje entre os dois */
  pairMatchesToday: number;
  /** Duracao da partida em ms (da entrada do 2o jogador ate o fim); define os pontos de quem perde */
  durationMs?: number;
}

export interface ScoreOutput {
  counted: boolean;
  reason?: 'too_short' | 'pair_limit' | 'same_user';
  white: number;
  black: number;
}

/** Regra pura de pontuacao. Desistencia e tratada como derrota (result ja vem resolvido). */
export function computeScore(i: ScoreInput): ScoreOutput {
  if (i.whiteId === i.blackId) return { counted: false, reason: 'same_user', white: 0, black: 0 };
  if (i.moves < MIN_MOVES_TO_COUNT) return { counted: false, reason: 'too_short', white: 0, black: 0 };
  if (i.pairMatchesToday >= MAX_PAIR_MATCHES_PER_DAY) return { counted: false, reason: 'pair_limit', white: 0, black: 0 };

  if (i.result === 'draw') return { counted: true, white: POINTS.draw, black: POINTS.draw };

  const winnerPts = i.result === 'w' ? i.whitePoints : i.blackPoints;
  const loserPts = i.result === 'w' ? i.blackPoints : i.whitePoints;
  const win = POINTS.win + (loserPts > winnerPts ? POINTS.upsetBonus : 0);

  const loss = lossPointsForDuration(i.durationMs);
  return i.result === 'w' ? { counted: true, white: win, black: loss } : { counted: true, white: loss, black: win };
}

// ---------- Partidas contra a IA ----------
export type AiLevelId = 'facil' | 'medio' | 'dificil' | 'mestre' | 'deus';

/** Pontos por nivel: vitoria vale bem mais nos niveis altos; derrota contra a IA nao pontua. */
export const AI_POINTS: Record<AiLevelId, { win: number; draw: number; loss: number }> = {
  facil: { win: 5, draw: 2, loss: 0 },
  medio: { win: 12, draw: 6, loss: 0 },
  dificil: { win: 25, draw: 12, loss: 0 },
  mestre: { win: 45, draw: 22, loss: 0 },
  deus: { win: 80, draw: 40, loss: 0 },
};

export const AI_MIN_MOVES_TO_COUNT = 10;
/** Limites diarios (partidas contra a IA sao reportadas pelo cliente e conferidas por repeticao dos lances). */
export const AI_MAX_GAMES_PER_DAY = 15;
export const AI_MAX_POINTS_PER_DAY = 400;

export function isAiLevel(v: unknown): v is AiLevelId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AI_POINTS, v);
}

export interface AiScoreInput {
  level: AiLevelId;
  /** resultado do ponto de vista do jogador humano */
  outcome: 'win' | 'draw' | 'loss';
  /** jogadas completas */
  moves: number;
  /** partidas contra a IA ja pontuadas hoje */
  gamesToday: number;
  /** pontos ja ganhos hoje contra a IA */
  pointsToday: number;
}

export interface AiScoreOutput {
  counted: boolean;
  delta: number;
  reason?: 'too_short' | 'daily_limit';
}

export function computeAiScore(i: AiScoreInput): AiScoreOutput {
  if (i.moves < AI_MIN_MOVES_TO_COUNT) return { counted: false, delta: 0, reason: 'too_short' };
  if (i.gamesToday >= AI_MAX_GAMES_PER_DAY || i.pointsToday >= AI_MAX_POINTS_PER_DAY) {
    return { counted: false, delta: 0, reason: 'daily_limit' };
  }
  const p = AI_POINTS[i.level];
  const base = i.outcome === 'win' ? p.win : i.outcome === 'draw' ? p.draw : p.loss;
  // nunca passa do teto diario
  const delta = Math.min(base, AI_MAX_POINTS_PER_DAY - i.pointsToday);
  return { counted: true, delta };
}
