import { useState } from 'react';
import { Bot, Copy, Eye, Link2, LogIn, Plus, Swords, Trophy, Users, Wifi, WifiOff } from 'lucide-react';
import { SCENE_ROOMS, SceneRoomId } from '../game/types';
import { describeTimeControl } from '../game/clock';
import type { OnlineUser, PlayerIdentity, RoomSummary } from '../shared/protocol';
import type { SocketStatus } from '../net/socket';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({
  user,
  size = 32,
}: {
  user: { name: string; avatarUrl: string | null } | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (user?.avatarUrl && !failed) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={style}
        className="rounded-full object-cover border border-slate-600 shrink-0 bg-slate-800"
      />
    );
  }
  return (
    <span
      style={style}
      className="rounded-full shrink-0 flex items-center justify-center font-bold bg-[#0047A0] text-white border border-[#38bdf8]/30"
      aria-hidden="true"
    >
      {user ? initialsOf(user.name) : '?'}
    </span>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function roomLink(code: string): string {
  return `${window.location.origin}${window.location.pathname}?room=${code}`;
}

export function ConnectionBadge({ status }: { status: SocketStatus }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300" title="Conectado">
        <Wifi className="w-3.5 h-3.5" /> Online
      </span>
    );
  }
  const label =
    status === 'reconnecting'
      ? 'Reconectando...'
      : status === 'closed'
        ? 'Desconectado'
        : 'Conectando...';
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 text-[11px] text-amber-300 animate-pulse"
    >
      <WifiOff className="w-3.5 h-3.5" /> {label}
    </span>
  );
}

interface LobbyProps {
  me: { userId: string; name: string; avatarUrl: string | null };
  online: OnlineUser[];
  rooms: RoomSummary[];
  connection: SocketStatus;
  /** usuario cujo desafio esta aguardando resposta */
  challengingUserId: string | null;
  creatingRoom: boolean;
  sceneRoom: SceneRoomId;
  onSelectSceneRoom: (id: SceneRoomId) => void;
  onChallenge: (userId: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string, asSpectator?: boolean) => void;
  onStartAI: () => void;
  onOpenLeaderboard: () => void;
  onBack: () => void;
}

function playerName(p: PlayerIdentity | null): string {
  return p ? p.name : 'vaga livre';
}

export function Lobby({
  me,
  online,
  rooms,
  connection,
  challengingUserId,
  creatingRoom,
  sceneRoom,
  onSelectSceneRoom,
  onChallenge,
  onCreateRoom,
  onJoinRoom,
  onStartAI,
  onOpenLeaderboard,
  onBack,
}: LobbyProps) {
  const [code, setCode] = useState('');
  const connected = connection === 'ready';
  const others = online.filter((u) => u.userId !== me.userId);
  const mine = online.find((u) => u.userId === me.userId);
  const visibleRooms = rooms.filter((r) => r.phase !== 'finished');

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto p-3 sm:p-6 bg-[#050811]/70">
      <div className="mx-auto w-full max-w-3xl bg-[#0B1222]/96 border border-slate-700/80 rounded-2xl p-4 sm:p-6 shadow-2xl">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
          <h1 className="font-display font-extrabold text-xl text-white mr-auto">Lobby</h1>
          <ConnectionBadge status={connection} />
          <button
            type="button"
            onClick={onOpenLeaderboard}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-amber-300 cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5" /> Leaderboard
          </button>
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 cursor-pointer"
          >
            Voltar
          </button>
        </header>

        {/* Acoes principais */}
        <section className="grid sm:grid-cols-2 gap-2.5 mb-4">
          <button
            type="button"
            onClick={onCreateRoom}
            disabled={!connected || creatingRoom}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#00E676] hover:bg-[#00d16b] disabled:opacity-50 text-slate-950 font-display font-bold text-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {creatingRoom ? 'Criando sala...' : 'Criar sala'}
          </button>
          <button
            type="button"
            onClick={onStartAI}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0047A0] hover:bg-[#0b56b8] border border-[#38bdf8]/30 text-white font-display font-semibold text-sm cursor-pointer"
          >
            <Bot className="w-4 h-4" /> Jogar contra IA
            <span className="text-[10px] font-normal text-sky-200/80">(sem pontos)</span>
          </button>
        </section>

        <form
          className="flex gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c.length >= 3) onJoinRoom(c);
          }}
        >
          <div className="relative flex-1 min-w-0">
            <Link2 className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Entrar por código (ex: ABC234)"
              aria-label="Código da sala"
              maxLength={10}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white font-mono-tabular placeholder:text-slate-500 focus:outline-none focus:border-[#00E676]"
            />
          </div>
          <button
            type="submit"
            disabled={!connected || code.trim().length < 3}
            className="px-4 py-2.5 rounded-xl bg-[#00E5C3] disabled:opacity-50 text-slate-950 font-semibold text-sm hover:bg-[#22f3d2] cursor-pointer whitespace-nowrap shrink-0"
          >
            Entrar
          </button>
        </form>

        <div className="mb-4">
          <div className="text-[11px] font-semibold text-slate-300 mb-1.5">Cenário 3D das suas salas</div>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Cenário 3D">
            {SCENE_ROOMS.map((rm) => (
              <button
                key={rm.id}
                type="button"
                aria-pressed={sceneRoom === rm.id}
                onClick={() => onSelectSceneRoom(rm.id)}
                className={`px-1.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                  sceneRoom === rm.id
                    ? 'bg-[#0047A0] border-[#00E676] text-white'
                    : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:text-white'
                }`}
              >
                {rm.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Usuarios online */}
          <section aria-label="Usuários online">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100 mb-2">
              <Users className="w-4 h-4 text-[#00E5C3]" /> Online ({online.length})
            </h2>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              <li className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-[#0047A0]/25 border border-[#38bdf8]/30">
                <Avatar user={me} />
                <span className="flex-1 min-w-0 truncate text-sm text-white">{me.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#00E676]/20 text-[#00E676] font-semibold">
                  você
                </span>
                {mine?.roomId && <span className="text-[10px] text-slate-400">em partida</span>}
              </li>
              {others.map((u) => {
                const busy = Boolean(u.roomId);
                const waiting = challengingUserId === u.userId;
                return (
                  <li
                    key={u.userId}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800"
                  >
                    <Avatar user={u} />
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-100">{u.name}</span>
                    {busy && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                        em partida
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy || waiting || !connected}
                      onClick={() => onChallenge(u.userId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00E676] disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 text-xs font-bold cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <Swords className="w-3.5 h-3.5" />
                      {waiting ? 'Aguardando' : 'Desafiar'}
                    </button>
                  </li>
                );
              })}
              {others.length === 0 && (
                <li className="text-xs text-slate-400 px-1 py-2">
                  Ninguém mais online agora. Crie uma sala e compartilhe o link!
                </li>
              )}
            </ul>
          </section>

          {/* Salas e partidas */}
          <section aria-label="Salas">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100 mb-2">
              <Link2 className="w-4 h-4 text-[#00E5C3]" /> Salas e partidas ({visibleRooms.length})
            </h2>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {visibleRooms.map((r) => {
                const hasSeat = !r.white || !r.black;
                return (
                  <li
                    key={r.roomId}
                    className="px-2.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono-tabular text-xs text-[#00E5C3] font-bold">{r.roomId}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          r.phase === 'playing'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {r.phase === 'playing' ? 'ao vivo' : 'aberta'}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/60 text-slate-200">
                        {describeTimeControl(r.time)}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300">
                        {r.classic ? 'Clássico' : 'Bold'}
                      </span>
                      {r.spectatorCount > 0 && (
                        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
                          <Eye className="w-3 h-3" /> {r.spectatorCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-300 truncate mb-2">
                      {playerName(r.white)} <span className="text-slate-500">x</span> {playerName(r.black)}
                    </div>
                    <div className="flex gap-1.5">
                      {hasSeat && (
                        <button
                          type="button"
                          disabled={!connected}
                          onClick={() => onJoinRoom(r.roomId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0047A0] hover:bg-[#0b56b8] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                        >
                          <LogIn className="w-3.5 h-3.5" /> Entrar
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!connected}
                        onClick={() => onJoinRoom(r.roomId, true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-100 text-xs font-semibold cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" /> Assistir
                      </button>
                      <button
                        type="button"
                        aria-label={`Copiar link da sala ${r.roomId}`}
                        onClick={() => void copyText(roomLink(r.roomId))}
                        className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
              {visibleRooms.length === 0 && (
                <li className="text-xs text-slate-400 px-1 py-2">Nenhuma sala aberta no momento.</li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Lobby;
