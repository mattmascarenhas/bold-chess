// Conferencia de partidas contra a IA: repete os lances no motor do jogo e deduz o resultado.
// O cliente envia as acoes; o servidor nao confia no resultado informado, so em lances legais.
import { applyMove, createInitialState, resolveConvocation } from '../../src/game/engine';
import { isSpecialKind, type GameState, type MoveKind, type PieceKind } from '../../src/game/types';
import type { AiAction } from '../../src/shared/protocol';

export const MAX_AI_ACTIONS = 700;

export type AiVerdict =
  | { ok: true; outcome: 'win' | 'draw' | 'loss'; reason: string; moves: number }
  | { ok: false; why: string };

const KINDS = new Set<string>(['move', 'castling', 'enpassant', 'promotion', 'convocation', 'push', 'kick', 'arrest', 'decree', 'pass']);
const inB = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 8;
const sq = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && inB(v[0]) && inB(v[1]);

/** Repete a partida (jogador = brancas) e devolve o resultado do ponto de vista do jogador. */
export function verifyAiGame(actions: unknown, outcome?: unknown): AiVerdict {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_AI_ACTIONS) return { ok: false, why: 'actions' };
  let st: GameState = createInitialState(true);

  for (const raw of actions as AiAction[]) {
    if (!raw || typeof raw !== 'object') return { ok: false, why: 'shape' };
    if (st.winner) return { ok: false, why: 'after_end' };

    if (raw.k === 'm') {
      if (!sq(raw.f) || !sq(raw.t) || typeof raw.d !== 'string' || !KINDS.has(raw.d)) return { ok: false, why: 'shape' };
      if (raw.p !== undefined && (typeof raw.p !== 'string' || raw.p.length > 12)) return { ok: false, why: 'shape' };
      if (st.pendingConvocation) return { ok: false, why: 'pending' };
      // A oferta de especiais depende da semente do estado: usa a que o cliente tinha.
      if (typeof raw.s === 'number' && Number.isFinite(raw.s)) st = { ...st, offerSeed: raw.s >>> 0 };
      const next = applyMove(st, {
        kind: raw.d as MoveKind,
        from: { row: raw.f[0], col: raw.f[1] },
        to: { row: raw.t[0], col: raw.t[1] },
        promoteTo: raw.p as PieceKind | undefined,
      });
      if (next === st) return { ok: false, why: 'illegal_move' };
      st = next;
    } else if (raw.k === 'c') {
      const pc = st.pendingConvocation;
      if (!pc || typeof raw.c !== 'string') return { ok: false, why: 'no_convocation' };
      if (Array.isArray(raw.o)) {
        const offer = raw.o.filter((x): x is never => typeof x === 'string' && isSpecialKind(x as PieceKind)).slice(0, 10);
        st = { ...st, pendingConvocation: { ...pc, availableSpecials: offer } };
      }
      const next = resolveConvocation(st, raw.c as never);
      if (next === st) return { ok: false, why: 'illegal_choice' };
      st = next;
    } else {
      return { ok: false, why: 'shape' };
    }
  }

  const moves = Math.max(0, st.fullMoveNumber - 1);
  if (st.winner === 'w') return { ok: true, outcome: 'win', reason: st.endReason ?? 'checkmate', moves };
  if (st.winner === 'b') return { ok: true, outcome: 'loss', reason: st.endReason ?? 'checkmate', moves };
  if (st.winner === 'draw') return { ok: true, outcome: 'draw', reason: st.endReason ?? 'draw', moves };
  // partida sem fim no tabuleiro: so vale desistencia ou tempo esgotado do jogador (derrota)
  if (outcome === 'resign') return { ok: true, outcome: 'loss', reason: 'resign', moves };
  if (outcome === 'timeout') return { ok: true, outcome: 'loss', reason: 'timeout', moves };
  return { ok: false, why: 'incomplete' };
}
