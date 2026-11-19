// Transporte HTTP por polling (funcoes serverless). Mesma API publica do GameSocket.
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import {
  DEFAULT_POLL,
  EMPTY_POS,
  type AuthResponse,
  type HttpError,
  type PollIntervals,
  type Pos,
  type ViewResponse,
} from '../shared/http-protocol';
import type { SocketEventMap, SocketStatus } from './socket';
import { httpBase } from './serverUrl';

export type { SocketEventMap, SocketStatus };

export interface PollingSocketOptions {
  getToken: (forceRefresh?: boolean) => Promise<string>;
  /** base HTTP (default: httpBase(); vazio => mesma origem) */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  intervals?: Partial<PollIntervals>;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  /** deve retornar [0,1) */
  random?: () => number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  maxQueue?: number;
}

type Listener<K extends keyof SocketEventMap> = (payload: SocketEventMap[K]) => void;
type OutMsg = Exclude<ClientMessage, { type: 'auth' }>;

const MAX_REAUTH_STREAK = 3;

interface CallResult {
  status: number;
  data: unknown;
}

export class PollingSocket {
  private readonly getToken: (forceRefresh?: boolean) => Promise<string>;
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (h: unknown) => void;
  private readonly rnd: () => number;
  private readonly backoffMin: number;
  private readonly backoffMax: number;
  private readonly maxQueue: number;
  private readonly overrides: Partial<PollIntervals>;

  private status: SocketStatus = 'idle';
  private listeners = new Map<string, Set<(p: never) => void>>();
  private queue: OutMsg[] = [];
  private session: string | null = null;
  private pollMs: PollIntervals = { ...DEFAULT_POLL };
  private pos: Pos = { ...EMPTY_POS };
  private active = true;
  private authenticated = false;
  private started = false;
  private closed = false;
  private fatal = false;
  private inFlight = false;
  private pollNow = false;
  private timer: unknown = null;
  private abort: AbortController | null = null;
  private gen = 0;
  private attempt = 0;
  private forceToken = false;
  private reauthStreak = 0;
  private expiredStreak = 0;

  constructor(options: PollingSocketOptions) {
    this.getToken = options.getToken;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.setT = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = options.clearTimeoutImpl ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.rnd = options.random ?? Math.random;
    this.backoffMin = options.backoffMinMs ?? 500;
    this.backoffMax = options.backoffMaxMs ?? 8_000;
    this.maxQueue = options.maxQueue ?? 50;
    this.overrides = options.intervals ?? {};
  }

  // ---------- API publica ----------
  get connectionStatus(): SocketStatus {
    return this.status;
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  get roomId(): string | null {
    return this.pos.roomId;
  }

  /** true se ha timer ou requisicao em voo (usado pelos testes de vazamento). */
  get hasPendingTimers(): boolean {
    return this.timer !== null || this.abort !== null;
  }

  connect(): void {
    if (this.closed || this.started) return;
    this.started = true;
    this.setStatus('connecting');
    this.kick();
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

  send(msg: ClientMessage): void {
    if (this.closed) return;
    if (msg.type === 'ping' || msg.type === 'auth') return;
    if (msg.type === 'lobby_list') {
      // so dispara um poll imediato
      if (this.canRunNow()) {
        this.clearTimer();
        this.kick();
      } else {
        this.pollNow = true; // em voo/sem sessao: poll logo apos o passo atual
      }
      return;
    }
    if (this.queue.length >= this.maxQueue) this.queue.shift();
    this.queue.push(msg);
    if (this.canRunNow()) {
      this.clearTimer();
      this.kick();
    }
  }

  /** Aba ativa/inativa: inativa usa o intervalo idle. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (this.closed || !this.started || this.fatal || this.inFlight) return;
    if (this.timer === null) return; // backoff/auth em andamento nao existe sem timer; nada a fazer
    this.clearTimer();
    if (active) this.kick();
    else this.schedule(this.interval());
  }

  close(): void {
    this.closed = true;
    this.gen++;
    this.clearTimer();
    this.abortInFlight();
    this.queue = [];
    this.session = null;
    this.authenticated = false;
    this.inFlight = false;
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
        console.error('[PollingSocket] listener falhou', err);
      }
    }
  }

  private emitMsg(msg: ServerMessage) {
    this.emit(msg.type as keyof SocketEventMap, msg as never);
    this.emit('message', msg);
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private url(path: string): string {
    return `${this.baseUrl ?? httpBase()}${path}`;
  }

  private interval(): number {
    const p = { ...this.pollMs, ...this.overrides };
    if (!this.active) return p.idle;
    return this.pos.roomId ? p.game : p.lobby;
  }

  private canRunNow(): boolean {
    return this.started && !this.fatal && !this.inFlight && this.session !== null;
  }

  private clearTimer() {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }

  private abortInFlight() {
    const ac = this.abort;
    this.abort = null;
    if (ac) ac.abort();
  }

  private schedule(ms: number) {
    this.clearTimer();
    if (this.closed || this.fatal) return;
    this.timer = this.setT(() => {
      this.timer = null;
      this.kick();
    }, ms);
  }

  private kick() {
    if (this.closed || this.fatal || this.inFlight) return;
    this.inFlight = true;
    void this.pump();
  }

  private backoff(): number {
    const base = Math.min(this.backoffMax, this.backoffMin * 2 ** this.attempt);
    this.attempt++;
    return Math.round(base * (0.5 + this.rnd() * 0.5));
  }

  private async call(path: string, body: unknown, session?: string): Promise<CallResult> {
    const ac = new AbortController();
    this.abort = ac;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session) headers.Authorization = `Bearer ${session}`;
      const res = await this.fetchImpl(this.url(path), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* corpo vazio/invalido */
      }
      return { status: res.status, data };
    } finally {
      if (this.abort === ac) this.abort = null;
    }
  }

  /** Um passo serializado: auth, send ou poll. Nunca ha dois em voo. */
  private async pump() {
    const gen = this.gen;
    let delay: number | null = null; // null => intervalo normal; 0 => imediato
    try {
      if (!this.session) delay = await this.authStep(gen);
      else if (this.queue.length > 0) delay = await this.sendStep(gen);
      else delay = await this.pollStep(gen);
    } catch {
      if (gen !== this.gen) return;
      this.setStatus('reconnecting');
      delay = this.backoff();
    }
    if (gen !== this.gen) return;
    this.inFlight = false;
    if (this.fatal) return;
    if (delay !== null) {
      if (delay === 0) this.kick();
      else this.schedule(delay);
      return;
    }
    if (this.pollNow || (this.session && this.queue.length > 0)) {
      this.pollNow = false;
      this.kick();
      return;
    }
    this.schedule(this.interval());
  }

  private async authStep(gen: number): Promise<number | null> {
    if (this.status !== 'reconnecting') this.setStatus('authenticating');
    const force = this.forceToken;
    this.forceToken = false;
    let token: string;
    try {
      token = await this.getToken(force);
    } catch {
      if (gen !== this.gen) return null;
      this.setStatus('reconnecting');
      return this.backoff();
    }
    if (gen !== this.gen) return null;
    const { status, data } = await this.call('/api/auth', { ssoToken: token });
    if (gen !== this.gen) return null;

    if (status === 200 && data && typeof (data as AuthResponse).session === 'string') {
      const r = data as AuthResponse;
      this.session = r.session;
      if (r.pollMs) this.pollMs = { ...DEFAULT_POLL, ...r.pollMs };
      this.attempt = 0;
      this.expiredStreak = 0;
      this.authenticated = true;
      this.setStatus('ready');
      this.emitMsg({ type: 'auth_ok', me: r.me, resumeRoomId: r.resumeRoomId ?? null });
      return 0;
    }

    if (status >= 500 || status === 429 || status === 408 || status === 0) {
      this.emitMsg({ type: 'auth_error', code: 'auth_unavailable' });
      if (gen !== this.gen) return null;
      this.setStatus('reconnecting');
      return this.backoff();
    }

    // 401/400/403...: token rejeitado
    const err = String((data as HttpError | null)?.error ?? '');
    if (status === 401 && /expired/i.test(err) && this.expiredStreak < MAX_REAUTH_STREAK) {
      this.expiredStreak++;
      this.forceToken = true;
      this.emitMsg({ type: 'auth_error', code: 'expired_token' });
      return gen === this.gen ? 0 : null;
    }
    this.fatal = true;
    this.emitMsg({ type: 'auth_error', code: /expired/i.test(err) ? 'expired_token' : 'invalid_token' });
    if (gen === this.gen) this.setStatus('closed');
    return null;
  }

  private async sendStep(gen: number): Promise<number | null> {
    const msg = this.queue.shift() as OutMsg;
    let res: CallResult;
    try {
      res = await this.call('/api/send', { msg, pos: this.pos }, this.session as string);
    } catch (e) {
      if (gen === this.gen) this.queue.unshift(msg);
      throw e;
    }
    if (gen !== this.gen) return null;
    if (res.status >= 500 || res.status === 429) {
      this.queue.unshift(msg);
      this.setStatus('reconnecting');
      return this.backoff();
    }
    const unauth = this.checkSession(res);
    if (unauth !== undefined) {
      this.queue.unshift(msg);
      return unauth;
    }
    if (res.status !== 200) {
      this.emitMsg({ type: 'error', code: 'bad_request' });
      return null;
    }
    return this.applyView(res.data);
  }

  private async pollStep(gen: number): Promise<number | null> {
    const res = await this.call('/api/poll', { pos: this.pos, active: this.active }, this.session as string);
    if (gen !== this.gen) return null;
    if (res.status >= 500 || res.status === 429) {
      this.setStatus('reconnecting');
      return this.backoff();
    }
    const unauth = this.checkSession(res);
    if (unauth !== undefined) return unauth;
    if (res.status !== 200) {
      this.setStatus('reconnecting');
      return this.backoff();
    }
    return this.applyView(res.data);
  }

  /** 401 de sessao => refaz auth. Retorna undefined se nao for 401. */
  private checkSession(res: CallResult): number | null | undefined {
    if (res.status !== 401) return undefined;
    const err = String((res.data as HttpError | null)?.error ?? '');
    this.session = null;
    this.authenticated = false;
    if (this.reauthStreak >= MAX_REAUTH_STREAK) {
      this.fatal = true;
      this.emitMsg({ type: 'auth_error', code: /expired/i.test(err) ? 'expired_token' : 'invalid_token' });
      this.setStatus('closed');
      return null;
    }
    this.reauthStreak++;
    this.forceToken = true;
    this.setStatus('authenticating');
    return 0;
  }

  private applyView(data: unknown): number | null {
    const view = data as ViewResponse | null;
    if (!view || !Array.isArray(view.messages) || !view.pos) {
      this.setStatus('reconnecting');
      return this.backoff();
    }
    this.attempt = 0;
    this.reauthStreak = 0;
    this.pos = { ...view.pos };
    this.setStatus('ready');
    for (const m of view.messages) {
      if (this.closed) break;
      if (m.type === 'joined') this.pos.roomId = m.roomId;
      else if (m.type === 'left') this.pos.roomId = null;
      this.emitMsg(m);
    }
    return null;
  }
}
