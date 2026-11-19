// Relogio de xadrez: funcoes puras, usadas pelo servidor (autoritativo) e pelo modo contra a IA.
import type { ClockState, Color, GameState, TimeControl } from './types';

export const MIN_BASE_MS = 30_000;
export const MAX_BASE_MS = 3 * 60 * 60 * 1000;
export const MAX_INCREMENT_MS = 60_000;

export interface TimePreset {
  label: string;
  tc: TimeControl;
}

const min = (m: number) => m * 60_000;
export const TIME_PRESETS: TimePreset[] = [
  { label: '1 min', tc: { baseMs: min(1), incrementMs: 0 } },
  { label: '3 min', tc: { baseMs: min(3), incrementMs: 0 } },
  { label: '3 | 2', tc: { baseMs: min(3), incrementMs: 2000 } },
  { label: '5 min', tc: { baseMs: min(5), incrementMs: 0 } },
  { label: '10 min', tc: { baseMs: min(10), incrementMs: 0 } },
  { label: '15 | 10', tc: { baseMs: min(15), incrementMs: 10_000 } },
  { label: '30 min', tc: { baseMs: min(30), incrementMs: 0 } },
];

const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** Valida um controle de tempo vindo de fora. null/undefined = livre; invalido => { ok:false }. */
export function parseTimeControl(v: unknown): { ok: true; tc: TimeControl | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, tc: null };
  if (typeof v !== 'object') return { ok: false };
  const { baseMs, incrementMs } = v as Record<string, unknown>;
  if (typeof baseMs !== 'number' || !Number.isFinite(baseMs)) return { ok: false };
  const inc = incrementMs === undefined ? 0 : incrementMs;
  if (typeof inc !== 'number' || !Number.isFinite(inc)) return { ok: false };
  const b = Math.round(baseMs);
  const i = Math.round(inc);
  if (b < MIN_BASE_MS || b > MAX_BASE_MS || i < 0 || i > MAX_INCREMENT_MS) return { ok: false };
  return { ok: true, tc: { baseMs: b, incrementMs: i } };
}

export function createClock(tc: TimeControl, startedAt: number | null = null): ClockState {
  return {
    baseMs: tc.baseMs,
    incrementMs: tc.incrementMs,
    remaining: { w: tc.baseMs, b: tc.baseMs },
    turnStartedAt: startedAt,
  };
}

/** Anexa (ou remove, se tc for null) o relogio ao estado. */
export function withClock(state: GameState, tc: TimeControl | null, startedAt: number | null = null): GameState {
  const { clock: _old, ...rest } = state;
  return tc ? { ...rest, clock: createClock(tc, startedAt) } : (rest as GameState);
}

export function timeControlOf(state: GameState): TimeControl | null {
  return state.clock ? { baseMs: state.clock.baseMs, incrementMs: state.clock.incrementMs } : null;
}

/** Comeca a contar o turno atual (so se houver relogio parado e a partida nao acabou). */
export function startClock(state: GameState, now: number): GameState {
  const c = state.clock;
  if (!c || c.turnStartedAt !== null || state.winner) return state;
  return { ...state, clock: { ...c, turnStartedAt: now } };
}

/** Para o relogio (fim de partida). */
export function stopClock(state: GameState): GameState {
  const c = state.clock;
  if (!c || c.turnStartedAt === null) return state;
  return { ...state, clock: { ...c, turnStartedAt: null } };
}

/** Quem esta com o relogio correndo: quem deve jogar (inclusive escolhendo a convocacao). */
export function runningColor(state: GameState): Color {
  return state.pendingConvocation ? state.pendingConvocation.color : state.turn;
}

/** Cor cujo tempo acabou em `now` (servidor), ou null. */
export function flagged(state: GameState, now: number): Color | null {
  const c = state.clock;
  if (!c || c.turnStartedAt === null || state.winner) return null;
  const who = runningColor(state);
  return c.remaining[who] - (now - c.turnStartedAt) <= 0 ? who : null;
}

export function timeoutState(state: GameState, loser: Color): GameState {
  const c = state.clock;
  return {
    ...state,
    winner: opposite(loser),
    endReason: 'timeout',
    ...(c ? { clock: { ...c, remaining: { ...c.remaining, [loser]: 0 }, turnStartedAt: null } } : {}),
  };
}

/**
 * Aplica o relogio a uma transicao prev -> next feita no instante `now`:
 * desconta o tempo de quem jogou, soma o incremento quando a vez passa e reinicia a contagem.
 * Se quem jogou estourou o tempo, a jogada e rejeitada e ele perde por tempo.
 */
export function stampMove(prev: GameState, next: GameState, now: number): GameState {
  if (!prev.clock || next === prev) return next;
  const { now: _ignored, ...c } = prev.clock;
  if (c.turnStartedAt === null) return { ...next, clock: { ...c, remaining: { ...c.remaining } } };

  const payer = runningColor(prev);
  const remaining = { ...c.remaining };
  remaining[payer] -= now - c.turnStartedAt;
  if (remaining[payer] <= 0) return timeoutState(prev, payer);

  if (next.turn !== prev.turn) remaining[payer] += c.incrementMs;
  return { ...next, clock: { ...c, remaining, turnStartedAt: next.winner ? null : now } };
}

/** Milissegundos ja gastos no turno atual, do ponto de vista de quem exibe. */
export function elapsedInTurn(clock: ClockState, clientNow: number, receivedAt: number): number {
  if (clock.turnStartedAt === null) return 0;
  // Estado vindo do servidor traz `now` (hora do servidor): usa a diferenca + o tempo desde o recebimento.
  if (typeof clock.now === 'number') return Math.max(0, clock.now - clock.turnStartedAt) + Math.max(0, clientNow - receivedAt);
  return Math.max(0, clientNow - clock.turnStartedAt);
}

/** Tempo restante exibido de cada lado. */
export function displayRemaining(state: GameState, clientNow: number, receivedAt: number): Record<Color, number> | null {
  const c = state.clock;
  if (!c) return null;
  const out = { ...c.remaining };
  if (c.turnStartedAt !== null && !state.winner) {
    const who = runningColor(state);
    out[who] = Math.max(0, out[who] - elapsedInTurn(c, clientNow, receivedAt));
  }
  return out;
}

/** 5:00, 0:09.4 (abaixo de 10 s mostra decimos), 1:02:03. */
export function formatClock(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 10_000) {
    const s = Math.floor(v / 1000);
    return `0:0${s}.${Math.floor((v % 1000) / 100)}`;
  }
  const total = Math.ceil(v / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function describeTimeControl(tc: TimeControl | null | undefined): string {
  if (!tc) return 'Livre';
  const mins = tc.baseMs / 60_000;
  const base = Number.isInteger(mins) ? `${mins} min` : `${Math.round(tc.baseMs / 1000)}s`;
  return tc.incrementMs > 0 ? `${base} + ${Math.round(tc.incrementMs / 1000)}s` : base;
}
