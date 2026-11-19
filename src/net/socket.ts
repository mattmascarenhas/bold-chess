// Cliente WebSocket tipado: auth, fila, reconexao com backoff, resume e ping.
import type { ClientMessage, ServerMessage, Seat } from '../shared/protocol';

export type SocketStatus = 'idle' | 'connecting' | 'authenticating' | 'ready' | 'reconnecting' | 'closed';

/** Subconjunto de WebSocket usado aqui (compativel com o do browser e com o do pacote `ws`). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketEventMap = {
  [T in ServerMessage['type']]: Extract<ServerMessage, { type: T }>;
} & {
  status: SocketStatus;
  message: ServerMessage;
};

export interface GameSocketOptions {
  getToken: (forceRefresh?: boolean) => Promise<string>;
  url?: string;
  createWebSocket?: (url: string) => WebSocketLike;
  pingIntervalMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** injetavel para testes; deve retornar [0,1) */
  random?: () => number;
  maxQueue?: number;
}

type Listener<K extends keyof SocketEventMap> = (payload: SocketEventMap[K]) => void;

import { wsUrl } from './serverUrl';

const WS_OPEN = 1;
const MAX_CONSECUTIVE_EXPIRED = 3;

export function defaultSocketUrl(): string {
  return wsUrl();
}

export class GameSocket {
  private readonly opts: Required<
    Pick<GameSocketOptions, 'pingIntervalMs' | 'backoffMinMs' | 'backoffMaxMs' | 'maxQueue'>
  > &
    GameSocketOptions;
  private ws: WebSocketLike | null = null;
  private status: SocketStatus = 'idle';
  private listeners = new Map<string, Set<(p: never) => void>>();
  private queue: ClientMessage[] = [];
  private authenticated = false;
  private closedByUser = false;
  private fatal = false;
  private attempt = 0;
  private expiredStreak = 0;
  private forceNextToken = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private currentRoom: { roomId: string; seat: Seat } | null = null;
  private generation = 0;

  constructor(options: GameSocketOptions) {
    this.opts = {
      pingIntervalMs: 25_000,
      backoffMinMs: 500,
      backoffMaxMs: 8_000,
      maxQueue: 50,
      ...options,
    };
  }

  // ---------- API publica ----------
  get connectionStatus(): SocketStatus {
    return this.status;
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  get roomId(): string | null {
    return this.currentRoom?.roomId ?? null;
  }

  /** true se ainda ha timers pendentes (usado pelos testes de vazamento). */
  get hasPendingTimers(): boolean {
    return this.reconnectTimer !== null || this.pingTimer !== null;
  }

  connect(): void {
    if (this.closedByUser) return;
    if (this.ws || this.reconnectTimer) return;
    this.open();
  }

  on<K extends keyof SocketEventMap>(type: K, cb: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb as (p: never) => void);
    return () => this.off(type, cb);
  }

  off<K extends keyof SocketEventMap>(type: K, cb: Listener<K>): void {
    this.listeners.get(type)?.delete(cb as (p: never) => void);
  }

  /** Envia agora se autenticado; senao enfileira (ping nao e enfileirado). */
  send(msg: ClientMessage): void {
    this.trackOutgoing(msg);
    if (this.authenticated && this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    if (msg.type === 'ping' || msg.type === 'auth') return;
    if (this.queue.length >= this.opts.maxQueue) this.queue.shift();
    this.queue.push(msg);
  }

  close(): void {
    this.closedByUser = true;
    this.generation++;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.authenticated = false;
    this.queue = [];
    if (ws) {
      this.detach(ws);
      try {
        ws.close();
      } catch {
        /* ja fechado */
      }
    }
    this.setStatus('closed');
    this.listeners.clear();
  }

  // ---------- internos ----------
  private emit<K extends keyof SocketEventMap>(type: K, payload: SocketEventMap[K]) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<K>)(payload);
      } catch (err) {
        console.error('[GameSocket] listener falhou', err);
      }
    }
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private trackOutgoing(msg: ClientMessage) {
    if (msg.type === 'leave') this.currentRoom = null;
    else if (msg.type === 'join') {
      // marca intencao; confirmada (ou limpa) pelo servidor
      this.currentRoom = { roomId: msg.roomId, seat: msg.asSpectator ? 'spectator' : 'w' };
    }
  }

  private open() {
    const gen = ++this.generation;
    this.setStatus(this.attempt === 0 && this.status !== 'reconnecting' ? 'connecting' : 'reconnecting');
    let ws: WebSocketLike;
    try {
      const url = this.opts.url ?? defaultSocketUrl();
      ws = this.opts.createWebSocket ? this.opts.createWebSocket(url) : (new WebSocket(url) as unknown as WebSocketLike);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (gen !== this.generation) return;
      this.setStatus('authenticating');
      const force = this.forceNextToken;
      this.forceNextToken = false;
      this.opts
        .getToken(force)
        .then((token) => {
          if (gen !== this.generation || this.ws !== ws) return;
          ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientMessage));
        })
        .catch(() => {
          if (gen !== this.generation || this.ws !== ws) return;
          // sem token (ex.: bridge em timeout): derruba e tenta de novo com backoff
          try {
            ws.close();
          } catch {
            /* noop */
          }
        });
    };

    ws.onmessage = (ev) => {
      if (gen !== this.generation) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg, ws);
    };

    ws.onclose = () => {
      if (gen !== this.generation || this.ws !== ws) return;
      this.onDropped();
    };
    ws.onerror = () => {
      /* o onclose subsequente cuida da reconexao */
    };
  }

  private handle(msg: ServerMessage, ws: WebSocketLike) {
    switch (msg.type) {
      case 'auth_ok':
        this.authenticated = true;
        this.attempt = 0;
        this.expiredStreak = 0;
        this.setStatus('ready');
        this.startPing();
        this.flushQueue(ws, this.resumeRoom(ws));
        break;
      case 'auth_error':
        this.authenticated = false;
        if (msg.code === 'expired_token' && this.expiredStreak < MAX_CONSECUTIVE_EXPIRED) {
          this.expiredStreak++;
          this.forceNextToken = true;
          this.emit('auth_error', msg);
          this.emit('message', msg);
          this.dropForRetry(ws, true);
          return;
        }
        if (msg.code !== 'auth_unavailable') this.fatal = true;
        this.emit('auth_error', msg);
        this.emit('message', msg);
        if (this.fatal) {
          this.dropSilently(ws);
          this.setStatus('closed');
        } else {
          this.dropForRetry(ws, false);
        }
        return;
      case 'joined':
        this.currentRoom = { roomId: msg.roomId, seat: msg.yourSeat };
        break;
      case 'left':
        this.currentRoom = null;
        break;
      case 'error':
        if (msg.code === 'room_not_found') this.currentRoom = null;
        break;
      default:
        break;
    }
    this.emit(msg.type as keyof SocketEventMap, msg as never);
    this.emit('message', msg);
  }

  private resumeRoom(ws: WebSocketLike): string | null {
    if (!this.currentRoom) return null;
    const { roomId, seat } = this.currentRoom;
    const msg: ClientMessage = { type: 'join', roomId, asSpectator: seat === 'spectator' ? true : undefined };
    ws.send(JSON.stringify(msg));
    return roomId;
  }

  private flushQueue(ws: WebSocketLike, resumedRoom: string | null) {
    const pending = this.queue;
    this.queue = [];
    for (const m of pending) {
      // um join enfileirado ja foi coberto pelo resume se for da mesma sala
      if (m.type === 'join' && m.roomId === resumedRoom) continue;
      ws.send(JSON.stringify(m));
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.authenticated && this.ws && this.ws.readyState === WS_OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
      }
    }, this.opts.pingIntervalMs);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers() {
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private detach(ws: WebSocketLike) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  private dropSilently(ws: WebSocketLike) {
    this.generation++;
    this.detach(ws);
    this.ws = null;
    this.stopPing();
    try {
      ws.close();
    } catch {
      /* noop */
    }
  }

  private dropForRetry(ws: WebSocketLike, immediate: boolean) {
    this.dropSilently(ws);
    this.authenticated = false;
    this.scheduleReconnect(immediate);
  }

  private onDropped() {
    this.ws = null;
    this.authenticated = false;
    this.stopPing();
    if (this.closedByUser || this.fatal) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(immediate = false) {
    if (this.closedByUser || this.fatal || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    const { backoffMinMs, backoffMaxMs } = this.opts;
    const rnd = (this.opts.random ?? Math.random)();
    const base = Math.min(backoffMaxMs, backoffMinMs * 2 ** this.attempt);
    // jitter: 50%..100% do valor exponencial
    const delay = immediate ? 0 : Math.round(base * (0.5 + rnd * 0.5));
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser) return;
      this.open();
    }, delay);
  }
}
