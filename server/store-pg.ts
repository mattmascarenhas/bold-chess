// Store em Postgres (Neon). Ativado quando DATABASE_URL esta definido.
import pg from 'pg';
import type { LeaderboardEntry, PlayerIdentity } from '../src/shared/protocol';
import type { MatchRecord, PlayerStats, Store } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chess_players (
  user_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  avatar_url TEXT,
  points     INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chess_matches (
  id                 TEXT PRIMARY KEY,
  room_id            TEXT NOT NULL,
  white_id           TEXT NOT NULL,
  white_name         TEXT NOT NULL,
  white_avatar       TEXT,
  white_account_id   TEXT,
  white_workspace_id TEXT,
  black_id           TEXT NOT NULL,
  black_name         TEXT NOT NULL,
  black_avatar       TEXT,
  black_account_id   TEXT,
  black_workspace_id TEXT,
  result             TEXT NOT NULL,
  reason             TEXT NOT NULL,
  moves              INTEGER NOT NULL,
  counted            BOOLEAN NOT NULL,
  white_delta        INTEGER NOT NULL,
  black_delta        INTEGER NOT NULL,
  ended_at           BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS chess_matches_pair_idx ON chess_matches (white_id, black_id, ended_at);
CREATE INDEX IF NOT EXISTS chess_matches_ended_idx ON chess_matches (ended_at DESC);
CREATE INDEX IF NOT EXISTS chess_players_rank_idx ON chess_players (points DESC, wins DESC);
`;

const ORDER = 'points DESC, wins DESC, name ASC, user_id ASC';

function startOfLocalDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rowToStats(r: any): PlayerStats {
  return {
    userId: r.user_id,
    name: r.name,
    avatarUrl: r.avatar_url ?? null,
    points: r.points,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
  };
}

function identity(r: any, side: 'white' | 'black'): PlayerIdentity {
  return {
    userId: r[`${side}_id`],
    name: r[`${side}_name`],
    avatarUrl: r[`${side}_avatar`] ?? null,
    accountId: r[`${side}_account_id`] ?? null,
    workspaceId: r[`${side}_workspace_id`] ?? null,
  };
}

function rowToMatch(r: any): MatchRecord {
  return {
    id: r.id,
    roomId: r.room_id,
    white: identity(r, 'white'),
    black: identity(r, 'black'),
    result: r.result,
    reason: r.reason,
    moves: r.moves,
    counted: r.counted,
    whiteDelta: r.white_delta,
    blackDelta: r.black_delta,
    endedAt: Number(r.ended_at),
  };
}

export class PgStore implements Store {
  private ready: Promise<void>;

  constructor(private pool: pg.Pool) {
    this.ready = pool.query(SCHEMA).then(() => undefined);
    // evita "unhandled rejection" se o banco estiver fora no boot; o erro reaparece nas chamadas
    this.ready.catch(() => undefined);
  }

  async recordMatch(rec: MatchRecord): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = Date.now();
      const sides: Array<['white' | 'black', 'w' | 'b']> = [['white', 'w'], ['black', 'b']];
      for (const [side, col] of sides) {
        const p = rec[side];
        const counted = rec.counted;
        const delta = side === 'white' ? rec.whiteDelta : rec.blackDelta;
        const win = counted && rec.result === col ? 1 : 0;
        const loss = counted && rec.result !== 'draw' && rec.result !== col ? 1 : 0;
        const draw = counted && rec.result === 'draw' ? 1 : 0;
        await client.query(
          `INSERT INTO chess_players (user_id, name, avatar_url, points, wins, losses, draws, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (user_id) DO UPDATE SET
             name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url,
             points = chess_players.points + $4,
             wins = chess_players.wins + $5,
             losses = chess_players.losses + $6,
             draws = chess_players.draws + $7,
             updated_at = $8`,
          [p.userId, p.name, p.avatarUrl ?? null, counted ? delta : 0, win, loss, draw, now],
        );
      }
      await client.query(
        `INSERT INTO chess_matches (id, room_id, white_id, white_name, white_avatar, white_account_id, white_workspace_id,
           black_id, black_name, black_avatar, black_account_id, black_workspace_id,
           result, reason, moves, counted, white_delta, black_delta, ended_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          rec.id, rec.roomId,
          rec.white.userId, rec.white.name, rec.white.avatarUrl ?? null, rec.white.accountId ?? null, rec.white.workspaceId ?? null,
          rec.black.userId, rec.black.name, rec.black.avatarUrl ?? null, rec.black.accountId ?? null, rec.black.workspaceId ?? null,
          rec.result, rec.reason, rec.moves, rec.counted, rec.whiteDelta, rec.blackDelta, rec.endedAt,
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getStats(userId: string): Promise<PlayerStats | null> {
    await this.ready;
    const r = await this.pool.query('SELECT * FROM chess_players WHERE user_id = $1', [userId]);
    return r.rows[0] ? rowToStats(r.rows[0]) : null;
  }

  async getTop(limit: number): Promise<LeaderboardEntry[]> {
    await this.ready;
    const r = await this.pool.query(`SELECT * FROM chess_players ORDER BY ${ORDER} LIMIT $1`, [Math.max(0, limit)]);
    return r.rows.map((row, i) => ({ rank: i + 1, ...rowToStats(row) }));
  }

  async getRank(userId: string): Promise<number | null> {
    await this.ready;
    const r = await this.pool.query(
      `SELECT rank FROM (SELECT user_id, ROW_NUMBER() OVER (ORDER BY ${ORDER}) AS rank FROM chess_players) t WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0] ? Number(r.rows[0].rank) : null;
  }

  async countPairToday(userA: string, userB: string): Promise<number> {
    await this.ready;
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM chess_matches
       WHERE counted = TRUE AND ended_at >= $3
         AND ((white_id = $1 AND black_id = $2) OR (white_id = $2 AND black_id = $1))`,
      [userA, userB, startOfLocalDay()],
    );
    return r.rows[0].n;
  }

  async recentMatches(limit: number): Promise<MatchRecord[]> {
    await this.ready;
    const r = await this.pool.query('SELECT * FROM chess_matches ORDER BY ended_at DESC LIMIT $1', [Math.max(0, limit)]);
    return r.rows.map(rowToMatch);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPgStore(databaseUrl: string): PgStore {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon exige TLS
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: true },
  });
  pool.on('error', (err) => console.error('[pg] erro no pool:', err.message));
  return new PgStore(pool);
}
