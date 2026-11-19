// Esquema das tabelas do jogo (alem de chess_players/chess_matches do ranking, em server/store-pg.ts).
// Sem tabelas de usuarios/empresas: so guardamos snapshots de identidade vindos do SSO.
import type { Db } from './db';

export const GAME_SCHEMA = `
CREATE TABLE IF NOT EXISTS chess_online (
  user_id   TEXT PRIMARY KEY,
  identity  JSONB NOT NULL,
  last_seen BIGINT NOT NULL,
  room_id   TEXT
);
CREATE INDEX IF NOT EXISTS chess_online_seen_idx ON chess_online (last_seen);

CREATE TABLE IF NOT EXISTS chess_rooms (
  id          TEXT PRIMARY KEY,
  scene_room  TEXT NOT NULL,
  state       JSONB NOT NULL,
  state_ver   INTEGER NOT NULL DEFAULT 1,
  seats_ver   INTEGER NOT NULL DEFAULT 1,
  scored      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chess_members (
  room_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  identity   JSONB NOT NULL,
  seat       TEXT NOT NULL CHECK (seat IN ('w','b','spectator')),
  last_seen  BIGINT NOT NULL,
  last_emote BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS chess_members_seat_uq ON chess_members (room_id, seat) WHERE seat IN ('w','b');
CREATE INDEX IF NOT EXISTS chess_members_user_idx ON chess_members (user_id);

CREATE TABLE IF NOT EXISTS chess_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  msg        JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS chess_events_user_idx ON chess_events (user_id, id);

CREATE TABLE IF NOT EXISTS chess_invites (
  id            TEXT PRIMARY KEY,
  from_user     TEXT NOT NULL,
  to_user       TEXT NOT NULL,
  from_identity JSONB NOT NULL,
  room_id       TEXT NOT NULL,
  scene_room    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS chess_invites_from_idx ON chess_invites (from_user, status);
CREATE INDEX IF NOT EXISTS chess_invites_to_idx ON chess_invites (to_user, status);
`;

let ensured = new WeakMap<Db, Promise<void>>();

/** Cria as tabelas uma vez por instancia (idempotente). */
export function ensureSchema(db: Db): Promise<void> {
  let p = ensured.get(db);
  if (!p) {
    p = db.query(GAME_SCHEMA).then(() => undefined);
    p.catch(() => ensured.delete(db)); // permite tentar de novo se o banco estava fora
    ensured.set(db, p);
  }
  return p;
}
