import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer, type GameServer } from '../server';
import type { FinishMatchInput, Leaderboard } from '../server/types';
import type { PlayerIdentity, PointsAward, ServerMessage } from '../src/shared/protocol';

const users: Record<string, PlayerIdentity> = {
  u1: { userId: 'u1', name: 'Ana', avatarUrl: null, accountId: 'accA', workspaceId: 'wsA' },
  u2: { userId: 'u2', name: 'Bruno', avatarUrl: null, accountId: 'accB', workspaceId: 'wsB' },
  u3: { userId: 'u3', name: 'Carla', avatarUrl: null, accountId: 'accC', workspaceId: 'wsC' },
  u5: { userId: 'u5', name: 'Eva', avatarUrl: null, accountId: 'accE', workspaceId: 'wsE' },
  u6: { userId: 'u6', name: 'Fábio', avatarUrl: null, accountId: 'accF', workspaceId: 'wsF' },
  u7: { userId: 'u7', name: 'Gil', avatarUrl: null, accountId: 'accG', workspaceId: 'wsG' },
  u8: { userId: 'u8', name: 'Hana', avatarUrl: null, accountId: 'accH', workspaceId: 'wsH' },
  u4: { userId: 'u4', name: 'Davi', avatarUrl: null, accountId: 'accA', workspaceId: 'wsA' },
};

class AuthFail extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const finished: FinishMatchInput[] = [];
const fakeLeaderboard: Leaderboard = {
  async finishAiMatch(input) {
    return { userId: input.user.userId, delta: 0, total: 0, counted: false };
  },
  async finishMatch(input) {
    finished.push(input);
    const awards: PointsAward[] = [input.white, input.black].map((p) => ({
      userId: p!.userId,
      delta: 1,
      total: 1,
      counted: true,
    }));
    return awards;
  },
};

type Msg = ServerMessage & Record<string, any>;

class Client {
  ws!: WebSocket;
  msgs: Msg[] = [];
  closed = false;
  private waiters: Array<() => void> = [];

  static async open(port: number): Promise<Client> {
    const c = new Client();
    c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    c.ws.on('message', (d) => {
      c.msgs.push(JSON.parse(d.toString()));
      c.waiters.forEach((w) => w());
    });
    c.ws.on('close', () => {
      c.closed = true;
      c.waiters.forEach((w) => w());
    });
    await new Promise<void>((res, rej) => {
      c.ws.once('open', () => res());
      c.ws.once('error', rej);
    });
    return c;
  }

  static async login(port: number, token: string): Promise<Client> {
    const c = await Client.open(port);
    c.send({ type: 'auth', token });
    await c.wait((m) => m.type === 'auth_ok');
    return c;
  }

  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }

  /** Espera (e consome) a primeira mensagem que casa; olha tambem o que ja chegou. */
  async wait(pred: (m: Msg) => boolean, ms = 2000): Promise<Msg> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.msgs.findIndex(pred);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout; recebidas: ${JSON.stringify(this.msgs.map((m) => m.type))}`);
      await new Promise<void>((res) => {
        const t = setTimeout(res, left);
        this.waiters.push(() => {
          clearTimeout(t);
          res();
        });
      });
    }
  }

  type(t: string, ms?: number) {
    return this.wait((m) => m.type === t, ms);
  }

  async waitClosed(ms = 2000) {
    const deadline = Date.now() + ms;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('nao fechou');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  close() {
    this.ws.close();
  }
}

const e2e4 = { kind: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } };

let gs: GameServer;
let port: number;
const open: Client[] = [];
const login = async (t: string) => {
  const c = await Client.login(port, t);
  open.push(c);
  return c;
};

before(async () => {
  gs = await createGameServer({
    port: 0,
    serveClient: false,
    leaderboard: fakeLeaderboard,
    verifyToken: async (token) => {
      const u = users[token];
      if (!u) throw new AuthFail(token === 'expired' ? 'expired_token' : 'invalid_token');
      return u;
    },
    inviteTtlMs: 300,
    resumeGraceMs: 400,
    authTimeoutMs: 300,
    lobbyDebounceMs: 20,
  });
  port = gs.port;
});

after(async () => {
  for (const c of open) c.close();
  await gs.close();
});

describe('autenticacao', () => {
  test('mensagem antes de auth => not_authenticated', async () => {
    const c = await Client.open(port);
    c.send({ type: 'lobby_list' });
    const e = await c.type('error');
    assert.equal(e.code, 'not_authenticated');
    c.close();
  });

  test('sem auth em tempo => fecha', async () => {
    const c = await Client.open(port);
    await c.waitClosed();
  });

  test('token invalido => auth_error e fecha', async () => {
    const c = await Client.open(port);
    c.send({ type: 'auth', token: 'nope' });
    const m = await c.type('auth_error');
    assert.equal(m.code, 'invalid_token');
    await c.waitClosed();
  });

  test('token valido => auth_ok; JSON invalido nao derruba', async () => {
    const c = await login('u1');
    c.ws.send('{{{nao json');
    c.send({ type: 'ping' });
    await c.type('pong');
    c.close();
  });
});

describe('lobby, convites e partida', () => {
  test('lobby lista online de contas diferentes sem accountId', async () => {
    const a = await login('u1');
    const b = await login('u2');
    a.send({ type: 'lobby_list' });
    const l = await a.type('lobby');
    const ids = l.online.map((u: any) => u.userId);
    assert.ok(ids.includes('u1') && ids.includes('u2'));
    assert.ok(l.online.every((u: any) => u.accountId === null && u.workspaceId === null));
    a.close();
    b.close();
  });

  test('desafio aceito: cores certas, contas diferentes; resign => match_ended + leaderboard 1x', async () => {
    finished.length = 0;
    const a = await login('u1'); // accA
    const b = await login('u2'); // accB
    a.send({ type: 'challenge', targetUserId: 'u2' });
    const inv = await b.type('invite');
    assert.equal(inv.from.userId, 'u1');
    assert.ok(inv.expiresAt > Date.now());
    b.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
    const ja = await a.wait((m) => m.type === 'joined' && m.seats.b !== null);
    const jb = await b.type('joined');
    assert.equal(ja.yourSeat, 'w');
    assert.equal(jb.yourSeat, 'b');
    assert.equal(ja.seats.w.userId, 'u1');
    assert.equal(ja.seats.b.userId, 'u2');
    const res = await a.type('invite_result');
    assert.equal(res.status, 'accepted');

    // convite so vale uma vez
    b.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });

    // brancas movem, depois blacks resign
    a.send({ type: 'move', move: e2e4 });
    const st = await b.type('state');
    assert.equal(st.state.turn, 'b');
    b.send({ type: 'resign' });
    const end = await a.type('match_ended');
    await b.type('match_ended');
    assert.equal(end.result, 'w');
    assert.equal(end.reason, 'resign');
    assert.equal(end.points.length, 2);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].white!.userId, 'u1');
    assert.equal(finished[0].result, 'w');
    // resign repetido nao pontua de novo
    b.send({ type: 'resign' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(finished.length, 1);
    a.close();
    b.close();
  });

  test('recusa', async () => {
    const a = await login('u1');
    const b = await login('u2');
    a.send({ type: 'challenge', targetUserId: 'u2' });
    const inv = await b.type('invite');
    b.send({ type: 'invite_response', inviteId: inv.inviteId, accept: false });
    const r = await a.type('invite_result');
    assert.equal(r.status, 'declined');
    a.close();
    b.close();
  });

  test('expiracao', async () => {
    const a = await login('u1');
    const b = await login('u2');
    a.send({ type: 'challenge', targetUserId: 'u2' });
    const inv = await b.type('invite');
    const r = await a.type('invite_result');
    assert.equal(r.status, 'expired');
    // resposta tardia ignorada
    b.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
    await new Promise((r2) => setTimeout(r2, 80));
    assert.ok(!a.msgs.some((m) => m.type === 'joined' && m.seats?.b));
    a.close();
    b.close();
  });

  test('alvo offline e self challenge', async () => {
    const a = await login('u1');
    a.send({ type: 'challenge', targetUserId: 'u4' });
    assert.equal((await a.type('error')).code, 'user_offline');
    a.send({ type: 'challenge', targetUserId: 'u1' });
    assert.equal((await a.type('error')).code, 'self_challenge');
    a.close();
  });

  test('resposta de quem nao eh alvo eh ignorada', async () => {
    const a = await login('u1');
    const b = await login('u2');
    const c = await login('u3');
    a.send({ type: 'challenge', targetUserId: 'u2' });
    const inv = await b.type('invite');
    c.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(!a.msgs.some((m) => m.type === 'invite_result'));
    a.close();
    b.close();
    c.close();
  });
});

describe('salas', () => {
  test('join por codigo, espectador barrado, fora do turno, sala inexistente', async () => {
    const a = await login('u1');
    const b = await login('u2');
    const c = await login('u3');
    a.send({ type: 'create_room' });
    const created = await a.type('room_created');
    const ja = await a.type('joined');
    assert.equal(ja.yourSeat, 'w');
    b.send({ type: 'join', roomId: created.roomId.toLowerCase() });
    assert.equal((await b.type('joined')).yourSeat, 'b');
    c.send({ type: 'join', roomId: created.roomId });
    const jc = await c.type('joined');
    assert.equal(jc.yourSeat, 'spectator');
    assert.equal(jc.seats.spectators[0].userId, 'u3');

    c.send({ type: 'move', move: e2e4 });
    assert.equal((await c.type('error')).code, 'not_a_player');
    c.send({ type: 'rematch' });
    assert.equal((await c.type('error')).code, 'not_a_player');
    b.send({ type: 'move', move: e2e4 });
    assert.equal((await b.type('error')).code, 'not_your_turn');

    c.send({ type: 'join', roomId: 'ZZZZZZ' });
    assert.equal((await c.type('error')).code, 'room_not_found');
    a.close();
    b.close();
    c.close();
  });

  test('reconexao dentro do grace retoma o assento', async () => {
    const a = await login('u5');
    const b = await login('u6');
    a.send({ type: 'create_room' });
    const { roomId } = await a.type('room_created');
    await a.type('joined');
    b.send({ type: 'join', roomId });
    await b.type('joined');
    a.close();
    await b.wait((m) => m.type === 'seats'); // saida do conn
    const a2 = await Client.open(port);
    open.push(a2);
    a2.send({ type: 'auth', token: 'u5' });
    const ok = await a2.type('auth_ok');
    assert.equal(ok.resumeRoomId, roomId);
    a2.send({ type: 'join', roomId });
    const j = await a2.type('joined');
    assert.equal(j.resumed, true);
    assert.equal(j.yourSeat, 'w');
    a2.close();
    b.close();
  });

  test('grace expirado: outro vence por abandon', async () => {
    const a = await login('u7');
    const b = await login('u8');
    a.send({ type: 'create_room' });
    const { roomId } = await a.type('room_created');
    b.send({ type: 'join', roomId });
    await b.type('joined');
    a.close();
    const end = await b.type('match_ended', 3000);
    assert.equal(end.result, 'b');
    assert.equal(end.reason, 'abandon');
    assert.equal(finished.filter((f) => f.roomId === roomId).length, 1);
    b.close();
  });

  test('mesmo usuario em duas abas: a nova assume, a antiga recebe left e fecha', async () => {
    const a1 = await login('u1');
    a1.send({ type: 'create_room' });
    const { roomId } = await a1.type('room_created');
    await a1.type('joined');
    const a2 = await login('u1');
    a2.send({ type: 'join', roomId });
    const j = await a2.type('joined');
    assert.equal(j.yourSeat, 'w');
    assert.equal(j.seats.b, null);
    await a1.type('left');
    await a1.waitClosed();
    a2.close();
  });

  test('rate limit de convites', async () => {
    const a = await login('u3');
    const b = await login('u4');
    for (let i = 0; i < 8; i++) a.send({ type: 'challenge', targetUserId: 'u4' });
    const e = await a.wait((x) => x.type === 'error' && x.code === 'rate_limited', 3000);
    assert.equal(e.code, 'rate_limited');
    a.close();
    b.close();
  });
});
