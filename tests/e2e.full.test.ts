// E2E de protocolo: servidor real + auth dev + store em memoria + leaderboard real.
// 3 usuarios de empresas/workspaces diferentes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer, type GameServer } from '../server';
import { createMemoryStore } from '../server/store';
import { createLeaderboard } from '../server/leaderboard';
import { createVerifyToken } from '../server/auth';
import { applyMove, chooseBestAIMove } from '../src/game/engine';
import type { GameState } from '../src/game/types';
import type { ServerMessage } from '../src/shared/protocol';

type Msg = ServerMessage & Record<string, any>;

class Client {
  ws!: WebSocket;
  msgs: Msg[] = [];
  state: GameState | null = null;
  seat: string | null = null;
  constructor(private port: number, private token: string) {}
  async open() {
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Msg;
      this.msgs.push(m);
      if (m.type === 'joined') { this.state = m.state; this.seat = m.yourSeat; }
      if (m.type === 'state') this.state = m.state;
    });
    await new Promise((r) => this.ws.once('open', r));
    this.send({ type: 'auth', token: this.token });
    return this.wait((m) => m.type === 'auth_ok' || m.type === 'auth_error');
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  async wait(pred: (m: Msg) => boolean, ms = 4000, fromIdx = 0): Promise<Msg> {
    const start = Date.now();
    let from = fromIdx;
    for (;;) {
      for (; from < this.msgs.length; from++) if (pred(this.msgs[from])) return this.msgs[from++ - 0];
      if (Date.now() - start > ms) throw new Error('timeout; msgs=' + this.msgs.map((m) => m.type).join(','));
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  close() { this.ws.close(); }
}

describe('E2E multiplayer cross-company', () => {
  let srv: GameServer;
  const store = createMemoryStore();
  before(async () => {
    const verifyToken = createVerifyToken({ env: { NODE_ENV: 'test' } as any });
    srv = await createGameServer({ port: 0, serveClient: false, verifyToken, store, leaderboard: createLeaderboard(store) });
  });
  after(async () => { await srv.close(); });

  const tok = (id: string, name: string, acc: string, ws: string) => `dev:${id}:${name}:${acc}:${ws}`;

  test('desafio entre empresas, partida longa pontua, espectador, leaderboard', async () => {
    const ana = new Client(srv.port, tok('ana', 'Ana', 'bold', 'atendimento'));
    const bruno = new Client(srv.port, tok('bruno', 'Bruno', 'acme', 'vendas'));
    const carla = new Client(srv.port, tok('carla', 'Carla', 'globex', 'suporte'));
    for (const c of [ana, bruno, carla]) assert.equal((await c.open()).type, 'auth_ok');

    // lobby: Ana ve Bruno e Carla (outras empresas)
    ana.send({ type: 'lobby_list' });
    const lobby = await ana.wait((m) => m.type === 'lobby' && m.online.length >= 3);
    assert.deepEqual(lobby.online.map((u: any) => u.userId).sort(), ['ana', 'bruno', 'carla']);
    assert.ok(lobby.online.every((u: any) => u.accountId === null));

    // desafio + aceite
    ana.send({ type: 'challenge', targetUserId: 'bruno' });
    const inv = await bruno.wait((m) => m.type === 'invite');
    assert.equal(inv.from.userId, 'ana');
    bruno.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
    await ana.wait((m) => m.type === 'joined');
    await bruno.wait((m) => m.type === 'joined');
    assert.equal(ana.seat, 'w');
    assert.equal(bruno.seat, 'b');

    // Carla assiste e nao pode mover
    carla.send({ type: 'join', roomId: inv.roomId, asSpectator: true });
    await carla.wait((m) => m.type === 'joined');
    assert.equal(carla.seat, 'spectator');
    const before = carla.msgs.length;
    carla.send({ type: 'resign' });
    await carla.wait((m) => m.type === 'error' && m.code === 'not_a_player');
    assert.ok(carla.msgs.length > before);

    // joga 24 jogadas (12 completas) com a IA do jogo escolhendo lances, depois Bruno desiste
    let guard = 0;
    while (ana.state!.fullMoveNumber <= 12 && !ana.state!.winner && guard++ < 80) {
      const pc = ana.state!.pendingConvocation;
      if (pc) {
        const i0 = ana.msgs.length;
        (pc.color === 'w' ? ana : bruno).send({ type: 'convocate', choice: 'keep_pawn' });
        await ana.wait((m) => m.type === 'state' && !m.state.pendingConvocation, 4000, i0);
        continue;
      }
      const turnClient = ana.state!.turn === 'w' ? ana : bruno;
      const mv = chooseBestAIMove(ana.state!, ana.state!.turn, 1);
      assert.ok(mv, 'sem lance legal: ' + JSON.stringify({w: ana.state!.winner, r: ana.state!.endReason, pc: ana.state!.pendingConvocation, ph: ana.state!.draft.phase, t: ana.state!.turn, n: ana.state!.fullMoveNumber}));
      const i1 = ana.msgs.length;
      turnClient.send({ type: 'move', move: mv });
      await ana.wait((m) => m.type === 'state', 4000, i1);
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(ana.state!.fullMoveNumber > 12 || ana.state!.winner);
    if (!ana.state!.winner) bruno.send({ type: 'resign' });

    const ended = await ana.wait((m) => m.type === 'match_ended', 6000);
    assert.equal(ended.points.length, 2);
    const a = ended.points.find((p: any) => p.userId === 'ana');
    const b = ended.points.find((p: any) => p.userId === 'bruno');
    assert.ok(a.counted && b.counted, 'partida longa deve pontuar');
    assert.ok(ended.result === 'w' ? a.delta >= 30 && b.delta === 10 : ended.result === 'b' ? b.delta >= 30 && a.delta === 10 : a.delta === 15);
    await carla.wait((m) => m.type === 'match_ended'); // espectador tambem recebe

    // leaderboard HTTP global
    const res = await fetch(`http://localhost:${srv.port}/api/leaderboard`);
    const body = (await res.json()) as { entries: any[] };
    assert.equal(body.entries.length, 2);
    assert.deepEqual(body.entries.map((e) => e.userId).sort(), ['ana', 'bruno']);
    assert.ok(!JSON.stringify(body).includes('accountId'));

    [ana, bruno, carla].forEach((c) => c.close());
  });

  test('partida curta nao pontua', async () => {
    const x = new Client(srv.port, tok('x1', 'X', 'a', 'a'));
    const y = new Client(srv.port, tok('y1', 'Y', 'b', 'b'));
    await x.open(); await y.open();
    x.send({ type: 'challenge', targetUserId: 'y1' });
    const inv = await y.wait((m) => m.type === 'invite');
    y.send({ type: 'invite_response', inviteId: inv.inviteId, accept: true });
    await x.wait((m) => m.type === 'joined'); await y.wait((m) => m.type === 'joined');
    x.send({ type: 'resign' });
    const ended = await y.wait((m) => m.type === 'match_ended');
    assert.ok(ended.points.every((p: any) => p.counted === false && p.reason === 'too_short'));
    x.close(); y.close();
  });

  test('link/codigo: usuario entra depois por codigo e reconecta', async () => {
    const p = new Client(srv.port, tok('p1', 'P', 'a', 'a'));
    await p.open();
    p.send({ type: 'create_room' });
    const created = await p.wait((m) => m.type === 'room_created');
    p.send({ type: 'join', roomId: created.roomId });
    await p.wait((m) => m.type === 'joined');
    const q = new Client(srv.port, tok('q1', 'Q', 'z', 'z'));
    await q.open();
    q.send({ type: 'join', roomId: created.roomId });
    await q.wait((m) => m.type === 'joined');
    assert.equal(q.seat, 'b');
    // queda e retomada
    q.close();
    const q2 = new Client(srv.port, tok('q1', 'Q', 'z', 'z'));
    const ok = await q2.open();
    assert.equal(ok.resumeRoomId, created.roomId);
    q2.send({ type: 'join', roomId: created.roomId });
    const j = await q2.wait((m) => m.type === 'joined');
    assert.equal(j.resumed, true);
    assert.equal(j.yourSeat, 'b');
    p.close(); q2.close();
  });

  test('token invalido e rejeitado', async () => {
    const bad = new Client(srv.port, 'lixo');
    const r = await bad.open();
    assert.equal(r.type, 'auth_error');
  });
});
