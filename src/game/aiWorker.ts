import { AIDifficulty, chooseConvocation, searchBestMove } from './ai';
import { resolveConvocation } from './engine';
import { Color, GameState } from './types';

interface AIWorkerRequest {
  requestId: number;
  state: GameState;
  aiColor: Color;
  level?: AIDifficulty;
  /** tempo maximo de pensamento nesta jogada (ex.: pouco relogio restante) */
  timeBudgetMs?: number;
}

self.onmessage = (event: MessageEvent<AIWorkerRequest>) => {
  const { requestId, state, aiColor, level = 'medio', timeBudgetMs } = event.data;

  if (state.pendingConvocation && state.pendingConvocation.color === aiColor) {
    const choice = chooseConvocation(state, aiColor, level, { timeBudgetMs });
    const next = resolveConvocation(state, choice);
    self.postMessage({ requestId, convocationChoice: choice, nextState: next });
    return;
  }

  const res = searchBestMove(state, aiColor, level, { timeBudgetMs });
  self.postMessage({ requestId, move: res.move, info: { depth: res.depth, score: res.score, nodes: res.nodes, ms: res.ms } });
};
