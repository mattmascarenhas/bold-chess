import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createInitialState, getLegalMoves } from '../src/game/engine';
import {
  describeTimeControl,
  displayRemaining,
  flagged,
  formatClock,
  parseTimeControl,
  startClock,
  stampMove,
  stopClock,
  timeoutState,
  withClock,
} from '../src/game/clock';

const T0 = 1_000_000;
const e4 = () => getLegalMoves(createInitialState(true), { row: 6, col: 4 }).find((m) => m.to.row === 4)!;

test('parseTimeControl: livre, valido e invalido', () => {
  assert.deepEqual(parseTimeControl(null), { ok: true, tc: null });
  assert.deepEqual(parseTimeControl(undefined), { ok: true, tc: null });
  assert.deepEqual(parseTimeControl({ baseMs: 300000, incrementMs: 2000 }), { ok: true, tc: { baseMs: 300000, incrementMs: 2000 } });
  assert.deepEqual(parseTimeControl({ baseMs: 60000 }), { ok: true, tc: { baseMs: 60000, incrementMs: 0 } });
  for (const bad of [{ baseMs: 1000 }, { baseMs: 1e9 }, { baseMs: 60000, incrementMs: -1 }, { baseMs: 60000, incrementMs: 61000 }, { baseMs: 'x' }, 5, 'a', { baseMs: NaN }]) {
    assert.deepEqual(parseTimeControl(bad), { ok: false }, JSON.stringify(bad));
  }
});

test('relogio nao inicia sozinho e startClock so inicia uma vez', () => {
  const s = withClock(createInitialState(true), { baseMs: 60000, incrementMs: 0 });
  assert.equal(s.clock!.turnStartedAt, null);
  const started = startClock(s, T0);
  assert.equal(started.clock!.turnStartedAt, T0);
  assert.equal(startClock(started, T0 + 5000).clock!.turnStartedAt, T0); // nao reinicia
  assert.equal(flagged(s, T0 + 10 ** 9), null); // parado nunca estoura
});

test('jogada desconta o tempo de quem jogou, soma incremento e passa a vez', () => {
  const s0 = startClock(withClock(createInitialState(true), { baseMs: 60000, incrementMs: 2000 }), T0);
  const next = stampMove(s0, applyMove(s0, e4()), T0 + 7000);
  assert.equal(next.turn, 'b');
  assert.equal(next.clock!.remaining.w, 60000 - 7000 + 2000);
  assert.equal(next.clock!.remaining.b, 60000);
  assert.equal(next.clock!.turnStartedAt, T0 + 7000);
});

test('jogada fora do tempo e rejeitada: quem jogou perde por tempo', () => {
  const s0 = startClock(withClock(createInitialState(true), { baseMs: 60000, incrementMs: 0 }), T0);
  const res = stampMove(s0, applyMove(s0, e4()), T0 + 61000);
  assert.equal(res.winner, 'b');
  assert.equal(res.endReason, 'timeout');
  assert.equal(res.clock!.remaining.w, 0);
  assert.equal(res.clock!.turnStartedAt, null);
  assert.equal(res.history.length, 0); // o lance nao entrou
});

test('flagged detecta estouro e timeoutState encerra', () => {
  const s0 = startClock(withClock(createInitialState(true), { baseMs: 30000, incrementMs: 0 }), T0);
  assert.equal(flagged(s0, T0 + 29999), null);
  assert.equal(flagged(s0, T0 + 30000), 'w');
  const end = timeoutState(s0, 'w');
  assert.equal(end.winner, 'b');
  assert.equal(flagged(end, T0 + 10 ** 9), null);
});

test('sem relogio (modo livre) tudo e neutro', () => {
  const s0 = createInitialState(true);
  const next = applyMove(s0, e4());
  assert.equal(stampMove(s0, next, T0), next);
  assert.equal(flagged(s0, T0), null);
  assert.equal(displayRemaining(s0, T0, T0), null);
  assert.equal(stopClock(s0), s0);
});

test('displayRemaining: servidor (clock.now) e local', () => {
  const s0 = startClock(withClock(createInitialState(true), { baseMs: 60000, incrementMs: 0 }), T0);
  // local: desconta clientNow - turnStartedAt
  assert.equal(displayRemaining(s0, T0 + 4000, 0)!.w, 56000);
  // servidor: ja tinha 3s gastos quando enviou, e chegou ha 1s
  const fromServer = { ...s0, clock: { ...s0.clock!, now: T0 + 3000 } };
  assert.equal(displayRemaining(fromServer, 50_000, 49_000)!.w, 60000 - 3000 - 1000);
  assert.equal(displayRemaining(s0, T0, 0)!.b, 60000); // quem nao joga nao gasta
});

test('formatClock e describeTimeControl', () => {
  assert.equal(formatClock(300000), '5:00');
  assert.equal(formatClock(61000), '1:01');
  assert.equal(formatClock(9400), '0:09.4');
  assert.equal(formatClock(0), '0:00.0');
  assert.equal(formatClock(3725000), '1:02:05');
  assert.equal(describeTimeControl(null), 'Livre');
  assert.equal(describeTimeControl({ baseMs: 180000, incrementMs: 2000 }), '3 min + 2s');
  assert.equal(describeTimeControl({ baseMs: 90000, incrementMs: 0 }), '90s');
});

test('convocacao pendente: relogio segue com quem escolhe e incremento so quando a vez passa', () => {
  let s = startClock(withClock(createInitialState(true), { baseMs: 60000, incrementMs: 1000 }), T0);
  const pend = { ...s, pendingConvocation: { color: 'w' as const, pos: { row: 2, col: 2 }, isLastRank: false, availableSpecials: [] } };
  const same = stampMove(pend, { ...pend }, T0 + 4000);
  assert.equal(same.clock!.remaining.w, 56000); // sem incremento: a vez nao passou
  const passed = stampMove(same, { ...same, pendingConvocation: null, turn: 'b' }, T0 + 6000);
  assert.equal(passed.clock!.remaining.w, 56000 - 2000 + 1000);
});
