import { useEffect, useMemo, useState } from 'react';
import { SPECIAL_BY_ID, SpecialId } from '../game/types';
import { SPECIAL_PREVIEW, type Sq } from '../game/specialPreview';

const STEP_MS = 1500; // duracao de cada cena
const MOVE_AT_MS = 450; // quando a peca comeca a se mover dentro da cena

function pct(n: number) {
  return `${(n / 8) * 100}%`;
}

interface MovePreviewProps {
  specialId: SpecialId;
  /** lado em px do mini-tabuleiro */
  size?: number;
  /** mostra a legenda da cena */
  showCaption?: boolean;
}

/** Mini-tabuleiro 8x8 com a peca se movendo no padrao da peca especial. */
export function MovePreview({ specialId, size = 168, showCaption = true }: MovePreviewProps) {
  const scenes = SPECIAL_PREVIEW[specialId];
  const meta = SPECIAL_BY_ID[specialId];
  const [idx, setIdx] = useState(0);
  const [moved, setMoved] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    try {
      setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      /* sem matchMedia */
    }
  }, []);

  useEffect(() => {
    if (reduced) return;
    setIdx(0);
    setMoved(false);
    let i = 0;
    const timers: number[] = [];
    const run = () => {
      setIdx(i);
      setMoved(false);
      timers.push(window.setTimeout(() => setMoved(true), MOVE_AT_MS));
      timers.push(
        window.setTimeout(() => {
          i = (i + 1) % scenes.length;
          run();
        }, STEP_MS)
      );
    };
    run();
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [specialId, scenes.length, reduced]);

  const scene = scenes[idx];
  const pos: Sq = reduced || !moved ? scene.from : scene.to;
  // Quique: passa primeiro pelos pontos intermediarios.
  const bounceStyle = useMemo(() => {
    if (!scene.via || !moved || reduced) return undefined;
    const pts = [scene.from, ...scene.via, scene.to];
    const frames = pts
      .map((p, k) => `${(k / (pts.length - 1)) * 100}% { top: ${pct(p[0])}; left: ${pct(p[1])}; }`)
      .join(' ');
    return { name: `bounce_${specialId}_${idx}`, css: `@keyframes bounce_${specialId}_${idx} { ${frames} }` };
  }, [scene, moved, reduced, specialId, idx]);

  const cell = size / 8;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {bounceStyle && <style>{bounceStyle.css}</style>}
      <div
        className="relative rounded-md overflow-hidden border border-slate-700 shadow-inner"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Demonstração do movimento de ${meta.name}: ${meta.movementSummary}`}
      >
        {/* casas */}
        <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
          {Array.from({ length: 64 }, (_, k) => {
            const r = Math.floor(k / 8);
            const c = k % 8;
            return <div key={k} style={{ backgroundColor: (r + c) % 2 === 0 ? '#1E2A44' : '#142036' }} />;
          })}
        </div>

        {/* destinos possiveis */}
        {scene.targets.map(([r, c]) => (
          <div
            key={`t${idx}-${r}-${c}`}
            className="absolute flex items-center justify-center pointer-events-none"
            style={{ top: pct(r), left: pct(c), width: cell, height: cell }}
          >
            <span
              className="rounded-full"
              style={{
                width: cell * 0.36,
                height: cell * 0.36,
                backgroundColor: `${meta.accentColor}`,
                opacity: 0.75,
              }}
            />
          </div>
        ))}

        {/* obstaculos / pecas inimigas */}
        {scene.blockers?.map(([r, c]) => (
          <div
            key={`b${idx}-${r}-${c}`}
            className="absolute flex items-center justify-center pointer-events-none"
            style={{ top: pct(r), left: pct(c), width: cell, height: cell }}
          >
            <span
              className="rounded-sm bg-slate-500/80 border border-slate-300/40"
              style={{ width: cell * 0.55, height: cell * 0.55 }}
            />
          </div>
        ))}

        {/* a peca */}
        <div
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            top: pct(pos[0]),
            left: pct(pos[1]),
            width: cell,
            height: cell,
            transition: bounceStyle || reduced ? undefined : `top 520ms ease-in-out, left 520ms ease-in-out`,
            animation: bounceStyle ? `${bounceStyle.name} 700ms ease-in-out forwards` : undefined,
            zIndex: 2,
          }}
        >
          <span
            className="rounded-full flex items-center justify-center font-bold text-white shadow-lg"
            style={{
              width: cell * 0.82,
              height: cell * 0.82,
              fontSize: cell * 0.5,
              backgroundColor: meta.accentColor,
              border: `2px solid ${meta.secondaryColor}`,
              transform: scene.jump && moved ? 'scale(1.25) translateY(-3px)' : 'scale(1)',
              transition: 'transform 260ms ease-out',
            }}
          >
            {meta.emblemChar}
          </span>
        </div>
      </div>
      {showCaption && (
        <div className="min-h-[1.5rem] text-[10px] leading-tight text-slate-400 text-center px-1" style={{ width: size }}>
          {scene.caption ?? ''}
        </div>
      )}
    </div>
  );
}
