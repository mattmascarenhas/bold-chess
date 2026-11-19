// Build para a Vercel (Build Output API v3): estaticos do Vite + funcao Node unica em /api/game.
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const funcDir = path.join(out, 'functions', 'api', 'game.func');

// (g) limpa a saida anterior
fs.rmSync(out, { recursive: true, force: true });

// (a) manifest de audio embutido no bundle
const audioDir = path.join(root, 'public', 'audio');
let files = [];
let config = null;
if (fs.existsSync(audioDir)) {
  files = fs.readdirSync(audioDir).filter((f) => f.endsWith('.mp3')).sort();
  const cfg = path.join(audioDir, 'audio-config.json');
  if (fs.existsSync(cfg)) {
    try {
      config = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    } catch {
      config = null;
    }
  }
}
fs.writeFileSync(path.join(root, 'server', 'serverless', 'audio-manifest.json'), JSON.stringify({ files, config }, null, 2));

// (b) cliente
await viteBuild({ root, logLevel: 'info' });

// (c) funcao: bundle unico ESM
fs.mkdirSync(funcDir, { recursive: true });
await esbuild({
  entryPoints: [path.join(root, 'server', 'serverless', 'entry.ts')],
  outfile: path.join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  // pg/sdk podem usar require() de builtins dentro do bundle ESM
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  // pglite so e usado em dev/testes (import dinamico); pg-native e opcional do pg
  external: ['@electric-sql/pglite', 'pg-native'],
});

// (d) config da funcao
fs.writeFileSync(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 10 }, null, 2),
);

// (e) estaticos
fs.cpSync(path.join(root, 'dist'), path.join(out, 'static'), { recursive: true });

// (f) rotas: toda /api/* vai para a funcao unica; o caminho original segue em ?__p= (lido pelo handler)
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        { src: '/api/(.*)', dest: '/api/game?__p=$1' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('[build-vercel] ok:', path.relative(root, out));
