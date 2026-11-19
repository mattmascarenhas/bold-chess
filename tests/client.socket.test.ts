import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import { GameSocket, type WebSocketLike } from '../src/net/socket';
import type { ClientMessage, PlayerIdentity, ServerMessage } from '../src/shared/protocol';

const ME: PlayerIdentity = { userId: 'u1', name: 'Ana', avatarUrl: null, accountId: null, workspaceId: null };

interface FakeServer {
  url: string;
  received: ClientMessage[];
  conns: WebSocket[];
  sendAll(msg: ServerMessage): void;
  stop(): Promise<void>;
  /** responde ao auth: handler recebe a mensagem e a conexao */
  onAuth: (msg: Extract<ClientMessage, { type: 'auth' }>, ws: WebSocket) => void;
}

async function startServer(): Promise<FakeServer> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const port = (wss.address() as { port: number }).port;
  const srv: FakeServer = {
    url: `ws://127.0.0.1:${port}`,
    received: [],
    conns: [],
    sendAll: (m) => srv.conns.forEach((c) => c.readyState === 1 && c.send(JSON.stringify(m))),
    stop: () =>
      new Promise<void>((r) => {
        wss.clients.forEach((c) => c.terminate());
        wss.close(() => r());
      }),
    onAuth: (_m, ws) => ws.send(JSON.stringify({ type: 'auth_ok', me: ME, resumeRoomId: null } satisfies ServerMessage)),
  };
  wss.on('connection', (ws) => {
    srv.conns.push(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      srv.received.push(msg);
      if (msg.type === 'auth') srv.onAuth(msg, ws);
    });
  });
  return srv;
}

function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (cond()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(id);
        reject(new Error('timeout aguardando condicao'));
      }
    }, 10);
  });
}

function make(srv: FakeServer, extra: Partial<ConstructorParameters<typeof GameSocket>[0]> = {}) {
  return new GameSocket({
    url: srv.url,
    getToken: async () => 'tok1',
    createWebSocket: (u) => new WebSocket(u) as unknown as WebSocketLike,
    backoffMinMs: 20,
    backoffMaxMs: 80,
    pingIntervalMs: 50,
    random: () => 0,
    ...extra,
  });
}

test('envia auth primeiro e enfileira mensagens ate autenticar', async () => {
  const srv = await startServer();
  let release: (() => void) | null = null;
  srv.onAuth = (_m, ws) => {
    release = () => ws.send(JSON.stringify({ type: 'auth_ok', me: ME, resumeRoomId: null }));
  };
  const sock = make(srv);
  sock.send({ type: 'lobby_list' });
  sock.send({ type: 'create_room' });
  sock.connect();
  await waitFor(() => release !== null);
  assert.deepEqual(srv.received.map((m) => m.type), ['auth']);
  assert.equal((srv.received[0] as { token: string }).token, 'tok1');
  release!();
  await waitFor(() => srv.received.length >= 3);
  assert.deepEqual(srv.received.map((m) => m.type), ['auth', 'lobby_list', 'create_room']);
  sock.close();
  await srv.stop();
});

test('reconecta com backoff e retoma a sala (resume)', async () => {
  const srv = await startServer();
  const sock = make(srv);
  const statuses: string[] = [];
  sock.on('status', (s) => statuses.push(s));
  sock.connect();
  await waitFor(() => sock.isAuthenticated);
  srv.sendAll({
    type: 'joined',
    roomId: 'ABC234',
    sceneRoom: 'bold_office',
    yourSeat: 'spectator',
    state: {} as never,
    seats: { w: null, b: null, spectators: [] },
    resumed: false,
  });
  await waitFor(() => sock.roomId === 'ABC234');
  srv.received.length = 0;
  srv.conns.forEach((c) => c.terminate());
  await waitFor(() => statuses.includes('reconnecting'));
  await waitFor(() => srv.received.some((m) => m.type === 'join'));
  assert.equal(srv.received[0].type, 'auth');
  const join = srv.received.find((m) => m.type === 'join') as Extract<ClientMessage, { type: 'join' }>;
  assert.equal(join.roomId, 'ABC234');
  assert.equal(join.asSpectator, true);
  sock.close();
  await srv.stop();
});

test('renova token (getToken(true)) quando auth_error expired_token', async () => {
  const srv = await startServer();
  const calls: boolean[] = [];
  srv.onAuth = (m, ws) => {
    if (m.token === 'old') ws.send(JSON.stringify({ type: 'auth_error', code: 'expired_token' }));
    else ws.send(JSON.stringify({ type: 'auth_ok', me: ME, resumeRoomId: null }));
  };
  const sock = make(srv, {
    getToken: async (force) => {
      calls.push(Boolean(force));
      return force ? 'fresh' : 'old';
    },
  });
  sock.connect();
  await waitFor(() => sock.isAuthenticated);
  assert.deepEqual(calls, [false, true]);
  const tokens = srv.received.filter((m) => m.type === 'auth').map((m) => (m as { token: string }).token);
  assert.deepEqual(tokens, ['old', 'fresh']);
  sock.close();
  await srv.stop();
});

test('close() limpa timers, listeners e nao reconecta', async () => {
  const srv = await startServer();
  const sock = make(srv);
  let statusEvents = 0;
  sock.on('status', () => statusEvents++);
  sock.connect();
  await waitFor(() => sock.isAuthenticated);
  assert.equal(sock.hasPendingTimers, true); // ping ativo
  sock.close();
  assert.equal(sock.hasPendingTimers, false);
  assert.equal(sock.connectionStatus, 'closed');
  const before = srv.conns.length;
  const evBefore = statusEvents;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(srv.conns.length, before, 'nao deve reconectar');
  assert.equal(statusEvents, evBefore, 'listeners removidos');
  await srv.stop();
});

test('ping periodico apos autenticar', async () => {
  const srv = await startServer();
  const sock = make(srv, { pingIntervalMs: 30 });
  sock.connect();
  await waitFor(() => srv.received.filter((m) => m.type === 'ping').length >= 2);
  sock.close();
  await srv.stop();
});
