import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trophy, X } from 'lucide-react';
import type { LeaderboardEntry } from '../shared/protocol';

interface MeData {
  rank: number | null;
  stats: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    points: number;
    wins: number;
    losses: number;
    draws: number;
  } | null;
}

interface LeaderboardProps {
  meUserId?: string | null;
  onClose?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-8 h-8 rounded-full object-cover bg-slate-800 shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[#003399] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
      {initials(name)}
    </div>
  );
}

export function Leaderboard({ meUserId, onClose }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const topRes = await fetch('/api/leaderboard?limit=50');
      if (!topRes.ok) throw new Error('top');
      const top = (await topRes.json()) as { entries: LeaderboardEntry[] };
      setEntries(top.entries);
      if (meUserId) {
        try {
          const meRes = await fetch(`/api/leaderboard/me?userId=${encodeURIComponent(meUserId)}`);
          setMe(meRes.ok ? ((await meRes.json()) as MeData) : null);
        } catch {
          setMe(null);
        }
      } else {
        setMe(null);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [meUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const inTop = !!meUserId && !!entries?.some((e) => e.userId === meUserId);
  const showMeOutside = !!me && !!me.stats && !inTop;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-4 bg-[#050811]/82">
      <div className="w-full max-w-md max-h-full flex flex-col bg-[#0B1222] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-[#00E676] text-slate-950 flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4" />
          </div>
          <h2 className="font-display text-lg font-bold text-white flex-1 truncate">Ranking</h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Atualizar"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[8rem]">
          {loading && !entries && (
            <p className="text-center text-sm text-slate-400 py-8">Carregando ranking...</p>
          )}
          {error && (
            <div className="text-center py-8">
              <p className="text-sm text-red-300 mb-3">Não foi possível carregar o ranking.</p>
              <button
                type="button"
                onClick={() => void load()}
                className="px-4 py-2 rounded-xl bg-[#0047A0] hover:bg-[#0b56b8] text-white text-sm font-medium cursor-pointer"
              >
                Tentar novamente
              </button>
            </div>
          )}
          {!error && entries && entries.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">
              Ainda não há partidas pontuadas. Desafie alguém e seja o primeiro!
            </p>
          )}
          {!error && entries && entries.length > 0 && (
            <ol className="flex flex-col gap-1">
              {entries.map((e) => (
                <li key={e.userId}>
                  <Row entry={e} mine={e.userId === meUserId} />
                </li>
              ))}
            </ol>
          )}
        </div>

        {showMeOutside && me?.stats && (
          <div className="border-t border-slate-800 px-2 py-2 bg-[#0B1222]">
            <p className="px-2 pb-1 text-[11px] text-slate-400">Sua posição</p>
            <Row
              mine
              entry={{
                rank: me.rank ?? 0,
                userId: me.stats.userId,
                name: me.stats.name,
                avatarUrl: me.stats.avatarUrl,
                points: me.stats.points,
                wins: me.stats.wins,
                losses: me.stats.losses,
                draws: me.stats.draws,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ entry, mine }: { entry: LeaderboardEntry; mine: boolean }) {
  const medal = entry.rank === 1 ? 'text-yellow-300' : entry.rank === 2 ? 'text-slate-300' : entry.rank === 3 ? 'text-amber-600' : 'text-slate-400';
  return (
    <div
      className={`flex items-center gap-2 px-2 py-2 rounded-xl border ${
        mine ? 'bg-[#00E676]/10 border-[#00E676]/60' : 'bg-slate-900/70 border-slate-800'
      }`}
    >
      <span className={`w-7 text-center font-mono-tabular text-sm font-bold shrink-0 ${medal}`}>
        {entry.rank > 0 ? entry.rank : '-'}
      </span>
      <Avatar name={entry.name} url={entry.avatarUrl} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium truncate">
          {entry.name}
          {mine && <span className="ml-1 text-[10px] text-[#00E676]">(você)</span>}
        </div>
        <div className="text-[11px] text-slate-400 font-mono-tabular">
          {entry.wins}V / {entry.losses}D / {entry.draws}E
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono-tabular text-base font-bold text-[#00E5C3]">{entry.points}</div>
        <div className="text-[10px] text-slate-500">pts</div>
      </div>
    </div>
  );
}

export default Leaderboard;
