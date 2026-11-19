// Modelo de salas: vagas w/b por identidade (userId), espectadores, reserva de vaga.
import { createInitialState } from '../src/game/engine';
import type { Color, GameState, SceneRoomId } from '../src/game/types';
import type { PlayerIdentity, RoomSeatInfo, RoomSummary } from '../src/shared/protocol';
import { publicIdentity, type Conn } from './presence';

export interface Room {
  id: string;
  sceneRoom: SceneRoomId;
  state: GameState;
  /** vagas ocupadas (identidade completa, interna) */
  players: Record<Color, PlayerIdentity | null>;
  /** timers de reserva de vaga apos queda de conexao */
  grace: Record<Color, NodeJS.Timeout | null>;
  conns: Set<Conn>;
  /** ja pontuou esta partida? (rematch zera) */
  scored: boolean;
  createdAt: number;
  /** desde quando a sala esta sem conexoes e sem jogadores (null se ocupada) */
  emptySince: number | null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  private generateId(): string {
    for (;;) {
      let id = '';
      for (let i = 0; i < 6; i++) id += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(id)) return id;
    }
  }

  create(sceneRoom: SceneRoomId): Room {
    const room: Room = {
      id: this.generateId(),
      sceneRoom,
      state: createInitialState(true),
      players: { w: null, b: null },
      grace: { w: null, b: null },
      conns: new Set(),
      scored: false,
      createdAt: Date.now(),
      emptySince: Date.now(),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Ha dois jogadores sentados e a partida nao terminou. */
  inProgress(room: Room): boolean {
    return !!room.players.w && !!room.players.b && !room.state.winner;
  }

  phase(room: Room): RoomSummary['phase'] {
    if (room.state.winner) return 'finished';
    return room.players.w && room.players.b ? 'playing' : 'waiting';
  }

  seatsInfo(room: Room): RoomSeatInfo {
    const spec = new Map<string, PlayerIdentity>();
    for (const c of room.conns) {
      if (c.seat === 'spectator') spec.set(c.user.userId, publicIdentity(c.user));
    }
    return {
      w: room.players.w ? publicIdentity(room.players.w) : null,
      b: room.players.b ? publicIdentity(room.players.b) : null,
      spectators: [...spec.values()],
    };
  }

  summary(room: Room): RoomSummary {
    return {
      roomId: room.id,
      sceneRoom: room.sceneRoom,
      white: room.players.w ? publicIdentity(room.players.w) : null,
      black: room.players.b ? publicIdentity(room.players.b) : null,
      spectatorCount: this.seatsInfo(room).spectators.length,
      phase: this.phase(room),
    };
  }

  /** Salas com alguem dentro (para o lobby). */
  listSummaries(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.conns.size > 0 || r.players.w || r.players.b)
      .map((r) => this.summary(r));
  }

  touchEmpty(room: Room): void {
    const empty = room.conns.size === 0 && !room.players.w && !room.players.b;
    if (!empty) room.emptySince = null;
    else if (room.emptySince === null) room.emptySince = Date.now();
  }

  /** Remove salas vazias ha mais de ttlMs. Devolve ids removidos. */
  sweep(ttlMs: number, now = Date.now()): string[] {
    const removed: string[] = [];
    for (const room of this.rooms.values()) {
      this.touchEmpty(room);
      if (room.emptySince !== null && now - room.emptySince > ttlMs) {
        this.dispose(room);
        removed.push(room.id);
      }
    }
    return removed;
  }

  dispose(room: Room): void {
    for (const c of ['w', 'b'] as Color[]) {
      const t = room.grace[c];
      if (t) clearTimeout(t);
      room.grace[c] = null;
    }
    this.rooms.delete(room.id);
  }

  disposeAll(): void {
    for (const room of [...this.rooms.values()]) this.dispose(room);
  }

  /** Sala onde o usuario ocupa vaga (para resumeRoomId). Prefere partida em andamento. */
  findSeatedRoom(userId: string): Room | undefined {
    let found: Room | undefined;
    for (const r of this.rooms.values()) {
      if (r.players.w?.userId === userId || r.players.b?.userId === userId) {
        if (this.inProgress(r)) return r;
        found ??= r;
      }
    }
    return found;
  }
}
