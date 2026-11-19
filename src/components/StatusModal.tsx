import { RotateCcw, Trophy } from 'lucide-react';
import { GameState } from '../game/types';

interface StatusModalProps {
  status: 'paused' | 'gameover';
  gameState: GameState;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export function StatusModal({
  status,
  gameState,
  onResume,
  onRestart,
  onReturnTitle,
}: StatusModalProps) {
  const isGameOver = status === 'gameover';
  const totalMoves = gameState.history.length;
  const totalCaptures =
    gameState.capturedBy.w.length + gameState.capturedBy.b.length;
  const specialsUsed =
    gameState.usedSpecials.w.length + gameState.usedSpecials.b.length;

  let title = 'Partida Pausada';
  let subtitle = 'O tabuleiro aguarda a próxima jogada.';

  if (isGameOver) {
    if (gameState.winner === 'draw') {
      if (gameState.endReason === 'insufficient_material') {
        title = 'Empate — Material Insuficiente';
        subtitle = 'Não há mais peças suficientes para nenhum jogador vencer.';
      } else if (gameState.endReason === 'threefold') {
        title = 'Empate — Repetição Tripla';
        subtitle = 'A mesma posição se repetiu 3 vezes no tabuleiro.';
      } else if (gameState.endReason === 'fifty_move') {
        title = 'Empate — Regra dos 50 Lances';
        subtitle = '50 lances seguidos sem avanço de peão nem captura.';
      } else {
        title = 'Empate por Afogamento';
        subtitle = 'Nenhum lance legal disponível sem xeque.';
      }
    } else if (gameState.winner === 'w') {
      title = 'Vitória das Brancas!';
      subtitle =
        gameState.endReason === 'timeout'
          ? 'O tempo das Pretas acabou.'
          : gameState.endReason === 'resign'
            ? 'As Pretas desistiram da partida.'
            : 'Xeque-mate! Não há mais defesa possível para as Pretas.';
    } else {
      title = 'Vitória das Pretas!';
      subtitle =
        gameState.endReason === 'timeout'
          ? 'O tempo das Brancas acabou.'
          : gameState.endReason === 'resign'
            ? 'As Brancas desistiram da partida.'
            : 'Xeque-mate! Não há mais defesa possível para as Brancas.';
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#050811]/82">
      <div className="w-full max-w-md bg-[#0B1222] border border-slate-700/80 rounded-2xl p-6 shadow-2xl text-center">
        <div className="flex justify-center mb-4">
          {isGameOver ? (
            <div className="relative">
              <img
                src="/assets/aistudio/image_45bb4b06.png"
                alt="Robôzinho da Bold"
                referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-2xl object-cover border-2 border-[#00E676] bg-[#003399]"
              />
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-lg bg-[#00E676] text-slate-950 flex items-center justify-center shadow-lg">
                <Trophy className="w-4 h-4" />
              </div>
            </div>
          ) : (
            <img
              src="/assets/aistudio/image_3c54a752.png"
              alt="Bold Solution"
              referrerPolicy="no-referrer"
              className="h-10 w-auto object-contain bg-white/95 rounded-lg px-3 py-1"
            />
          )}
        </div>

        <h2 className="font-display text-2xl font-bold text-white mb-1">{title}</h2>
        <p className="text-sm text-slate-400 mb-5">{subtitle}</p>

        {/* Mastery / Match Stat Tiles */}
        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="font-mono-tabular text-xl font-bold text-white">
              {totalMoves}
            </div>
            <div className="text-[11px] text-slate-400">Lances</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="font-mono-tabular text-xl font-bold text-[#00E5C3]">
              {totalCaptures}
            </div>
            <div className="text-[11px] text-slate-400">Capturas</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="font-mono-tabular text-xl font-bold text-[#00E676]">
              {specialsUsed}
            </div>
            <div className="text-[11px] text-slate-400">Especiais</div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {!isGameOver && (
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 rounded-xl bg-[#00E676] hover:bg-[#00d16b] text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer"
            >
              Continuar Partida
            </button>
          )}
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className={`w-full py-3 rounded-xl font-display font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              isGameOver
                ? 'bg-[#00E676] hover:bg-[#00d16b] text-slate-950'
                : 'bg-[#0047A0] hover:bg-[#0b56b8] text-white'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            Jogar Novamente
          </button>
          <button
            type="button"
            onClick={onReturnTitle}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-colors cursor-pointer"
          >
            Voltar ao Início
          </button>
        </div>
      </div>
    </div>
  );
}
