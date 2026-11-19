// Roteador HTTP das funcoes serverless (sem express): auth, send, poll, ranking, audio.
import type http from 'node:http';
import type { PlayerIdentity } from '../../src/shared/protocol';
import {
  DEFAULT_POLL,
  type AuthResponse,
  type PollRequest,
  type Pos,
  type SendRequest,
} from '../../src/shared/http-protocol';
import { AuthError, type Store, type VerifyToken } from '../types';
import type { Game } from './game';
import { SessionError, signSession, verifySession } from './session';

export interface HandlerDeps {
  game: Game;
  verifyToken: VerifyToken;
  store: Store;
  sessionSecret: string;
  now?: () => number;
  audioManifest?: () => unknown;
  /** limites por IP/min (best effort, memoria da instancia) */
  authLimitPerMin?: number;
  apiLimitPerMin?: number;
}

const MAX_BODY = 32 * 1024;
const WINDOW_MS = 60_000;

class HttpErr extends Error {
  constructor(public status: number, public body: { error: string; message?: string }) {
    super(body.error);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const ct = String(req.headers['content-type'] ?? '');
  if (!/^application\/json\b/i.test(ct)) throw new HttpErr(415, { error: 'unsupported_media_type' });
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new HttpErr(413, { error: 'payload_too_large' });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > MAX_BODY) throw new HttpErr(413, { error: 'payload_too_large' });
    chunks.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpErr(400, { error: 'invalid_json' });
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isUint = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function parsePos(v: unknown): Pos {
  if (!isObj(v)) throw new HttpErr(400, { error: 'invalid_pos' });
  const { roomId, sv, pv, cursor } = v;
  const roomOk = roomId === null || (typeof roomId === 'string' && roomId.length > 0 && roomId.length <= 64);
  if (!roomOk || !isUint(sv) || !isUint(pv) || !isUint(cursor)) throw new HttpErr(400, { error: 'invalid_pos' });
  return { roomId: roomId as string | null, sv, pv, cursor };
}

function parseLimit(raw: string | null, def: number, max: number): number | null {
  if (raw === null) return def;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || n > max) return null;
  return n;
}

function publicIdentity(p: PlayerIdentity) {
  return { userId: p.userId, name: p.name, avatarUrl: p.avatarUrl };
}

export function createHandler(deps: HandlerDeps) {
  const now = deps.now ?? Date.now;
  const authLimit = deps.authLimitPerMin ?? 20;
  const apiLimit = deps.apiLimitPerMin ?? 600;
  const buckets = new Map<string, { start: number; n: number }>();

  function allow(key: string, limit: number): boolean {
    const t = now();
    if (buckets.size > 5000) for (const [k, b] of buckets) if (t - b.start >= WINDOW_MS) buckets.delete(k);
    const b = buckets.get(key);
    if (!b || t - b.start >= WINDOW_MS) {
      buckets.set(key, { start: t, n: 1 });
      return true;
    }
    b.n++;
    return b.n <= limit;
  }

  function clientIp(req: http.IncomingMessage): string {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    const real = req.headers['x-real-ip'];
    return first || (typeof real === 'string' ? real : '') || req.socket?.remoteAddress || 'unknown';
  }

  function sessionFrom(req: http.IncomingMessage): PlayerIdentity {
    const h = req.headers.authorization;
    const m = typeof h === 'string' ? /^Bearer\s+(\S+)$/i.exec(h) : null;
    if (!m) throw new SessionError('invalid_session');
    return verifySession(m[1], deps.sessionSecret, now());
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = url.pathname;
    // Na Vercel, a rota /api/(.*) -> /api/game?__p=$1 entrega o caminho original em __p.
    const p = url.searchParams.get('__p');
    if (p !== null) {
      url.searchParams.delete('__p');
      path = '/api/' + p.replace(/^\/+/, '');
    }
    if (path.length > 1) path = path.replace(/\/+$/, '');
    const method = (req.method ?? 'GET').toUpperCase();

    if (!path.startsWith('/api/')) throw new HttpErr(404, { error: 'not_found' });
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    const ip = clientIp(req);
    const methodOnly = (m: string) => {
      if (method !== m) throw new HttpErr(405, { error: 'method_not_allowed' });
    };
    const limited = (key: string, limit: number) => {
      if (!allow(key, limit)) throw new HttpErr(429, { error: 'rate_limited' });
    };

    switch (path) {
      case '/api/auth': {
        methodOnly('POST');
        limited('auth:' + ip, authLimit);
        const body = await readJson(req);
        if (!isObj(body) || typeof body.ssoToken !== 'string' || !body.ssoToken || body.ssoToken.length > 4096) {
          throw new HttpErr(400, { error: 'invalid_request' });
        }
        let me: PlayerIdentity;
        try {
          me = await deps.verifyToken(body.ssoToken);
        } catch (err) {
          if (err instanceof AuthError) {
            throw new HttpErr(err.code === 'auth_unavailable' ? 503 : 401, { error: err.code });
          }
          throw err;
        }
        const lg: unknown = await deps.game.login(me);
        const resumeRoomId =
          typeof lg === 'string' ? lg : isObj(lg) && typeof lg.resumeRoomId === 'string' ? lg.resumeRoomId : null;
        const { token, expiresAt } = signSession(me, deps.sessionSecret, undefined, now());
        const out: AuthResponse = { session: token, expiresAt, me, resumeRoomId, pollMs: DEFAULT_POLL };
        return sendJson(res, 200, out);
      }

      case '/api/send':
      case '/api/poll': {
        methodOnly('POST');
        limited('api:' + ip, apiLimit);
        const me = sessionFrom(req); // identidade vem SEMPRE da sessao
        const body = await readJson(req);
        if (!isObj(body)) throw new HttpErr(400, { error: 'invalid_request' });
        const pos = parsePos(body.pos);
        if (path === '/api/send') {
          const msg = body.msg;
          if (!isObj(msg) || typeof msg.type !== 'string' || !msg.type || msg.type.length > 40 || msg.type === 'auth') {
            throw new HttpErr(400, { error: 'invalid_msg' });
          }
          return sendJson(res, 200, await deps.game.send(me, msg as unknown as SendRequest['msg'], pos));
        }
        const active = body.active === undefined ? undefined : body.active !== false;
        return sendJson(res, 200, await deps.game.poll(me, pos, active as PollRequest['active']));
      }

      case '/api/leaderboard': {
        methodOnly('GET');
        limited('api:' + ip, apiLimit);
        const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
        if (limit === null) throw new HttpErr(400, { error: 'invalid_limit' });
        return sendJson(res, 200, { entries: await deps.store.getTop(limit) });
      }

      case '/api/leaderboard/me': {
        methodOnly('GET');
        limited('api:' + ip, apiLimit);
        const userId = url.searchParams.get('userId');
        if (!userId || userId.length > 200) throw new HttpErr(400, { error: 'invalid_user_id' });
        const [rank, stats] = await Promise.all([deps.store.getRank(userId), deps.store.getStats(userId)]);
        return sendJson(res, 200, { rank, stats });
      }

      case '/api/matches/recent': {
        methodOnly('GET');
        limited('api:' + ip, apiLimit);
        const limit = parseLimit(url.searchParams.get('limit'), 20, 100);
        if (limit === null) throw new HttpErr(400, { error: 'invalid_limit' });
        const recs = await deps.store.recentMatches(limit);
        const matches = recs.map((m) => ({
          id: m.id,
          roomId: m.roomId,
          white: publicIdentity(m.white),
          black: publicIdentity(m.black),
          result: m.result,
          reason: m.reason,
          moves: m.moves,
          counted: m.counted,
          whiteDelta: m.whiteDelta,
          blackDelta: m.blackDelta,
          endedAt: m.endedAt,
        }));
        return sendJson(res, 200, { matches });
      }

      case '/api/audio-manifest': {
        methodOnly('GET');
        return sendJson(res, 200, deps.audioManifest ? deps.audioManifest() : { files: [], config: null });
      }

      default:
        throw new HttpErr(404, { error: 'not_found' });
    }
  }

  return async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpErr) return sendJson(res, err.status, err.body);
      if (err instanceof SessionError) return sendJson(res, 401, { error: err.code });
      console.error('[handler] erro interno:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
  };
}
