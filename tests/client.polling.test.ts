import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PollingSocket, type SocketStatus } from '../src/net/pollingSocket';
import type { AuthResponse, Pos } from '../src/shared/http-protocol';
import type { PlayerIdentity, ServerMessage } from '../src/shared/protocol';

const ME: PlayerIdentity = { userId: 'u1', name: 'Ana', avatarUrl: null, accountId: null, workspaceId: null };
const POLL = { game: 1000, lobby: 2000, idle: 8000 };

interface Req {
  path: string;
  body: any;
  auth: string | null;
}
type Reply = { status: number; body: unknown } | 'network';

function setup(handler: (r: Req, n: number) => Reply | Promise<Reply>) {
  const reqs: Req[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    try {
      const headers = init.headers as Record<string, string>;
      const r: Req = {
        path: String(url).replace(/^https?:\/\/[^/]*/, ''),
        body: JSON.parse(String(init.body)),
        auth: headers.Authorization ?? null,
      };
      reqs.push(r);
      await new Promise((res) => setImmediate(res));
      const out = await handler(r, reqs.length);
      if (out === 'network') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(out.body), { status: out.status });
    } finally {
      inflight--;
    }
  }) as unknown as typeof fetch;

  // relogio injetado
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let seq = 1;
  const clock = {
    set: (fn: () => void, ms: number) => {
      const id = seq++;
      timers.set(id, { fn, ms });
      return id;
    },
    clear: (h: unknown) => void timers.delete(h as number),
    pending: () => [...timers.values()].map((t) => t.ms),
    async fire() {
      const first = [...timers.entries()][0];
      assert.ok(first, 'sem timer pendente');
      timers.delete(first[0]);
      first[1].fn();
      await settle();
    },
  };

  const tokens: boolean[] = [];
  const sock = new PollingSocket({
    getToken: async (force) => {
      tokens.push(Boolean(force));
      return 'sso-token';
    },
    baseUrl: 'http://srv',
    fetchImpl,
    intervals: POLL,
    setTimeoutImpl: clock.set,
    clearTimeoutImpl: clock.clear,
    random: () => 0.5,
  });
  const statuses: SocketStatus[] = [];
  const events: ServerMessage[] = [];
  sock.on('status', (s) => statuses.push(s));
  sock.on('message', (m) => events.push(m));
  return { sock, reqs, clock, statuses, events, tokens, maxInflight: () => maxInflight };
}

async function settle() {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
}

const authOk = (extra: Partial<AuthResponse> = {}): Reply => ({
  status: 200,
  body: { session: 's1', expiresAt: Date.now() + 1e6, me: ME, resumeRoomId: null, pollMs: POLL, ...extra },
});
const view = (messages: ServerMessage[], pos: Partial<Pos> = {}): Reply => ({
  status: 200,
  body: { messages, pos: { roomId: null, sv: 0, pv: 0, cursor: 0, ...pos } },
});

test('auth -> auth_ok, status ready, primeiro poll com Bearer', async () => {
  const t = setup((r) => (r.path === '/api/auth' ? authOk() : view([])));
  const oks: unknown[] = [];
  t.sock.on('auth_ok', (m) => oks.push(m));
  t.sock.connect();
  await settle();
  assert.equal(t.reqs[0].path, '/api/auth');
  assert.deepEqual(t.reqs[0].body, { ssoToken: 'sso-token' });
  assert.equal(oks.length, 1);
  assert.equal(t.sock.isAuthenticated, true);
  assert.equal(t.sock.connectionStatus, 'ready');
  assert.deepEqual(t.statuses.slice(0, 3), ['connecting', 'authenticating', 'ready']);
  assert.equal(t.reqs[1].path, '/api/poll');
  assert.equal(t.reqs[1].auth, 'Bearer s1');
  assert.equal(t.reqs[1].body.active, true);
  t.sock.close();
});

test('poll entrega lobby/joined/state/seats em ordem e atualiza pos', async () => {
  const seats = { w: ME, b: null, spectators: 0 } as never;
  const state = { turn: 'w' } as never;
  const t = setup((r, n) => {
    if (r.path === '/api/auth') return authOk();
    if (n === 2)
      return view(
        [
          { type: 'lobby', online: [], rooms: [] },
          { type: 'joined', roomId: 'ABC123', sceneRoom: 'bold_office', yourSeat: 'w', state, seats, resumed: false },
          { type: 'state', state },
          { type: 'seats', seats },
        ],
        { roomId: 'ABC123', sv: 3, pv: 2, cursor: 9 }
      );
    return view([]);
  });
  const order: string[] = [];
  t.sock.on('lobby', () => order.push('lobby'));
  t.sock.on('joined', () => order.push('joined'));
  t.sock.on('state', () => order.push('state'));
  t.sock.on('seats', () => order.push('seats'));
  t.sock.connect();
  await settle();
  assert.deepEqual(order, ['lobby', 'joined', 'state', 'seats']);
  assert.equal(t.sock.roomId, 'ABC123');
  assert.deepEqual(t.clock.pending(), [POLL.game]);
  await t.clock.fire();
  const last = t.reqs[t.reqs.length - 1];
  assert.equal(last.path, '/api/poll');
  assert.deepEqual(last.body.pos, { roomId: 'ABC123', sv: 3, pv: 2, cursor: 9 });
  t.sock.close();
});

test('send aplica a resposta, envia pos e reagenda o poll; lobby_list so faz poll', async () => {
  const t = setup((r) => {
    if (r.path === '/api/auth') return authOk();
    if (r.path === '/api/send') return view([{ type: 'room_created', roomId: 'ZZZ999', sceneRoom: 'bold_office' }], { cursor: 4 });
    return view([]);
  });
  const created: unknown[] = [];
  t.sock.on('room_created', (m) => created.push(m));
  t.sock.connect();
  await settle();
  const before = t.reqs.length;
  t.sock.send({ type: 'create_room', sceneRoom: 'bold_office' });
  await settle();
  const sendReq = t.reqs.slice(before).find((r) => r.path === '/api/send');
  assert.ok(sendReq);
  assert.deepEqual(sendReq.body.msg, { type: 'create_room', sceneRoom: 'bold_office' });
  assert.equal(created.length, 1);
  assert.equal(t.clock.pending().length, 1);
  await t.clock.fire();
  assert.equal(t.reqs[t.reqs.length - 1].body.pos.cursor, 4);

  const n = t.reqs.length;
  t.sock.send({ type: 'lobby_list' });
  await settle();
  assert.equal(t.reqs.length, n + 1);
  assert.equal(t.reqs[n].path, '/api/poll');
  t.sock.close();
});

test('serializa requisicoes: nunca duas em voo e sends em ordem', async () => {
  const t = setup((r) => (r.path === '/api/auth' ? authOk() : view([])));
  t.sock.connect();
  t.sock.send({ type: 'emote', emoteId: 'a' });
  t.sock.send({ type: 'emote', emoteId: 'b' });
  t.sock.send({ type: 'lobby_list' });
  t.sock.send({ type: 'emote', emoteId: 'c' });
  await settle();
  const sends = t.reqs.filter((r) => r.path === '/api/send').map((r) => r.body.msg.emoteId);
  assert.deepEqual(sends, ['a', 'b', 'c']);
  assert.equal(t.maxInflight(), 1);
  t.sock.close();
});

test('401 expired_session reautentica com token novo e segue', async () => {
  let polls = 0;
  const t = setup((r) => {
    if (r.path === '/api/auth') return authOk({ session: `s${t.reqs.filter((x) => x.path === '/api/auth').length}` });
    polls++;
    if (polls === 1) return { status: 401, body: { error: 'expired_session' } };
    return view([{ type: 'lobby', online: [], rooms: [] }]);
  });
  const lobbies: unknown[] = [];
  t.sock.on('lobby', (m) => lobbies.push(m));
  t.sock.connect();
  await settle();
  assert.equal(t.reqs.filter((r) => r.path === '/api/auth').length, 2);
  assert.deepEqual(t.tokens, [false, true]);
  assert.equal(lobbies.length, 1);
  assert.equal(t.reqs[t.reqs.length - 1].auth, 'Bearer s2');
  assert.equal(t.sock.connectionStatus, 'ready');
  t.sock.close();
});

test('401 repetido encerra com auth_error e status closed', async () => {
  const t = setup((r) => (r.path === '/api/auth' ? authOk() : { status: 401, body: { error: 'invalid_session' } }));
  const errs: string[] = [];
  t.sock.on('auth_error', (m) => errs.push(m.code));
  t.sock.connect();
  await settle();
  assert.deepEqual(errs, ['invalid_token']);
  assert.equal(t.sock.connectionStatus, 'closed');
  assert.equal(t.clock.pending().length, 0);
});

test('/api/auth: sso expirado renova token; invalido fecha; 5xx vira auth_unavailable com retry', async () => {
  // expirado -> renova
  let a = 0;
  const t1 = setup((r) => {
    if (r.path !== '/api/auth') return view([]);
    return ++a === 1 ? { status: 401, body: { error: 'sso_token_expired' } } : authOk();
  });
  const codes1: string[] = [];
  t1.sock.on('auth_error', (m) => codes1.push(m.code));
  t1.sock.connect();
  await settle();
  assert.deepEqual(codes1, ['expired_token']);
  assert.deepEqual(t1.tokens, [false, true]);
  assert.equal(t1.sock.isAuthenticated, true);
  t1.sock.close();

  // invalido
  const t2 = setup(() => ({ status: 401, body: { error: 'bad_signature' } }));
  const codes2: string[] = [];
  t2.sock.on('auth_error', (m) => codes2.push(m.code));
  t2.sock.connect();
  await settle();
  assert.deepEqual(codes2, ['invalid_token']);
  assert.equal(t2.sock.connectionStatus, 'closed');

  // 5xx -> unavailable + retry
  let b = 0;
  const t3 = setup((r) => {
    if (r.path !== '/api/auth') return view([]);
    return ++b === 1 ? { status: 503, body: { error: 'x' } } : authOk();
  });
  const codes3: string[] = [];
  t3.sock.on('auth_error', (m) => codes3.push(m.code));
  t3.sock.connect();
  await settle();
  assert.deepEqual(codes3, ['auth_unavailable']);
  assert.equal(t3.sock.connectionStatus, 'reconnecting');
  assert.deepEqual(t3.clock.pending(), [375]); // 500 * (0.5 + 0.5*0.5)
  await t3.clock.fire();
  assert.equal(t3.sock.isAuthenticated, true);
  t3.sock.close();
});

test('erro de rede -> reconnecting, backoff exponencial e retoma sem perder pos', async () => {
  let polls = 0;
  const t = setup((r) => {
    if (r.path === '/api/auth') return authOk();
    polls++;
    if (polls === 1) return view([], { sv: 5, cursor: 7 });
    if (polls === 2 || polls === 3) return 'network';
    return view([{ type: 'lobby', online: [], rooms: [] }], { sv: 6, cursor: 8 });
  });
  t.sock.connect();
  await settle();
  await t.clock.fire(); // poll 2 falha
  assert.equal(t.sock.connectionStatus, 'reconnecting');
  assert.deepEqual(t.clock.pending(), [375]);
  await t.clock.fire(); // poll 3 falha
  assert.deepEqual(t.clock.pending(), [750]);
  await t.clock.fire(); // poll 4 ok
  assert.equal(t.sock.connectionStatus, 'ready');
  const polled = t.reqs.filter((r) => r.path === '/api/poll');
  assert.deepEqual(polled[1].body.pos, { roomId: null, sv: 5, pv: 0, cursor: 7 });
  assert.deepEqual(polled[2].body.pos, { roomId: null, sv: 5, pv: 0, cursor: 7 });
  assert.deepEqual(polled[3].body.pos, { roomId: null, sv: 5, pv: 0, cursor: 7 });
  assert.equal(t.reqs.filter((r) => r.path === '/api/auth').length, 1);
  t.sock.close();
});

test('setActive(false) usa o intervalo idle', async () => {
  const t = setup((r) => (r.path === '/api/auth' ? authOk() : view([])));
  t.sock.connect();
  await settle();
  assert.deepEqual(t.clock.pending(), [POLL.lobby]);
  t.sock.setActive(false);
  assert.deepEqual(t.clock.pending(), [POLL.idle]);
  await t.clock.fire();
  const last = t.reqs[t.reqs.length - 1];
  assert.equal(last.body.active, false);
  assert.deepEqual(t.clock.pending(), [POLL.idle]);
  t.sock.setActive(true);
  await settle();
  assert.equal(t.reqs[t.reqs.length - 1].body.active, true);
  t.sock.close();
});

test('close() cancela timers e requisicoes em voo', async () => {
  let aborted = false;
  const t = setup(async (r) => {
    if (r.path === '/api/auth') return authOk();
    await new Promise((res) => setImmediate(res));
    return view([]);
  });
  t.sock.connect();
  await settle();
  assert.equal(t.sock.hasPendingTimers, true);
  t.sock.close();
  assert.equal(t.sock.hasPendingTimers, false);
  assert.equal(t.sock.connectionStatus, 'closed');
  await settle();
  assert.equal(t.clock.pending().length, 0);
  assert.equal(aborted, false);
});
