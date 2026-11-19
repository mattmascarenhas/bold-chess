// Dev/E2E local SEM Vercel e SEM Neon: handler serverless + PGlite + vite em modo middleware.
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createVerifyToken } from '../server/auth';
import { createLeaderboard } from '../server/leaderboard';
import { createMemoryStore } from '../server/store';
import { createPgliteDb } from '../server/serverless/db';
import { createGame } from '../server/serverless/game';
import { createHandler } from '../server/serverless/handler';
import fs from 'node:fs';
import path from 'node:path';

process.env.ALLOW_DEV_AUTH = '1';

const port = Number(process.env.PORT) || 3000;
const db = await createPgliteDb(process.env.PGLITE_DIR || undefined);
const store = createMemoryStore();
const leaderboard = createLeaderboard(store);
const verifyToken = createVerifyToken({ env: { ...process.env, ALLOW_DEV_AUTH: '1' } });
const game = createGame({ db, leaderboard });

const audioDir = path.resolve('public/audio');
const audioManifest = () => {
  let files: string[] = [];
  let config: unknown = null;
  if (fs.existsSync(audioDir)) {
    files = fs.readdirSync(audioDir).filter((f) => f.endsWith('.mp3'));
    try {
      config = JSON.parse(fs.readFileSync(path.join(audioDir, 'audio-config.json'), 'utf8'));
    } catch {
      config = null;
    }
  }
  return { files, config };
};

const api = createHandler({
  game,
  verifyToken,
  store,
  sessionSecret: 'dev-local-secret',
  audioManifest,
  authLimitPerMin: 10_000,
  apiLimitPerMin: 1_000_000,
});

const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
const server = http.createServer((req, res) => {
  if ((req.url ?? '').startsWith('/api/')) {
    void api(req, res);
    return;
  }
  vite.middlewares(req, res);
});
server.listen(port, '0.0.0.0', () => console.log(`Xadrez Bold (dev local, sem Vercel) em http://localhost:${port}`));

const stop = async () => {
  server.close();
  await vite.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
