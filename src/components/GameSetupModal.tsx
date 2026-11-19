import { useMemo, useState } from 'react';
import { Clock, Infinity as InfinityIcon, X } from 'lucide-react';
import {
  MAX_BASE_MS,
  MAX_INCREMENT_MS,
  MIN_BASE_MS,
  TIME_PRESETS,
  describeTimeControl,
  parseTimeControl,
} from '../game/clock';
import type { TimeControl } from '../game/types';

const STORAGE_KEY = 'bold-chess:time-control';

/** Ultima escolha do usuario (mantida so neste navegador). */
export function loadLastTimeControl(): TimeControl | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = parseTimeControl(JSON.parse(raw));
    return p.ok ? p.tc : null;
  } catch {
    return null;
  }
}

export function saveLastTimeControl(tc: TimeControl | null): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tc));
  } catch {
    /* storage indisponivel: ignora */
  }
}

interface GameSetupModalProps {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  onConfirm: (tc: TimeControl | null) => void;
  onCancel: () => void;
}

const sameTc = (a: TimeControl | null, b: TimeControl | null) =>
  a === b || (!!a && !!b && a.baseMs === b.baseMs && a.incrementMs === b.incrementMs);

/** Escolha do modo antes de comecar: livre (sem tempo) ou com tempo (preset ou personalizado). */
export function GameSetupModal({ title, subtitle, confirmLabel, onConfirm, onCancel }: GameSetupModalProps) {
  const initial = useMemo(loadLastTimeControl, []);
  const [timed, setTimed] = useState<boolean>(initial !== null);
  const [tc, setTc] = useState<TimeControl>(initial ?? TIME_PRESETS[3].tc);
  const [customMin, setCustomMin] = useState<string>(String(Math.round((initial ?? TIME_PRESETS[3].tc).baseMs / 60_000)));
  const [customInc, setCustomInc] = useState<string>(String(Math.round((initial ?? TIME_PRESETS[3].tc).incrementMs / 1000)));

  const presetActive = TIME_PRESETS.find((p) => sameTc(p.tc, tc));

  const applyCustom = (minStr: string, incStr: string) => {
    setCustomMin(minStr);
    setCustomInc(incStr);
    const m = Number(minStr.replace(',', '.'));
    const i = Number(incStr);
    if (!Number.isFinite(m) || !Number.isFinite(i)) return;
    const parsed = parseTimeControl({ baseMs: Math.round(m * 60_000), incrementMs: Math.round(i * 1000) });
    if (parsed.ok && parsed.tc) setTc(parsed.tc);
  };

  const customValid = useMemo(() => {
    const m = Number(customMin.replace(',', '.'));
    const i = Number(customInc);
    const p = parseTimeControl({ baseMs: Math.round(m * 60_000), incrementMs: Math.round(i * 1000) });
    return p.ok && !!p.tc;
  }, [customMin, customInc]);

  const choose = (preset: TimeControl) => {
    setTc(preset);
    setCustomMin(String(preset.baseMs / 60_000));
    setCustomInc(String(preset.incrementMs / 1000));
  };

  const canConfirm = !timed || customValid || !!presetActive;
  const confirm = () => {
    const result = timed ? tc : null;
    saveLastTimeControl(result);
    onConfirm(result);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050811]/85"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#0B1222] border border-[#00E676]/40 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="text-xs font-semibold text-slate-300 mb-2">Modo de jogo</div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTimed(false)}
                aria-pressed={!timed}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  !timed
                    ? 'bg-[#00E676]/12 border-[#00E676] text-white'
                    : 'bg-[#111C33] border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <InfinityIcon className="w-5 h-5 mb-1.5 text-[#00E676]" />
                <div className="font-display font-bold text-sm">Livre</div>
                <div className="text-[11px] text-slate-400 leading-snug">Sem relógio. Jogue no seu ritmo.</div>
              </button>
              <button
                type="button"
                onClick={() => setTimed(true)}
                aria-pressed={timed}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  timed
                    ? 'bg-[#00E676]/12 border-[#00E676] text-white'
                    : 'bg-[#111C33] border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <Clock className="w-5 h-5 mb-1.5 text-[#00E676]" />
                <div className="font-display font-bold text-sm">Com tempo</div>
                <div className="text-[11px] text-slate-400 leading-snug">Relógio para cada jogador. Quem zera perde.</div>
              </button>
            </div>
          </div>

          {timed && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-300 mb-2">Tempo por jogador</div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {TIME_PRESETS.map((p) => {
                    const active = sameTc(p.tc, tc);
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => choose(p.tc)}
                        aria-pressed={active}
                        className={`py-2 rounded-lg border text-sm font-semibold tabular-nums transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#00E676] border-[#00E676] text-[#04210F]'
                            : 'bg-slate-800 border-slate-600 text-white hover:bg-slate-700'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">“3 | 2” = 3 minutos + 2 segundos a cada jogada.</p>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-300 mb-2">Personalizado</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] text-slate-400">
                    Minutos ({MIN_BASE_MS / 60_000} a {MAX_BASE_MS / 60_000})
                    <input
                      type="number"
                      inputMode="decimal"
                      min={MIN_BASE_MS / 60_000}
                      max={MAX_BASE_MS / 60_000}
                      step={0.5}
                      value={customMin}
                      onChange={(e) => applyCustom(e.target.value, customInc)}
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm tabular-nums focus:outline-none focus:border-[#00E676]"
                    />
                  </label>
                  <label className="text-[11px] text-slate-400">
                    Acréscimo por jogada (0 a {MAX_INCREMENT_MS / 1000}s)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_INCREMENT_MS / 1000}
                      step={1}
                      value={customInc}
                      onChange={(e) => applyCustom(customMin, e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm tabular-nums focus:outline-none focus:border-[#00E676]"
                    />
                  </label>
                </div>
                {!customValid && (
                  <p className="text-[11px] text-red-400 mt-1.5">
                    Use de {MIN_BASE_MS / 60_000} a {MAX_BASE_MS / 60_000} minutos e acréscimo de 0 a {MAX_INCREMENT_MS / 1000} segundos.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="text-xs text-slate-400">
              Modo escolhido:{' '}
              <span className="font-semibold text-[#00E676]">{timed ? describeTimeControl(tc) : 'Livre (sem tempo)'}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold border border-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!canConfirm}
                className="px-5 py-2 rounded-xl bg-[#00E676] hover:bg-[#33F08F] disabled:opacity-40 disabled:cursor-not-allowed text-[#04210F] text-sm font-bold cursor-pointer"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
