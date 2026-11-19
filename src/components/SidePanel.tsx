import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, History, Info, Sparkles } from 'lucide-react';
import { posToAlgebraic } from '../game/engine';
import {
  CLASSIC_NAMES,
  ClassicKind,
  GameState,
  MoveOption,
  Pos,
  SPECIAL_BY_ID,
  getPieceDisplayName,
  isSpecialKind,
} from '../game/types';
import { MovePreview } from './MovePreview';

const CLASSIC_DESC: Record<ClassicKind, string> = {
  p: 'Anda 1 casa para a frente (2 no primeiro lance) e captura na diagonal. Na 6ª fileira pode convocar um especial; na última, é promovido.',
  n: 'Move em “L”: 2 casas em uma direção e 1 na perpendicular. É a única peça que salta sobre as outras.',
  b: 'Move em diagonal, quantas casas quiser, sem saltar.',
  r: 'Move em linha reta (horizontal ou vertical), quantas casas quiser, sem saltar.',
  q: 'Move como Torre e Bispo juntos: em qualquer direção, quantas casas quiser.',
  k: 'Anda 1 casa em qualquer direção. Não pode ficar em xeque. Roque com a Torre quando livre.',
};

const KIND_LABEL: Record<string, string> = {
  move: 'Movimento',
  castling: 'Roque',
  enpassant: 'En passant',
  promotion: 'Promoção',
  convocation: 'Convocação',
  push: 'Empurrão',
  kick: 'Chute a gol',
  arrest: 'Abordagem',
  decree: 'Decreto',
  pass: 'Passe',
};

const ABILITY_KINDS = new Set(['push', 'kick', 'arrest', 'decree', 'pass']);

// ---------- Historico ----------
function MoveHistory({ gameState }: { gameState: GameState }) {
  const history = gameState.history;
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [history.length]);

  // agrupa por numero de lance: [{ n, w, b }]
  const rows = useMemo(() => {
    const out: Array<{ n: number; w?: string; b?: string; wi?: number; bi?: number }> = [];
    history.forEach((m, i) => {
      let row = out[out.length - 1];
      if (!row || (m.color === 'w' && (row.w !== undefined || row.b !== undefined)) || row.n !== m.moveNumber) {
        if (m.color === 'b' && row && row.b === undefined && row.n === m.moveNumber) {
          /* mesma linha */
        } else {
          row = { n: m.moveNumber };
          out.push(row);
        }
      }
      if (m.color === 'w') {
        row.w = m.notation;
        row.wi = i;
      } else {
        row.b = m.notation;
        row.bi = i;
      }
    });
    return out;
  }, [history]);

  const lastIdx = history.length - 1;
  const cell = (text: string | undefined, idx: number | undefined) =>
    text === undefined ? (
      <span className="text-slate-600">…</span>
    ) : (
      <span
        className={`px-1.5 py-0.5 rounded font-mono-tabular text-[12px] ${
          idx === lastIdx ? 'bg-[#00E676]/20 text-[#00E676] font-bold' : 'text-slate-200'
        }`}
      >
        {text}
      </span>
    );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1" aria-label="Histórico de movimentos">
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">Nenhum lance ainda. Os movimentos aparecem aqui.</p>
      ) : (
        <ol className="space-y-0.5">
          {rows.map((r) => (
            <li key={`${r.n}-${r.wi ?? r.bi}`} className="grid grid-cols-[1.6rem_1fr_1fr] items-center gap-1 text-xs">
              <span className="text-slate-500 tabular-nums text-right">{r.n}.</span>
              {cell(r.w, r.wi)}
              {cell(r.b, r.bi)}
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}

// ---------- Informacoes da peca ----------
function squares(ms: MoveOption[]): string {
  return ms.map((m) => posToAlgebraic(m.to)).join(', ');
}

function PieceInfo({
  gameState,
  square,
  moves,
  isOwnTurnPiece,
}: {
  gameState: GameState;
  square: Pos | null;
  moves: MoveOption[];
  isOwnTurnPiece: boolean;
}) {
  const piece = square ? gameState.board[square.row][square.col] : null;
  if (!square || !piece) {
    return (
      <p className="text-xs text-slate-500 leading-snug">
        Clique em uma peça no tabuleiro para ver como ela se move, principalmente as peças especiais.
      </p>
    );
  }

  const special = isSpecialKind(piece.kind) ? SPECIAL_BY_ID[piece.kind] : null;
  const name = getPieceDisplayName(piece.kind);
  const ability = moves.filter((m) => ABILITY_KINDS.has(m.kind));
  const normal = moves.filter((m) => !ABILITY_KINDS.has(m.kind) && m.kind !== 'promotion' && m.kind !== 'castling');
  const captures = normal.filter((m) => {
    const t = m.capturePos ?? m.to;
    const target = gameState.board[t.row][t.col];
    return (target && target.color !== piece.color) || m.kind === 'enpassant';
  });
  const quiet = normal.filter((m) => !captures.includes(m));
  const promos = moves.filter((m) => m.kind === 'promotion');
  const castles = moves.filter((m) => m.kind === 'castling');
  const frozen = piece.frozenTurns ?? 0;

  // Habilidades agrupadas por tipo, para mostrar “Chute a gol: g7, g8”.
  const abilityByKind = new Map<string, MoveOption[]>();
  ability.forEach((m) => abilityByKind.set(m.kind, [...(abilityByKind.get(m.kind) ?? []), m]));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
          style={
            special
              ? { backgroundColor: `${special.accentColor}26`, border: `1px solid ${special.accentColor}88`, color: special.accentColor }
              : { backgroundColor: '#1E293B', border: '1px solid #475569', color: '#E2E8F0' }
          }
          aria-hidden="true"
        >
          {special ? special.emblemChar : name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <div className="font-display font-bold text-sm text-white leading-tight truncate">{name}</div>
          <div className="text-[11px] text-slate-400 leading-tight">
            {piece.color === 'w' ? 'Brancas' : 'Pretas'} · {posToAlgebraic(square)}
            {!isOwnTurnPiece && ' · só visualização'}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-300 leading-snug">
        {special ? special.movementSummary : CLASSIC_DESC[piece.kind as ClassicKind] ?? CLASSIC_NAMES[piece.kind as ClassicKind]}
      </p>

      {special?.abilityName && (
        <div className="text-[11px] leading-snug text-[#00E5C3] border-l-2 border-[#00E5C3]/50 pl-2">
          <span className="font-semibold">{special.abilityName}:</span> {special.abilitySummary}
          {special.hasActiveAbility && piece.abilityUsed && <span className="text-slate-400"> (já usada)</span>}
        </div>
      )}

      {special && (
        <div className="flex justify-center pt-0.5">
          <MovePreview specialId={special.id} size={112} showCaption={false} />
        </div>
      )}

      {frozen > 0 && (
        <div className="text-[11px] font-semibold text-sky-300">Congelada por {frozen} turno(s): não pode se mover.</div>
      )}

      <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
        <div className="text-[11px] font-semibold text-slate-300">
          {isOwnTurnPiece ? 'Movimentos possíveis agora' : 'Movimentos possíveis (se fosse a vez dela)'}
        </div>
        {moves.length === 0 ? (
          <p className="text-[11px] text-slate-500">Nenhum movimento disponível neste momento.</p>
        ) : (
          <ul className="space-y-1 text-[11px] leading-snug">
            {quiet.length > 0 && (
              <li>
                <span className="text-slate-400">Mover ({quiet.length}): </span>
                <span className="font-mono-tabular text-white">{squares(quiet)}</span>
              </li>
            )}
            {captures.length > 0 && (
              <li>
                <span className="text-red-300">Capturar ({captures.length}): </span>
                <span className="font-mono-tabular text-white">{squares(captures)}</span>
              </li>
            )}
            {castles.length > 0 && (
              <li>
                <span className="text-slate-400">Roque: </span>
                <span className="font-mono-tabular text-white">{squares(castles)}</span>
              </li>
            )}
            {promos.length > 0 && (
              <li>
                <span className="text-amber-300">Promoção: </span>
                <span className="font-mono-tabular text-white">
                  {[...new Set(promos.map((m) => posToAlgebraic(m.to)))].join(', ')}
                </span>
              </li>
            )}
            {[...abilityByKind.entries()].map(([kind, list]) => (
              <li key={kind}>
                <span className="text-purple-300 inline-flex items-center gap-1 mr-1">
                  <Sparkles className="w-3 h-3" aria-hidden="true" />
                  {KIND_LABEL[kind] ?? kind} ({list.length}):{' '}
                </span>
                <span className="font-mono-tabular text-white">{squares(list)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Painel ----------
interface SidePanelProps {
  gameState: GameState;
  /** peca em foco (selecionada ou inspecionada) */
  focusSquare: Pos | null;
  focusMoves: MoveOption[];
  focusIsPlayable: boolean;
  /** abre recolhido (telas estreitas) */
  defaultCollapsed?: boolean;
}

export function SidePanel({ gameState, focusSquare, focusMoves, focusIsPlayable, defaultCollapsed }: SidePanelProps) {
  const [open, setOpen] = useState(!defaultCollapsed);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#090E1A]/94 border border-slate-700/70 text-xs font-semibold text-slate-200 hover:text-white shadow-xl cursor-pointer"
        aria-label="Abrir painel de lances e peça"
      >
        <History className="w-4 h-4 text-[#00E676]" />
        Lances ({gameState.history.length})
      </button>
    );
  }

  return (
    <aside
      className="pointer-events-auto w-[16.5rem] max-w-[80vw] max-h-full flex flex-col bg-[#090E1A]/94 border border-slate-700/70 rounded-xl shadow-xl overflow-hidden"
      aria-label="Painel de lances e peça selecionada"
    >
      {/* Peca selecionada: movimentos que ela faz */}
      <section className="flex flex-col min-h-0 max-h-[62%] border-b border-slate-800" aria-label="Peça selecionada">
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#00E676]/8 shrink-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[#00E676]">
            <Info className="w-3.5 h-3.5" /> Peça selecionada
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-slate-400 hover:text-white cursor-pointer"
            aria-label="Recolher painel"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 overflow-y-auto min-h-0">
          <PieceInfo gameState={gameState} square={focusSquare} moves={focusMoves} isOwnTurnPiece={focusIsPlayable} />
        </div>
      </section>

      {/* Historico */}
      <section className="flex flex-col min-h-[7rem] flex-1" aria-label="Histórico de movimentos">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/40 text-xs font-semibold text-slate-200 shrink-0">
          <History className="w-3.5 h-3.5 text-[#00E676]" /> Histórico ({gameState.history.length})
        </div>
        <div className="p-3 pt-2 min-h-0 flex-1 flex flex-col">
          <MoveHistory gameState={gameState} />
        </div>
      </section>
    </aside>
  );
}
