// Abstracao de transporte: o App usa GameTransport; GameSocket (WS) e PollingSocket (HTTP) a satisfazem.
import type { ClientMessage } from '../shared/protocol';
import { GameSocket, type SocketEventMap, type SocketStatus } from './socket';
import { PollingSocket } from './pollingSocket';

export type { SocketEventMap, SocketStatus };

export interface GameTransport {
  connect(): void;
  on<K extends keyof SocketEventMap>(type: K, cb: (payload: SocketEventMap[K]) => void): () => void;
  off<K extends keyof SocketEventMap>(type: K, cb: (payload: SocketEventMap[K]) => void): void;
  send(msg: ClientMessage): void;
  close(): void;
  readonly roomId: string | null;
  readonly connectionStatus: SocketStatus;
  readonly isAuthenticated: boolean;
  readonly hasPendingTimers: boolean;
  /** aba ativa/inativa (so o polling usa) */
  setActive?(active: boolean): void;
}

// Verificacao estrutural em tempo de compilacao.
const _ws: GameTransport | null = null as GameSocket | null;
const _poll: GameTransport | null = null as PollingSocket | null;
void _ws;
void _poll;

export function createTransport(opts: { getToken: (forceRefresh?: boolean) => Promise<string> }): GameTransport {
  const kind = (import.meta as unknown as { env?: { VITE_TRANSPORT?: string } }).env?.VITE_TRANSPORT;
  if (kind === 'ws') return new GameSocket({ getToken: opts.getToken });
  return new PollingSocket({ getToken: opts.getToken });
}
