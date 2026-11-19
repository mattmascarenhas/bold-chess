import { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { displayRemaining, formatClock, describeTimeControl, runningColor, timeControlOf } from '../game/clock';
import type { Color, GameState } from '../game/types';
import type { RoomSeatInfo, Seat } from '../shared/protocol';
import { Avatar } from './Lobby';

interface TurnBannerProps {
  gameState: GameState;
  mode: 'ai' | 'multiplayer';
  playerColor: Seat;
  seats: RoomSeatInfo | null;
  myName: string;
  aiThinking: boolean;
}

interface Side {
  color: Color;
  name: string;
  user: { userId: string; name: string; avatarUrl: string | null } | null;
  isMe: boolean;
}

/** Brilho na borda da tela quando e a sua vez (nao bloqueia cliques). */
export function TurnGlow({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="turn-glow fixed inset-0 z-[9] pointer-events-none" aria-hidden="true" />;
}

/** Vez em destaque + relogios dos dois jogadores. */
export function TurnBanner({ gameState, mode, playerColor, seats, myName, aiThinking }: TurnBannerProps) {
  const timed = !!gameState.clock;
  const running = timed && gameState.clock!.turnStartedAt !== null && !gameState.winner;

  // hora local em que este estado chegou (corrige a latencia do relogio vindo do servidor)
  const receivedAt = useMemo(() => Date.now(), [gameState]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running, gameState]);

  const sides: Record<Color, Side> = useMemo(() => {
    const me = playerColor === 'w' || playerColor === 'b' ? playerColor : null;
    if (mode === 'ai') {
      return {
        w: { color: 'w', name: myName || 'Você', user: null, isMe: true },
        b: { color: 'b', name: 'Robôzinho (IA)', user: null, isMe: false },
      };
    }
    const mk = (c: Color): Side => {
      const u = seats?.[c] ?? null;
      return { color: c, name: u?.name ?? 'Aguardando…', user: u, isMe: me === c };
    };
    return { w: mk('w'), b: mk('b') };
  }, [mode, playerColor, seats, myName]);

  const active = runningColor(gameState);
  const waiting = mode === 'multiplayer' && (!seats?.w || !seats?.b);
  const over = !!gameState.winner;
  const myColor: Color | null = playerColor === 'w' || playerColor === 'b' ? playerColor : mode === 'ai' ? 'w' : null;
  const myTurn = !waiting && !over && myColor !== null && active === myColor;
  const remaining = displayRemaining(gameState, now, receivedAt);
  const tc = timeControlOf(gameState);

  let headline: string;
  let sub: string | null = null;
  if (over) headline = 'Fim de jogo';
  else if (waiting) headline = 'Aguardando adversário…';
  else if (myTurn) headline = gameState.pendingConvocation ? 'Escolha sua peça!' : 'SUA VEZ';
  else if (mode === 'ai') {
    headline = aiThinking ? 'Robôzinho pensando…' : 'Vez do Robôzinho';
  } else {
    headline = `Vez de ${sides[active].name}`;
    sub = myColor === null ? (active === 'w' ? 'Brancas' : 'Pretas') : 'Aguarde sua vez';
  }

  return (
    <div
      className="pointer-events-none w-full flex justify-center"
      role="status"
      aria-live="polite"
      aria-label={headline}
    >
      <div className="pointer-events-auto flex items-stretch gap-2 max-w-[96vw]">
        <PlayerCard side={sides.w} active={active === 'w' && !over && !waiting} remaining={remaining?.w ?? null} timed={timed} />

        <div
          className={`flex flex-col items-center justify-center px-4 py-1.5 rounded-xl border min-w-[8.5rem] text-center transition-colors ${
            myTurn
              ? 'turn-banner-me bg-[#00E676] border-[#B6FFD6] text-[#04210F]'
              : 'bg-[#090E1A]/94 border-slate-700/70 text-slate-100'
          }`}
        >
          <div className={`font-display font-extrabold leading-tight whitespace-nowrap ${myTurn ? 'text-lg tracking-wide' : 'text-sm'}`}>
            {headline}
          </div>
          {sub && <div className="text-[11px] text-slate-400 leading-tight">{sub}</div>}
          <div className={`flex items-center gap-1 text-[10px] leading-tight mt-0.5 ${myTurn ? 'text-[#0A3A1B]' : 'text-slate-400'}`}>
            <Clock className="w-3 h-3" aria-hidden="true" />
            {describeTimeControl(tc)}
          </div>
        </div>

        <PlayerCard side={sides.b} active={active === 'b' && !over && !waiting} remaining={remaining?.b ?? null} timed={timed} />
      </div>
    </div>
  );
}

function PlayerCard({
  side,
  active,
  remaining,
  timed,
}: {
  side: Side;
  active: boolean;
  remaining: number | null;
  timed: boolean;
}) {
  const low = remaining !== null && remaining < 10_000;
  const warn = remaining !== null && remaining < 30_000;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all min-w-[8rem] ${
        active
          ? 'bg-[#0E2A1B]/95 border-[#00E676] shadow-[0_0_18px_rgba(0,230,118,0.55)]'
          : 'bg-[#090E1A]/90 border-slate-700/70 opacity-80'
      }`}
    >
      <span
        className={`w-3.5 h-3.5 rounded-sm border shrink-0 ${
          side.color === 'w' ? 'bg-slate-100 border-white' : 'bg-slate-900 border-slate-400'
        }`}
        aria-hidden="true"
      />
      {side.user && <Avatar user={side.user} size={22} />}
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white truncate max-w-[7.5rem]">
          {side.name}
          {side.isMe ? ' (você)' : ''}
        </div>
        {timed && remaining !== null && (
          <div
            className={`font-mono-tabular text-lg font-bold leading-none tabular-nums ${
              low ? 'text-red-400 clock-low' : warn ? 'text-amber-300' : active ? 'text-[#00E676]' : 'text-slate-300'
            }`}
            aria-label={`Tempo restante: ${formatClock(remaining)}`}
          >
            {formatClock(remaining)}
          </div>
        )}
      </div>
    </div>
  );
}
