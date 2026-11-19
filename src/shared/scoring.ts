import type { MatchResult } from './protocol';

export const POINTS = {
  win: 30,
  loss: 10,
  draw: 15,
  upsetBonus: 5,
} as const;

export const MIN_MOVES_TO_COUNT = 10;
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

  return i.result === 'w'
    ? { counted: true, white: win, black: POINTS.loss }
    : { counted: true, white: POINTS.loss, black: win };
}
