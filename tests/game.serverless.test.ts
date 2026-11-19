import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseBestAIMove } from '../src/game/engine';
import type { GameState } from '../src/game/types';
import { EMPTY_POS, type Pos } from '../src/shared/http-protocol';
import type { ClientMessage, PlayerIdentity, ServerMessage } from '../src/shared/protocol';
import type { FinishMatchInput, Leaderboard } from '../server/types';
import { createPgDb, createPgliteDb, type Db } from '../server/serverless/db';
import { GAME_SCHEMA } from '../server/serverless/schema';
import { createGame, type GameOptions } from '../server/serverless/game';

const T0 = 1_700_000_000_000;

function ident(userId: string, acct: string): PlayerIdentity {
  return { userId, name: userId.toUpperCase(), avatarUrl: null, accountId: `acct-${acct}`, workspaceId: `ws-${acct}` };
}

/** PGlite por padrao; com TEST_DATABASE_URL roda contra um Postgres real (tabelas do jogo recriadas a cada teste). */
async function newDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return createPgliteDb();
  const db = createPgDb(url);
  for (const t of ['chess_events', 'chess_invites', 'chess_members', 'chess_rooms', 'chess_online']) {
    await db.query('DROP TABLE IF EXISTS ' + t);
  }
  return db;
}

async function setup(options: GameOptions = {}) {
  const inner = await newDb();
  // createPgliteDb().query usa o protocolo estendido e rejeita o GAME_SCHEMA (varios comandos): executa-o comando a comando.
  const db: Db = {
    ...inner,
    query: async (sql, params) => {
      if (params === undefined && sql === GAME_SCHEMA) {
        for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) await inner.query(stmt);
        return { rows: [] };
      }
      return inner.query(sql, params);
    },
  };
  const clock = { t: T0 };
  const calls: FinishMatchInput[] = [];
  const lb: Leaderboard = {
    async finishMatch(input) {
      calls.push(input);
      return [input.white, input.black].map((p) => ({ userId: p!.userId, delta: 10, total: 10, counted: true }));
    },
  };
  const game = createGame({ db, leaderboard: lb, now: () => clock.t, options });
  class Client {
    pos: Pos = EMPTY_POS;
    state: GameState | null = null;
    seat: string | null = null;
    roomId: string | null = null;
    all: ServerMessage[] = [];
    constructor(public me: PlayerIdentity) {}
    private apply(msgs: ServerMessage[], pos: Pos) {
      this.pos = pos;
      for (const m of msgs) {
        this.all.push(m);
        if (m.type === 'joined') {
          this.state = m.state;
          this.seat = m.yourSeat;
          this.roomId = m.roomId;
        } else if (m.type === 'state') this.state = m.state;
        else if (m.type === 'left') {
          this.state = null;
          this.seat = null;
          this.roomId = null;
        }
      }
    }
    async login() {
      return game.login(this.me);
    }
    async send(msg: Exclude<ClientMessage, { type: 'auth' }>) {
      const r = await game.send(this.me, msg, this.pos);
      this.apply(r.messages, r.pos);
      return r.messages;
    }
    async poll(active?: boolean) {
      const r = await game.poll(this.me, this.pos, active);
      this.apply(r.messages, r.pos);
      return r.messages;
    }
  }
  const mk = async (u: string, acct = u) => {
    const c = new Client(ident(u, acct));
    await c.login();
    return c;
  };
  return { db, clock, calls, game, mk };
}
type Env = Awaited<ReturnType<typeof setup>>;
type C = Awaited<ReturnType<Env['mk']>>;

const find = <T extends ServerMessage['type']>(ms: ServerMessage[], type: T) =>
  ms.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const errorOf = (ms: ServerMessage[]) => find(ms, 'error');

async function duel(e: Env) {
  const ana = await e.mk('ana', 'acme');
  const bruno = await e.mk('bruno', 'globex');
  await ana.send({ type: 'challenge', targetUserId: 'bruno' });
  const inv = find(await bruno.poll(), 'invite')!;
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  await ana.poll();
  return { ana, bruno, roomId: inv.roomId };
}

async function playMoves(ana: C, bruno: C, fullMoves: number) {
  let guard = 0;
  while (ana.state!.fullMoveNumber <= fullMoves && !ana.state!.winner && guard++ < 100) {
    const s = ana.state!;
    const pc = s.pendingConvocation;
    const actor = (pc ? pc.color : s.turn) === 'w' ? ana : bruno;
    if (pc) await actor.send({ type: 'convocate', choice: 'keep_pawn' });
    else {
      const mv = chooseBestAIMove(s, s.turn, 1);
      assert.ok(mv, 'sem lance legal');
      await actor.send({ type: 'move', move: mv });
    }
    await (actor === ana ? bruno : ana).poll();
  }
}

test('login/lobby: usuarios de empresas diferentes se veem, sem accountId', async () => {
  const e = await setup();
  const ana = await e.mk('ana', 'acme');
  await e.mk('bruno', 'globex');
  const ms = await ana.poll();
  const lobby = find(ms, 'lobby')!;
  assert.deepEqual(lobby.online.map((u) => u.userId).sort(), ['ana', 'bruno']);
  assert.ok(lobby.online.every((u) => u.accountId === null && u.workspaceId === null));
  assert.deepEqual(lobby.rooms, []);
  assert.equal((await ana.poll(false)).length, 0);
  await e.db.close();
});

test('create_room + join por codigo', async () => {
  const e = await setup();
  const ana = await e.mk('ana');
  const bruno = await e.mk('bruno');
  const ms = await ana.send({ type: 'create_room' });
  const created = find(ms, 'room_created')!;
  assert.match(created.roomId, /^[A-Z2-9]{6}$/);
  assert.equal(find(ms, 'joined')!.yourSeat, 'w');
  assert.equal(find(ms, 'joined')!.resumed, false);

  assert.equal(errorOf(await bruno.send({ type: 'join', roomId: 'ZZZZZZ' }))?.code, 'room_not_found');
  assert.equal(errorOf(await bruno.send({ type: 'join', roomId: 'abc' }))?.code, 'room_not_found');
  const j = find(await bruno.send({ type: 'join', roomId: created.roomId.toLowerCase() }), 'joined')!;
  assert.equal(j.yourSeat, 'b');
  assert.equal(j.seats.w?.userId, 'ana');
  const seats = find(await ana.poll(), 'seats')!;
  assert.equal(seats.seats.b?.userId, 'bruno');
  // lobby lista a sala como playing
  const lobbyMs = await e.mk('carla');
  const lobby = find(await lobbyMs.poll(), 'lobby')!;
  assert.equal(lobby.rooms.length, 1);
  assert.equal(lobby.rooms[0].phase, 'playing');
  // join repetido eh noop
  assert.equal(errorOf(await bruno.send({ type: 'join', roomId: created.roomId })), undefined);
  await e.db.close();
});

test('desafio aceito: cores e joined para ambos', async () => {
  const e = await setup();
  const ana = await e.mk('ana', 'acme');
  const bruno = await e.mk('bruno', 'globex');
  const ms = await ana.send({ type: 'challenge', targetUserId: 'bruno', sceneRoom: 'bold_studio' });
  assert.equal(find(ms, 'room_created')!.sceneRoom, 'bold_studio');
  assert.equal(find(ms, 'joined')!.yourSeat, 'w');
  const inv = find(await bruno.poll(), 'invite')!;
  assert.equal(inv.from.userId, 'ana');
  assert.equal(inv.from.accountId, null);
  assert.equal(inv.expiresAt, T0 + 60_000);
  const bms = await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  assert.equal(find(bms, 'joined')!.yourSeat, 'b');
  assert.equal(bruno.state!.turn, 'w');
  const ams = await ana.poll();
  assert.equal(find(ams, 'invite_result')!.status, 'accepted');
  const aj = find(ams, 'joined')!;
  assert.equal(aj.yourSeat, 'w');
  assert.equal(aj.seats.b?.userId, 'bruno');
  // convite usado nao pode ser reutilizado
  const again = await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  assert.equal(errorOf(again)?.code, 'bad_request');
  await e.db.close();
});

test('desafio recusado', async () => {
  const e = await setup();
  const ana = await e.mk('ana');
  const bruno = await e.mk('bruno');
  await ana.send({ type: 'challenge', targetUserId: 'bruno' });
  const inv = find(await bruno.poll(), 'invite')!;
  // so o alvo responde
  const carla = await e.mk('carla');
  assert.equal(errorOf(await carla.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true }))?.code, 'bad_request');
  const bms = await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: false });
  assert.equal(find(bms, 'joined'), undefined);
  assert.equal(find(await ana.poll(), 'invite_result')!.status, 'declined');
  assert.equal(bruno.roomId, null);
  await e.db.close();
});

test('desafio expirado (relogio injetado)', async () => {
  const e = await setup({ inviteTtlMs: 5_000 });
  const ana = await e.mk('ana');
  const bruno = await e.mk('bruno');
  await ana.send({ type: 'challenge', targetUserId: 'bruno' });
  const inv = find(await bruno.poll(), 'invite')!;
  e.clock.t += 6_000;
  const r1 = await ana.poll();
  assert.equal(r1.filter((m) => m.type === 'invite_result').length, 1);
  assert.equal(find(r1, 'invite_result')!.status, 'expired');
  assert.equal(ana.all.filter((m) => m.type === 'invite_result').length, 1);
  await ana.poll();
  assert.equal(ana.all.filter((m) => m.type === 'invite_result').length, 1, 'expira uma vez');
  const bms = await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  assert.equal(find(bms, 'joined'), undefined);
  assert.equal(bruno.roomId, null);

  // convite pendente expirado respondido antes do poll do desafiante
  e.clock.t += 1_000;
  await bruno.poll();
  await ana.send({ type: 'challenge', targetUserId: 'bruno' });
  const inv2 = find(await bruno.poll(), 'invite')!;
  e.clock.t += 6_000;
  const bms2 = await bruno.send({ type: 'invite_response', inviteId: inv2.inviteId, accept: true });
  assert.equal(find(bms2, 'joined'), undefined);
  assert.equal(find(bms2, 'invite_result')!.status, 'expired');
  await e.db.close();
});

test('alvo offline, self challenge, rate limit', async () => {
  const e = await setup({ maxInvitesPerMinute: 2 });
  const ana = await e.mk('ana');
  const bruno = await e.mk('bruno');
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'ana' }))?.code, 'self_challenge');
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'ghost' }))?.code, 'user_offline');
  e.clock.t += 30_000;
  await ana.poll();
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'bruno' }))?.code, 'user_offline');
  await bruno.poll();
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'bruno' })), undefined);
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'bruno' })), undefined);
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'bruno' }))?.code, 'rate_limited');
  e.clock.t += 61_000;
  await bruno.poll();
  assert.equal(errorOf(await ana.send({ type: 'challenge', targetUserId: 'bruno' })), undefined);
  await e.db.close();
});

test('user_busy e in_game', async () => {
  const e = await setup();
  const { ana } = await duel(e);
  const carla = await e.mk('carla');
  assert.equal(errorOf(await carla.send({ type: 'challenge', targetUserId: 'ana' }))?.code, 'user_busy');
  const ms = await ana.send({ type: 'create_room' });
  assert.equal(errorOf(ms)?.code, 'bad_request');
  assert.equal(errorOf(ms)?.message, 'in_game');
  assert.equal(ana.roomId !== null, true);
  const other = await carla.send({ type: 'create_room' });
  assert.ok(find(other, 'room_created'));
  assert.equal(errorOf(await ana.send({ type: 'join', roomId: find(other, 'room_created')!.roomId }))?.message, 'in_game');
  await e.db.close();
});

test('espectador entra e eh barrado; lance fora do turno', async () => {
  const e = await setup();
  const { ana, bruno, roomId } = await duel(e);
  const carla = await e.mk('carla');
  const j = find(await carla.send({ type: 'join', roomId, asSpectator: true }), 'joined')!;
  assert.equal(j.yourSeat, 'spectator');
  assert.equal(errorOf(await carla.send({ type: 'resign' }))?.code, 'not_a_player');
  assert.equal(errorOf(await carla.send({ type: 'auto_draft' }))?.code, 'not_a_player');
  assert.equal(errorOf(await carla.send({ type: 'rematch' }))?.code, 'not_a_player');
  // os jogadores veem o espectador
  assert.equal(find(await ana.poll(), 'seats')!.seats.spectators[0].userId, 'carla');
  // terceiro entrando sem asSpectator vira espectador (sem room_full)
  const dani = await e.mk('dani');
  assert.equal(find(await dani.send({ type: 'join', roomId }), 'joined')!.yourSeat, 'spectator');
  // lance de preto fora do turno
  const mv = { from: { row: 1, col: 0 }, to: { row: 2, col: 0 }, kind: 'move' } as any;
  assert.equal(errorOf(await bruno.send({ type: 'move', move: mv }))?.code, 'not_your_turn');
  assert.equal(errorOf(await ana.send({ type: 'move', move: { from: { row: 9, col: 0 }, to: { row: 2, col: 0 }, kind: 'move' } as any }))?.code, 'bad_request');
  await e.db.close();
});

test('partida longa ate resign: match_ended 1x, finishMatch 1x, espectador recebe', async () => {
  const e = await setup();
  const { ana, bruno, roomId } = await duel(e);
  const carla = await e.mk('carla');
  await carla.send({ type: 'join', roomId, asSpectator: true });
  await playMoves(ana, bruno, 12);
  assert.ok(ana.state!.fullMoveNumber > 12 || ana.state!.winner);
  if (!ana.state!.winner) await bruno.send({ type: 'resign' });
  const mine = await ana.poll();
  const ended = find(mine, 'match_ended')!;
  assert.equal(ended.roomId, roomId);
  assert.equal(ended.points.length, 2);
  assert.equal(ended.reason, ana.state!.endReason ?? 'resign');
  await bruno.poll();
  assert.ok(find(await carla.poll(), 'match_ended'));
  assert.equal(e.calls.length, 1);
  assert.ok(e.calls[0].moves >= 12 || e.calls[0].reason !== 'resign');
  assert.equal(e.calls[0].white?.userId, 'ana');
  assert.equal(e.calls[0].white?.accountId, 'acct-acme', 'leaderboard recebe identidade completa');
  // polls extras nao repetem nem repontuam
  assert.equal((await ana.poll()).filter((m) => m.type === 'match_ended').length, 0);
  assert.equal(e.calls.length, 1);
  // resign depois do fim: noop
  await bruno.send({ type: 'resign' });
  assert.equal(e.calls.length, 1);
  await e.db.close();
});

test('leave em partida = abandono (1x)', async () => {
  const e = await setup();
  const { ana, bruno } = await duel(e);
  const ms = await ana.send({ type: 'leave' });
  assert.ok(find(ms, 'left'));
  const bms = await bruno.poll();
  assert.equal(bruno.state!.winner, 'b');
  const ended = find(bms, 'match_ended')!;
  assert.equal(ended.reason, 'abandon');
  assert.equal(ended.result, 'b');
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].reason, 'abandon');
  assert.equal(find(await ana.poll(), 'match_ended'), undefined);
  await e.db.close();
});

test('jogador ausente => abandono 1x', async () => {
  const e = await setup({ absentGraceMs: 60_000 });
  const { ana, bruno } = await duel(e);
  e.clock.t += 30_000;
  await ana.poll();
  assert.equal(bruno.state!.winner, null);
  e.clock.t += 31_000; // bruno sem poll ha 61s
  const ms = await ana.poll();
  assert.equal(ana.state!.winner, 'w');
  assert.equal(find(ms, 'match_ended')!.reason, 'abandon');
  await ana.poll();
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].result, 'w');
  // bruno volta: descobre que saiu e perdeu
  const back = await bruno.poll();
  assert.ok(find(back, 'left'));
  assert.equal(find(back, 'match_ended')!.result, 'w');
  assert.equal(e.calls.length, 1);
  await e.db.close();
});

test('espectador ausente eh removido', async () => {
  const e = await setup();
  const { ana, roomId } = await duel(e);
  const carla = await e.mk('carla');
  await carla.send({ type: 'join', roomId, asSpectator: true });
  assert.equal(find(await ana.poll(), 'seats')!.seats.spectators.length, 1);
  e.clock.t += 30_000;
  await ana.poll();
  e.clock.t += 100_000; // carla sem poll por 130s; ana ativa
  const ms = await ana.poll();
  assert.equal(find(ms, 'seats')!.seats.spectators.length, 0);
  assert.ok(find(await carla.poll(), 'left'));
  await e.db.close();
});

test('rematch so apos o fim; reinicia e pontua de novo', async () => {
  const e = await setup();
  const { ana, bruno } = await duel(e);
  const early = await ana.send({ type: 'rematch' });
  assert.equal(errorOf(early)?.code, 'bad_request');
  await ana.send({ type: 'resign' });
  assert.equal(ana.state!.winner, 'b');
  await bruno.poll();
  assert.equal(e.calls.length, 1);
  await bruno.send({ type: 'rematch' });
  assert.equal(bruno.state!.winner, null);
  assert.equal(bruno.state!.fullMoveNumber, 1);
  await ana.poll();
  assert.equal(ana.state!.winner, null);
  await bruno.send({ type: 'resign' });
  assert.equal(e.calls.length, 2);
  await e.db.close();
});

test('emote: cooldown, evento para todos, validacao', async () => {
  const e = await setup({ emoteCooldownMs: 10_000 });
  const { ana, bruno } = await duel(e);
  await ana.send({ type: 'emote', emoteId: 'gg' });
  assert.equal(find(await bruno.poll(), 'emote')!.fromColor, 'w');
  await ana.poll();
  assert.equal(find(ana.all, 'emote')!.emoteId, 'gg');
  e.clock.t += 5_000;
  await ana.send({ type: 'emote', emoteId: 'gg' });
  assert.equal(find(await bruno.poll(), 'emote'), undefined);
  e.clock.t += 5_000;
  await ana.send({ type: 'emote', emoteId: 'gg' });
  assert.ok(find(await bruno.poll(), 'emote'));
  assert.equal(errorOf(await bruno.send({ type: 'emote', emoteId: 'x'.repeat(33) }))?.code, 'bad_request');
  assert.equal(errorOf(await bruno.send({ type: 'emote', emoteId: 5 as any }))?.code, 'bad_request');
  await e.db.close();
});

test('deltas de versao: poll sem mudanca nao devolve nada alem do lobby', async () => {
  const e = await setup();
  const { ana, bruno } = await duel(e);
  assert.equal((await ana.poll()).length, 0);
  assert.equal((await bruno.poll()).length, 0);
  const mv = chooseBestAIMove(ana.state!, 'w', 1)!;
  await ana.send({ type: 'move', move: mv });
  const ms = await bruno.poll();
  assert.equal(ms.length, 1);
  assert.equal(ms[0].type, 'state');
  assert.equal(bruno.state!.turn, 'b');
  assert.equal((await bruno.poll()).length, 0);
  // lobby: so lobby (e nada com active=false)
  const carla = await e.mk('carla');
  assert.deepEqual((await carla.poll()).map((m) => m.type), ['lobby']);
  assert.equal((await carla.poll(false)).length, 0);
  // sala de espera: lobby continua chegando
  await carla.send({ type: 'create_room' });
  assert.deepEqual((await carla.poll()).map((m) => m.type), ['lobby']);
  await e.db.close();
});

test('nao vaza accountId/workspaceId', async () => {
  const e = await setup();
  const { ana, bruno, roomId } = await duel(e);
  const carla = await e.mk('carla', 'initech');
  await carla.send({ type: 'join', roomId, asSpectator: true });
  await ana.send({ type: 'emote', emoteId: 'gg' });
  await ana.send({ type: 'resign' });
  for (const c of [ana, bruno, carla]) await c.poll();
  for (const c of [ana, bruno, carla]) {
    const json = JSON.stringify(c.all);
    assert.ok(!json.includes('acct-'), `vazou accountId para ${c.me.userId}`);
    assert.ok(!json.includes('ws-'), `vazou workspaceId para ${c.me.userId}`);
  }
  await e.db.close();
});

test('concorrencia: dois moves simultaneos do mesmo jogador, so um aplica', async () => {
  const e = await setup();
  const { ana, bruno } = await duel(e);
  const mv = chooseBestAIMove(ana.state!, 'w', 1)!;
  const [r1, r2] = await Promise.all([ana.send({ type: 'move', move: mv }), ana.send({ type: 'move', move: mv })]);
  const errs = [errorOf(r1), errorOf(r2)].filter(Boolean);
  assert.equal(errs.length, 1);
  assert.equal(errs[0]!.code, 'not_your_turn');
  await bruno.poll();
  assert.equal(bruno.state!.history.length, 1);
  assert.equal(bruno.state!.turn, 'b');
  // join simultaneo do mesmo usuario em salas diferentes termina em UMA sala
  const carla = await e.mk('carla');
  const a = find(await carla.send({ type: 'create_room' }), 'room_created')!.roomId;
  const dani = await e.mk('dani');
  const b = find(await dani.send({ type: 'create_room' }), 'room_created')!.roomId;
  const z = await e.mk('zed');
  await Promise.all([z.send({ type: 'join', roomId: a }), z.send({ type: 'join', roomId: b })]);
  const rows = await e.db.query('SELECT room_id FROM chess_members WHERE user_id = $1', ['zed']);
  assert.equal(rows.rows.length, 1);
  await e.db.close();
});

test('login devolve resumeRoomId e limites de salas', async () => {
  const e = await setup({ maxRooms: 2 });
  const ana = await e.mk('ana');
  assert.equal((await ana.login()).resumeRoomId, null);
  await ana.send({ type: 'create_room' });
  assert.equal((await ana.login()).resumeRoomId, ana.roomId);
  const bruno = await e.mk('bruno');
  await bruno.send({ type: 'create_room' });
  const carla = await e.mk('carla');
  assert.equal(errorOf(await carla.send({ type: 'create_room' }))?.code, 'rate_limited');
  // sair de uma sala de espera nao exige abandono
  const ms = await ana.send({ type: 'leave' });
  assert.ok(find(ms, 'left'));
  assert.equal(e.calls.length, 0);
  await e.db.close();
});

test('cliente novo (cursor 0) nao recebe eventos antigos, so recentes', async () => {
  const db = await newDb();
  const clock = { t: T0 };
  const lb: Leaderboard = { async finishMatch() { return []; } };
  const game = createGame({ db, leaderboard: lb, now: () => clock.t });
  const me = ident('u1', 'a');
  await game.login(me); // cria o esquema
  const old = { type: 'invite_result', inviteId: 'velho', status: 'expired' };
  const recent = { type: 'invite_result', inviteId: 'novo', status: 'declined' };
  await db.query('INSERT INTO chess_events (user_id, msg, created_at) VALUES ($1,$2,$3)', ['u1', JSON.stringify(old), T0 - 5 * 60_000]);
  await db.query('INSERT INTO chess_events (user_id, msg, created_at) VALUES ($1,$2,$3)', ['u1', JSON.stringify(recent), T0 - 5_000]);
  const v = await game.poll(me, EMPTY_POS, true);
  const ids = v.messages.filter((m) => m.type === 'invite_result').map((m: any) => m.inviteId);
  assert.deepEqual(ids, ['novo']);
  // proximo poll com o cursor devolvido nao repete
  const v2 = await game.poll(me, v.pos, true);
  assert.equal(v2.messages.filter((m) => m.type === 'invite_result').length, 0);
  await db.close();
});

// ---------- relogio / modo de jogo ----------
const FIVE_MIN = { baseMs: 300_000, incrementMs: 2_000 };

async function timedDuel(e: Env, time: { baseMs: number; incrementMs: number } | null = FIVE_MIN) {
  const ana = await e.mk('ana', 'acme');
  const bruno = await e.mk('bruno', 'globex');
  await ana.send({ type: 'challenge', targetUserId: 'bruno', time });
  const inv = find(await bruno.poll(), 'invite')!;
  return { ana, bruno, inv };
}

test('relogio: convite leva o tempo, so comeca com os dois sentados e sai carimbado', async () => {
  const e = await setup();
  const { ana, bruno, inv } = await timedDuel(e);
  assert.deepEqual(inv.time, FIVE_MIN);
  // desafiante sozinho na sala: relogio criado, mas parado
  assert.equal(ana.state!.clock!.baseMs, 300_000);
  assert.equal(ana.state!.clock!.turnStartedAt, null);
  e.clock.t += 8_000; // o convidado demora para aceitar: nao gasta tempo de ninguem
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  const c = bruno.state!.clock!;
  assert.equal(c.turnStartedAt, e.clock.t);
  assert.equal(c.now, e.clock.t); // carimbo do servidor para o cliente corrigir a latencia
  assert.deepEqual(c.remaining, { w: 300_000, b: 300_000 });
  await e.db.close();
});

test('relogio: jogada desconta o tempo e soma incremento; poll do outro ve o novo estado', async () => {
  const e = await setup();
  const { ana, bruno, inv } = await timedDuel(e);
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  await ana.poll();
  e.clock.t += 12_000;
  const mv = chooseBestAIMove(ana.state!, 'w', 1)!;
  await ana.send({ type: 'move', move: mv });
  assert.equal(ana.state!.turn, 'b');
  assert.equal(ana.state!.clock!.remaining.w, 300_000 - 12_000 + 2_000);
  assert.equal(ana.state!.clock!.turnStartedAt, e.clock.t);
  await bruno.poll();
  assert.equal(bruno.state!.clock!.remaining.w, 290_000);
  await e.db.close();
});

test('relogio: tempo esgotado detectado por poll => match_ended timeout, pontua 1x', async () => {
  const e = await setup({ absentGraceMs: 10 ** 9 }); // isola o tempo esgotado do abandono por ausencia
  const { ana, bruno, inv } = await timedDuel(e, { baseMs: 60_000, incrementMs: 0 });
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  await ana.poll();
  await playMoves(ana, bruno, 11); // partida longa o bastante para pontuar
  assert.ok(!ana.state!.winner);
  e.clock.t += 61_000; // estoura quem esta com a vez
  const turnBefore = ana.state!.turn;
  const spectatorView = await bruno.poll();
  const ms = [...spectatorView, ...(await ana.poll())];
  const end = ms.find((m) => m.type === 'match_ended') as Extract<ServerMessage, { type: 'match_ended' }> | undefined;
  assert.ok(end, 'deveria haver match_ended');
  assert.equal(end!.reason, 'timeout');
  assert.equal(ana.state!.winner, turnBefore === 'w' ? 'b' : 'w');
  assert.equal(ana.state!.endReason, 'timeout');
  assert.equal(ana.state!.clock!.turnStartedAt, null);
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].reason, 'timeout');
  // nada mais pontua em polls seguintes
  await ana.poll();
  await bruno.poll();
  assert.equal(e.calls.length, 1);
  await e.db.close();
});

test('relogio: jogada enviada depois de estourar o tempo perde a partida', async () => {
  const e = await setup();
  const { ana, bruno, inv } = await timedDuel(e, { baseMs: 30_000, incrementMs: 0 });
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  await ana.poll();
  e.clock.t += 31_000;
  const mv = chooseBestAIMove(ana.state!, 'w', 1)!;
  await ana.send({ type: 'move', move: mv });
  assert.equal(ana.state!.winner, 'b');
  assert.equal(ana.state!.endReason, 'timeout');
  assert.equal(ana.state!.history.length, 0); // o lance nao valeu
  await e.db.close();
});

test('modo livre: sem relogio e nunca estoura', async () => {
  const e = await setup();
  const { ana, bruno, inv } = await timedDuel(e, null);
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  await ana.poll();
  assert.equal(ana.state!.clock, undefined);
  e.clock.t += 10 ** 7; // horas parado
  await bruno.poll(); // maintain nao encerra por tempo
  assert.ok(!bruno.state!.winner || bruno.state!.endReason !== 'timeout');
  await e.db.close();
});

test('relogio: tempo invalido e rejeitado e sala criada leva o tempo para o lobby', async () => {
  const e = await setup();
  const ana = await e.mk('ana');
  const bad = await ana.send({ type: 'create_room', time: { baseMs: 5, incrementMs: 0 } });
  assert.equal(errorOf(bad)?.code, 'bad_request');
  assert.equal(errorOf(bad)?.message, 'invalid_time');
  const ok = await ana.send({ type: 'create_room', time: FIVE_MIN });
  assert.ok(find(ok, 'room_created'));
  const bruno = await e.mk('bruno');
  const lobby = find(await bruno.poll(), 'lobby')!;
  assert.deepEqual(lobby.rooms[0].time, FIVE_MIN);
  await e.db.close();
});

test('relogio: revanche mantem o controle de tempo e reinicia o relogio', async () => {
  const e = await setup();
  const { ana, bruno, inv } = await timedDuel(e, { baseMs: 60_000, incrementMs: 1_000 });
  await bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
  await ana.poll();
  await ana.send({ type: 'resign' });
  assert.equal(ana.state!.clock!.turnStartedAt, null);
  e.clock.t += 5_000;
  await bruno.send({ type: 'rematch' });
  assert.equal(bruno.state!.clock!.baseMs, 60_000);
  assert.equal(bruno.state!.clock!.incrementMs, 1_000);
  assert.deepEqual(bruno.state!.clock!.remaining, { w: 60_000, b: 60_000 });
  assert.equal(bruno.state!.clock!.turnStartedAt, e.clock.t);
  await e.db.close();
});
