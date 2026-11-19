import { useState } from 'react';
import { Bot, Building2, Link2, Users } from 'lucide-react';
import { SCENE_ROOMS, SceneRoomId } from '../game/types';

interface TitleOverlayProps {
  selectedRoom: SceneRoomId;
  onSelectRoom: (roomId: SceneRoomId) => void;
  onStartAI: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  isCreatingRoom: boolean;
}

export function TitleOverlay({
  selectedRoom,
  onSelectRoom,
  onStartAI,
  onCreateRoom,
  onJoinRoom,
  isCreatingRoom,
}: TitleOverlayProps) {
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  const activeRoomMeta = SCENE_ROOMS.find((r) => r.id === selectedRoom) ?? SCENE_ROOMS[0];

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 md:p-8 overflow-y-auto">
      {/* Left/Center Editorial Lockup over calm scrim */}
      <div className="my-auto max-w-md pointer-events-auto bg-[#090E1A]/94 border border-slate-700/70 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <img
            src="/assets/aistudio/image_3c54a752.png"
            alt="Bold Solution"
            referrerPolicy="no-referrer"
            className="h-8 w-auto object-contain bg-white/95 rounded-md px-2 py-1"
          />
          <span className="text-xs font-medium text-slate-400">Edição de Estúdio 3D</span>
        </div>

        {/* Bespoke inline SVG Title Lockup */}
        <svg
          viewBox="0 0 360 76"
          className="w-full max-w-[290px] h-auto mb-2.5"
          aria-label="Xadrez Bold"
        >
          <defs>
            <linearGradient id="boldMintGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#1D6CE0" />
              <stop offset="55%" stopColor="#00E5C3" />
              <stop offset="100%" stopColor="#00E676" />
            </linearGradient>
          </defs>
          <g transform="translate(2, 10)">
            <path
              d="M20 4 L28 14 L24 18 L30 46 L34 52 L6 52 L10 46 L16 18 L12 14 Z"
              fill="#0E1B33"
              stroke="url(#boldMintGrad)"
              strokeWidth="2.5"
            />
            <circle cx="20" cy="7" r="3.5" fill="#00E676" />
          </g>
          <text
            x="48"
            y="48"
            fill="#F8FAFC"
            fontFamily="Outfit, sans-serif"
            fontWeight="800"
            fontSize="40"
            letterSpacing="-0.02em"
          >
            Xadrez
          </text>
          <text
            x="184"
            y="48"
            fill="url(#boldMintGrad)"
            fontFamily="Outfit, sans-serif"
            fontWeight="800"
            fontSize="40"
            letterSpacing="-0.02em"
          >
            Bold
          </text>
          <path
            d="M48 60 L152 60 L170 67 L315 67"
            fill="none"
            stroke="url(#boldMintGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="170" cy="67" r="4" fill="#00E676" />
          <circle cx="315" cy="67" r="4" fill="#00E5C3" />
        </svg>

        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-4">
          Tabuleiro 3D sobre a mesa com estações de trabalho ao redor, 10 peças especiais da equipe e áudios do Robôzinho.
        </p>

        {/* 3D Room Selector (Choose before starting) */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-[#00E5C3]" />
              Escolha a Sala 3D
            </span>
            <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
              {activeRoomMeta.name}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Escolha a Sala 3D">
            {SCENE_ROOMS.map((rm) => {
              const active = selectedRoom === rm.id;
              return (
                <button
                  key={rm.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectRoom(rm.id)}
                  className={`px-1.5 sm:px-2 py-2 rounded-lg text-[11px] sm:text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#0047A0] border-[#00E676] text-white'
                      : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  {rm.name}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
            {activeRoomMeta.shortDesc}
          </p>
        </div>

        {/* Primary & Secondary Actions */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onStartAI}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#00E676] hover:bg-[#00d16b] text-slate-950 font-display font-bold text-base transition-transform active:scale-[0.99] cursor-pointer whitespace-nowrap"
          >
            <Bot className="w-5 h-5" />
            Jogar contra IA
          </button>

          <button
            type="button"
            onClick={onCreateRoom}
            disabled={isCreatingRoom}
            className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl bg-[#0047A0] hover:bg-[#0b56b8] text-white font-display font-semibold text-sm border border-[#38bdf8]/30 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            <Link2 className="w-4 h-4" />
            {isCreatingRoom ? 'Criando sala...' : 'Criar Sala Multiplayer'}
          </button>

          {!showJoinInput ? (
            <button
              type="button"
              onClick={() => setShowJoinInput(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-sm font-medium border border-slate-700/70 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Users className="w-4 h-4 text-[#00E5C3]" />
              Entrar com código de sala
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (joinCode.trim().length >= 3) {
                  onJoinRoom(joinCode.trim().toUpperCase());
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Código (ex: BOLD42)"
                aria-label="Código da sala"
                maxLength={10}
                className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white font-mono-tabular placeholder:text-slate-500 focus:outline-none focus:border-[#00E676]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-[#00E5C3] text-slate-950 font-semibold text-sm hover:bg-[#22f3d2] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Entrar
              </button>
            </form>
          )}
        </div>

        {/* Robôzinho mini greeting strip */}
        <div className="mt-4 pt-3.5 border-t border-slate-800 flex items-center gap-3">
          <img
            src="/assets/aistudio/image_45bb4b06.png"
            alt="Robôzinho da Bold"
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-xl object-cover border border-[#00E676]/50 bg-[#003399]"
          />
          <p className="text-xs text-slate-300 leading-snug">
            <span className="font-semibold text-[#00E676]">Robôzinho da Bold:</span>{' '}
            &ldquo;Escolha a sala acima e chegue à 6ª ou 8ª fileira para convocar até 3 especiais!&rdquo;
          </p>
        </div>
      </div>

      {/* Single flat control-hint line in bottom safe margin */}
      <div className="flex justify-center pt-3">
        <div className="px-3.5 py-1.5 rounded-xl bg-[#090E1A]/88 border border-slate-700/70 text-center text-[11px] sm:text-xs text-slate-200 tracking-wide shadow-lg">
          Clique para mover · Arraste para girar a câmera · Scroll para zoom · Esc para pausar
        </div>
      </div>
    </div>
  );
}
