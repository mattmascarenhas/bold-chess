// Cenas de demonstracao do movimento de cada peca especial (mini-tabuleiro 8x8).
// Coordenadas [linha, coluna], linha 0 no topo. Somente visual: nao altera as regras do motor.
import type { SpecialId } from './types';

export type Sq = readonly [number, number];

export interface PreviewScene {
  /** casa onde a peca comeca a cena */
  from: Sq;
  /** casa final */
  to: Sq;
  /** pontos intermediarios (ex.: quique na borda) */
  via?: Sq[];
  /** casas destacadas como possiveis destinos */
  targets: Sq[];
  /** pecas inimigas/obstaculos desenhados no tabuleiro */
  blockers?: Sq[];
  /** a peca salta por cima (animacao em arco) */
  jump?: boolean;
  /** legenda curta opcional sob o tabuleiro */
  caption?: string;
}

const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

const KING_DIRS: Sq[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];
const ROOK_DIRS: Sq[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS: Sq[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function king(p: Sq): Sq[] {
  return KING_DIRS.map(([dr, dc]) => [p[0] + dr, p[1] + dc] as Sq).filter(([r, c]) => inB(r, c));
}

function knight(p: Sq): Sq[] {
  const d: Sq[] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  return d.map(([dr, dc]) => [p[0] + dr, p[1] + dc] as Sq).filter(([r, c]) => inB(r, c));
}

function rays(p: Sq, dirs: Sq[], min: number, max: number, blockers: Sq[] = []): Sq[] {
  const blocked = new Set(blockers.map(([r, c]) => `${r},${c}`));
  const out: Sq[] = [];
  for (const [dr, dc] of dirs) {
    for (let k = 1; k <= max; k++) {
      const r = p[0] + dr * k;
      const c = p[1] + dc * k;
      if (!inB(r, c) || blocked.has(`${r},${c}`)) break;
      if (k >= min) out.push([r, c]);
    }
  }
  return out;
}

function twoStep(p: Sq): Sq[] {
  return KING_DIRS.map(([dr, dc]) => [p[0] + dr * 2, p[1] + dc * 2] as Sq).filter(([r, c]) => inB(r, c));
}

export const SPECIAL_PREVIEW: Record<SpecialId, PreviewScene[]> = {
  gabigol: [
    { from: [4, 3], to: [2, 4], targets: knight([4, 3]), jump: true },
    { from: [2, 4], to: [3, 6], targets: knight([2, 4]), jump: true },
    { from: [3, 6], to: [5, 5], targets: knight([3, 6]), jump: true },
    { from: [5, 5], to: [4, 3], targets: knight([5, 5]), jump: true },
  ],
  salles: [
    { from: [4, 3], to: [3, 3], targets: king([4, 3]) },
    { from: [3, 3], to: [3, 4], targets: king([3, 3]) },
    { from: [3, 4], to: [4, 4], targets: king([3, 4]) },
    { from: [4, 4], to: [4, 3], targets: king([4, 4]) },
  ],
  hbarril: [
    { from: [5, 1], to: [5, 7], targets: rays([5, 1], ROOK_DIRS, 1, 8), caption: 'Rola até bater em algo ou na borda' },
    { from: [5, 7], to: [1, 7], targets: rays([5, 7], ROOK_DIRS, 1, 8) },
    { from: [1, 7], to: [1, 0], targets: rays([1, 7], ROOK_DIRS, 1, 8) },
    { from: [1, 0], to: [5, 0], targets: rays([1, 0], ROOK_DIRS, 1, 8) },
    { from: [5, 0], to: [5, 1], targets: rays([5, 0], ROOK_DIRS, 1, 1) },
  ],
  pm: [
    { from: [4, 3], to: [3, 4], targets: king([4, 3]) },
    { from: [3, 4], to: [3, 3], targets: king([3, 4]) },
    { from: [3, 3], to: [4, 2], targets: king([3, 3]) },
    { from: [4, 2], to: [4, 3], targets: king([4, 2]) },
  ],
  ministro: [
    { from: [4, 3], to: [2, 3], targets: [...rays([4, 3], KING_DIRS, 1, 2)] },
    { from: [2, 3], to: [2, 4], targets: [...rays([2, 3], KING_DIRS, 1, 2)] },
    { from: [2, 4], to: [4, 4], targets: [...rays([2, 4], KING_DIRS, 1, 2)] },
    { from: [4, 4], to: [4, 3], targets: [...rays([4, 4], KING_DIRS, 1, 2)] },
  ],
  vitin: [
    { from: [4, 3], to: [2, 3], targets: twoStep([4, 3]), blockers: [[3, 3], [3, 4]], jump: true, caption: 'Pula por cima de tudo' },
    { from: [2, 3], to: [2, 5], targets: twoStep([2, 3]), blockers: [[2, 4]], jump: true },
    { from: [2, 5], to: [4, 3], targets: twoStep([2, 5]), blockers: [[3, 4]], jump: true },
  ],
  marcola: [
    { from: [4, 3], to: [4, 4], targets: king([4, 3]) },
    { from: [4, 4], to: [3, 5], targets: king([4, 4]) },
    { from: [3, 5], to: [3, 4], targets: king([3, 5]) },
    { from: [3, 4], to: [4, 3], targets: king([3, 4]) },
  ],
  eminnym: [
    { from: [4, 3], to: [2, 4], targets: knight([4, 3]), jump: true, caption: 'Rival moveu um Cavalo: copia o Cavalo' },
    { from: [2, 4], to: [4, 6], targets: rays([2, 4], BISHOP_DIRS, 1, 8), caption: 'Rival moveu um Bispo: copia o Bispo' },
    { from: [4, 6], to: [4, 3], targets: rays([4, 6], ROOK_DIRS, 1, 8), caption: 'Rival moveu uma Torre: copia a Torre' },
  ],
  jac: [
    {
      from: [7, 2],
      via: [[2, 7]],
      to: [0, 5],
      targets: [[6, 3], [5, 4], [4, 5], [3, 6], [2, 7], [1, 6], [0, 5]],
      caption: 'Quica 1 vez na borda lateral',
    },
    {
      from: [0, 5],
      via: [[5, 0]],
      to: [7, 2],
      targets: [[1, 4], [2, 3], [3, 2], [4, 1], [5, 0], [6, 1], [7, 2]],
    },
  ],
  uiu: [
    { from: [4, 3], to: [4, 6], targets: rays([4, 3], KING_DIRS, 3, 8), caption: 'Desliza no mínimo 3 casas' },
    { from: [4, 6], to: [1, 3], targets: rays([4, 6], KING_DIRS, 3, 8) },
    { from: [1, 3], to: [4, 3], targets: rays([1, 3], KING_DIRS, 3, 8) },
  ],
};
