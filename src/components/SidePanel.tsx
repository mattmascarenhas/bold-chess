import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, History, Info, Sparkles } from 'lucide-react';
import { posToAlgebraic } from '../game/engine';
import {
  CLASSIC_NAMES,
  ClassicKind,
  GameState,
  MoveOption,
  PieceKind,
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
/** Silhuetas das pecas classicas (SVG, mesmo desenho para as duas cores). */
const SILHOUETTE: Record<ClassicKind, string> = {
  p: 'M12 4.2a3.1 3.1 0 0 1 1.7 5.7c1.5.8 2.6 2.7 2.8 4.6H17.5v2.2H6.5v-2.2h1c.2-1.9 1.3-3.8 2.8-4.6A3.1 3.1 0 0 1 12 4.2ZM5.5 18.4h13V20h-13z',
  n: 'M7 19.8c0-3.2.9-5.4 3.2-7.5-1 .3-2 .9-3 1.7L5.8 12 10.9 6.6l.6-2.6 1.8 1.3 1.8-.8c2.5 1.6 4 4.2 4 8.7v4.6zM5.5 18.4h13V20h-13z',
  b: 'M12 2.8c2.6 2 4 3.9 4 6.1 0 1.3-.6 2.3-1.5 3h1.2v1.9h-2.1c.2 1.2.7 2 1.5 2.7v1.4H8.9v-1.4c.8-.7 1.3-1.5 1.5-2.7H8.3v-1.9h1.2c-.9-.7-1.5-1.7-1.5-3 0-2.2 1.4-4.1 4-6.1ZM5.5 18.4h13V20h-13z',
  r: 'M6.2 4h2.4v2h1.9V4h3v2h1.9V4h2.4v5.2l-1.9 1.5v5.1l1.5 1.1V18H6.6v-1.1l1.5-1.1v-5.1L6.2 9.2zM5.5 18.4h13V20h-13z',
  q: 'M4.2 7.8l3.4 5.2 1.4-6.3L12 12l3-5.3 1.4 6.3 3.4-5.2-1.7 9.6H5.9zM5.5 17.8h13V20h-13z',
  k: 'M11 2.5h2v2h2v2h-2v2.3c2.4.7 4.1 2.6 4.1 4.8 0 1-.4 2-1 2.8l1 .9v2.2H6.9V17.3l1-.9c-.6-.8-1-1.8-1-2.8 0-2.2 1.7-4.1 4.1-4.8V6.5H9v-2h2z',
};

function ClassicGlyph({ kind, size }: { kind: ClassicKind; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d={SILHOUETTE[kind]} />
    </svg>
  );
}

/** Icone da peca: simbolo para as classicas, emblema colorido para as especiais. */
function PieceBadge({ kind, color, size = 26 }: { kind: PieceKind; color: 'w' | 'b'; size?: number }) {
  if (isSpecialKind(kind)) {
    const m = SPECIAL_BY_ID[kind];
    return (
      <span
        className="rounded-md flex items-center justify-center font-bold shrink-0"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.5,
          backgroundColor: `${m.accentColor}2E`,
          border: `1px solid ${m.accentColor}99`,
          color: m.accentColor,
        }}
        title={m.name}
      >
        {m.emblemChar}
      </span>
    );
  }
  return (
    <span
      className={`rounded-md flex items-center justify-center shrink-0 leading-none ${
        color === 'w' ? 'bg-slate-100 border border-white text-slate-800' : 'bg-slate-800 border border-slate-500 text-slate-100'
      }`}
      style={{ width: size, height: size }}
      title={getPieceDisplayName(kind)}
    >
      <ClassicGlyph kind={kind as ClassicKind} size={Math.round(size * 0.82)} />
    </span>
  );
}

const ABILITY_VERB: Record<string, string> = {
  kick: 'Chute a gol',
  arrest: 'Abordagem',
  decree: 'Decreto',
  pass: 'Passe',
  push: 'Empurrão',
  convocation: 'Convocação',
  castling: 'Roque',
  enpassant: 'En passant',
  promotion: 'Promoção',
};

function MoveHistory({ gameState }: { gameState: GameState }) {
  const history = gameState.history;
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [history.length]);

  if (history.length === 0) {
    return <p className="text-xs text-slate-500 py-2">Nenhum lance ainda. Os movimentos aparecem aqui.</p>;
  }

  const last = history.length - 1;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1" aria-label="Histórico de movimentos">
      <ol className="space-y-1">
        {history.map((m, i) => {
          const from = posToAlgebraic(m.from);
          const to = posToAlgebraic(m.to);
          const verb = ABILITY_VERB[m.kind];
          const special = m.kind !== 'move' && m.kind !== 'castling' && m.kind !== 'enpassant' && m.kind !== 'promotion';
          return (
            <li
              key={i}
              className={`flex items-center gap-2 px-1.5 py-1 rounded-lg border ${
                i === last ? 'bg-[#00E676]/10 border-[#00E676]/40' : 'border-transparent odd:bg-slate-800/25'
              }`}
            >
              <span className="w-5 text-right text-[11px] text-slate-500 tabular-nums shrink-0">
                {m.color === 'w' ? `${m.moveNumber}.` : ''}
              </span>
              <PieceBadge kind={m.pieceKind} color={m.color} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex items-center gap-1 text-[12px] font-mono-tabular text-white">
                  {special && m.kind !== 'convocation' ? (
                    <span>{to}</span>
                  ) : m.kind === 'convocation' ? (
                    <span>{to}</span>
                  ) : (
                    <>
                      <span className="text-slate-300">{from}</span>
                      <span className="text-slate-500" aria-hidden="true">→</span>
                      <span className="font-bold">{to}</span>
                    </>
                  )}
                  {m.capturedKind && (
                    <span className="inline-flex items-center gap-0.5 text-red-300 ml-0.5" title={`Capturou ${getPieceDisplayName(m.capturedKind)}`}>
                      ×
                      <PieceBadge kind={m.capturedKind} color={m.color === 'w' ? 'b' : 'w'} size={16} />
                    </span>
                  )}
                  {m.isCheckmate ? (
                    <span className="ml-auto text-[10px] font-bold text-red-300">MATE</span>
                  ) : m.isCheck ? (
                    <span className="ml-auto text-[10px] font-bold text-amber-300">XEQUE</span>
                  ) : null}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {getPieceDisplayName(m.pieceKind)}
                  {verb ? ` · ${verb}` : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
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
        {special
          ? special.movementSummary
          : piece.kind === 'p' && gameState.classic
            ? 'Anda 1 casa para a frente (2 no primeiro lance) e captura na diagonal. Na última fileira é promovido.'
            : CLASSIC_DESC[piece.kind as ClassicKind] ?? CLASSIC_NAMES[piece.kind as ClassicKind]}
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
