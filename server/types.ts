// Interfaces internas do servidor (contrato entre os modulos).
import type { LeaderboardEntry, MatchResult, PlayerIdentity, PointsAward } from '../src/shared/protocol';

export interface MatchRecord {
  id: string;
  roomId: string;
  white: PlayerIdentity;
  black: PlayerIdentity;
  result: MatchResult;
  reason: string;
  moves: number;
  counted: boolean;
  whiteDelta: number;
  blackDelta: number;
  endedAt: number;
}

export interface PlayerStats {
  userId: string;
  name: string;
  avatarUrl: string | null;
  points: number;
  wins: number;
  losses: number;
  draws: number;
}

/** Persistencia. JsonStore agora, Postgres depois, sem mudar quem consome. */
export interface Store {
  /** Grava a partida e atualiza agregados dos dois jogadores de forma atomica. */
  recordMatch(rec: MatchRecord): Promise<void>;
  getStats(userId: string): Promise<PlayerStats | null>;
  getTop(limit: number): Promise<LeaderboardEntry[]>;
  getRank(userId: string): Promise<number | null>;
  /** Partidas PONTUADAS hoje (dia local do servidor) entre os dois, em qualquer ordem de cor. */
  countPairToday(userA: string, userB: string): Promise<number>;
  /** Partidas e pontos de hoje (dia local) do usuario contra a IA, so as pontuadas. */
  countAiToday(userId: string): Promise<{ games: number; points: number }>;
  recentMatches(limit: number): Promise<MatchRecord[]>;
}

export interface FinishMatchInput {
  roomId: string;
  white: PlayerIdentity | null;
  black: PlayerIdentity | null;
  result: MatchResult;
  reason: string;
  /** jogadas completas */
  moves: number;
}

export interface FinishAiMatchInput {
  user: PlayerIdentity;
  level: string;
  /** do ponto de vista do jogador humano */
  outcome: 'win' | 'draw' | 'loss';
  reason: string;
  moves: number;
}

export interface Leaderboard {
  /** Pontua uma partida contra a IA (ja conferida) e grava. Nunca lanca. */
  finishAiMatch(input: FinishAiMatchInput): Promise<PointsAward>;
  /** Calcula pontos (src/shared/scoring.ts), grava no Store e devolve os premios. Nunca lanca por falha de IA/jogador ausente: devolve counted=false. */
  finishMatch(input: FinishMatchInput): Promise<PointsAward[]>;
}

export class AuthError extends Error {
  constructor(public code: 'invalid_token' | 'expired_token' | 'auth_unavailable', message?: string) {
    super(message ?? code);
  }
}

export type VerifyToken = (token: string) => Promise<PlayerIdentity>;
