// Wrapper unico sobre o BoldBridge (SDK do Workspace) com fallback de modo dev.
import { BoldBridge } from '@bold-workspace/sdk/iframe';
import {
  buildDevToken,
  decideAuthMode,
  detectEmbedded,
  isDevAuthAllowed,
  resolveDevIdentity,
  type AuthMode,
} from './devAuth';

export type HostTheme = 'light' | 'dark';

export interface WorkspaceIdentity {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface WorkspaceInit {
  identity: WorkspaceIdentity;
  theme: HostTheme;
  language: string;
  embedded: boolean;
}

export type WorkspaceErrorCode = 'timeout' | 'login_required' | 'unknown';

export class WorkspaceError extends Error {
  code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

let bridge: BoldBridge | null = null;
let mode: AuthMode = 'dev';
let devToken: string | null = null;
let initPromise: Promise<WorkspaceInit> | null = null;

function getBridge(): BoldBridge {
  if (!bridge) bridge = new BoldBridge({ timeout: 5000 });
  return bridge;
}

function viteEnv(): { DEV?: boolean; VITE_ALLOW_DEV_AUTH?: string } | undefined {
  return (import.meta as unknown as { env?: { DEV?: boolean; VITE_ALLOW_DEV_AUTH?: string } }).env;
}

function normalizeTheme(t: unknown): HostTheme {
  return t === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: HostTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.hostTheme = theme;
}

function toWorkspaceError(err: unknown): WorkspaceError {
  if (err instanceof WorkspaceError) return err;
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === 'timeout' || /timed out/i.test(e?.message ?? '')) {
    return new WorkspaceError(
      'timeout',
      'O Bold Workspace nao respondeu a tempo (5 s). Verifique sua conexao e tente de novo.'
    );
  }
  return new WorkspaceError('unknown', e?.message ?? 'Falha ao falar com o Bold Workspace.');
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function doInit(): Promise<WorkspaceInit> {
  const embedded = detectEmbedded(typeof window !== 'undefined' ? window : undefined);
  mode = decideAuthMode(embedded, isDevAuthAllowed(viteEnv()));

  if (mode === 'embedded') {
    try {
      const b = getBridge();
      const ctx = await b.getContext();
      await b.getSSOToken();
      const theme = normalizeTheme(ctx.theme);
      applyTheme(theme);
      return {
        identity: {
          userId: ctx.user.id,
          name: ctx.user.name,
          avatarUrl: ctx.user.avatarUrl ?? null,
        },
        theme,
        language: ctx.language || 'pt-BR',
        embedded: true,
      };
    } catch (err) {
      throw toWorkspaceError(err);
    }
  }

  if (mode === 'dev') {
    const { userId, name } = resolveDevIdentity({
      search: window.location.search,
      storage: safeLocalStorage(),
    });
    devToken = buildDevToken(userId, name);
    applyTheme('dark');
    return {
      identity: { userId, name, avatarUrl: null },
      theme: 'dark',
      language: 'pt-BR',
      embedded: false,
    };
  }

  try {
    getBridge().redirectToLogin();
  } catch {
    /* segue para a tela amigavel */
  }
  throw new WorkspaceError('login_required', 'Entre no Bold Workspace para jogar.');
}

/** Idempotente; uma falha libera nova tentativa (botao "Tentar de novo"). */
export function initWorkspace(): Promise<WorkspaceInit> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function getToken(forceRefresh = false): Promise<string> {
  if (mode === 'embedded') {
    try {
      return await getBridge().getSSOToken({ forceRefresh });
    } catch (err) {
      throw toWorkspaceError(err);
    }
  }
  if (mode === 'dev' && devToken) return devToken;
  throw new WorkspaceError('login_required', 'Sem sessao do Workspace.');
}

const NOOP = () => {};

export function onThemeChange(cb: (theme: HostTheme) => void): () => void {
  if (mode !== 'embedded') return NOOP;
  return getBridge().onThemeChange((t) => {
    const theme = normalizeTheme(t);
    applyTheme(theme);
    cb(theme);
  });
}

export function onTabActive(cb: (isActive: boolean) => void): () => void {
  if (mode === 'embedded') {
    return getBridge().onTabActiveChange((s) => cb(Boolean(s.isActive)));
  }
  if (typeof document === 'undefined') return NOOP;
  const h = () => cb(!document.hidden);
  document.addEventListener('visibilitychange', h);
  return () => document.removeEventListener('visibilitychange', h);
}

/** Reporta ao host que o app terminou de carregar (chamar apos conectar/autenticar). */
export function setReady() {
  if (mode === 'embedded') getBridge().setReady();
}

export function setTitle(title: string) {
  if (mode === 'embedded') getBridge().setTitle(title);
}

export function setRoute(path: string) {
  if (mode === 'embedded') getBridge().setRoute(path);
}

export function onNavigate(cb: (path: string) => void): () => void {
  if (mode !== 'embedded') return NOOP;
  return getBridge().onNavigate(cb);
}

/** Notificacao do Workspace: extra opcional, falha silenciosa. */
export function notifyLocal(title: string, message?: string) {
  if (mode !== 'embedded') return;
  try {
    getBridge().notify({ title, message });
  } catch {
    /* extra opcional */
  }
}
