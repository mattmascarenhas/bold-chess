import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Eye, LogOut } from 'lucide-react';
import type { PlayerIdentity, RoomSeatInfo, Seat } from '../shared/protocol';
import { Avatar, ConnectionBadge, copyText, roomLink } from './Lobby';
import type { SocketStatus } from '../net/socket';

interface SpectatorBarProps {
  roomId: string;
  seats: RoomSeatInfo;
  yourSeat: Seat;
  connection: SocketStatus;
  onLeave: () => void;
}

function PlayerChip({ color, user, isMe }: { color: 'w' | 'b'; user: PlayerIdentity | null; isMe: boolean }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className={`w-2.5 h-2.5 rounded-full border border-slate-500 shrink-0 ${
          color === 'w' ? 'bg-white' : 'bg-slate-900'
        }`}
        aria-label={color === 'w' ? 'Brancas' : 'Pretas'}
      />
      <Avatar user={user} size={22} />
      <span className={`text-xs truncate max-w-[7rem] ${user ? 'text-slate-100' : 'text-slate-500 italic'}`}>
        {user ? user.name : 'Aguardando...'}
        {isMe ? ' (você)' : ''}
      </span>
    </div>
  );
}

export function SpectatorBar({ roomId, seats, yourSeat, connection, onLeave }: SpectatorBarProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isSpectator = yourSeat === 'spectator';

  const copy = async () => {
    const ok = await copyText(roomLink(roomId));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-30 w-[min(96vw,34rem)] pointer-events-none">
      <div className="pointer-events-auto bg-[#090E1A]/92 border border-slate-700/70 rounded-xl px-2.5 py-1.5 shadow-lg">
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          <PlayerChip color="w" user={seats.w} isMe={yourSeat === 'w'} />
          <span className="text-[10px] text-slate-500">x</span>
          <PlayerChip color="b" user={seats.b} isMe={yourSeat === 'b'} />
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-300" title="Espectadores">
            <Eye className="w-3.5 h-3.5" /> {seats.spectators.length}
          </span>
          <button
            type="button"
            aria-label={open ? 'Recolher detalhes da sala' : 'Expandir detalhes da sala'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {isSpectator && (
          <div className="mt-1 text-[11px] font-semibold text-sky-300 flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" /> Você está assistindo — as jogadas estão bloqueadas.
          </div>
        )}

        {open && (
          <div className="mt-2 pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400">Sala</span>
              <span className="font-mono-tabular font-bold text-[#00E5C3] text-sm">{roomId}</span>
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-100 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Link copiado' : 'Copiar link'}
              </button>
              <span className="ml-auto">
                <ConnectionBadge status={connection} />
              </span>
            </div>
            <div className="text-[11px] text-slate-300">
              {seats.spectators.length === 0
                ? 'Nenhum espectador.'
                : `Espectadores (${seats.spectators.length}): ${seats.spectators.map((s) => s.name).join(', ')}`}
            </div>
            <button
              type="button"
              onClick={onLeave}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-[11px] text-rose-200 cursor-pointer"
            >
              <LogOut className="w-3 h-3" /> Sair da sala
            </button>
          </div>
        )}
        {!open && connection !== 'ready' && (
          <div className="mt-1">
            <ConnectionBadge status={connection} />
          </div>
        )}
      </div>
    </div>
  );
}

export default SpectatorBar;
