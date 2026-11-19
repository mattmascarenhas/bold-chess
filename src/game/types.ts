export type Color = 'w' | 'b';

export type SceneRoomId = 'bold_office' | 'bold_studio' | 'bold_executive';

export interface SceneRoomMeta {
  id: SceneRoomId;
  name: string;
  shortDesc: string;
  accentColor: string;
}

export const SCENE_ROOMS: SceneRoomMeta[] = [
  {
    id: 'bold_office',
    name: 'Sala da Bold',
    shortDesc: 'Escritório Bold com telão, vidro azul e estações',
    accentColor: '#0047A0',
  },
  {
    id: 'bold_studio',
    name: 'Estúdio Dark',
    shortDesc: 'Arena noturna em metal escovado e luz esmeralda',
    accentColor: '#00E676',
  },
  {
    id: 'bold_executive',
    name: 'Executiva',
    shortDesc: 'Mesa em nogueira, fachada de vidro e luz natural',
    accentColor: '#00E5C3',
  },
];

export type ClassicKind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export type SpecialId =
  | 'gabigol'
  | 'salles'
  | 'hbarril'
  | 'pm'
  | 'ministro'
  | 'vitin'
  | 'marcola'
  | 'eminnym'
  | 'jac'
  | 'uiu';

export type PieceKind = ClassicKind | SpecialId;

export interface Pos {
  row: number; // 0 = rank 8 (Black back rank), 7 = rank 1 (White back rank)
  col: number; // 0 = file a, 7 = file h
}

export interface Piece {
  id: string;
  color: Color;
  kind: PieceKind;
  hasMoved: boolean;
  abilityUsed?: boolean;
  frozenTurns?: number; // Half-turns or opponent turns remaining frozen
}

export interface ForbiddenSquare {
  row: number;
  col: number;
  halfTurnsLeft: number;
  owner: Color;
}

export type MoveKind =
  | 'move'
  | 'castling'
  | 'enpassant'
  | 'promotion'
  | 'convocation'
  | 'push'
  | 'kick'
  | 'arrest'
  | 'decree'
  | 'pass';

export interface MoveOption {
  kind: MoveKind;
  from: Pos;
  to: Pos; // Destination square (or target square for kick/arrest/decree/pass)
  capturePos?: Pos;
  pushTo?: Pos; // For Salles Forte off-board or onto-square push
  pushOffBoard?: boolean;
  promoteTo?: PieceKind;
  rookFrom?: Pos;
  rookTo?: Pos;
  isDoublePawnPush?: boolean;
  label?: string;
}

export interface PendingConvocation {
  color: Color;
  pos: Pos;
  isLastRank: boolean;
  availableSpecials: SpecialId[];
}

export interface DraftState {
  phase: 'draft' | 'playing' | 'finished';
  order: Color[]; // ['w', 'b', 'b', 'w', 'w', 'b']
  step: number;
  squads: Record<Color, SpecialId[]>;
}

export interface MoveRecord {
  moveNumber: number;
  color: Color;
  notation: string;
  kind: MoveKind;
  pieceKind: PieceKind;
  capturedKind?: PieceKind;
  from: Pos;
  to: Pos;
  isCheck: boolean;
  isCheckmate: boolean;
}

export interface GameState {
  board: (Piece | null)[][];
  turn: Color;
  draft: DraftState;
  usedSpecials: Record<Color, SpecialId[]>;
  enPassantTarget: Pos | null;
  forbiddenSquares: ForbiddenSquare[];
  lastMovedKind: Record<Color, PieceKind | null>;
  lastMove: { from: Pos; to: Pos; kind: MoveKind } | null;
  pendingConvocation: PendingConvocation | null;
  winner: Color | 'draw' | null;
  endReason:
    | 'checkmate'
    | 'stalemate'
    | 'insufficient_material'
    | 'threefold'
    | 'fifty_move'
    | 'resign'
    | 'agreement'
    | null;
  inCheck: Color | null;
  halfMoveClock: number;
  fullMoveNumber: number;
  capturedBy: Record<Color, PieceKind[]>;
  history: MoveRecord[];
  positionHistory?: string[];
}

export interface SpecialMeta {
  id: SpecialId;
  name: string;
  person: string;
  emblemChar: string;
  accentColor: string;
  secondaryColor: string;
  movementSummary: string;
  abilityName: string | null;
  abilitySummary: string;
  catchphrase: string;
  hasActiveAbility: boolean;
}

export const SPECIAL_ROSTER: SpecialMeta[] = [
  {
    id: 'gabigol',
    name: 'Gabigol',
    person: 'Gabriel',
    emblemChar: 'G',
    accentColor: '#EF4444',
    secondaryColor: '#111827',
    movementSummary: 'Move como Cavalo.',
    abilityName: 'Chute a Gol (1x)',
    abilitySummary:
      'Sem sair do lugar, captura peça inimiga (exceto Rei) a até 4 casas em linha reta com caminho livre. Conta como xeque enquanto disponível.',
    catchphrase: 'Hoje tem gol do Gabigol!',
    hasActiveAbility: true,
  },
  {
    id: 'salles',
    name: 'Salles Forte',
    person: 'Salles',
    emblemChar: 'S',
    accentColor: '#F59E0B',
    secondaryColor: '#1E293B',
    movementSummary: '1 casa em qualquer direção. Peão não o captura.',
    abilityName: 'Empurrão',
    abilitySummary:
      'Ao andar contra uma peça inimiga, empurra-a 1 casa na mesma direção (se livre). Se sair do tabuleiro, é capturada!',
    catchphrase: 'Sai da frente que o Salles tá chegando!',
    hasActiveAbility: false,
  },
  {
    id: 'hbarril',
    name: 'H-Barril',
    person: 'Henrique',
    emblemChar: 'H',
    accentColor: '#D97706',
    secondaryColor: '#78350F',
    movementSummary: 'Rola em linha reta e só para ao bater em algo ou na borda.',
    abilityName: 'Rolagem Total',
    abilitySummary:
      'Se bater em peça inimiga, captura; se bater em peça própria ou casa proibida, para imediatamente antes dela.',
    catchphrase: 'Lá vem o H-Barril sem freio!',
    hasActiveAbility: false,
  },
  {
    id: 'pm',
    name: 'PM - Puliça',
    person: 'Pedro Merces',
    emblemChar: 'PM',
    accentColor: '#1D4ED8',
    secondaryColor: '#E2E8F0',
    movementSummary: '1 casa em qualquer direção.',
    abilityName: 'Abordagem (1x)',
    abilitySummary:
      'Sem se mover, enquadra uma peça inimiga vizinha (exceto Rei), deixando-a 2 turnos sem poder se mover.',
    catchphrase: 'Parado! Documento e licença da peça!',
    hasActiveAbility: true,
  },
  {
    id: 'ministro',
    name: 'Ministro',
    person: 'Edu',
    emblemChar: 'M',
    accentColor: '#7C3AED',
    secondaryColor: '#FDE68A',
    movementSummary: '1 ou 2 casas em qualquer direção (sem saltar).',
    abilityName: 'Decreto (1x)',
    abilitySummary:
      'Declara uma casa vazia a até 3 casas dele como proibida por 3 turnos. Nenhuma peça entra ou passa por ela.',
    catchphrase: 'Por decreto ministerial, essa casa tá interditada!',
    hasActiveAbility: true,
  },
  {
    id: 'vitin',
    name: 'Vitin',
    person: 'Vitinho',
    emblemChar: 'V',
    accentColor: '#10B981',
    secondaryColor: '#ECFDF5',
    movementSummary: 'Pula exatamente 2 casas em qualquer das 8 direções.',
    abilityName: 'Pulo Livre',
    abilitySummary:
      'Salta por cima de peças na distância 2 (capturando na chegada) ou anda 1 casa reta sem capturar.',
    catchphrase: 'Pequeno no tamanho, gigante no salto!',
    hasActiveAbility: false,
  },
  {
    id: 'marcola',
    name: 'Marcola',
    person: 'Marcos',
    emblemChar: 'MC',
    accentColor: '#06B6D4',
    secondaryColor: '#0F172A',
    movementSummary: '1 casa em qualquer direção.',
    abilityName: 'Passe (1x)',
    abilitySummary:
      'Sem mover normalmente, troca de lugar com qualquer peça sua (exceto Rei) na mesma linha, coluna ou diagonal.',
    catchphrase: 'Toca e passa, visão de jogo absurda!',
    hasActiveAbility: true,
  },
  {
    id: 'eminnym',
    name: 'Eminnym',
    person: 'Emilly',
    emblemChar: 'E',
    accentColor: '#EC4899',
    secondaryColor: '#1F2937',
    movementSummary: 'Move como a última peça que o oponente moveu.',
    abilityName: 'Espelho',
    abilitySummary:
      'Copia o padrão de movimento da última peça movida pelo adversário (sem efeitos). Se não houver, aguarda.',
    catchphrase: 'Tudo que você fizer, eu faço melhor!',
    hasActiveAbility: false,
  },
  {
    id: 'jac',
    name: 'Jac',
    person: 'Jac',
    emblemChar: 'J',
    accentColor: '#84CC16',
    secondaryColor: '#14532D',
    movementSummary: 'Bispo que quica 1 vez na borda lateral do tabuleiro.',
    abilityName: 'Tabela Lateral',
    abilitySummary:
      'A diagonal reflete uma vez ao atingir as colunas laterais (a ou h) e continua até capturar ou parar.',
    catchphrase: 'De tabela na lateral, ninguém esperava!',
    hasActiveAbility: false,
  },
  {
    id: 'uiu',
    name: 'UIU',
    person: 'Williams',
    emblemChar: 'U',
    accentColor: '#38BDF8',
    secondaryColor: '#0C4A6E',
    movementSummary: 'Desliza nas 8 direções, mínimo de 3 casas.',
    abilityName: 'Voo Longo',
    abilitySummary:
      'Atravessa o tabuleiro gritando "uiu!"; proibido parar a 1 ou 2 casas de distância.',
    catchphrase: 'Uiuuuu! Cruzando o tabuleiro inteiro!',
    hasActiveAbility: false,
  },
];

export const SPECIAL_BY_ID: Record<SpecialId, SpecialMeta> = Object.fromEntries(
  SPECIAL_ROSTER.map((s) => [s.id, s])
) as Record<SpecialId, SpecialMeta>;

export interface EmoteDef {
  id: string;
  label: string;
  speech: string;
  audioFile: string;
  pitchPattern: number[];
}

export const MEME_EMOTES: EmoteDef[] = [
  {
    id: 'mim_de_papai',
    label: 'Mim dê papai',
    speech: 'Mim dê papai!',
    audioFile: '/audio/mim_de_papai.mp3',
    pitchPattern: [392, 523, 659],
  },
  {
    id: 'receba',
    label: 'Receba!',
    speech: 'Receba! O melhor do mundo!',
    audioFile: '/audio/receba.mp3',
    pitchPattern: [440, 587, 880],
  },
  {
    id: 'que_isso',
    label: 'Que isso meu filho',
    speech: 'Que isso meu filho, calma!',
    audioFile: '/audio/que_isso.mp3',
    pitchPattern: [523, 440, 349],
  },
  {
    id: 'tome',
    label: 'Tome!',
    speech: 'Tome! Essa doeu!',
    audioFile: '/audio/tome.mp3',
    pitchPattern: [330, 660],
  },
  {
    id: 'bora_bill',
    label: 'Bora Bill!',
    speech: 'Bora Bill! Bora fi do Bill!',
    audioFile: '/audio/bora_bill.mp3',
    pitchPattern: [494, 587, 659],
  },
  {
    id: 'uiuiui',
    label: 'Uiuiui',
    speech: 'Uiuiui, que jogada!',
    audioFile: '/audio/uiuiui.mp3',
    pitchPattern: [587, 659, 784, 659],
  },
  {
    id: 'eita_giovanna',
    label: 'Eita Giovanna',
    speech: 'Eita Giovanna, o forninho caiu!',
    audioFile: '/audio/eita_giovanna.mp3',
    pitchPattern: [440, 415, 392, 330],
  },
  {
    id: 'fala_comigo',
    label: 'Fala comigo bebê',
    speech: 'Fala comigo bebê!',
    audioFile: '/audio/fala_comigo.mp3',
    pitchPattern: [349, 440, 523, 659],
  },
];

export const CLASSIC_NAMES: Record<ClassicKind, string> = {
  p: 'Peão',
  n: 'Cavalo',
  b: 'Bispo',
  r: 'Torre',
  q: 'Dama',
  k: 'Rei',
};

export function isSpecialKind(kind: PieceKind): kind is SpecialId {
  return (
    kind !== 'p' &&
    kind !== 'n' &&
    kind !== 'b' &&
    kind !== 'r' &&
    kind !== 'q' &&
    kind !== 'k'
  );
}

export function getPieceDisplayName(kind: PieceKind): string {
  if (isSpecialKind(kind)) return SPECIAL_BY_ID[kind].name;
  return CLASSIC_NAMES[kind];
}
