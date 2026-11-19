import { Crown, Sparkles } from 'lucide-react';
import {
  CLASSIC_NAMES,
  ClassicKind,
  PendingConvocation,
  SPECIAL_BY_ID,
  SpecialId,
} from '../game/types';

interface ConvocationModalProps {
  pending: PendingConvocation;
  usedCount: number;
  maxSpecials?: number;
  onResolve: (choice: SpecialId | ClassicKind | 'keep_pawn') => void;
}

export function ConvocationModal({
  pending,
  usedCount,
  maxSpecials = 3,
  onResolve,
}: ConvocationModalProps) {
  const { isLastRank, availableSpecials } = pending;
  const remainingSlots = Math.max(0, maxSpecials - usedCount);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#050811]/82">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-[#0B1222] border border-[#00E676]/50 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#00E676]/15 border border-[#00E676]/50 flex items-center justify-center text-[#00E676] shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-lg md:text-xl font-bold text-white">
                {isLastRank ? 'Promoção na Última Fileira' : 'Convocação na 6ª Fileira'}
              </h3>
              <p className="text-xs text-slate-400">
                {isLastRank
                  ? 'Escolha uma peça clássica ou convoque 1 das 10 peças especiais da Bold.'
                  : 'Momento especial! Convoque 1 peça da equipe Bold agora ou continue rumo à Dama.'}
              </p>
            </div>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-[#0047A0]/35 border border-[#38BDF8]/30 text-xs font-semibold text-[#00E676] tabular-nums">
            Escolhas usadas: {usedCount}/{maxSpecials} · Restam {remainingSlots}
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* Special Roster Options */}
          {availableSpecials.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-[#00E676] mb-2.5">
                Escolha uma das {availableSpecials.length} Peças Especiais Disponíveis
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {availableSpecials.map((spId) => {
                  const meta = SPECIAL_BY_ID[spId];
                  return (
                    <button
                      key={spId}
                      type="button"
                      onClick={() => onResolve(spId)}
                      className="p-3 rounded-xl bg-[#111C33] hover:bg-[#172645] border border-slate-700 hover:border-[#00E676] text-left transition-colors cursor-pointer flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span
                            className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                            style={{
                              backgroundColor: `${meta.accentColor}26`,
                              border: `1px solid ${meta.accentColor}66`,
                              color: meta.accentColor,
                            }}
                          >
                            {meta.emblemChar}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate">
                            {meta.person}
                          </span>
                        </div>
                        <div className="font-display font-bold text-sm text-white">
                          {meta.name}
                        </div>
                        <p className="text-[11px] text-slate-300 leading-snug mt-1">
                          {meta.movementSummary}
                        </p>
                      </div>

                      {meta.abilityName && (
                        <div className="pt-1.5 border-t border-slate-800/90 text-[10px] text-[#00E5C3] leading-snug">
                          <span className="font-semibold">{meta.abilityName}:</span>{' '}
                          {meta.abilitySummary}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-400">
              {usedCount >= maxSpecials
                ? `Limite de ${maxSpecials} peças especiais atingido nesta partida.`
                : 'Você já possui 1 peça especial em campo no momento.'}
            </div>
          )}

          {/* Classic Promotion on Last Rank OR Keep Pawn on 6th Rank */}
          {isLastRank ? (
            <div className="mt-5 pt-4 border-t border-slate-800">
              <div className="text-xs font-semibold text-slate-300 mb-2">Promoção Clássica</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['q', 'r', 'b', 'n'] as ClassicKind[]).map((ck) => (
                  <button
                    key={ck}
                    type="button"
                    onClick={() => onResolve(ck)}
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {ck === 'q' && <Crown className="w-4 h-4 text-amber-400" />}
                    {CLASSIC_NAMES[ck]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 pt-4 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => onResolve('keep_pawn')}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold border border-slate-600 transition-colors cursor-pointer"
              >
                Manter como Peão (ir até a Dama)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
