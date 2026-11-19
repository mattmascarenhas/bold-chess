import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyMove,
  autoDraftRemaining,
  createInitialState,
  draftPick,
  oppositeColor,
  resolveConvocation,
} from './src/game/engine';
import type { Color, SceneRoomId } from './src/game/types';
import {
  INVITE_TTL_MS,
  MAX_INVITES_PER_MINUTE,
  RESUME_GRACE_MS,
  ROOM_CODE_REGEX,
  type AuthErrorCode,
  type ClientMessage,
  type ErrorCode,
  type PlayerIdentity,
  type PointsAward,
  type Seat,
  type ServerMessage,
} from './src/shared/protocol';
import type { Leaderboard, Store, VerifyToken } from './server/types';
import { Debouncer, InviteBook, Presence, publicIdentity, sendTo, type Conn } from './server/presence';
import { RoomManager, type Room } from './server/rooms';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_SCENE_ROOMS: SceneRoomId[] = ['bold_office', 'bold_studio', 'bold_executive'];
const MAX_MESSAGE_BYTES = 64 * 1024;
const EMOTE_COOLDOWN_MS = 10_000;
const AUTH_CODES: AuthErrorCode[] = ['invalid_token', 'expired_token', 'auth_unavailable'];

export interface GameServerOptions {
  verifyToken?: VerifyToken;
  leaderboard?: Leaderboard;
  store?: Store;
  port?: number;
  serveClient?: boolean;
  /** ---- ajustes para teste ---- */
  inviteTtlMs?: number;
  resumeGraceMs?: number;
  authTimeoutMs?: number;
  lobbyDebounceMs?: number;
  emptyRoomTtlMs?: number;
  sweepIntervalMs?: number;
}

export interface GameServer {
  server: http.Server;
  port: number;
  close(): Promise<void>;
}

function sceneOrDefault(v: unknown): SceneRoomId {
  return VALID_SCENE_ROOMS.includes(v as SceneRoomId) ? (v as SceneRoomId) : 'bold_office';
}

const MAX_ROOMS = 500;

function isPos(p: any): boolean {
  return !!p && Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.row < 8 && p.col >= 0 && p.col < 8;
}

export async function createGameServer(opts: GameServerOptions = {}): Promise<GameServer> {
  const inviteTtlMs = opts.inviteTtlMs ?? INVITE_TTL_MS;
  const graceMs = opts.resumeGraceMs ?? RESUME_GRACE_MS;
  const authTimeoutMs = opts.authTimeoutMs ?? 10_000;
  const emptyRoomTtlMs = opts.emptyRoomTtlMs ?? 5 * 60_000;

  // ---- dependencias (imports dinamicos so quando nao injetadas) ----
  let store = opts.store;
  let leaderboard = opts.leaderboard;
  let verifyToken = opts.verifyToken;
  if (!verifyToken) {
    const { createVerifyToken } = await import('./server/auth');
    verifyToken = createVerifyToken();
  }
  if (!store && !leaderboard) {
    if (process.env.DATABASE_URL) {
      const { createPgStore } = await import('./server/store-pg');
      store = createPgStore(process.env.DATABASE_URL);
    } else {
      const { createStore } = await import('./server/store');
      store = await createStore();
    }
  }
  if (!leaderboard) {
    const { createLeaderboard } = await import('./server/leaderboard');
    leaderboard = createLeaderboard(store!);
  }
  const lb = leaderboard;
  const verify = verifyToken;

  const presence = new Presence();
  const rooms = new RoomManager();
  const invites = new InviteBook();

  // ---- lobby push (debounce) ----
  const lobbyMsg = (): ServerMessage => ({
    type: 'lobby',
    online: presence.onlineList(),
    rooms: rooms.listSummaries(),
  });
  const lobbyPush = new Debouncer(() => presence.broadcastAll(lobbyMsg()), opts.lobbyDebounceMs ?? 300);

  // ---- HTTP ----
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  // CORS para o frontend hospedado em outra origem (ex.: Vercel). Rotas /api sao somente
  // leitura publica (ranking/audio) ou sem credenciais; a autenticacao do jogo e por token no WebSocket.
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/audio-manifest', (_req, res) => {
    const audioDir = path.resolve(__dirname, 'public/audio');
    let files: string[] = [];
    let config: unknown = null;
    if (fs.existsSync(audioDir)) {
      files = fs.readdirSync(audioDir).filter((f) => f.endsWith('.mp3'));
      const cfgPath = path.join(audioDir, 'audio-config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        } catch {
          config = null;
        }
      }
    }
    res.json({ files, config });
  });

  app.post('/api/rooms', (req, res) => {
    if (rooms.rooms.size >= MAX_ROOMS) {
      res.status(429).json({ error: 'Muitas salas abertas' });
      return;
    }
    const room = rooms.create(sceneOrDefault((req.body as { sceneRoom?: string } | undefined)?.sceneRoom));
    lobbyPush.schedule();
    res.json({ roomId: room.id, sceneRoom: room.sceneRoom });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = rooms.get(String(req.params.id).toUpperCase());
    if (!room) {
      res.status(404).json({ error: 'Sala não encontrada' });
      return;
    }
    res.json({
      roomId: room.id,
      players: (room.players.w ? 1 : 0) + (room.players.b ? 1 : 0),
      phase: room.state.draft.phase,
    });
  });

  if (store) {
    const { registerLeaderboardRoutes } = await import('./server/leaderboard');
    registerLeaderboardRoutes(app, store);
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

  // ---- helpers de sala ----
  const err = (conn: Conn, code: ErrorCode, message?: string) => sendTo(conn, { type: 'error', code, message });

  function broadcast(room: Room, msg: ServerMessage, except?: Conn) {
    for (const c of room.conns) if (c !== except) sendTo(c, msg);
  }
  const broadcastSeats = (room: Room) => broadcast(room, { type: 'seats', seats: rooms.seatsInfo(room) });

  function joinedMsg(room: Room, conn: Conn, resumed: boolean): ServerMessage {
    return {
      type: 'joined',
      roomId: room.id,
      sceneRoom: room.sceneRoom,
      yourSeat: conn.seat as Seat,
      state: room.state,
      seats: rooms.seatsInfo(room),
      resumed,
    };
  }

  /** Pontua UMA vez por partida (flag em room.scored) e avisa a sala. Nunca lanca. */
  function finalize(room: Room, reasonOverride?: string): void {
    const s = room.state;
    if (!s.winner || room.scored || !room.players.w || !room.players.b) return;
    room.scored = true;
    const input = {
      roomId: room.id,
      white: room.players.w,
      black: room.players.b,
      result: s.winner,
      reason: reasonOverride ?? s.endReason ?? 'unknown',
      moves: Math.max(0, s.fullMoveNumber - 1),
    };
    void (async () => {
      let points: PointsAward[] = [];
      try {
        points = await lb.finishMatch(input);
      } catch (e) {
        console.error('[leaderboard] finishMatch falhou', e);
      }
      broadcast(room, {
        type: 'match_ended',
        roomId: room.id,
        result: input.result,
        reason: input.reason,
        points,
      });
      lobbyPush.schedule();
    })();
  }

  function pushState(room: Room, extra: { event?: unknown; convocation?: string } = {}) {
    broadcast(room, { type: 'state', state: room.state, ...extra });
    finalize(room);
    lobbyPush.schedule();
  }

  function forfeit(room: Room, loser: Color, reason: string) {
    if (room.state.winner) return;
    room.state = { ...room.state, winner: oppositeColor(loser), endReason: 'resign' };
    broadcast(room, { type: 'state', state: room.state });
    finalize(room, reason);
  }

  /** Libera a vaga; se havia partida em andamento, o outro vence. */
  function releaseSeat(room: Room, color: Color, doForfeit: boolean) {
    const t = room.grace[color];
    if (t) clearTimeout(t);
    room.grace[color] = null;
    if (!room.players[color]) return;
    if (doForfeit && rooms.inProgress(room)) forfeit(room, color, 'abandon');
    room.players[color] = null;
    rooms.touchEmpty(room);
    broadcastSeats(room);
    lobbyPush.schedule();
  }

  function startGrace(room: Room, color: Color) {
    const old = room.grace[color];
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
      room.grace[color] = null;
      releaseSeat(room, color, true);
    }, graceMs);
    t.unref?.();
    room.grace[color] = t;
  }

  /** Tira a conexao da sala. 'drop' = queda (reserva vaga); 'leave' = saida definitiva. */
  function detach(conn: Conn, mode: 'drop' | 'leave') {
    const room = conn.roomId ? rooms.get(conn.roomId) : undefined;
    const seat = conn.seat;
    conn.roomId = null;
    conn.seat = null;
    if (!room) return;
    room.conns.delete(conn);
    if (seat === 'w' || seat === 'b') {
      const stillHeld = [...room.conns].some((c) => c.user.userId === conn.user.userId && c.seat === seat);
      if (!stillHeld) {
        if (mode === 'leave') releaseSeat(room, seat, true);
        else if (room.players[seat]) startGrace(room, seat);
      }
    }
    rooms.touchEmpty(room);
    broadcastSeats(room);
    lobbyPush.schedule();
  }

  function isBusy(userId: string): boolean {
    for (const r of rooms.rooms.values()) {
      if ((r.players.w?.userId === userId || r.players.b?.userId === userId) && rooms.inProgress(r)) return true;
    }
    return false;
  }

  /** Conexao atual esta num jogo em andamento como jogador (em sala diferente de `target`)? */
  function lockedInGame(conn: Conn, target?: Room): boolean {
    if (!conn.roomId || conn.roomId === target?.id) return false;
    const r = rooms.get(conn.roomId);
    return !!r && (conn.seat === 'w' || conn.seat === 'b') && rooms.inProgress(r);
  }

  /** Coloca a conexao na sala. A conexao mais nova do mesmo usuario assume; as antigas recebem left e fecham. */
  function enterRoom(conn: Conn, room: Room, mode: 'auto' | 'spectator' | 'w' | 'b'): boolean {
    for (const other of presence.conns(conn.user.userId)) {
      if (other === conn || !other.roomId) continue;
      sendTo(other, { type: 'left' });
      detach(other, 'drop');
      try {
        other.ws.close(4000, 'replaced');
      } catch {
        // ignore
      }
    }
    if (conn.roomId) detach(conn, 'drop');

    let seat: Seat = 'spectator';
    let resumed = false;
    const held = (['w', 'b'] as Color[]).find((c) => room.players[c]?.userId === conn.user.userId);
    if (held) {
      seat = held;
      resumed = true;
      const t = room.grace[held];
      if (t) clearTimeout(t);
      room.grace[held] = null;
      room.players[held] = conn.user;
    } else if (mode !== 'spectator') {
      const order: Color[] = mode === 'w' ? ['w'] : mode === 'b' ? ['b'] : ['w', 'b'];
      const free = order.find((c) => !room.players[c]);
      if (free) {
        seat = free;
        room.players[free] = conn.user;
      }
    }
    conn.roomId = room.id;
    conn.seat = seat;
    room.conns.add(conn);
    room.emptySince = null;
    sendTo(conn, joinedMsg(room, conn, resumed));
    broadcast(room, { type: 'seats', seats: rooms.seatsInfo(room) }, conn);
    lobbyPush.schedule();
    return resumed;
  }

  // ---- convites ----
  function sendInviteResult(inv: { fromUserId: string; roomId: string }, id: string, status: 'accepted' | 'declined' | 'expired' | 'offline') {
    presence.sendUser(inv.fromUserId, { type: 'invite_result', inviteId: id, status, roomId: inv.roomId });
  }

  function handleChallenge(conn: Conn, msg: Extract<ClientMessage, { type: 'challenge' }>) {
    const targetId = msg.targetUserId;
    if (typeof targetId !== 'string' || !targetId) return err(conn, 'bad_request');
    if (targetId === conn.user.userId) return err(conn, 'self_challenge');
    if (!invites.allow(conn.user.userId, MAX_INVITES_PER_MINUTE)) return err(conn, 'rate_limited');
    if (!presence.isOnline(targetId)) return err(conn, 'user_offline');
    if (isBusy(targetId)) return err(conn, 'user_busy');
    if (lockedInGame(conn)) return err(conn, 'bad_request', 'in_game');

    // Sala nova; o desafiante entra como brancas.
    const room = rooms.create(sceneOrDefault(msg.sceneRoom));
    sendTo(conn, { type: 'room_created', roomId: room.id, sceneRoom: room.sceneRoom });
    enterRoom(conn, room, 'w');

    const id = randomUUID();
    const expiresAt = Date.now() + inviteTtlMs;
    const timer = setTimeout(() => {
      const inv = invites.take(id);
      if (!inv) return;
      sendInviteResult(inv, id, 'expired');
      presence.sendUser(inv.targetUserId, { type: 'invite_result', inviteId: id, status: 'expired', roomId: inv.roomId });
    }, inviteTtlMs);
    timer.unref?.();
    invites.add({ id, fromUserId: conn.user.userId, targetUserId: targetId, roomId: room.id, expiresAt, timer });
    presence.sendUser(targetId, {
      type: 'invite',
      inviteId: id,
      from: publicIdentity(conn.user),
      roomId: room.id,
      sceneRoom: room.sceneRoom,
      expiresAt,
    });
  }

  function handleInviteResponse(conn: Conn, msg: Extract<ClientMessage, { type: 'invite_response' }>) {
    const inv = typeof msg.inviteId === 'string' ? invites.get(msg.inviteId) : undefined;
    // Quem nao eh o alvo (ou convite inexistente/usado) eh ignorado.
    if (!inv || inv.targetUserId !== conn.user.userId) return;
    invites.take(inv.id);
    if (!msg.accept) return sendInviteResult(inv, inv.id, 'declined');

    // Decisao: ao recusar/expirar a sala do desafiante eh mantida como sala de espera
    // (o desafiante continua nela; a limpeza periodica remove salas abandonadas).
    const room = rooms.get(inv.roomId);
    const valid = !!room && room.players.w?.userId === inv.fromUserId && !room.players.b && !room.state.winner;
    if (!room || !valid) {
      err(conn, 'room_not_found');
      return sendInviteResult(inv, inv.id, 'expired');
    }
    if (lockedInGame(conn, room)) {
      err(conn, 'user_busy');
      return sendInviteResult(inv, inv.id, 'declined');
    }
    enterRoom(conn, room, 'b');
    // Desafiante (todas as abas na sala) tambem recebe joined atualizado.
    for (const c of room.conns) {
      if (c !== conn && c.seat === 'w') sendTo(c, joinedMsg(room, c, false));
    }
    sendInviteResult(inv, inv.id, 'accepted');
  }

  // ---- mensagens autenticadas ----
  function requirePlayer(conn: Conn): { room: Room; color: Color } | null {
    const room = conn.roomId ? rooms.get(conn.roomId) : undefined;
    if (!room || (conn.seat !== 'w' && conn.seat !== 'b')) {
      err(conn, 'not_a_player');
      return null;
    }
    return { room, color: conn.seat };
  }

  function handle(conn: Conn, msg: ClientMessage) {
    switch (msg.type) {
      case 'ping':
        return sendTo(conn, { type: 'pong' });
      case 'lobby_list': {
        const now = Date.now();
        const c = conn as unknown as { lastLobbyAt?: number };
        if (now - (c.lastLobbyAt ?? 0) < 1000) return err(conn, 'rate_limited');
        c.lastLobbyAt = now;
        return sendTo(conn, lobbyMsg());
      }
      case 'create_room': {
        if (lockedInGame(conn)) return err(conn, 'bad_request', 'in_game');
        if (rooms.rooms.size >= MAX_ROOMS) return err(conn, 'rate_limited', 'too_many_rooms');
        const room = rooms.create(sceneOrDefault(msg.sceneRoom));
        sendTo(conn, { type: 'room_created', roomId: room.id, sceneRoom: room.sceneRoom });
        enterRoom(conn, room, 'auto');
        return;
      }
      case 'join': {
        const id = typeof msg.roomId === 'string' ? msg.roomId.trim().toUpperCase() : '';
        const room = ROOM_CODE_REGEX.test(id) ? rooms.get(id) : undefined;
        if (!room) return err(conn, 'room_not_found');
        if (lockedInGame(conn, room)) return err(conn, 'bad_request', 'in_game');
        enterRoom(conn, room, msg.asSpectator ? 'spectator' : 'auto');
        return;
      }
      case 'leave': {
        if (!conn.roomId) return sendTo(conn, { type: 'left' });
        detach(conn, 'leave');
        return sendTo(conn, { type: 'left' });
      }
      case 'challenge':
        return handleChallenge(conn, msg);
      case 'invite_response':
        return handleInviteResponse(conn, msg);
      case 'draft_pick': {
        const p = requirePlayer(conn);
        if (!p) return;
        if (!rooms.inProgress(p.room)) return err(conn, 'bad_request', 'waiting_opponent');
        const next = draftPick(p.room.state, p.color, msg.specialId);
        if (next !== p.room.state) {
          p.room.state = next;
          pushState(p.room);
        }
        return;
      }
      case 'auto_draft': {
        const p = requirePlayer(conn);
        if (!p) return;
        if (!rooms.inProgress(p.room)) return err(conn, 'bad_request', 'waiting_opponent');
        p.room.state = autoDraftRemaining(p.room.state);
        pushState(p.room);
        return;
      }
      case 'move': {
        const p = requirePlayer(conn);
        if (!p) return;
        if (!rooms.inProgress(p.room)) return err(conn, 'bad_request', 'waiting_opponent');
        const m = msg.move as any;
        if (!m || !isPos(m.from) || !isPos(m.to)) return err(conn, 'bad_request');
        if (p.room.state.turn !== p.color) return err(conn, 'not_your_turn');
        const next = applyMove(p.room.state, msg.move);
        if (next !== p.room.state) {
          p.room.state = next;
          pushState(p.room, { event: next.lastMove });
        }
        return;
      }
      case 'convocate': {
        const p = requirePlayer(conn);
        if (!p) return;
        if (!rooms.inProgress(p.room)) return err(conn, 'bad_request', 'waiting_opponent');
        if (p.room.state.pendingConvocation?.color !== p.color) return err(conn, 'not_your_turn');
        const next = resolveConvocation(p.room.state, msg.choice);
        if (next !== p.room.state) {
          p.room.state = next;
          pushState(p.room, { convocation: msg.choice });
        }
        return;
      }
      case 'resign': {
        const p = requirePlayer(conn);
        if (!p) return;
        if (!rooms.inProgress(p.room)) return;
        p.room.state = { ...p.room.state, winner: oppositeColor(p.color), endReason: 'resign' };
        pushState(p.room);
        return;
      }
      case 'rematch': {
        // Decisao: so apos o fim da partida (evita fugir de uma derrota reiniciando).
        const p = requirePlayer(conn);
        if (!p) return;
        if (!p.room.state.winner) return err(conn, 'bad_request', 'game_not_finished');
        p.room.state = createInitialState(true);
        p.room.scored = false;
        pushState(p.room);
        return;
      }
      case 'emote': {
        const p = requirePlayer(conn);
        if (!p) return;
        if (typeof msg.emoteId !== 'string' || !msg.emoteId || msg.emoteId.length > 64) return err(conn, 'bad_request');
        const now = Date.now();
        if (now - conn.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
        conn.lastEmoteAt = now;
        broadcast(p.room, { type: 'emote', emoteId: msg.emoteId, fromColor: p.color });
        return;
      }
      default:
        return err(conn, 'bad_request');
    }
  }

  // ---- WebSocket ----
  wss.on('connection', (ws) => {
    let conn: Conn | null = null;
    let authing = false;

    const raw = (m: ServerMessage) => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      } catch {
        // ignore
      }
    };

    const authTimer = setTimeout(() => {
      if (!conn) ws.close(4001, 'auth_timeout');
    }, authTimeoutMs);
    authTimer.unref?.();

    ws.on('error', () => {
      // erros de socket nunca derrubam o processo
    });

    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) return;
        const text = data.toString();
        if (text.length > MAX_MESSAGE_BYTES) return;
        let msg: ClientMessage;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return;

        if (!conn) {
          if (msg.type !== 'auth') {
            raw({ type: 'error', code: 'not_authenticated' });
            return;
          }
          if (authing || typeof msg.token !== 'string') return;
          authing = true;
          verify(msg.token).then(
            (user) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              clearTimeout(authTimer);
              conn = { ws, user, roomId: null, seat: null, lastEmoteAt: 0 };
              presence.add(conn);
              const resume = rooms.findSeatedRoom(user.userId);
              raw({ type: 'auth_ok', me: user, resumeRoomId: resume?.id ?? null });
              lobbyPush.schedule();
            },
            (e: unknown) => {
              const code = (e as { code?: AuthErrorCode } | null)?.code;
              raw({ type: 'auth_error', code: code && AUTH_CODES.includes(code) ? code : 'auth_unavailable' });
              ws.close(4003, 'auth_error');
            }
          );
          return;
        }

        if (msg.type === 'auth') return;
        handle(conn, msg);
      } catch (e) {
        console.error('[ws] erro ao tratar mensagem', e);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!conn) return;
      const c = conn;
      try {
        detach(c, 'drop');
      } catch (e) {
        console.error('[ws] erro no close', e);
      }
      presence.remove(c);
      lobbyPush.schedule();
    });
  });

  // ---- limpeza periodica de salas vazias ----
  const sweeper = setInterval(() => {
    const removed = rooms.sweep(emptyRoomTtlMs);
    invites.prune();
    if (removed.length) lobbyPush.schedule();
  }, opts.sweepIntervalMs ?? 30_000);
  sweeper.unref?.();

  // ---- cliente (vite em dev / estatico em prod) ----
  let vite: { close(): Promise<void> } | null = null;
  if (opts.serveClient ?? true) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const v = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
      vite = v;
      app.use(v.middlewares);
    } else {
      const distDir = path.resolve(__dirname, 'dist');
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const wantedPort = opts.port ?? (Number(process.env.PORT) || 3000);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(wantedPort, '0.0.0.0', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : wantedPort;

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clearInterval(sweeper);
    lobbyPush.cancel();
    invites.clear();
    rooms.disposeAll();
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
    if (vite) await vite.close();
  }

  return { server, port, close };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const strip = (p: string) => path.resolve(p).replace(/\.[cm]?[jt]s$/, '').toLowerCase();
  return strip(entry) === strip(__filename);
}

if (isMain()) {
  createGameServer()
    .then(({ port }) => console.log(`Xadrez Bold server listening on http://localhost:${port}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export type { PlayerIdentity };
