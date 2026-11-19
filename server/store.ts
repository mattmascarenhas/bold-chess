// Persistencia: JsonStore (arquivo) e MemoryStore (testes).
import fs from 'node:fs';
import path from 'node:path';
import type { LeaderboardEntry } from '../src/shared/protocol';
import type { MatchRecord, PlayerStats, Store } from './types';

interface Data {
  users: Record<string, PlayerStats>;
  matches: MatchRecord[];
}

const MAX_MATCHES = 5000;
const DEFAULT_FILE = path.join(process.cwd(), 'data', 'chess.json');

function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const isAi = (id: string) => id.startsWith('ai:');

function touch(users: Record<string, PlayerStats>, p: MatchRecord['white']): PlayerStats {
  const cur = (Object.hasOwn(users, p.userId) ? users[p.userId] : undefined) ?? { userId: p.userId, name: p.name, avatarUrl: null, points: 0, wins: 0, losses: 0, draws: 0 };
  cur.name = p.name;
  cur.avatarUrl = p.avatarUrl ?? null;
  users[p.userId] = cur;
  return cur;
}

function apply(data: Data, rec: MatchRecord): void {
  // O adversario IA (ai:<nivel>) nunca entra no ranking: so a partida e gravada.
  const w = isAi(rec.white.userId) ? null : touch(data.users, rec.white);
  const b = isAi(rec.black.userId) ? null : touch(data.users, rec.black);
  if (rec.counted) {
    if (w) w.points += rec.whiteDelta;
    if (b) b.points += rec.blackDelta;
    if (rec.result === 'w') { if (w) w.wins++; if (b) b.losses++; }
    else if (rec.result === 'b') { if (b) b.wins++; if (w) w.losses++; }
    else { if (w) w.draws++; if (b) b.draws++; }
  }
  data.matches.push(rec);
  if (data.matches.length > MAX_MATCHES) data.matches.splice(0, data.matches.length - MAX_MATCHES);
}

function sorted(data: Data): PlayerStats[] {
  return Object.values(data.users).sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}

class BaseStore implements Store {
  protected data: Data = { users: Object.create(null), matches: [] };
  private queue: Promise<unknown> = Promise.resolve();

  protected persist(): Promise<void> { return Promise.resolve(); }

  recordMatch(rec: MatchRecord): Promise<void> {
    const run = async () => {
      apply(this.data, { ...rec, white: { ...rec.white }, black: { ...rec.black } });
      await this.persist();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async idle(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  async getStats(userId: string): Promise<PlayerStats | null> {
    await this.idle();
    const s = this.data.users[userId];
    return s ? { ...s } : null;
  }

  async getTop(limit: number): Promise<LeaderboardEntry[]> {
    await this.idle();
    return sorted(this.data).slice(0, Math.max(0, limit)).map((s, i) => ({ rank: i + 1, ...s }));
  }

  async getRank(userId: string): Promise<number | null> {
    await this.idle();
    const i = sorted(this.data).findIndex((s) => s.userId === userId);
    return i < 0 ? null : i + 1;
  }

  async countPairToday(userA: string, userB: string): Promise<number> {
    await this.idle();
    const today = localDay(Date.now());
    return this.data.matches.filter(
      (m) =>
        m.counted === true &&
        localDay(m.endedAt) === today &&
        ((m.white.userId === userA && m.black.userId === userB) || (m.white.userId === userB && m.black.userId === userA)),
    ).length;
  }

  async countAiToday(userId: string): Promise<{ games: number; points: number }> {
    await this.idle();
    const today = localDay(Date.now());
    let games = 0;
    let points = 0;
    for (const m of this.data.matches) {
      if (m.counted && isAi(m.black.userId) && m.white.userId === userId && localDay(m.endedAt) === today) {
        games++;
        points += m.whiteDelta;
      }
    }
    return { games, points };
  }

  async recentMatches(limit: number): Promise<MatchRecord[]> {
    await this.idle();
    return this.data.matches.slice(-Math.max(0, limit)).reverse().map((m) => ({ ...m }));
  }
}

class JsonStore extends BaseStore {
  constructor(private file: string) {
    super();
    this.load();
  }

  private load(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    } catch { /* ignora */ }
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return; // ausente
    }
    try {
      const j = JSON.parse(raw);
      if (!j || typeof j !== 'object' || typeof j.users !== 'object' || !j.users || !Array.isArray(j.matches)) throw new Error('shape');
      this.data = { users: Object.assign(Object.create(null), j.users), matches: j.matches };
    } catch {
      try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}.bak`); } catch { /* ignora */ }
      this.data = { users: {}, matches: [] };
    }
  }

  protected async persist(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.data), 'utf8');
    await fs.promises.rename(tmp, this.file);
  }
}

export function createStore(filePath: string = DEFAULT_FILE): Store {
  return new JsonStore(filePath);
}

export function createMemoryStore(): Store {
  return new BaseStore();
}
