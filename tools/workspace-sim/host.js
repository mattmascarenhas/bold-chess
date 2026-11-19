// Lado navegador do host simulado. A logica do protocolo vem de /protocol-handlers.js.
import * as H from '/protocol-handlers.js';

const cfg = window.__SIM__;
const $ = (id) => document.getElementById(id);
const state = H.createState(cfg.params);
const gameOrigin = new URL(cfg.gameUrl).origin;
const frame = $('game');
let route = cfg.params.route || '/';
let embeddedRoute = route;

function applyTheme() { document.body.classList.toggle('dark', state.theme === 'dark'); }
function stamp() { return new Date().toISOString().slice(11, 23); }

function log(kind, text) {
  const el = document.createElement('div');
  el.className = 'l ' + kind;
  el.textContent = `${stamp()} ${text}`;
  const box = $('log');
  box.appendChild(el);
  while (box.children.length > 400) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
const short = (o) => { try { const s = JSON.stringify(o); return s.length > 260 ? s.slice(0, 260) + '...' : s; } catch { return String(o); } };

function post(msg) {
  if (!frame.contentWindow) return;
  frame.contentWindow.postMessage(msg, gameOrigin);
  log('out', `host -> app ${msg.type}${msg.requestId ? ' #' + msg.requestId.slice(0, 8) : ''} ${short(msg.payload)}`);
}

function setAddress() {
  const path = H.addressBarFor(state, embeddedRoute);
  $('addr').value = location.origin + path;
  try {
    const u = new URL(location.href);
    u.searchParams.set('route', embeddedRoute);
    history.replaceState(null, '', u);
  } catch { /* ignore */ }
}

function refreshUi() {
  $('who').innerHTML = '';
  const b = document.createElement('span');
  b.textContent = state.user.name;
  const s = document.createElement('small');
  s.textContent = ` ${state.account.name} / ${state.workspace.name} (${state.user.id})`;
  $('who').append(b, s);
  $('bTheme').textContent = 'tema: ' + state.theme;
  $('bLang').textContent = 'idioma: ' + state.language;
  $('bTab').textContent = state.tabActive ? 'aba ativa' : 'aba inativa';
  $('bTab').classList.toggle('on', !state.tabActive);
  $('bNet').textContent = state.online ? 'rede on' : 'rede off';
  $('bNet').classList.toggle('on', !state.online);
  $('bExp').textContent = state.tokenExpired ? 'renovar token' : 'expirar token';
  $('bExp').classList.toggle('on', state.tokenExpired);
  $('offline').classList.toggle('on', !state.online);
  applyTheme();
}

function loadFrame() {
  // Sem ?ssoToken: o app deve pedir o token via BOLD_GET_SSO_TOKEN.
  const base = cfg.gameUrl.replace(/\/$/, '');
  frame.src = base + (embeddedRoute.startsWith('/') ? embeddedRoute : '/' + embeddedRoute);
  $('status').textContent = 'carregando...';
  log('sys', `iframe src=${frame.src}`);
}

window.addEventListener('message', (ev) => {
  if (ev.source !== frame.contentWindow) return;
  const msg = ev.data;
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !msg.type.startsWith('BOLD_')) return;
  log('in', `app -> host ${msg.type}${msg.requestId ? ' #' + String(msg.requestId).slice(0, 8) : ''} ${short(msg.payload)}`);
  const reply = H.handleBridgeMessage(msg, state);
  if (reply) post(reply);
  else if (!state.online && msg.requestId) log('drop', `sem rede: ${msg.type} #${String(msg.requestId).slice(0, 8)} ignorado`);
  const ev2 = H.classifyEvent(msg);
  if (!ev2) return;
  switch (ev2.kind) {
    case 'ready': $('status').textContent = 'pronto'; $('loading').classList.remove('on'); break;
    case 'title': document.title = ev2.title; $('status').textContent = ev2.title; break;
    case 'route': embeddedRoute = ev2.path; setAddress(); break;
    case 'loading': $('loading').classList.toggle('on', ev2.show); break;
    case 'notification': addNotif(ev2.notification); break;
    case 'external': log('sys', `abriria aba externa: ${ev2.url}`); break;
    default: break;
  }
});

function addNotif(n) {
  const el = document.createElement('div');
  el.className = 'notif ' + (['info', 'success', 'warning', 'error'].includes(n.type) ? n.type : 'info');
  const t = document.createElement('b');
  t.textContent = String(n.title ?? '(sem titulo)');
  el.append(t);
  if (n.text) { const p = document.createElement('div'); p.textContent = String(n.text); el.append(p); }
  if (n.action && n.action.url) {
    const a = document.createElement('button');
    a.textContent = String(n.action.label || 'Abrir');
    a.onclick = () => post(H.pushNavigate(String(n.action.url)));
    el.append(a);
  }
  $('notifs').prepend(el);
}

$('bTheme').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; refreshUi(); if (state.online) { post(H.pushTheme(state)); post(H.pushContext(state)); } };
$('bLang').onclick = () => { state.language = state.language === 'pt-BR' ? 'en-US' : 'pt-BR'; refreshUi(); if (state.online) { post(H.pushLanguage(state)); post(H.pushContext(state)); } };
$('bTab').onclick = () => { state.tabActive = !state.tabActive; refreshUi(); if (state.online) post(H.pushTabActive(state)); };
$('bNet').onclick = () => { state.online = !state.online; refreshUi(); log('sys', state.online ? 'rede restaurada' : 'rede derrubada (sem respostas)'); };
$('bExp').onclick = () => { state.tokenExpired = !state.tokenExpired; refreshUi(); log('sys', state.tokenExpired ? 'token passa a ser invalido' : 'token renovado'); };
$('bReload').onclick = () => loadFrame();
$('bUsers').onclick = () => post(H.pushUsers(state));
$('bClear').onclick = () => { $('log').innerHTML = ''; };
$('bNav').onclick = () => post(H.pushNavigate($('navPath').value || '/'));
$('togglePanel').onclick = () => $('panel').classList.toggle('collapsed');
frame.addEventListener('load', () => log('sys', 'iframe load'));

refreshUi();
setAddress();
loadFrame();
