import { ipcMain } from 'electron';
import {
  IPC,
  type AuthOpResult,
  type AuthState,
  type AuthUser
} from '../shared/types.js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient.js';

let currentUser: AuthUser | null = null;
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
let onSignedInFn: (() => void) | null = null;
let onSignedOutFn: (() => void) | null = null;
let subscribed = false;

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function getAuthState(): AuthState {
  return currentUser
    ? { status: 'signed-in', user: currentUser }
    : { status: 'signed-out' };
}

function translateError(message: string | undefined): string {
  if (!message) return '알 수 없는 오류';
  const m = message.toLowerCase();
  if (m.includes('user already registered')) return '이미 가입된 이메일입니다.';
  if (m.includes('invalid login credentials'))
    return '이메일 또는 비밀번호가 일치하지 않습니다.';
  if (m.includes('email not confirmed')) return '이메일 인증이 필요한 계정입니다.';
  if (m.includes('password should be at least'))
    return '비밀번호가 너무 짧습니다. (6자 이상)';
  if (m.includes('invalid email')) return '이메일 형식이 올바르지 않습니다.';
  return message;
}

function applySession(
  user: { id: string; email?: string | null } | null,
  event: string
): void {
  const previouslySignedIn = currentUser !== null;
  if (user) {
    currentUser = { id: user.id, email: user.email ?? '' };
  } else {
    currentUser = null;
  }
  const state = getAuthState();
  broadcastFn?.(IPC.AuthStateChange, state);

  const nowSignedIn = currentUser !== null;
  if (nowSignedIn && !previouslySignedIn) {
    onSignedInFn?.();
  } else if (!nowSignedIn && previouslySignedIn) {
    onSignedOutFn?.();
  } else if (event === 'INITIAL' && nowSignedIn) {
    onSignedInFn?.();
  }
}

function ensureSubscription(): void {
  if (subscribed) return;
  const supabase = getSupabase();
  if (!supabase) return;
  subscribed = true;
  void supabase.auth.getSession().then(({ data }) => {
    applySession(data.session?.user ?? null, 'INITIAL');
  });
  supabase.auth.onAuthStateChange((event, session) => {
    applySession(session?.user ?? null, event);
  });
}

export function setAuthCallbacks(opts: {
  broadcast: (channel: string, payload: unknown) => void;
  onSignedIn: () => void;
  onSignedOut: () => void;
}): void {
  broadcastFn = opts.broadcast;
  onSignedInFn = opts.onSignedIn;
  onSignedOutFn = opts.onSignedOut;
  ensureSubscription();
}

export function authConfigured(): boolean {
  return isSupabaseConfigured();
}

// IPC handlers — registered at module import so they exist before any renderer
// has a chance to invoke them, regardless of whenReady timing.
ipcMain.handle(IPC.AuthGetState, () => getAuthState());

ipcMain.handle(
  IPC.AuthSignUp,
  async (_e, payload: { email: string; password: string }): Promise<AuthOpResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'DB가 설정되지 않았습니다.' };
    ensureSubscription();
    const { data, error } = await supabase.auth.signUp({
      email: payload.email,
      password: payload.password
    });
    if (error) return { ok: false, error: translateError(error.message) };
    if (!data.session) {
      const signIn = await supabase.auth.signInWithPassword({
        email: payload.email,
        password: payload.password
      });
      if (signIn.error) return { ok: false, error: translateError(signIn.error.message) };
    }
    return { ok: true };
  }
);

ipcMain.handle(
  IPC.AuthSignIn,
  async (_e, payload: { email: string; password: string }): Promise<AuthOpResult> => {
    const supabase = getSupabase();
    if (!supabase) return { ok: false, error: 'DB가 설정되지 않았습니다.' };
    ensureSubscription();
    const { error } = await supabase.auth.signInWithPassword({
      email: payload.email,
      password: payload.password
    });
    if (error) return { ok: false, error: translateError(error.message) };
    return { ok: true };
  }
);

ipcMain.handle(IPC.AuthSignOut, async (): Promise<AuthOpResult> => {
  const supabase = getSupabase();
  if (!supabase) return { ok: true };
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: translateError(error.message) };
  return { ok: true };
});
