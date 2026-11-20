import { useState } from 'react';
import {
  Baby,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Crown,
  Flag,
  Flame,
  Hand,
  MessageCircleHeart,
  MessageSquare,
  Pause,
  PartyPopper,
  Rocket,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Color,
  GameState,
  MEME_EMOTES,
  MoveOption,
  Pos,
  SCENE_ROOMS,
  SPECIAL_BY_ID,
  SPECIAL_ROSTER,
  SceneRoomId,
  getPieceDisplayName,
  isSpecialKind,
} from '../game/types';
import { CameraPreset } from '../three/ChessScene';

/** Icone e cor de cada emote (em vez de so texto). */
const EMOTE_VISUAL: Record<string, { Icon: LucideIcon; color: string }> = {
  mim_de_papai: { Icon: Baby, color: '#F472B6' },
  receba: { Icon: Trophy, color: '#FBBF24' },
  que_isso: { Icon: Hand, color: '#38BDF8' },
  tome: { Icon: Zap, color: '#A78BFA' },
  bora_bill: { Icon: Rocket, color: '#34D399' },
  uiuiui: { Icon: PartyPopper, color: '#FB923C' },
  eita_giovanna: { Icon: Flame, color: '#F87171' },
  fala_comigo: { Icon: MessageCircleHeart, color: '#2DD4BF' },
};

interface GameHUDProps {
  gameState: GameState;
  mode: 'ai' | 'multiplayer';
  sceneRoom: SceneRoomId;
  playerColor: Color | 'spectator';
  roomId: string | null;
  playersConnected: number;
  aiThinking: boolean;
  selectedSquare: Pos | null;
  legalMoves: MoveOption[];
  cameraPreset: CameraPreset;
  muted: boolean;
  volume: number;
  emoteCooldownSec: number;
  robotSpeech: string;
  robotSpeaker: string | null;
  onCameraPreset: (preset: CameraPreset) => void;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
  onSendEmote: (emoteId: string) => void;
  onPause: () => void;
  onResign: () => void;
}

export function GameHUD({
  gameState,
  mode,
  sceneRoom,
  playerColor,
  roomId,
  playersConnected,
  aiThinking,
  selectedSquare,
  legalMoves,
  cameraPreset,
  muted,
  volume,
  emoteCooldownSec,
  robotSpeech,
  robotSpeaker,
  onCameraPreset,
  onToggleMute,
  onVolumeChange,
  onSendEmote,
  onPause,
  onResign,
}: GameHUDProps) {
  const [dockOpen, setDockOpen] = useState(true);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const selectedPiece = selectedSquare
    ? gameState.board[selectedSquare.row][selectedSquare.col]
    : null;
  const abilityMovesCount = legalMoves.filter(
    (m) =>
      m.kind === 'kick' ||
      m.kind === 'arrest' ||
      m.kind === 'decree' ||
      m.kind === 'pass'
  ).length;

  const myColor: Color = playerColor === 'b' ? 'b' : 'w';
  const myUsedSpecials = gameState.usedSpecials[myColor];

  const handleCopyRoomLink = () => {
    if (!roomId) return;
    const url = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-5">
      {/* Top Perimeter Row */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left: Active Turn, Convocations & Robôzinho Narrator */}
        <div className="flex flex-col gap-2 max-w-[300px]">
          <div className="pointer-events-auto bg-[#090E1A]/92 border border-slate-700/70 rounded-xl px-4 py-2.5 shadow-xl flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-3.5 h-3.5 rounded-sm border ${
                  gameState.turn === 'w'
                    ? 'bg-slate-100 border-white'
                    : 'bg-slate-900 border-slate-500'
                }`}
                aria-hidden="true"
              />
              <span className="font-display font-bold text-sm text-white whitespace-nowrap">
                {gameState.turn === 'w' ? 'Vez das Brancas' : 'Vez das Pretas'}
              </span>
              {aiThinking && (
                <span className="text-xs font-medium text-[#00E5C3]">
                  · IA pensando...
                </span>
              )}
              {gameState.inCheck && (
                <span className="text-xs font-bold text-red-400">
                  · XEQUE!
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 tabular-nums">
              <span>Lance {gameState.fullMoveNumber}</span>
              <span aria-hidden="true">·</span>
              <span>
                Capturas: {gameState.capturedBy.w.length}B / {gameState.capturedBy.b.length}P
              </span>
              <span aria-hidden="true">·</span>
              <span>{SCENE_ROOMS.find((r) => r.id === sceneRoom)?.name ?? 'Sala da Bold'}</span>
            </div>

            {gameState.classic && (
              <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/80 text-[11px] font-semibold text-[#00E676]">
                <Crown className="w-3.5 h-3.5" aria-hidden="true" /> Xadrez clássico
              </div>
            )}

            {/* Convocation Slots Status (3 choices from 10 specials) */}
            {!gameState.classic && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/80">
              <span className="text-[11px] font-semibold text-[#00E676] tabular-nums">
                Especiais {myUsedSpecials.length}/3
              </span>
              {myUsedSpecials.length === 0 ? (
                <span className="text-[11px] text-slate-400">· Convoca na 6ª/8ª fileira</span>
              ) : (
                myUsedSpecials.map((spId) => {
                  const meta = SPECIAL_BY_ID[spId];
                  const onBoard = gameState.board.some((row) =>
                    row.some((p) => p && p.color === myColor && p.kind === spId)
                  );
                  return (
                    <span
                      key={spId}
                      title={`${meta.name}: ${meta.abilitySummary}`}
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${
                        onBoard
                          ? 'border-[#00E676]/60 text-[#00E676] bg-[#00E676]/10'
                          : 'border-slate-800 text-slate-500 line-through'
                      }`}
                    >
                      {meta.name}
                    </span>
                  );
                })
              )}
            </div>
            )}

            {/* Multiplayer Share Link */}
            {mode === 'multiplayer' && roomId && (
              <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono-tabular text-slate-300">
                  Sala {roomId} · {playersConnected}/2
                </span>
                <button
                  type="button"
                  onClick={handleCopyRoomLink}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#00E676] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3 h-3" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copiar link
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Robôzinho Speech Card */}
          <div className="pointer-events-auto bg-[#090E1A]/92 border border-slate-700/70 rounded-xl p-2.5 flex items-center gap-2.5 shadow-xl">
            <img
              src="/assets/aistudio/image_45bb4b06.png"
              alt="Robôzinho da Bold"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-lg object-cover border border-[#00E676]/60 bg-[#003399] shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[#00E676] truncate">
                {robotSpeaker ?? 'Robôzinho da Bold'}
              </div>
              <p className="text-xs text-slate-200 leading-snug line-clamp-2">
                {robotSpeech}
              </p>
            </div>
          </div>
        </div>

        {/* Top-Right: Compact Utility Icon Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Ativar som' : 'Silenciar som'}
            className="w-10 h-10 rounded-xl bg-[#090E1A]/92 border border-slate-700/70 hover:border-[#00E676] text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {!gameState.classic && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                setGuideOpen((prev) => !prev);
              }}
              aria-label="Manual das peças especiais"
              title="Manual das peças especiais"
              className="w-10 h-10 rounded-xl bg-[#090E1A]/92 border border-slate-700/70 hover:border-[#00E5C3] text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Pausar partida"
            className="w-10 h-10 rounded-xl bg-[#090E1A]/92 border border-slate-700/70 hover:border-white text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Area: Collapsible Bottom Dock */}
      <div className="flex flex-col items-center gap-2">

        {/* Emote Wheel Popover */}
        {emotesOpen && dockOpen && (
          <div className="pointer-events-auto w-full max-w-2xl bg-[#0B1222]/96 border border-slate-700 rounded-xl p-3 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-white">
                Emotes da Galera {emoteCooldownSec > 0 ? `(aguarde ${emoteCooldownSec}s)` : ''}
              </span>
              <button
                type="button"
                onClick={() => setEmotesOpen(false)}
                aria-label="Fechar emotes"
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MEME_EMOTES.map((em) => {
                const vis = EMOTE_VISUAL[em.id];
                const Icon = vis?.Icon ?? MessageSquare;
                const color = vis?.color ?? '#00E676';
                return (
                  <button
                    key={em.id}
                    type="button"
                    disabled={emoteCooldownSec > 0}
                    onClick={() => {
                      onSendEmote(em.id);
                      setEmotesOpen(false);
                    }}
                    title={em.speech}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/90 border border-slate-700 hover:border-slate-500 disabled:opacity-45 disabled:cursor-not-allowed text-left transition-colors cursor-pointer"
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${color}26`, border: `1px solid ${color}66`, color }}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-semibold text-slate-100 leading-tight">{em.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsible Bottom Control Dock */}
        <div className="pointer-events-auto flex flex-col items-center">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              setDockOpen((prev) => !prev);
            }}
            className="px-3.5 py-1 rounded-t-lg bg-[#090E1A]/94 border border-b-0 border-slate-700/70 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            {dockOpen ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" /> Ocultar Controles
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" /> Controles
              </>
            )}
          </button>

          {dockOpen && (
            <div className="bg-[#090E1A]/94 border border-slate-700/70 rounded-2xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-center gap-3 max-w-[94vw]">
              {/* Selected Piece & Ability Indicator */}
              {selectedPiece ? (
                <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
                  <span className="text-xs font-bold text-white">
                    {getPieceDisplayName(selectedPiece.kind)}
                  </span>
                  {isSpecialKind(selectedPiece.kind) && abilityMovesCount > 0 && (
                    <span className="text-[11px] font-semibold text-purple-300 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {SPECIAL_BY_ID[selectedPiece.kind].abilityName} ({abilityMovesCount} alvos roxos)
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-400 pr-3 border-r border-slate-800 hidden sm:block">
                  Selecione uma peça no tabuleiro
                </div>
              )}

              {/* Camera Presets */}
              <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
                {(
                  [
                    ['white', 'Brancas'],
                    ['black', 'Pretas'],
                    ['top', 'Topo'],
                  ] as [CameraPreset, string][]
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCameraPreset(preset);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      cameraPreset === preset
                        ? 'bg-[#0047A0] text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Emotes Button (espectador nao envia emotes) */}
              {playerColor !== 'spectator' && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setEmotesOpen((prev) => !prev);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-[#00E676] border border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {emoteCooldownSec > 0 ? `Emotes (${emoteCooldownSec}s)` : 'Emotes'}
                </button>
              )}

              {/* Volume Slider */}
              <div className="hidden md:flex items-center gap-2 px-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  aria-label="Volume do áudio"
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="w-20 accent-[#00E676] cursor-pointer"
                />
              </div>

              {/* Resign (espectador nao desiste) */}
              {playerColor !== 'spectator' && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onResign();
                  }}
                  aria-label="Desistir da partida"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-red-950/70 text-xs font-semibold text-red-400 border border-slate-800 hover:border-red-700/60 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Flag className="w-3.5 h-3.5" />
                  Desistir
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Special Pieces Manual Drawer */}
      {guideOpen && (
        <div className="fixed inset-0 z-40 pointer-events-auto flex items-center justify-center p-4 bg-[#050811]/82">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#0B1222] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-white">
                  Guia das 10 Peças Especiais & Convocação
                </h3>
                <p className="text-xs text-slate-400">
                  Ao chegar à 6ª ou 8ª fileira, você pode escolher até 3 das 10 peças especiais por partida (máximo 1 especial seu em campo por vez).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                aria-label="Fechar guia"
                className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
              {SPECIAL_ROSTER.map((sp) => (
                <div
                  key={sp.id}
                  className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex gap-3"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center font-display font-bold text-sm shrink-0"
                    style={{
                      backgroundColor: `${sp.accentColor}26`,
                      border: `1px solid ${sp.accentColor}`,
                      color: sp.accentColor,
                    }}
                  >
                    {sp.emblemChar}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-sm text-white">
                        {sp.name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">{sp.movementSummary}</p>
                    <p className="text-xs text-[#00E5C3] mt-1">
                      <strong>{sp.abilityName}:</strong> {sp.abilitySummary}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
