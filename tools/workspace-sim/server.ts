// Simulador do Bold Workspace (host). Uso: npm run sim  (SIM_PORT=4000, GAME_URL=http://localhost:3000)
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { ACCOUNTS, USERS, WORKSPACES } from './protocol-handlers.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

/** JSON seguro para embutir em <script>. */
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const q = (v: unknown): string | null => (typeof v === 'string' && v.length <= 100 ? v : null);

export interface SimOptions { port?: number; gameUrl?: string }

export function createApp(gameUrl: string) {
  const app = express();
  app.disable('x-powered-by');
  let handlersJs: string | null = null;

  app.get('/', (_req, res) => {
    const users = USERS.map((u) => ({
      ...u,
      accountName: ACCOUNTS.find((a) => a.id === u.accountId)?.name ?? u.accountId,
      workspaceName: WORKSPACES.find((w) => w.id === u.workspaceId)?.name ?? u.workspaceId,
    }));
    res.type('html').send(
      read('panel.html')
        .replace('/*__USERS__*/[]', () => safeJson(users))
        .replace('__GAME_URL__', () => escHtml(gameUrl)),
    );
  });

  app.get('/host', (req, res) => {
    const params = {
      user: q(req.query.user),
      name: q(req.query.name),
      account: q(req.query.account),
      workspace: q(req.query.workspace),
      theme: q(req.query.theme) === 'dark' ? 'dark' : 'light',
      language: q(req.query.lang) ?? q(req.query.language),
      route: (() => { const r = q(req.query.route); return r && r.startsWith('/') && !r.startsWith('//') ? r : '/'; })(),
    };
    const title = `Sim host - ${params.name ?? params.user ?? 'ana'}`;
    res.type('html').send(
      read('host.html')
        .replace('__SIM_TITLE__', () => escHtml(title))
        .replace('/*__SIM_CONFIG__*/{}', () => safeJson({ params, gameUrl })),
    );
  });

  app.get('/host.js', (_req, res) => res.type('js').send(read('host.js')));

  // protocol-handlers.ts transpilado para o navegador.
  app.get('/protocol-handlers.js', async (_req, res, next) => {
    try {
      if (!handlersJs) {
        const { transform } = await import('esbuild');
        handlersJs = (await transform(read('protocol-handlers.ts'), { loader: 'ts', format: 'esm', target: 'es2020' })).code;
      }
      res.type('js').send(handlersJs);
    } catch (e) { next(e); }
  });

  return app;
}

export function startSim(opts: SimOptions = {}): Promise<{ server: Server; port: number; url: string }> {
  const gameUrl = opts.gameUrl ?? process.env.GAME_URL ?? 'http://localhost:3000';
  const port = opts.port ?? Number(process.env.SIM_PORT ?? 4000);
  const app = createApp(gameUrl);
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const p = (server.address() as { port: number }).port;
      resolve({ server, port: p, url: `http://localhost:${p}` });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSim().then(({ url }) => {
    console.log(`[workspace-sim] painel: ${url}/  (jogo: ${process.env.GAME_URL ?? 'http://localhost:3000'})`);
    console.log(`[workspace-sim] 3 hosts: ${url}/?auto  |  um host: ${url}/host?user=ana`);
  });
}
