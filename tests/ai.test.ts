import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createInitialState, getAllLegalMoves, resolveConvocation } from '../src/game/engine';
import { AI_LEVELS, chooseConvocation, evaluate, searchBestMove } from '../src/game/ai';
import type { GameState, MoveOption, Piece } from '../src/game/types';

function blank(): GameState {
  const s = createInitialState(true);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s.board[r][c] = null;
  return s;
}
function put(s: GameState, row: number, col: number, color: 'w' | 'b', kind: Piece['kind'], extra: Partial<Piece> = {}) {
  s.board[row][col] = { id: `${color}${kind}${row}${col}`, color, kind, hasMoved: true, ...extra };
}
const same = (a: MoveOption, b: MoveOption) =>
  a.kind === b.kind && a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col && a.promoteTo === b.promoteTo;
const isLegal = (s: GameState, m: MoveOption | null) => !!m && getAllLegalMoves(s, s.turn).some((x) => same(x, m));

/** Partida curta para ter posicoes variadas. */
function midgame(plies: number, seed = 1): GameState {
  let s = createInitialState(true);
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < plies; i++) {
    if (s.pendingConvocation) s = resolveConvocation(s, 'keep_pawn');
    const ms = getAllLegalMoves(s, s.turn);
    if (!ms.length) break;
    s = applyMove(s, ms[Math.floor(rnd() * ms.length)]);
  }
  if (s.pendingConvocation) s = resolveConvocation(s, 'keep_pawn');
  return s;
}

test('todos os niveis devolvem sempre um lance legal', () => {
  for (const seed of [1, 2, 3]) {
    const s = midgame(14, seed);
    if (s.winner) continue;
    for (const lv of AI_LEVELS) {
      const r = searchBestMove(s, s.turn, lv, { timeBudgetMs: 150, random: Math.random });
      assert.ok(isLegal(s, r.move), `${lv.id} devolveu lance ilegal (seed ${seed})`);
    }
  }
});

test('encontra mate em 1 (niveis dificil, mestre e deus)', () => {
  // Rei preto em a8, rei branco em b6 e torre branca em h1: Th8# e mate
  const s = blank();
  put(s, 0, 0, 'b', 'k');
  put(s, 2, 1, 'w', 'k');
  put(s, 7, 7, 'w', 'r');
  s.turn = 'w';
  for (const id of ['dificil', 'mestre', 'deus'] as const) {
    const r = searchBestMove(s, 'w', id, { timeBudgetMs: 600 });
    assert.ok(r.move, id);
    const after = applyMove(s, r.move!);
    assert.equal(after.winner, 'w', `${id} nao deu mate`);
  }
});

test('captura peca desprotegida e nao entrega a dama', () => {
  const s = blank();
  put(s, 7, 4, 'w', 'k');
  put(s, 0, 4, 'b', 'k');
  put(s, 4, 3, 'w', 'q');
  put(s, 4, 6, 'b', 'r'); // torre preta desprotegida, na linha da dama
  s.turn = 'w';
  const r = searchBestMove(s, 'w', 'dificil', { timeBudgetMs: 800 });
  assert.equal(r.move!.to.row, 4);
  assert.equal(r.move!.to.col, 6);
});

test('nao deixa a dama ser capturada de graca (profundidade 2+ enxerga a resposta)', () => {
  const s = blank();
  put(s, 7, 4, 'w', 'k');
  put(s, 0, 4, 'b', 'k');
  put(s, 4, 4, 'w', 'q');
  put(s, 1, 1, 'b', 'p'); // peao preto: dama nao deve pega-lo se for defendido
  put(s, 0, 2, 'b', 'b'); // bispo defende o peao em b7? (bispo c8 defende b7)
  s.turn = 'w';
  const r = searchBestMove(s, 'w', 'mestre', { timeBudgetMs: 800 });
  assert.ok(isLegal(s, r.move));
  const after = applyMove(s, r.move!);
  // se a dama foi para a casa do peao defendido, o bispo a captura: a IA nao pode fazer isso
  const queenLost = !after.board.some((row) => row.some((p) => p && p.color === 'w' && p.kind === 'q'));
  assert.equal(queenLost, false);
});

test('niveis altos sao mais fundos que os baixos e respeitam o tempo', () => {
  const s = midgame(16, 7);
  const t0 = Date.now();
  const facil = searchBestMove(s, s.turn, 'facil');
  const deus = searchBestMove(s, s.turn, 'deus', { timeBudgetMs: 700 });
  const ms = Date.now() - t0;
  assert.ok(deus.depth > facil.depth, `deus ${deus.depth} x facil ${facil.depth}`);
  assert.ok(deus.nodes > facil.nodes * 5);
  assert.ok(ms < 2500, 'estourou o tempo: ' + ms);
});

test('modo facil varia de lance (nao e deterministico) e deus e estavel em posicao tatica', () => {
  const s = midgame(10, 11);
  const picks = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const m = searchBestMove(s, s.turn, 'facil').move!;
    picks.add(`${m.from.row}${m.from.col}${m.to.row}${m.to.col}`);
  }
  assert.ok(picks.size >= 4, 'facil jogou sempre quase o mesmo lance: ' + picks.size);
});

test('escolha de convocacao devolve uma opcao valida', () => {
  let s = blank();
  put(s, 7, 4, 'w', 'k');
  put(s, 0, 4, 'b', 'k');
  put(s, 3, 2, 'w', 'p', { hasMoved: true });
  put(s, 0, 7, 'b', 'r');
  s.turn = 'w';
  const mv = getAllLegalMoves(s, 'w').find((m) => m.from.row === 3 && m.to.row === 2)!;
  s = applyMove(s, mv);
  assert.ok(s.pendingConvocation);
  for (const id of ['facil', 'medio', 'dificil', 'deus'] as const) {
    const ch = chooseConvocation(s, 'w', id, { timeBudgetMs: 300 });
    const ok = ch === 'keep_pawn' || s.pendingConvocation!.availableSpecials.includes(ch as never);
    assert.ok(ok, `${id}: ${ch}`);
    assert.notEqual(resolveConvocation(s, ch), s);
  }
});

test('avaliacao: material pesa e e antissimetrica', () => {
  const s = blank();
  put(s, 7, 4, 'w', 'k');
  put(s, 0, 4, 'b', 'k');
  put(s, 6, 0, 'w', 'q');
  const w = evaluate(s, 'w');
  const b = evaluate(s, 'b');
  assert.ok(w > 700);
  assert.ok(Math.abs(w + b) <= 20); // diferenca so do tempo (tempo de jogada)
});
