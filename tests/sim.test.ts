import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { startSim } from '../tools/workspace-sim/server.ts';
import {
  createState, handleBridgeMessage, classifyEvent, makeSsoToken, addressBarFor,
  pushTheme, pushNavigate, pushTabActive, EXPIRED_TOKEN,
} from '../tools/workspace-sim/protocol-handlers.ts';

let server: Server;
let base: string;

before(async () => {
  const s = await startSim({ port: 0, gameUrl: 'http://localhost:3999' });
  server = s.server;
  base = s.url;
});
after(() => { server.close(); });

test('GET / lista os usuarios do painel', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  for (const n of ['Ana', 'Bruno', 'Carla', 'Diego', 'Acme Corp', 'Globex']) assert.ok(html.includes(n), n);
  assert.ok(html.includes('http://localhost:3999'));
});

test('GET /host injeta parametros e nao poe ssoToken', async () => {
  const r = await fetch(base + '/host?user=bruno&name=Bruno&account=acme-corp&workspace=vendas-acme&theme=dark&route=/sala/ABC234');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('"user":"bruno"'));
  assert.ok(html.includes('"theme":"dark"'));
  assert.ok(html.includes('"route":"/sala/ABC234"'));
  assert.ok(html.includes('Sim host - Bruno'));
  assert.ok(!html.includes('ssoToken'));
});

test('GET /host escapa HTML em parametros', async () => {
  const html = await (await fetch(base + '/host?name=' + encodeURIComponent('</script><b>x'))).text();
  assert.ok(!html.includes('</script><b>'));
});

test('assets: host.js e protocol-handlers.js (transpilado)', async () => {
  const js = await fetch(base + '/host.js');
  assert.equal(js.status, 200);
  const ph = await fetch(base + '/protocol-handlers.js');
  assert.equal(ph.status, 200);
  const code = await ph.text();
  assert.ok(code.includes('handleBridgeMessage'));
  assert.ok(!code.includes(': SimState'));
});

test('BOLD_GET_CONTEXT eco do requestId e dados do usuario', () => {
  const s = createState({ user: 'carla' });
  const r = handleBridgeMessage({ type: 'BOLD_GET_CONTEXT', requestId: 'r-1' }, s)!;
  assert.equal(r.type, 'BOLD_CONTEXT_RESPONSE');
  assert.equal(r.requestId, 'r-1');
  const c = r.payload as any;
  assert.equal(c.user.id, 'carla');
  assert.equal(c.account.name, 'Globex');
  assert.equal(c.workspace.name, 'Suporte');
  assert.equal(c.theme, 'light');
  assert.equal(c.language, 'pt-BR');
  assert.ok(Array.isArray(c.account.workspaces));
});

test('BOLD_GET_USERS retorna so usuarios do workspace atual', () => {
  const ana = createState({ user: 'ana' });
  const u1 = (handleBridgeMessage({ type: 'BOLD_GET_USERS', requestId: 'a' }, ana)!.payload as any[]).map((u) => u.id);
  assert.deepEqual(u1, ['ana']);
  const diego = createState({ user: 'diego' });
  const r = handleBridgeMessage({ type: 'BOLD_GET_USERS', requestId: 'b' }, diego)!;
  assert.equal(r.type, 'BOLD_USERS_RESPONSE');
  assert.deepEqual((r.payload as any[]).map((u) => u.id), ['diego']);
  // usuario extra no mesmo workspace aparece
  const s = createState({ user: 'zed', account: 'bold-solution', workspace: 'atendimento' });
  const ids = (handleBridgeMessage({ type: 'BOLD_GET_USERS', requestId: 'c' }, s)!.payload as any[]).map((u) => u.id).sort();
  assert.deepEqual(ids, ['ana', 'zed']);
});

test('BOLD_GET_WORKSPACES lista workspaces da empresa com isCurrent', () => {
  const s = createState({ user: 'diego' });
  const r = handleBridgeMessage({ type: 'BOLD_GET_WORKSPACES', requestId: 'w' }, s)!;
  assert.equal(r.type, 'BOLD_WORKSPACES_RESPONSE');
  const ws = r.payload as any[];
  assert.deepEqual(ws.map((w) => w.id).sort(), ['atendimento', 'vendas']);
  assert.equal(ws.find((w) => w.isCurrent).id, 'vendas');
});

test('BOLD_GET_SSO_TOKEN: formato dev e expiracao/renovacao', () => {
  const s = createState({ user: 'ana' });
  const r = handleBridgeMessage({ type: 'BOLD_GET_SSO_TOKEN', requestId: 't1' }, s)!;
  assert.equal(r.type, 'BOLD_SSO_TOKEN_RESPONSE');
  assert.equal(r.payload, 'dev:ana:Ana:bold-solution:atendimento');
  assert.equal(r.payload, makeSsoToken(s));
  s.tokenExpired = true;
  const e = handleBridgeMessage({ type: 'BOLD_GET_SSO_TOKEN', requestId: 't2' }, s)!;
  assert.equal(e.payload, EXPIRED_TOKEN);
  assert.equal(e.requestId, 't2');
  assert.ok(!String(e.payload).startsWith('dev:'));
  s.tokenExpired = false;
  assert.equal(handleBridgeMessage({ type: 'BOLD_GET_SSO_TOKEN', requestId: 't3' }, s)!.payload, makeSsoToken(s));
});

test('token sanitiza ":" e espacos no nome', () => {
  const s = createState({ user: 'x', name: 'Joao: da Silva' });
  assert.equal(makeSsoToken(s).split(':').length, 5);
});

test('BOLD_GET_TAB_ACTIVE_STATE segue o estado da aba', () => {
  const s = createState({ user: 'ana' });
  let r = handleBridgeMessage({ type: 'BOLD_GET_TAB_ACTIVE_STATE', requestId: 'x' }, s)!;
  assert.equal(r.type, 'BOLD_TAB_ACTIVE_RESPONSE');
  assert.equal((r.payload as any).isActive, true);
  s.tabActive = false;
  r = handleBridgeMessage({ type: 'BOLD_GET_TAB_ACTIVE_STATE', requestId: 'y' }, s)!;
  assert.equal((r.payload as any).isActive, false);
  assert.equal((r.payload as any).isFocused, false);
  assert.equal(r.requestId, 'y');
});

test('rede caida: nao responde; eventos e tipos desconhecidos retornam null', () => {
  const s = createState({ user: 'ana' });
  s.online = false;
  assert.equal(handleBridgeMessage({ type: 'BOLD_GET_CONTEXT', requestId: 'z' }, s), null);
  s.online = true;
  assert.equal(handleBridgeMessage({ type: 'BOLD_SET_READY' }, s), null);
  assert.equal(handleBridgeMessage({ type: 'FOO', requestId: 'q' }, s), null);
  assert.equal(handleBridgeMessage(null as any, s), null);
  const c = handleBridgeMessage({ type: 'BOLD_CONTACTS_LIST', requestId: 'c1' }, s)!;
  assert.equal(c.type, 'BOLD_ERROR');
  assert.equal(c.requestId, 'c1');
});

test('classifyEvent cobre READY/TITLE/ROUTE/NOTIFICATION/LOADING', () => {
  assert.deepEqual(classifyEvent({ type: 'BOLD_SET_READY' }), { kind: 'ready' });
  assert.deepEqual(classifyEvent({ type: 'BOLD_SET_TITLE', payload: { title: 'Xadrez' } }), { kind: 'title', title: 'Xadrez' });
  assert.deepEqual(classifyEvent({ type: 'BOLD_ROUTE_CHANGED', payload: { path: '/sala/ABC234' } }), { kind: 'route', path: '/sala/ABC234' });
  assert.equal(classifyEvent({ type: 'BOLD_SEND_NOTIFICATION', payload: { title: 'Oi' } })!.kind, 'notification');
  assert.deepEqual(classifyEvent({ type: 'BOLD_SHOW_LOADING', payload: { show: false } }), { kind: 'loading', show: false });
  assert.equal(classifyEvent({ type: 'BOLD_GET_CONTEXT' }), null);
});

test('pushes e barra de endereco', () => {
  const s = createState({ user: 'bruno', theme: 'dark' });
  assert.deepEqual(pushTheme(s), { type: 'BOLD_THEME_CHANGED', payload: 'dark' });
  assert.deepEqual(pushNavigate('/x'), { type: 'BOLD_NAVIGATE', payload: { path: '/x' } });
  assert.equal(pushTabActive(s).type, 'BOLD_TAB_ACTIVE_CHANGED');
  assert.equal(addressBarFor(s, '/sala/ABC234'), '/acme-corp/vendas/chess/sala/ABC234');
  assert.equal(addressBarFor(s, '/'), '/acme-corp/vendas/chess');
});
