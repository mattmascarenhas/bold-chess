// Logica do jogo stateless (polling HTTP + Postgres). Porte do servidor WebSocket (server.ts/rooms.ts/presence.ts).
// Regras de concorrencia: toda mutacao de sala roda em db.tx com a linha da sala travada (FOR UPDATE).
// Ordem de locks (evita deadlock): linhas de chess_online dos usuarios (ordenadas) -> convite -> sala.
// Transacoes de sala NUNCA escrevem em chess_online de outros usuarios; a fonte de verdade da sala atual
// do usuario eh chess_members (chess_online.room_id eh um ponteiro mantido pelo proprio usuario).
import { randomUUID } from 'node:crypto';
import {
  applyMove,
  autoDraftRemaining,
  createInitialState,
  draftPick,
  oppositeColor,
  resolveConvocation,
} from '../../src/game/engine';
import {
  flagged,
  parseTimeControl,
  startClock,
  stampMove,
  stopClock,
  timeControlOf,
  timeoutState,
  withClock,
} from '../../src/game/clock';
import type { Color, GameState, SceneRoomId, TimeControl } from '../../src/game/types';
import {
  ABSENT_GRACE_MS,
  MAX_ROOMS,
  ONLINE_WINDOW_MS,
  type Pos,
  type ViewResponse,
} from '../../src/shared/http-protocol';
import {
  INVITE_TTL_MS,
  MAX_INVITES_PER_MINUTE,
  ROOM_CODE_REGEX,
  type ClientMessage,
  type ErrorCode,
  type MatchResult,
  type OnlineUser,
  type PlayerIdentity,
  type PointsAward,
  type RoomSeatInfo,
  type RoomSummary,
  type Seat,
  type ServerMessage,
} from '../../src/shared/protocol';
import type { FinishMatchInput, Leaderboard } from '../types';
import type { Db, Queryable } from './db';
import { ensureSchema } from './schema';
import { verifyAiGame } from './aiMatch';

export interface GameOptions {
  inviteTtlMs?: number;
  absentGraceMs?: number;
  maxRooms?: number;
  maxInvitesPerMinute?: number;
  emoteCooldownMs?: number;
}

export interface GameDeps {
  db: Db;
  leaderboard: Leaderboard;
  now?: () => number;
  random?: () => number;
  options?: GameOptions;
}

export interface Game {
  login(me: PlayerIdentity): Promise<{ resumeRoomId: string | null }>;
  send(me: PlayerIdentity, msg: Exclude<ClientMessage, { type: 'auth' }>, pos: Pos): Promise<ViewResponse>;
  poll(me: PlayerIdentity, pos: Pos, active?: boolean): Promise<ViewResponse>;
}

type Msg = Exclude<ClientMessage, { type: 'auth' }>;

const VALID_SCENE_ROOMS: SceneRoomId[] = ['bold_office', 'bold_studio', 'bold_executive'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SPECTATOR_STALE_MS = 2 * 60_000;
const ONLINE_CLEAN_MS = 10 * 60_000;
const ROOM_CLEAN_MS = 60 * 60_000;
const MAX_EVENTS_PER_POLL = 200;

interface RoomRow {
  id: string;
  scene_room: SceneRoomId;
  state: GameState;
  state_ver: number;
  seats_ver: number;
  scored: boolean;
}
interface Member {
  user_id: string;
  identity: PlayerIdentity;
  seat: Seat;
  last_seen: number;
  last_emote: number;
}
interface Ctx {
  q: Queryable;
  room: RoomRow;
  members: Member[];
  finish: PendingFinish | null;
}
interface PendingFinish {
  input: FinishMatchInput;
  recipients: string[];
}
type Fail = [ErrorCode, string?];

function sceneOrDefault(v: unknown): SceneRoomId {
  return VALID_SCENE_ROOMS.includes(v as SceneRoomId) ? (v as SceneRoomId) : 'bold_office';
}
function isPos(p: any): boolean {
  return !!p && Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.row < 8 && p.col >= 0 && p.col < 8;
}
function parseJson<T>(v: unknown): T {
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}
function pub(u: PlayerIdentity): PlayerIdentity {
  return { userId: u.userId, name: u.name, avatarUrl: u.avatarUrl ?? null, accountId: null, workspaceId: null };
}
function toMember(r: any): Member {
  return {
    user_id: r.user_id,
    identity: parseJson<PlayerIdentity>(r.identity),
    seat: r.seat,
    last_seen: Number(r.last_seen),
    last_emote: Number(r.last_emote ?? 0),
  };
}
function playersOf(ms: Member[]): Record<Color, Member | null> {
  return { w: ms.find((m) => m.seat === 'w') ?? null, b: ms.find((m) => m.seat === 'b') ?? null };
}
function inProgress(state: GameState, ms: Member[]): boolean {
  const p = playersOf(ms);
  return !!p.w && !!p.b && !state.winner;
}
const memberPub = (m: Member): PlayerIdentity => pub({ ...m.identity, userId: m.user_id });
function seatsInfo(ms: Member[]): RoomSeatInfo {
  const p = playersOf(ms);
  return {
    w: p.w ? memberPub(p.w) : null,
    b: p.b ? memberPub(p.b) : null,
    spectators: ms.filter((m) => m.seat === 'spectator').map(memberPub),
  };
}
const fullIdentity = (m: Member): PlayerIdentity => ({ ...m.identity, userId: m.user_id });

async function addEvents(q: Queryable, userIds: string[], msg: ServerMessage, t: number): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const vals = ids.map((_, i) => `($${i + 3}::text, $1::jsonb, $2::bigint)`).join(',');
  await q.query(`INSERT INTO chess_events (user_id, msg, created_at) VALUES ${vals}`, [JSON.stringify(msg), t, ...ids]);
}

export function createGame(deps: GameDeps): Game {
  const { db, leaderboard } = deps;
  const clock = deps.now ?? Date.now;
  const rnd = deps.random ?? Math.random;
  const o = deps.options ?? {};
  const inviteTtlMs = o.inviteTtlMs ?? INVITE_TTL_MS;
  const absentGraceMs = o.absentGraceMs ?? ABSENT_GRACE_MS;
  const maxRooms = o.maxRooms ?? MAX_ROOMS;
  const maxInvites = o.maxInvitesPerMinute ?? MAX_INVITES_PER_MINUTE;
  const emoteCooldownMs = o.emoteCooldownMs ?? 10_000;

  const ready = () => ensureSchema(db);

  // ---------- presenca ----------
  async function touch(me: PlayerIdentity, t: number): Promise<void> {
    await db.query(
      `WITH o AS (
         INSERT INTO chess_online (user_id, identity, last_seen, room_id) VALUES ($1::text, $2::jsonb, $3::bigint, NULL)
         ON CONFLICT (user_id) DO UPDATE SET last_seen = EXCLUDED.last_seen
         RETURNING user_id
       )
       UPDATE chess_members SET last_seen = $3::bigint WHERE user_id = $1::text`,
      [me.userId, JSON.stringify(me), t]
    );
  }

  // ---------- salas ----------
  async function loadRoom(q: Queryable, id: string): Promise<Ctx | null> {
    const r = await q.query(
      'SELECT id, scene_room, state, state_ver, seats_ver, scored FROM chess_rooms WHERE id = $1 FOR UPDATE',
      [id]
    );
    const row = r.rows[0];
    if (!row) return null;
    const ms = await q.query('SELECT user_id, identity, seat, last_seen, last_emote FROM chess_members WHERE room_id = $1', [id]);
    return {
      q,
      room: {
        id: row.id,
        scene_room: row.scene_room,
        state: parseJson<GameState>(row.state),
        state_ver: Number(row.state_ver),
        seats_ver: Number(row.seats_ver),
        scored: !!row.scored,
      },
      members: ms.rows.map(toMember),
      finish: null,
    };
  }

  /** Executa fn com a sala travada; depois do commit conclui a pontuacao (fora da tx). Null se a sala nao existe. */
  async function withRoom<T>(roomId: string, fn: (c: Ctx) => Promise<T>): Promise<{ out: T } | null> {
    let finish: PendingFinish | null = null;
    const res = await db.tx(async (q) => {
      const c = await loadRoom(q, roomId);
      if (!c) return null;
      const out = await fn(c);
      finish = c.finish;
      return { out };
    });
    if (finish) await completeFinish(finish);
    return res;
  }

  async function bumpSeats(c: Ctx, t = clock()): Promise<void> {
    await c.q.query('UPDATE chess_rooms SET seats_ver = seats_ver + 1, updated_at = $2 WHERE id = $1', [c.room.id, t]);
    c.room.seats_ver += 1;
  }

  /** Remove o membro (nao escreve em chess_online: ver cabecalho). */
  async function removeMember(c: Ctx, userId: string): Promise<void> {
    await c.q.query('DELETE FROM chess_members WHERE room_id = $1 AND user_id = $2', [c.room.id, userId]);
    c.members = c.members.filter((m) => m.user_id !== userId);
    await bumpSeats(c);
  }

  async function writeState(
    c: Ctx,
    next: GameState,
    opts: { reason?: string; resetScored?: boolean; recipients?: string[] } = {}
  ): Promise<void> {
    const p = playersOf(c.members);
    const finishing = !opts.resetScored && !!next.winner && !c.room.scored && !!p.w && !!p.b;
    const scored = opts.resetScored ? false : c.room.scored || finishing;
    await c.q.query('UPDATE chess_rooms SET state = $2::jsonb, state_ver = state_ver + 1, scored = $3, updated_at = $4 WHERE id = $1', [
      c.room.id,
      JSON.stringify(next),
      scored,
      clock(),
    ]);
    c.room.state = next;
    c.room.state_ver += 1;
    c.room.scored = scored;
    if (finishing) {
      c.finish = {
        input: {
          roomId: c.room.id,
          white: fullIdentity(p.w!),
          black: fullIdentity(p.b!),
          result: next.winner as MatchResult,
          reason: opts.reason ?? next.endReason ?? 'unknown',
          moves: Math.max(0, next.fullMoveNumber - 1),
          durationMs: next.startedAt ? Math.max(0, clock() - next.startedAt) : undefined,
        },
        recipients: opts.recipients ?? c.members.map((m) => m.user_id),
      };
    }
  }

  /** Grava uma jogada aplicando o relogio; se quem jogou estourou o tempo, perde por tempo. */
  async function writeStamped(c: Ctx, prev: GameState, next: GameState): Promise<void> {
    const stamped = stampMove(prev, next, clock());
    await writeState(c, stamped, stamped.endReason === 'timeout' ? { reason: 'timeout' } : {});
  }

  async function forfeit(c: Ctx, loser: Color, reason: string, recipients?: string[]): Promise<void> {
    if (c.room.state.winner) return;
    await writeState(c, stopClock({ ...c.room.state, winner: oppositeColor(loser), endReason: 'resign' }), { reason, recipients });
  }

  /** Pontua (fora da tx) e avisa todos os destinatarios. Nunca lanca. */
  async function completeFinish(f: PendingFinish): Promise<void> {
    let points: PointsAward[] = [];
    try {
      points = await leaderboard.finishMatch(f.input);
    } catch (e) {
      console.error('[leaderboard] finishMatch falhou', e);
    }
    try {
      await addEvents(
        db,
        f.recipients,
        { type: 'match_ended', roomId: f.input.roomId, result: f.input.result, reason: f.input.reason, points },
        clock()
      );
    } catch (e) {
      console.error('[game] evento match_ended falhou', e);
    }
  }

  async function enterRoom(c: Ctx, me: PlayerIdentity, mode: 'auto' | 'spectator' | 'w' | 'b', t: number): Promise<{ seat: Seat; resumed: boolean }> {
    const existing = c.members.find((m) => m.user_id === me.userId);
    if (existing) {
      await c.q.query('UPDATE chess_online SET room_id = $2 WHERE user_id = $1', [me.userId, c.room.id]);
      return { seat: existing.seat, resumed: true };
    }
    const p = playersOf(c.members);
    let seat: Seat = 'spectator';
    if (mode !== 'spectator') {
      const order: Color[] = mode === 'w' ? ['w'] : mode === 'b' ? ['b'] : ['w', 'b'];
      const free = order.find((col) => !p[col]);
      if (free) seat = free;
    }
    await c.q.query(
      'INSERT INTO chess_members (room_id, user_id, identity, seat, last_seen, last_emote) VALUES ($1, $2, $3::jsonb, $4, $5, 0)',
      [c.room.id, me.userId, JSON.stringify(me), seat, t]
    );
    c.members.push({ user_id: me.userId, identity: me, seat, last_seen: t, last_emote: 0 });
    await c.q.query('UPDATE chess_online SET room_id = $2 WHERE user_id = $1', [me.userId, c.room.id]);
    await bumpSeats(c, t);
    // Com os dois jogadores sentados, o relogio (se houver) comeca a correr para as brancas.
    const seated = playersOf(c.members);
    if (seated.w && seated.b && c.room.state.clock && c.room.state.clock.turnStartedAt === null && !c.room.state.winner) {
      await writeState(c, { ...startClock(c.room.state, t), startedAt: t });
    } else if (seated.w && seated.b && !c.room.state.startedAt && !c.room.state.winner) {
      await writeState(c, { ...c.room.state, startedAt: t }); // partida livre: marca o inicio para medir a duracao
    }
    return { seat, resumed: false };
  }

  /** Remove membros ausentes de uma sala SEM partida em andamento (libera vagas de salas de espera/finalizadas). */
  async function purgeStale(c: Ctx, t: number): Promise<void> {
    if (inProgress(c.room.state, c.members)) return;
    const stale = c.members.filter((m) => m.last_seen < t - absentGraceMs);
    for (const m of stale) await removeMember(c, m.user_id);
  }

  async function lockUser(q: Queryable, userId: string): Promise<void> {
    await q.query('SELECT user_id FROM chess_online WHERE user_id = $1 FOR UPDATE', [userId]);
  }

  /** Sai de qualquer sala diferente de `keep` (em tx propria). 'in_game' se estiver numa partida em andamento como jogador. */
  async function prepareLeave(me: PlayerIdentity, keep: string | null): Promise<'ok' | 'in_game'> {
    return db.tx(async (q) => {
      await lockUser(q, me.userId);
      const rows = await q.query('SELECT room_id FROM chess_members WHERE user_id = $1', [me.userId]);
      for (const row of rows.rows) {
        const rid: string = row.room_id;
        if (rid === keep) continue;
        const c = await loadRoom(q, rid);
        if (!c) {
          await q.query('DELETE FROM chess_members WHERE room_id = $1 AND user_id = $2', [rid, me.userId]);
          continue;
        }
        const m = c.members.find((x) => x.user_id === me.userId);
        if (m && m.seat !== 'spectator' && inProgress(c.room.state, c.members)) return 'in_game';
        if (m) await removeMember(c, me.userId);
      }
      await q.query('UPDATE chess_online SET room_id = $2 WHERE user_id = $1', [me.userId, keep]);
      return 'ok';
    });
  }

  type Place =
    | { status: 'ok'; roomId: string; sceneRoom: SceneRoomId; seat: Seat; resumed: boolean }
    | { status: 'in_game' | 'not_found' | 'retry' };

  function roomTime(raw: unknown): TimeControl | null {
    if (!raw) return null;
    const c = parseJson<{ baseMs?: number; incrementMs?: number }>(raw);
    const p = parseTimeControl({ baseMs: Number(c.baseMs), incrementMs: Number(c.incrementMs ?? 0) });
    return p.ok ? p.tc : null;
  }

  function newCode(): string {
    let id = '';
    for (let i = 0; i < 6; i++) id += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length) % CODE_CHARS.length];
    return id;
  }

  /** Cria/entra numa sala de forma atomica para o usuario (sai da sala anterior antes). */
  async function place(
    me: PlayerIdentity,
    target: { roomId: string } | { create: SceneRoomId; time?: TimeControl | null },
    mode: 'auto' | 'spectator' | 'w' | 'b',
    after?: (c: Ctx) => Promise<void>
  ): Promise<Place> {
    const existingId = 'roomId' in target ? target.roomId : null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await prepareLeave(me, existingId)) === 'in_game') return { status: 'in_game' };
      let finish: PendingFinish | null = null;
      const res = await db.tx<Place>(async (q) => {
        const t = clock();
        await lockUser(q, me.userId);
        const cur = await q.query('SELECT room_id FROM chess_members WHERE user_id = $1', [me.userId]);
        if (cur.rows.some((r: any) => r.room_id !== existingId)) return { status: 'retry' };
        let c: Ctx | null;
        if (existingId) {
          c = await loadRoom(q, existingId);
          if (!c) return { status: 'not_found' };
          await purgeStale(c, t);
        } else {
          let id = '';
          for (let i = 0; i < 20; i++) {
            const cand = newCode();
            const ins = await q.query(
              `INSERT INTO chess_rooms (id, scene_room, state, state_ver, seats_ver, scored, created_at, updated_at)
               VALUES ($1, $2, $3::jsonb, 1, 1, FALSE, $4, $4) ON CONFLICT (id) DO NOTHING RETURNING id`,
              [cand, (target as { create: SceneRoomId }).create, JSON.stringify(withClock(createInitialState(true), (target as { time?: TimeControl | null }).time ?? null)), t]
            );
            if (ins.rows[0]) {
              id = cand;
              break;
            }
          }
          if (!id) throw new Error('nao foi possivel gerar codigo de sala');
          c = await loadRoom(q, id);
          if (!c) throw new Error('sala recem criada sumiu');
        }
        const { seat, resumed } = await enterRoom(c, me, mode, t);
        if (after) await after(c);
        finish = c.finish;
        return { status: 'ok', roomId: c.room.id, sceneRoom: c.room.scene_room, seat, resumed };
      });
      if (finish) await completeFinish(finish);
      if (res.status !== 'retry') return res;
    }
    return { status: 'retry' };
  }

  // ---------- manutencao oportunista ----------
  async function cleanup(t: number): Promise<void> {
    await db.query('DELETE FROM chess_members WHERE last_seen < $1', [t - ONLINE_CLEAN_MS]);
    await db.query('DELETE FROM chess_online WHERE last_seen < $1', [t - ONLINE_CLEAN_MS]);
    await db.query(
      'DELETE FROM chess_rooms r WHERE r.updated_at < $1 AND NOT EXISTS (SELECT 1 FROM chess_members m WHERE m.room_id = r.id)',
      [t - ROOM_CLEAN_MS]
    );
    await db.query('DELETE FROM chess_events WHERE created_at < $1', [t - ROOM_CLEAN_MS]);
    await db.query("DELETE FROM chess_invites WHERE created_at < $1", [t - ROOM_CLEAN_MS]);
  }

  async function roomCount(): Promise<number> {
    const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chess_rooms');
    return Number(r.rows[0]?.n ?? 0);
  }

  async function myRoomId(userId: string): Promise<string | null> {
    const r = await db.query('SELECT m.room_id FROM chess_members m JOIN chess_rooms r ON r.id = m.room_id WHERE m.user_id = $1 LIMIT 1', [userId]);
    return r.rows[0]?.room_id ?? null;
  }

  async function isBusy(userId: string): Promise<boolean> {
    const r = await db.query(
      `SELECT 1 FROM chess_members m JOIN chess_rooms r ON r.id = m.room_id
       WHERE m.user_id = $1 AND m.seat IN ('w','b') AND (r.state->>'winner') IS NULL
         AND EXISTS (SELECT 1 FROM chess_members m2 WHERE m2.room_id = m.room_id AND m2.seat IN ('w','b') AND m2.user_id <> m.user_id)
       LIMIT 1`,
      [userId]
    );
    return r.rows.length > 0;
  }

  // ---------- acoes ----------
  interface Out {
    imm: ServerMessage[];
    fresh: string | null;
  }
  const fail = (out: Out, code: ErrorCode, message?: string): void => {
    out.imm.push({ type: 'error', code, message });
  };

  async function handleRoomAction(me: PlayerIdentity, msg: Msg, out: Out): Promise<void> {
    const rid = await myRoomId(me.userId);
    if (!rid) return fail(out, 'not_a_player');
    const t = clock();
    const res = await withRoom<Fail | void>(rid, async (c) => {
      const m = c.members.find((x) => x.user_id === me.userId);
      if (!m || m.seat === 'spectator') return ['not_a_player'];
      const color = m.seat as Color;
      const state = c.room.state;
      const playing = inProgress(state, c.members);
      switch (msg.type) {
        case 'draft_pick': {
          if (!playing) return ['bad_request', 'waiting_opponent'];
          if (typeof msg.specialId !== 'string') return ['bad_request'];
          const next = draftPick(state, color, msg.specialId);
          if (next !== state) await writeStamped(c, state, next);
          return;
        }
        case 'auto_draft': {
          if (!playing) return ['bad_request', 'waiting_opponent'];
          const next = autoDraftRemaining(state);
          if (next !== state) await writeStamped(c, state, next);
          return;
        }
        case 'move': {
          if (!playing) return ['bad_request', 'waiting_opponent'];
          const mv = msg.move as any;
          if (!mv || !isPos(mv.from) || !isPos(mv.to)) return ['bad_request'];
          if (state.turn !== color) return ['not_your_turn'];
          const next = applyMove(state, msg.move);
          if (next !== state) await writeStamped(c, state, next);
          return;
        }
        case 'convocate': {
          if (!playing) return ['bad_request', 'waiting_opponent'];
          if (typeof msg.choice !== 'string') return ['bad_request'];
          if (state.pendingConvocation?.color !== color) return ['not_your_turn'];
          const next = resolveConvocation(state, msg.choice);
          if (next !== state) await writeStamped(c, state, next);
          return;
        }
        case 'resign': {
          if (!playing) return;
          await writeState(c, stopClock({ ...state, winner: oppositeColor(color), endReason: 'resign' }));
          return;
        }
        case 'rematch': {
          if (!state.winner) return ['bad_request', 'game_not_finished'];
          {
            const both = playersOf(c.members);
            const fresh = withClock(createInitialState(true), timeControlOf(state), both.w && both.b ? clock() : null);
            if (both.w && both.b) fresh.startedAt = clock();
            await writeState(c, fresh, { resetScored: true });
          }
          return;
        }
        case 'emote': {
          if (typeof msg.emoteId !== 'string' || !msg.emoteId || msg.emoteId.length > 32) return ['bad_request'];
          if (m.last_emote > 0 && t - m.last_emote < emoteCooldownMs) return;
          await c.q.query('UPDATE chess_members SET last_emote = $3 WHERE room_id = $1 AND user_id = $2', [c.room.id, me.userId, t]);
          await addEvents(c.q, c.members.map((x) => x.user_id), { type: 'emote', emoteId: msg.emoteId, fromColor: color }, t);
          return;
        }
        default:
          return ['bad_request'];
      }
    });
    if (!res) return fail(out, 'not_a_player');
    if (res.out) fail(out, res.out[0], res.out[1]);
  }

  async function handleLeave(me: PlayerIdentity, out: Out): Promise<void> {
    const rid = await myRoomId(me.userId);
    if (rid) {
      await withRoom(rid, async (c) => {
        const m = c.members.find((x) => x.user_id === me.userId);
        if (!m) return;
        if (m.seat !== 'spectator' && inProgress(c.room.state, c.members)) {
          await forfeit(c, m.seat as Color, 'abandon', c.members.filter((x) => x.user_id !== me.userId).map((x) => x.user_id));
        }
        await removeMember(c, me.userId);
      });
      await db.query('UPDATE chess_online SET room_id = NULL WHERE user_id = $1 AND room_id = $2', [me.userId, rid]);
    }
    out.imm.push({ type: 'left' });
  }

  async function handleChallenge(me: PlayerIdentity, msg: Extract<Msg, { type: 'challenge' }>, out: Out): Promise<void> {
    const target = msg.targetUserId;
    if (typeof target !== 'string' || !target || target.length > 200) return fail(out, 'bad_request');
    if (target === me.userId) return fail(out, 'self_challenge');
    const t = clock();
    const cnt = await db.query('SELECT count(*)::int AS n FROM chess_invites WHERE from_user = $1 AND created_at > $2', [me.userId, t - 60_000]);
    if (Number(cnt.rows[0]?.n ?? 0) >= maxInvites) return fail(out, 'rate_limited');
    const on = await db.query('SELECT 1 FROM chess_online WHERE user_id = $1 AND last_seen > $2', [target, t - ONLINE_WINDOW_MS]);
    if (!on.rows.length) return fail(out, 'user_offline');
    if (await isBusy(target)) return fail(out, 'user_busy');
    await cleanup(t);
    if ((await roomCount()) >= maxRooms) return fail(out, 'rate_limited', 'too_many_rooms');

    const scene = sceneOrDefault(msg.sceneRoom);
    const time = parseTimeControl(msg.time);
    if (!time.ok) return fail(out, 'bad_request', 'invalid_time');
    const inviteId = randomUUID();
    const expiresAt = t + inviteTtlMs;
    const res = await place(me, { create: scene, time: time.tc }, 'w', async (c) => {
      await c.q.query(
        `INSERT INTO chess_invites (id, from_user, to_user, from_identity, room_id, scene_room, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'pending', $7, $8)`,
        [inviteId, me.userId, target, JSON.stringify(me), c.room.id, scene, t, expiresAt]
      );
      await addEvents(
        c.q,
        [target],
        { type: 'invite', inviteId, from: pub(me), roomId: c.room.id, sceneRoom: scene, expiresAt, time: time.tc },
        t
      );
    });
    if (res.status === 'in_game') return fail(out, 'bad_request', 'in_game');
    if (res.status !== 'ok') return fail(out, 'bad_request');
    out.imm.push({ type: 'room_created', roomId: res.roomId, sceneRoom: res.sceneRoom });
    out.fresh = res.roomId;
  }

  async function handleInviteResponse(me: PlayerIdentity, msg: Extract<Msg, { type: 'invite_response' }>, out: Out): Promise<void> {
    const id = msg.inviteId;
    if (typeof id !== 'string' || !id || id.length > 64) return fail(out, 'bad_request');
    const t = clock();

    // Valida/consome o convite sob lock. Devolve o convite se o fluxo deve seguir.
    const pre = await db.query('SELECT from_user, to_user, status, room_id FROM chess_invites WHERE id = $1', [id]);
    const p = pre.rows[0];
    if (!p || p.to_user !== me.userId || p.status !== 'pending') return fail(out, 'bad_request');

    if (msg.accept) {
      const lv = await prepareLeave(me, p.room_id);
      if (lv === 'in_game') {
        await db.tx(async (q) => {
          const r = await q.query("UPDATE chess_invites SET status = 'declined' WHERE id = $1 AND status = 'pending' RETURNING from_user, room_id", [id]);
          if (r.rows[0]) await addEvents(q, [r.rows[0].from_user], { type: 'invite_result', inviteId: id, status: 'declined', roomId: r.rows[0].room_id }, t);
        });
        return fail(out, 'user_busy');
      }
    }

    type R = 'bad' | 'retry' | 'done' | 'room_gone' | { fresh: string };
    let finish: PendingFinish | null = null;
    let result: R = 'retry';
    for (let attempt = 0; attempt < 3 && result === 'retry'; attempt++) {
      result = await db.tx<R>(async (q) => {
        const users = [p.from_user as string, me.userId].sort();
        for (const u of users) await lockUser(q, u);
        const r = await q.query('SELECT from_user, to_user, status, room_id, expires_at FROM chess_invites WHERE id = $1 FOR UPDATE', [id]);
        const inv = r.rows[0];
        if (!inv || inv.to_user !== me.userId || inv.status !== 'pending') return 'bad';
        if (Number(inv.expires_at) < t) {
          await q.query("UPDATE chess_invites SET status = 'expired' WHERE id = $1", [id]);
          await addEvents(q, [inv.from_user, inv.to_user], { type: 'invite_result', inviteId: id, status: 'expired', roomId: inv.room_id }, t);
          return 'done';
        }
        if (!msg.accept) {
          await q.query("UPDATE chess_invites SET status = 'declined' WHERE id = $1", [id]);
          await addEvents(q, [inv.from_user], { type: 'invite_result', inviteId: id, status: 'declined', roomId: inv.room_id }, t);
          return 'done';
        }
        const cur = await q.query('SELECT room_id FROM chess_members WHERE user_id = $1', [me.userId]);
        if (cur.rows.some((x: any) => x.room_id !== inv.room_id)) return 'retry';
        const c = await loadRoom(q, inv.room_id);
        const pl = c ? playersOf(c.members) : null;
        if (!c || !pl || pl.w?.user_id !== inv.from_user || pl.b || c.room.state.winner) {
          await q.query("UPDATE chess_invites SET status = 'expired' WHERE id = $1", [id]);
          await addEvents(q, [inv.from_user], { type: 'invite_result', inviteId: id, status: 'expired', roomId: inv.room_id }, t);
          return 'room_gone';
        }
        await enterRoom(c, me, 'b', t);
        await q.query("UPDATE chess_invites SET status = 'accepted' WHERE id = $1", [id]);
        await addEvents(q, [inv.from_user], { type: 'invite_result', inviteId: id, status: 'accepted', roomId: inv.room_id }, t);
        await addEvents(q, [inv.from_user], joinedMsg(c.room, c.members, 'w', false), t);
        finish = c.finish;
        return { fresh: inv.room_id as string };
      });
    }
    if (finish) await completeFinish(finish);
    if (result === 'bad' || result === 'retry') return fail(out, 'bad_request');
    if (result === 'room_gone') return fail(out, 'room_not_found');
    if (typeof result === 'object') out.fresh = result.fresh;
  }

  async function handle(me: PlayerIdentity, msg: Msg, out: Out): Promise<void> {
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return fail(out, 'bad_request');
    switch (msg.type) {
      case 'ping':
        out.imm.push({ type: 'pong' });
        return;
      case 'ai_match': {
        // Partida contra a IA jogada no navegador: confere os lances e pontua pelo nivel.
        const v = verifyAiGame(msg.actions, msg.outcome);
        if (!v.ok) return fail(out, 'bad_request', `ai_match_${v.why}`);
        const award = await leaderboard.finishAiMatch({
          user: me,
          level: String(msg.level),
          outcome: v.outcome,
          reason: v.reason,
          moves: v.moves,
        });
        out.imm.push({
          type: 'match_ended',
          roomId: 'ia',
          result: v.outcome === 'win' ? 'w' : v.outcome === 'loss' ? 'b' : 'draw',
          reason: v.reason,
          points: [award],
        });
        return;
      }
      case 'lobby_list':
        return;
      case 'create_room': {
        const t = clock();
        await cleanup(t);
        if ((await roomCount()) >= maxRooms) return fail(out, 'rate_limited', 'too_many_rooms');
        const time = parseTimeControl(msg.time);
        if (!time.ok) return fail(out, 'bad_request', 'invalid_time');
        const res = await place(me, { create: sceneOrDefault(msg.sceneRoom), time: time.tc }, 'auto');
        if (res.status === 'in_game') return fail(out, 'bad_request', 'in_game');
        if (res.status !== 'ok') return fail(out, 'bad_request');
        out.imm.push({ type: 'room_created', roomId: res.roomId, sceneRoom: res.sceneRoom });
        out.fresh = res.roomId;
        return;
      }
      case 'join': {
        const id = typeof msg.roomId === 'string' ? msg.roomId.trim().toUpperCase() : '';
        if (!ROOM_CODE_REGEX.test(id)) return fail(out, 'room_not_found');
        const ex = await db.query('SELECT 1 FROM chess_rooms WHERE id = $1', [id]);
        if (!ex.rows.length) return fail(out, 'room_not_found');
        const res = await place(me, { roomId: id }, msg.asSpectator ? 'spectator' : 'auto');
        if (res.status === 'in_game') return fail(out, 'bad_request', 'in_game');
        if (res.status === 'not_found') return fail(out, 'room_not_found');
        if (res.status !== 'ok') return fail(out, 'bad_request');
        if (!res.resumed) out.fresh = res.roomId;
        return;
      }
      case 'leave':
        return handleLeave(me, out);
      case 'challenge':
        return handleChallenge(me, msg, out);
      case 'invite_response':
        return handleInviteResponse(me, msg, out);
      default:
        return handleRoomAction(me, msg, out);
    }
  }

  // ---------- visao ----------
  function joinedMsg(room: RoomRow, members: Member[], seat: Seat, resumed: boolean): ServerMessage {
    return {
      type: 'joined',
      roomId: room.id,
      sceneRoom: room.scene_room,
      yourSeat: seat,
      state: room.state,
      seats: seatsInfo(members),
      resumed,
    };
  }

  interface View {
    room: RoomRow;
    members: Member[];
  }

  async function fetchMine(userId: string): Promise<View | null> {
    const r = await db.query(
      `SELECT r.id, r.scene_room, r.state, r.state_ver, r.seats_ver, r.scored,
         (SELECT COALESCE(json_agg(json_build_object('user_id', m.user_id, 'identity', m.identity, 'seat', m.seat, 'last_seen', m.last_seen, 'last_emote', m.last_emote)), '[]'::json)
            FROM chess_members m WHERE m.room_id = r.id) AS members
       FROM chess_members me JOIN chess_rooms r ON r.id = me.room_id
       WHERE me.user_id = $1 LIMIT 1`,
      [userId]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      room: {
        id: row.id,
        scene_room: row.scene_room,
        state: parseJson<GameState>(row.state),
        state_ver: Number(row.state_ver),
        seats_ver: Number(row.seats_ver),
        scored: !!row.scored,
      },
      members: parseJson<any[]>(row.members).map(toMember),
    };
  }

  function findStale(
    state: GameState,
    members: Member[],
    viewer: string,
    t: number
  ): { loser: Color | null; specs: string[]; flag: Color | null } {
    let loser: Color | null = null;
    const flag = inProgress(state, members) ? flagged(state, t) : null;
    if (inProgress(state, members)) {
      const p = playersOf(members);
      let worst = Infinity;
      for (const col of ['w', 'b'] as Color[]) {
        const m = p[col]!;
        if (m.user_id !== viewer && m.last_seen < t - absentGraceMs && m.last_seen < worst) {
          worst = m.last_seen;
          loser = col;
        }
      }
    }
    const specs = members.filter((m) => m.seat === 'spectator' && m.user_id !== viewer && m.last_seen < t - SPECTATOR_STALE_MS).map((m) => m.user_id);
    return { loser, specs, flag };
  }

  /** Abandono por ausencia + remocao de espectadores ausentes. True se mudou algo. */
  async function maintain(me: PlayerIdentity, v: View, t: number): Promise<boolean> {
    const s = findStale(v.room.state, v.members, me.userId, t);
    if (!s.loser && !s.specs.length && !s.flag) return false;
    await withRoom(v.room.id, async (c) => {
      const s2 = findStale(c.room.state, c.members, me.userId, t);
      if (s2.flag && !c.room.state.winner) {
        // Tempo esgotado: quem estava com o relogio correndo perde.
        await writeState(c, timeoutState(c.room.state, s2.flag), { reason: 'timeout' });
      }
      if (s2.loser) {
        const lm = playersOf(c.members)[s2.loser]!;
        await forfeit(c, s2.loser, 'abandon');
        await removeMember(c, lm.user_id);
      }
      for (const uid of s2.specs) await removeMember(c, uid);
    });
    return true;
  }

  async function lobby(t: number): Promise<ServerMessage> {
    const since = t - ONLINE_WINDOW_MS;
    const online = await db.query(
      `SELECT o.user_id, o.identity, (SELECT m.room_id FROM chess_members m WHERE m.user_id = o.user_id LIMIT 1) AS room_id
       FROM chess_online o WHERE o.last_seen > $1 ORDER BY o.last_seen DESC LIMIT 500`,
      [since]
    );
    const rooms = await db.query(
      `SELECT r.id, r.scene_room, (r.state->>'winner') AS winner, (r.state->'clock') AS clock,
         json_agg(json_build_object('user_id', m.user_id, 'identity', m.identity, 'seat', m.seat, 'last_seen', m.last_seen)) AS members
       FROM chess_rooms r JOIN chess_members m ON m.room_id = r.id
       GROUP BY r.id HAVING bool_or(m.last_seen > $1)
       ORDER BY r.created_at DESC LIMIT 200`,
      [since]
    );
    const onlineList: OnlineUser[] = online.rows.map((r: any) => {
      const id = parseJson<PlayerIdentity>(r.identity);
      return { ...pub({ ...id, userId: r.user_id }), roomId: r.room_id ?? null };
    });
    const roomList: RoomSummary[] = rooms.rows.map((r: any) => {
      const ms = parseJson<any[]>(r.members).map((x) => ({ ...toMember({ ...x, last_emote: 0 }) }));
      const p = playersOf(ms);
      return {
        roomId: r.id,
        sceneRoom: r.scene_room,
        white: p.w ? memberPub(p.w) : null,
        black: p.b ? memberPub(p.b) : null,
        spectatorCount: ms.filter((m) => m.seat === 'spectator' && m.last_seen > since).length,
        phase: r.winner ? 'finished' : p.w && p.b ? 'playing' : 'waiting',
        time: roomTime(r.clock),
      };
    });
    return { type: 'lobby', online: onlineList, rooms: roomList };
  }

  async function view(me: PlayerIdentity, pos: Pos, active: boolean | undefined, out: Out): Promise<ViewResponse> {
    const t = clock();
    // convites pendentes vencidos do desafiante viram 'expired' + evento (uma vez, atomico)
    await db.query(
      `WITH e AS (
         UPDATE chess_invites SET status = 'expired' WHERE from_user = $1::text AND status = 'pending' AND expires_at < $2::bigint
         RETURNING id, room_id
       )
       INSERT INTO chess_events (user_id, msg, created_at)
       SELECT $1::text, jsonb_build_object('type', 'invite_result', 'inviteId', e.id, 'status', 'expired', 'roomId', e.room_id), $2::bigint FROM e`,
      [me.userId, t]
    );

    let v = await fetchMine(me.userId);
    if (v && (await maintain(me, v, t))) v = await fetchMine(me.userId);

    // Cliente novo (cursor 0): nao reenvie o historico antigo (convites/resultados velhos),
    // so eventos recentes. Depois do primeiro evento entregue, o cursor avanca normalmente.
    const ev = await db.query(
      `SELECT id, msg FROM chess_events
       WHERE user_id = $1 AND id > $2 AND ($2::bigint > 0 OR created_at >= $4)
       ORDER BY id LIMIT $3`,
      [me.userId, pos.cursor, MAX_EVENTS_PER_POLL, t - 30_000]
    );
    const messages: ServerMessage[] = [...out.imm];
    let cursor = pos.cursor;
    for (const r of ev.rows) {
      messages.push(parseJson<ServerMessage>(r.msg));
      cursor = Math.max(cursor, Number(r.id));
    }

    const mine = v?.members.find((m) => m.user_id === me.userId);
    if (active !== false && !(v && mine && inProgress(v.room.state, v.members))) messages.push(await lobby(t));

    let npos: Pos;
    if (v && mine) {
      const { room, members } = v;
      if (pos.roomId !== room.id) {
        messages.push(joinedMsg(room, members, mine.seat, out.fresh !== room.id));
      } else {
        if (pos.sv !== room.state_ver) {
          messages.push({ type: 'state', state: room.state, ...(room.state.lastMove ? { event: room.state.lastMove } : {}) });
        }
        if (pos.pv !== room.seats_ver) messages.push({ type: 'seats', seats: seatsInfo(members) });
      }
      npos = { roomId: room.id, sv: room.state_ver, pv: room.seats_ver, cursor };
    } else {
      if (pos.roomId !== null && !messages.some((m) => m.type === 'left')) messages.push({ type: 'left' });
      npos = { roomId: null, sv: 0, pv: 0, cursor };
    }
    // Estados com relogio saem carimbados com a hora do servidor (o cliente corrige a latencia).
    const stamped = messages.map((m) =>
      (m.type === 'joined' || m.type === 'state') && m.state.clock ? { ...m, state: { ...m.state, clock: { ...m.state.clock, now: t } } } : m
    );
    return { messages: stamped, pos: npos };
  }

  // ---------- API ----------
  return {
    async login(me) {
      await ready();
      const t = clock();
      await db.query(
        `INSERT INTO chess_online (user_id, identity, last_seen, room_id) VALUES ($1, $2::jsonb, $3, NULL)
         ON CONFLICT (user_id) DO UPDATE SET identity = EXCLUDED.identity, last_seen = EXCLUDED.last_seen`,
        [me.userId, JSON.stringify(me), t]
      );
      await db.query('UPDATE chess_members SET last_seen = $2 WHERE user_id = $1', [me.userId, t]);
      const r = await db.query(
        `SELECT m.room_id FROM chess_members m JOIN chess_rooms r ON r.id = m.room_id
         WHERE m.user_id = $1 AND m.seat IN ('w','b') ORDER BY ((r.state->>'winner') IS NULL) DESC LIMIT 1`,
        [me.userId]
      );
      const resumeRoomId: string | null = r.rows[0]?.room_id ?? null;
      if (resumeRoomId) await db.query('UPDATE chess_online SET room_id = $2 WHERE user_id = $1', [me.userId, resumeRoomId]);
      return { resumeRoomId };
    },

    async send(me, msg, pos) {
      await ready();
      await touch(me, clock());
      const out: Out = { imm: [], fresh: null };
      await handle(me, msg, out);
      return view(me, pos, true, out);
    },

    async poll(me, pos, active) {
      await ready();
      await touch(me, clock());
      return view(me, pos, active, { imm: [], fresh: null });
    },
  };
}
