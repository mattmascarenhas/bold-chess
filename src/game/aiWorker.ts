import { chooseBestAIMove, resolveConvocation } from './engine';
import { Color, GameState } from './types';

interface AIWorkerRequest {
  requestId: number;
  state: GameState;
  aiColor: Color;
  depth?: number;
}

self.onmessage = (event: MessageEvent<AIWorkerRequest>) => {
  const { requestId, state, aiColor, depth = 3 } = event.data;

  if (state.pendingConvocation && state.pendingConvocation.color === aiColor) {
    const av = state.pendingConvocation.availableSpecials;
    const choice = av.length > 0 ? av[0] : state.pendingConvocation.isLastRank ? 'q' : 'keep_pawn';
    const next = resolveConvocation(state, choice);
    self.postMessage({ requestId, convocationChoice: choice, nextState: next });
    return;
  }

  const move = chooseBestAIMove(state, aiColor, depth);
  self.postMessage({ requestId, move });
};
