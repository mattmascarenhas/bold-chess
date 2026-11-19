// Contrato HTTP (polling) entre cliente e funcoes serverless da Vercel.
// Reaproveita ClientMessage/ServerMessage de ./protocol.ts.
import type { ClientMessage, PlayerIdentity, ServerMessage } from './protocol';

/** Posicao do cliente: o que ele ja viu. O servidor devolve so o que mudou. */
export interface Pos {
  /** sala em que o cliente acha que esta (null = lobby) */
  roomId: string | null;
  /** versao do estado do jogo ja recebida */
  sv: number;
  /** versao dos assentos/espectadores ja recebida */
  pv: number;
  /** ultimo id de evento ja recebido */
  cursor: number;
}

export const EMPTY_POS: Pos = { roomId: null, sv: 0, pv: 0, cursor: 0 };

/** POST /api/auth */
export interface AuthRequest {
  ssoToken: string;
}
export interface AuthResponse {
  /** token de sessao proprio (HMAC), enviado como Authorization: Bearer */
  session: string;
  /** epoch ms de expiracao da sessao */
  expiresAt: number;
  me: PlayerIdentity;
  /** sala em que o usuario ja estava (reconexao) */
  resumeRoomId: string | null;
  pollMs: PollIntervals;
}

export interface PollIntervals {
  /** em jogo, vez do adversario ou espectando */
  game: number;
  /** lobby / sala de espera */
  lobby: number;
  /** aba inativa */
  idle: number;
}

export const DEFAULT_POLL: PollIntervals = { game: 1000, lobby: 2000, idle: 8000 };

/** POST /api/send */
export interface SendRequest {
  msg: Exclude<ClientMessage, { type: 'auth' }>;
  pos: Pos;
}

/** POST /api/poll */
export interface PollRequest {
  pos: Pos;
  /** false quando a aba esta inativa: servidor pode omitir o lobby */
  active?: boolean;
}

/** Resposta de /api/send e /api/poll */
export interface ViewResponse {
  messages: ServerMessage[];
  pos: Pos;
}

/** Erro HTTP: 401 { error: 'invalid_session' | 'expired_session' } => cliente refaz /api/auth */
export interface HttpError {
  error: string;
  message?: string;
}

/** Janela em que um usuario conta como online (ms sem poll). */
export const ONLINE_WINDOW_MS = 20_000;
/** Sem poll por este tempo em partida => considerado ausente (abandono). */
export const ABSENT_GRACE_MS = 60_000;
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_ROOMS = 500;
