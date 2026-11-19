// Entrada da funcao serverless da Vercel (empacotada por scripts/build-vercel.mjs).
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import { createVerifyToken } from '../auth';
import { createLeaderboard } from '../leaderboard';
import { createPgStore } from '../store-pg';
import { createPgDb } from './db';
import { createGame } from './game';
import { createHandler } from './handler';
// Gerado no build (scripts/build-vercel.mjs). O build cria um stub vazio se faltar.
import manifestJson from './audio-manifest.json';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
let cached: Handler | null = null;
let devSecret: string | null = null;

function build(): Handler {
  const env = process.env;
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL ausente');
  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    if (env.NODE_ENV === 'production') throw new Error('SESSION_SECRET ausente');
    devSecret ??= randomBytes(32).toString('hex');
    console.warn('[entry] SESSION_SECRET ausente: usando segredo aleatorio por processo (so dev).');
    sessionSecret = devSecret;
  }
  const db = createPgDb(databaseUrl);
  const store = createPgStore(databaseUrl);
  const leaderboard = createLeaderboard(store);
  const verifyToken = createVerifyToken({ env });
  const game = createGame({ db, leaderboard });
  const manifest = (manifestJson as unknown) ?? { files: [], config: null };
  return createHandler({ game, verifyToken, store, sessionSecret, audioManifest: () => manifest });
}

export default async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    cached ??= build();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[entry] configuracao invalida:', message);
    const body = JSON.stringify({ error: 'server_misconfigured', message });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
    return;
  }
  return cached(req, res);
}
