import { useEffect, useState } from 'react';
import { Check, Swords, X } from 'lucide-react';
import type { PlayerIdentity, PointsAward, MatchResult } from '../shared/protocol';
import { Avatar } from './Lobby';
import { describeTimeControl } from '../game/clock';
import type { TimeControl } from '../game/types';

export interface IncomingInvite {
  inviteId: string;
  from: PlayerIdentity;
  roomId: string;
  expiresAt: number;
  /** controle de tempo proposto; null/ausente = livre */
  time?: TimeControl | null;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

function useCountdown(expiresAt: number): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return left;
}

function InviteCard({
  invite,
  onRespond,
  onExpire,
}: {
  invite: IncomingInvite;
  onRespond: (inviteId: string, accept: boolean) => void;
  onExpire: (inviteId: string) => void;
}) {
  const left = useCountdown(invite.expiresAt);
  useEffect(() => {
    if (left <= 0) onExpire(invite.inviteId);
  }, [left, invite.inviteId, onExpire]);

  return (
    <div
      role="alertdialog"
      aria-label={`Convite de ${invite.from.name}`}
      className="pointer-events-auto w-full bg-[#0B1222]/97 border border-[#00E676]/50 rounded-xl p-3 shadow-2xl"
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <Avatar user={invite.from} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{invite.from.name}</div>
          <div className="text-[11px] text-slate-300 flex items-center gap-1">
            <Swords className="w-3 h-3 text-[#00E676]" /> te desafiou para uma partida
          </div>
          <div className="text-[11px] font-semibold text-[#00E676] mt-0.5">
            Modo: {invite.time ? describeTimeControl(invite.time) + ' por jogador' : 'Livre (sem tempo)'}
          </div>
        </div>
        <span className="font-mono-tabular text-xs text-amber-300 shrink-0" aria-label="Segundos restantes">
          {left}s
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onRespond(invite.inviteId, true)}
          className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-[#00E676] hover:bg-[#00d16b] text-slate-950 text-xs font-bold cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" /> Aceitar
        </button>
        <button
          type="button"
          onClick={() => onRespond(invite.inviteId, false)}
          className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold cursor-pointer"
        >
          <X className="w-3.5 h-3.5" /> Recusar
        </button>
      </div>
    </div>
  );
}

interface InviteToastProps {
  invites: IncomingInvite[];
  notices: Notice[];
  onRespond: (inviteId: string, accept: boolean) => void;
  onExpire: (inviteId: string) => void;
  onDismissNotice: (id: number) => void;
}

/** Pilha de convites recebidos + avisos curtos (invite_result, erros). */
export function InviteToast({ invites, notices, onRespond, onExpire, onDismissNotice }: InviteToastProps) {
  if (invites.length === 0 && notices.length === 0) return null;
  return (
    <div className="fixed top-3 right-3 left-3 sm:left-auto sm:w-80 z-50 flex flex-col gap-2 pointer-events-none">
      {invites.map((inv) => (
        <InviteCard key={inv.inviteId} invite={inv} onRespond={onRespond} onExpire={onExpire} />
      ))}
      {notices.map((n) => (
        <div
          key={n.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-xl border text-xs shadow-xl bg-[#0B1222]/97 ${
            n.kind === 'error'
              ? 'border-rose-500/50 text-rose-200'
              : n.kind === 'success'
                ? 'border-emerald-500/50 text-emerald-200'
                : 'border-slate-600 text-slate-200'
          }`}
        >
          <span className="flex-1 leading-snug">{n.text}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => onDismissNotice(n.id)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function inviteResultText(status: 'accepted' | 'declined' | 'expired' | 'offline'): { kind: Notice['kind']; text: string } {
  switch (status) {
    case 'declined':
      return { kind: 'info', text: 'Seu desafio foi recusado.' };
    case 'expired':
      return { kind: 'info', text: 'O convite expirou sem resposta.' };
    case 'offline':
      return { kind: 'error', text: 'Esse jogador está offline.' };
    default:
      return { kind: 'success', text: 'Convite aceito! Entrando na partida...' };
  }
}

/** Cartao com pontos ganhos ao fim da partida. */
export function MatchPointsCard({
  meUserId,
  result,
  reason,
  points,
  myColor,
  vsAiLabel,
  onOpenLeaderboard,
  onClose,
}: {
  meUserId: string;
  result: MatchResult;
  reason: string;
  points: PointsAward[];
  myColor: 'w' | 'b' | 'spectator';
  /** nivel da IA, quando a partida foi contra o computador */
  vsAiLabel?: string;
  onOpenLeaderboard: () => void;
  onClose: () => void;
}) {
  const mine = points.find((p) => p.userId === meUserId);
  const outcome =
    result === 'draw'
      ? 'Empate'
      : myColor === 'spectator'
        ? result === 'w'
          ? 'Brancas venceram'
          : 'Pretas venceram'
        : result === myColor
          ? 'Vitória!'
          : 'Derrota';
  let detail: string;
  if (!mine) detail = 'Você estava assistindo: sem pontos nesta partida.';
  else if (!mine.counted) {
    detail =
      mine.reason === 'too_short'
        ? 'Partida curta demais para pontuar (mínimo de 10 jogadas).'
        : mine.reason === 'pair_limit'
          ? 'Limite diário de partidas pontuadas contra este jogador atingido.'
          : mine.reason === 'daily_limit'
            ? 'Limite diário de partidas pontuadas contra a IA atingido.'
            : 'Esta partida não conta para o ranking.';
  } else detail = `Total: ${mine.total} pontos`;

  return (
    <div
      role="status"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,22rem)] bg-[#0B1222]/97 border border-amber-400/50 rounded-xl p-3 shadow-2xl text-center"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute top-2 right-2 text-slate-400 hover:text-white cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="text-xs text-slate-300">
        {vsAiLabel ? `Contra a IA (${vsAiLabel}) · ` : ''}
        {outcome} <span className="text-slate-500">· {reason}</span>
      </div>
      {mine && mine.counted && (
        <div className="font-display font-extrabold text-3xl text-[#00E676] tabular-nums">
          {mine.delta >= 0 ? '+' : ''}
          {mine.delta} pts
        </div>
      )}
      <div className="text-[11px] text-slate-400 mb-2">{detail}</div>
      <button
        type="button"
        onClick={onOpenLeaderboard}
        className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-amber-300 font-semibold cursor-pointer"
      >
        Ver leaderboard
      </button>
    </div>
  );
}

export default InviteToast;
