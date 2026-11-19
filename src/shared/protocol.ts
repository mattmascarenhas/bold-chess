// Contrato cliente <-> servidor do Bold Chess no Bold Workspace.
// Fonte unica da verdade. Mudancas aqui exigem alinhar client e server.
import type { ClassicKind, Color, GameState, MoveOption, SceneRoomId, SpecialId } from '../game/types';

/** Identidade vinda do Workspace (SSO). Nunca vem do cliente em texto livre. */
export interface PlayerIdentity {
  userId: string;
  name: string;
  avatarUrl: string | null;
  accountId: string | null;
  workspaceId: string | null;
}

export type Seat = Color | 'spectator';

export interface RoomSeatInfo {
  w: PlayerIdentity | null;
  b: PlayerIdentity | null;
  spectators: PlayerIdentity[];
}

export interface RoomSummary {
  roomId: string;
  sceneRoom: SceneRoomId;
  white: PlayerIdentity | null;
  black: PlayerIdentity | null;
  spectatorCount: number;
  phase: 'waiting' | 'playing' | 'finished';
}

export interface OnlineUser extends PlayerIdentity {
  /** sala em que esta jogando/assistindo, se houver */
  roomId: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  points: number;
  wins: number;
  losses: number;
  draws: number;
}

export type MatchResult = 'w' | 'b' | 'draw';

// ---------- Cliente -> Servidor ----------
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'lobby_list' }
  | { type: 'create_room'; sceneRoom?: SceneRoomId }
  | { type: 'join'; roomId: string; asSpectator?: boolean }
  | { type: 'leave' }
  | { type: 'challenge'; targetUserId: string; sceneRoom?: SceneRoomId }
  | { type: 'invite_response'; inviteId: string; accept: boolean }
  | { type: 'draft_pick'; specialId: SpecialId }
  | { type: 'auto_draft' }
  | { type: 'move'; move: MoveOption }
  | { type: 'convocate'; choice: SpecialId | ClassicKind | 'keep_pawn' }
  | { type: 'resign' }
  | { type: 'rematch' }
  | { type: 'emote'; emoteId: string }
  | { type: 'ping' };

// ---------- Servidor -> Cliente ----------
export type ServerMessage =
  | { type: 'auth_ok'; me: PlayerIdentity; resumeRoomId: string | null }
  | { type: 'auth_error'; code: AuthErrorCode }
  | { type: 'lobby'; online: OnlineUser[]; rooms: RoomSummary[] }
  | { type: 'room_created'; roomId: string; sceneRoom: SceneRoomId }
  | {
      type: 'joined';
      roomId: string;
      sceneRoom: SceneRoomId;
      yourSeat: Seat;
      state: GameState;
      seats: RoomSeatInfo;
      resumed: boolean;
    }
  | { type: 'seats'; seats: RoomSeatInfo }
  | { type: 'left' }
  | { type: 'state'; state: GameState; event?: unknown; convocation?: string }
  | { type: 'emote'; emoteId: string; fromColor: Color }
  | { type: 'invite'; inviteId: string; from: PlayerIdentity; roomId: string; sceneRoom: SceneRoomId; expiresAt: number }
  | { type: 'invite_result'; inviteId: string; status: 'accepted' | 'declined' | 'expired' | 'offline'; roomId?: string }
  | { type: 'match_ended'; roomId: string; result: MatchResult; reason: string; points: PointsAward[] }
  | { type: 'error'; code: ErrorCode; message?: string }
  | { type: 'pong' };

export interface PointsAward {
  userId: string;
  delta: number;
  total: number;
  counted: boolean;
  reason?: 'too_short' | 'pair_limit' | 'vs_ai' | 'same_user';
}

export type AuthErrorCode = 'invalid_token' | 'expired_token' | 'auth_unavailable';
export type ErrorCode =
  | 'not_authenticated'
  | 'room_not_found'
  | 'room_full'
  | 'not_your_turn'
  | 'not_a_player'
  | 'user_offline'
  | 'user_busy'
  | 'self_challenge'
  | 'rate_limited'
  | 'bad_request';

// ---------- Constantes compartilhadas ----------
export const ROOM_CODE_REGEX = /^[A-Z2-9]{6}$/;
export const INVITE_TTL_MS = 60_000;
export const RESUME_GRACE_MS = 60_000;
export const MAX_INVITES_PER_MINUTE = 6;

/** Prefixo aceito pelo modo dev: dev:<userId>:<nome>[:<accountId>[:<workspaceId>]] */
export const DEV_TOKEN_PREFIX = 'dev:';
