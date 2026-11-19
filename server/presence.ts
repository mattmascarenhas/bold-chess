// Presenca: conexoes autenticadas, push de lobby (debounce) e convites.
import type { WebSocket } from 'ws';
import type { OnlineUser, PlayerIdentity, Seat, ServerMessage } from '../src/shared/protocol';

export interface Conn {
  ws: WebSocket;
  user: PlayerIdentity;
  roomId: string | null;
  seat: Seat | null;
  lastEmoteAt: number;
}

export function publicIdentity(u: PlayerIdentity): PlayerIdentity {
  // Nunca expoe accountId/workspaceId para outros usuarios.
  return { userId: u.userId, name: u.name, avatarUrl: u.avatarUrl, accountId: null, workspaceId: null };
}

export function sendTo(conn: Conn, msg: ServerMessage): void {
  try {
    if (conn.ws.readyState === 1 /* OPEN */) conn.ws.send(JSON.stringify(msg));
  } catch {
    // conexao morrendo; ignora
  }
}

export class Presence {
  private byUser = new Map<string, Set<Conn>>();

  add(conn: Conn): void {
    let set = this.byUser.get(conn.user.userId);
    if (!set) this.byUser.set(conn.user.userId, (set = new Set()));
    set.add(conn);
  }

  remove(conn: Conn): void {
    const set = this.byUser.get(conn.user.userId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.byUser.delete(conn.user.userId);
  }

  conns(userId: string): Conn[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  isOnline(userId: string): boolean {
    return this.byUser.has(userId);
  }

  all(): Conn[] {
    const out: Conn[] = [];
    for (const set of this.byUser.values()) out.push(...set);
    return out;
  }

  sendUser(userId: string, msg: ServerMessage): void {
    for (const c of this.conns(userId)) sendTo(c, msg);
  }

  broadcastAll(msg: ServerMessage): void {
    for (const c of this.all()) sendTo(c, msg);
  }

  /** Um OnlineUser por userId (qualquer empresa), sem accountId/workspaceId. */
  onlineList(): OnlineUser[] {
    const out: OnlineUser[] = [];
    for (const set of this.byUser.values()) {
      const first = [...set][0];
      if (!first) continue;
      const withRoom = [...set].find((c) => c.roomId);
      out.push({ ...publicIdentity(first.user), roomId: withRoom?.roomId ?? null });
    }
    return out;
  }
}

/** Agenda um callback com debounce; timer unref e cancelavel. */
export class Debouncer {
  private timer: NodeJS.Timeout | null = null;
  constructor(private fn: () => void, private ms: number) {}
  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.fn();
      } catch (e) {
        console.error('[lobby] push falhou', e);
      }
    }, this.ms);
    this.timer.unref?.();
  }
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export interface Invite {
  id: string;
  fromUserId: string;
  targetUserId: string;
  roomId: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export class InviteBook {
  private invites = new Map<string, Invite>();
  private attempts = new Map<string, number[]>();

  get(id: string): Invite | undefined {
    return this.invites.get(id);
  }

  add(inv: Invite): void {
    this.invites.set(inv.id, inv);
  }

  /** Remove e cancela o timer (convite so vale uma vez). */
  take(id: string): Invite | undefined {
    const inv = this.invites.get(id);
    if (!inv) return undefined;
    this.invites.delete(id);
    clearTimeout(inv.timer);
    return inv;
  }

  /** Registra tentativa; false se excedeu o limite por minuto. */
  allow(userId: string, max: number, now = Date.now()): boolean {
    const arr = (this.attempts.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= max) {
      this.attempts.set(userId, arr);
      return false;
    }
    arr.push(now);
    this.attempts.set(userId, arr);
    return true;
  }

  /** Descarta janelas vencidas (chamado pela limpeza periodica). */
  prune(now = Date.now()): void {
    for (const [u, arr] of this.attempts) {
      const f = arr.filter((t) => now - t < 60_000);
      if (f.length) this.attempts.set(u, f);
      else this.attempts.delete(u);
    }
  }

  clear(): void {
    for (const inv of this.invites.values()) clearTimeout(inv.timer);
    this.invites.clear();
    this.attempts.clear();
  }
}

