// Logica pura do lado host do protocolo postMessage do BoldBridge.
// Roda no Node (testes) e no navegador (servida transpilada em /protocol-handlers.js).
// Nao importar nada aqui (o navegador carrega o arquivo isolado).

export const DEV_TOKEN_PREFIX = 'dev:';
export const EXPIRED_TOKEN = 'expired.invalid.token';

export interface SimUser {
  id: string;
  name: string;
  email: string;
  accountId: string;
  workspaceId: string;
}
export interface SimAccount { id: string; name: string; slug: string }
export interface SimWorkspace { id: string; accountId: string; name: string; slug: string }

export const ACCOUNTS: SimAccount[] = [
  { id: 'bold-solution', name: 'Bold Solution', slug: 'bold-solution' },
  { id: 'acme-corp', name: 'Acme Corp', slug: 'acme-corp' },
  { id: 'globex', name: 'Globex', slug: 'globex' },
];
export const WORKSPACES: SimWorkspace[] = [
  { id: 'atendimento', accountId: 'bold-solution', name: 'Atendimento', slug: 'atendimento' },
  { id: 'vendas', accountId: 'bold-solution', name: 'Vendas', slug: 'vendas' },
  { id: 'vendas-acme', accountId: 'acme-corp', name: 'Vendas', slug: 'vendas' },
  { id: 'suporte', accountId: 'globex', name: 'Suporte', slug: 'suporte' },
];
export const USERS: SimUser[] = [
  { id: 'ana', name: 'Ana', email: 'ana@bold-solution.test', accountId: 'bold-solution', workspaceId: 'atendimento' },
  { id: 'bruno', name: 'Bruno', email: 'bruno@acme-corp.test', accountId: 'acme-corp', workspaceId: 'vendas-acme' },
  { id: 'carla', name: 'Carla', email: 'carla@globex.test', accountId: 'globex', workspaceId: 'suporte' },
  { id: 'diego', name: 'Diego', email: 'diego@bold-solution.test', accountId: 'bold-solution', workspaceId: 'vendas' },
];

export interface SimState {
  user: SimUser;
  account: SimAccount;
  workspace: SimWorkspace;
  /** Todos os usuarios conhecidos (diretorio); filtrados por workspace nas respostas. */
  directory: SimUser[];
  accounts: SimAccount[];
  workspaces: SimWorkspace[];
  theme: 'light' | 'dark';
  language: string;
  tabActive: boolean;
  tabFocused: boolean;
  tokenExpired: boolean;
  /** false = host "sem rede": nao responde a nenhuma requisicao. */
  online: boolean;
  instanceId: string;
}

export interface HostParams {
  user?: string | null;
  name?: string | null;
  account?: string | null;
  workspace?: string | null;
  theme?: string | null;
  language?: string | null;
}

const clean = (s: string) => s.replace(/[:\s]+/g, '_');

export function createState(p: HostParams = {}): SimState {
  const id = p.user || 'ana';
  const base = USERS.find((u) => u.id === id);
  const name = p.name || base?.name || id;
  const accountId = p.account || base?.accountId || 'bold-solution';
  const workspaceId = p.workspace || base?.workspaceId || 'atendimento';
  const accounts = [...ACCOUNTS];
  const workspaces = [...WORKSPACES];
  let account = accounts.find((a) => a.id === accountId);
  if (!account) {
    account = { id: accountId, name: accountId, slug: accountId };
    accounts.push(account);
  }
  let workspace = workspaces.find((w) => w.id === workspaceId && w.accountId === account!.id);
  if (!workspace) {
    workspace = { id: workspaceId, accountId: account.id, name: workspaceId, slug: workspaceId };
    workspaces.push(workspace);
  }
  const user: SimUser = {
    id,
    name,
    email: base?.email ?? `${id}@${account.slug}.test`,
    accountId: account.id,
    workspaceId: workspace.id,
  };
  const directory = USERS.filter((u) => u.id !== id).concat(user);
  return {
    user, account, workspace, directory, accounts, workspaces,
    theme: p.theme === 'dark' ? 'dark' : 'light',
    language: p.language || 'pt-BR',
    tabActive: true,
    tabFocused: true,
    tokenExpired: false,
    online: true,
    instanceId: `sim-${id}`,
  };
}

/** Token no formato aceito pelo modo dev do servidor: dev:<userId>:<nome>:<accountId>:<workspaceId> */
export function makeSsoToken(state: SimState): string {
  const u = state.user;
  return `${DEV_TOKEN_PREFIX}${clean(u.id)}:${clean(u.name)}:${clean(state.account.id)}:${clean(state.workspace.id)}`;
}

function ctxUser(u: SimUser, state: SimState) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: null,
    status: 'active',
    isSuperAdmin: false,
    workspaceRole: u.workspaceId === state.workspace.id ? 'member' : null,
    accountRole: 'member',
    role: 'member',
    companyRole: 'member',
  };
}

export function workspaceUsers(state: SimState) {
  return state.directory
    .filter((u) => u.accountId === state.account.id && u.workspaceId === state.workspace.id)
    .map((u) => ctxUser(u, state));
}

export function accountWorkspaces(state: SimState) {
  return state.workspaces
    .filter((w) => w.accountId === state.account.id)
    .map((w, i) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      role: 'member',
      workspaceRole: 'member',
      accountId: w.accountId,
      accountName: state.account.name,
      accountSlug: state.account.slug,
      status: 'active',
      sortOrder: i,
      isCurrent: w.id === state.workspace.id,
    }));
}

export function buildContext(state: SimState) {
  const users = workspaceUsers(state);
  const workspaces = accountWorkspaces(state);
  return {
    theme: state.theme,
    language: state.language,
    user: ctxUser(state.user, state),
    workspace: workspaces.find((w) => w.isCurrent)!,
    account: {
      id: state.account.id,
      name: state.account.name,
      slug: state.account.slug,
      role: 'member',
      accountRole: 'member',
      companyRole: 'member',
      workspaces,
    },
    users,
    role: 'member',
    companyRole: 'member',
    accountRole: 'member',
    workspaceRole: 'member',
    workspaces,
  };
}

export function buildTabActive(state: SimState) {
  return {
    isActive: state.tabActive,
    isFocused: state.tabActive && state.tabFocused,
    instanceId: state.instanceId,
    appId: 'bold-chess',
    appSlug: 'chess',
    activeAppId: state.tabActive ? 'bold-chess' : 'other-app',
  };
}

export interface BridgeMessage { type?: string; requestId?: string; payload?: unknown; [k: string]: unknown }
export interface BridgeReply { type: string; requestId?: string; payload?: unknown; error?: string }

/** Responde a uma requisicao do iframe. null = nada a responder (evento, tipo desconhecido, rede caida). */
export function handleBridgeMessage(msg: BridgeMessage, state: SimState): BridgeReply | null {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
  if (!state.online) return null;
  const requestId = msg.requestId;
  const reply = (type: string, payload: unknown): BridgeReply => ({ type, requestId, payload });
  switch (msg.type) {
    case 'BOLD_GET_CONTEXT':
      return reply('BOLD_CONTEXT_RESPONSE', buildContext(state));
    case 'BOLD_GET_USERS':
      return reply('BOLD_USERS_RESPONSE', workspaceUsers(state));
    case 'BOLD_GET_WORKSPACES':
      return reply('BOLD_WORKSPACES_RESPONSE', accountWorkspaces(state));
    case 'BOLD_GET_SSO_TOKEN':
      return reply('BOLD_SSO_TOKEN_RESPONSE', state.tokenExpired ? EXPIRED_TOKEN : makeSsoToken(state));
    case 'BOLD_GET_TAB_ACTIVE_STATE':
      return reply('BOLD_TAB_ACTIVE_RESPONSE', buildTabActive(state));
    case 'BOLD_DOWNLOAD_FILE':
      return reply('BOLD_DOWNLOAD_FILE_RESPONSE', { success: true });
    default:
      // Contatos: erro explicito (evita timeout de 5s no iframe).
      if (requestId && msg.type.startsWith('BOLD_CONTACTS_')) {
        return { type: 'BOLD_ERROR', requestId, error: `${msg.type} nao suportado pelo simulador` };
      }
      return null;
  }
}

/** Pushes host -> iframe (sem requestId). */
export const pushTheme = (s: SimState): BridgeReply => ({ type: 'BOLD_THEME_CHANGED', payload: s.theme });
export const pushLanguage = (s: SimState): BridgeReply => ({ type: 'BOLD_LANGUAGE_CHANGED', payload: s.language });
export const pushContext = (s: SimState): BridgeReply => ({ type: 'BOLD_CONTEXT_CHANGED', payload: buildContext(s) });
export const pushUsers = (s: SimState): BridgeReply => ({ type: 'BOLD_USERS_CHANGED', payload: workspaceUsers(s) });
export const pushTabActive = (s: SimState): BridgeReply => ({ type: 'BOLD_TAB_ACTIVE_CHANGED', payload: buildTabActive(s) });
export const pushNavigate = (path: string): BridgeReply => ({ type: 'BOLD_NAVIGATE', payload: { path } });

export type HostEvent =
  | { kind: 'ready' }
  | { kind: 'title'; title: string }
  | { kind: 'route'; path: string }
  | { kind: 'notification'; notification: Record<string, unknown> }
  | { kind: 'loading'; show: boolean }
  | { kind: 'external'; url: string }
  | { kind: 'other' };

/** Classifica mensagens iframe -> host que nao exigem resposta (efeitos de UI). */
export function classifyEvent(msg: BridgeMessage): HostEvent | null {
  if (!msg || typeof msg.type !== 'string') return null;
  const p = (msg.payload ?? {}) as Record<string, unknown>;
  switch (msg.type) {
    case 'BOLD_SET_READY': return { kind: 'ready' };
    case 'BOLD_SET_TITLE': return { kind: 'title', title: String(p.title ?? '') };
    case 'BOLD_ROUTE_CHANGED': return { kind: 'route', path: String(p.path ?? '/') };
    case 'BOLD_SEND_NOTIFICATION': return { kind: 'notification', notification: p };
    case 'BOLD_SHOW_LOADING': return { kind: 'loading', show: p.show !== false };
    case 'BOLD_OPEN_EXTERNAL_URL':
    case 'BOLD_OPEN_TAB': return { kind: 'external', url: String(p.url ?? '') };
    default: return msg.type.startsWith('BOLD_') && !msg.type.startsWith('BOLD_GET_') ? { kind: 'other' } : null;
  }
}

/** Barra de endereco simulada: /:accountSlug/:workspaceSlug/:appSlug/:subpath* */
export function addressBarFor(state: SimState, route: string): string {
  const sub = route.startsWith('/') ? route : '/' + route;
  return `/${state.account.slug}/${state.workspace.slug}/chess${sub === '/' ? '' : sub}`;
}
