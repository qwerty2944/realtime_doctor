import { shell } from 'electron';
import { IPC, type SubscriptionState } from '../shared/types.js';
import { store } from './store.js';
import { getSupabase } from './supabaseClient.js';
import {
  daysRemaining,
  verifyToken,
  type EntitlementToken,
  type VerifyFailure
} from './subscriptionToken.js';

/**
 * 구독 게이트 (S2).
 *
 * 서버가 서명한 entitlement 토큰을 받아 캐시하고, 기능 진입점마다 그 토큰을
 * 다시 검증한다. 판정은 전부 서버가 한다 -- 여기서 하는 일은 "서버가 뭐라고
 * 서명했는지"를 확인하는 것뿐이다.
 *
 * 설계상 중요한 세 가지:
 *
 * 1. 캐시는 매번 다시 검증한다. electron-store 의 JSON 은 사용자가 편집할 수
 *    있으므로, 한 번 검증한 결과를 신뢰 상태로 들고 있으면 파일을 고치고
 *    재시작하는 것만으로 뚫린다.
 * 2. "네트워크 장애"와 "자격 없음"을 절대 같이 취급하지 않는다. 둘을 합치면
 *    서버가 5분 죽을 때 유료 고객 전원이 잠긴다. 서버가 서명해서 명시적으로
 *    entitled=false 를 말한 경우에만 잠근다. 그 외의 실패는 캐시로 버틴다.
 * 3. 캐시로 버티는 기간은 토큰 만료(72시간)까지다. 랜선을 뽑아도 영구 무료가
 *    되지는 않는다.
 */

// 공개키. 번들에 들어가도 되는 유일한 절반 -- 검증만 되고 발급은 불가능하다.
// (개인키는 Edge Function 환경변수에만 있고 electron.vite.config.ts 의
// EMBEDDED_ENV_KEYS 근처에도 가지 않는다.)
const FALLBACK_ENTITLEMENT_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElr+E32CHs/FVYKCWZPivFoULd57Q6HCL7XpNJh/4ovF1JYE12LlykVKmHfLewFdr/xAfxTQqtcoYldxkid4fAw==';

// admin-web 의 결제 페이지 (S3 에서 만든 `/billing`). 도메인은 배포처에 맞춰
// BILLING_PORTAL_URL 로 덮어쓴다. 경로(`/billing`)는 그대로 두어야 한다.
const FALLBACK_BILLING_URL = 'https://admin.realtime-doctor.app/billing';

/** 갱신 요청 타임아웃. 진료 중에 IPC 가 오래 매달려 있으면 안 된다. */
const FETCH_TIMEOUT_MS = 8000;

/** 같은 이유로 연달아 때리지 않기 위한 최소 간격 (하트비트는 5분이라 무해). */
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;

export type GateAction =
  | 'record'
  | 'analysis'
  | 'summary'
  | 'dictation'
  | 'patient-intake';

interface CachedEntitlement {
  token: unknown;
  /** 지금까지 관측한 가장 늦은 서버 시각(ms). 시계 되돌리기 방어의 기준점. */
  lastServerTimeMs: number;
}

let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
let currentUserId: string | null = null;
/** 마지막 갱신 시도가 네트워크/서버 문제로 실패했는가. */
let lastRefreshFailedOffline = false;
let lastRefreshAtMs = 0;
let inFlight: Promise<void> | null = null;

function publicKey(): string {
  return process.env.ENTITLEMENT_PUBLIC_KEY ?? FALLBACK_ENTITLEMENT_PUBLIC_KEY;
}

export function billingUrl(): string {
  return process.env.BILLING_PORTAL_URL ?? FALLBACK_BILLING_URL;
}

function entitlementUrl(): string | null {
  const explicit = process.env.ENTITLEMENT_URL;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/functions/v1/entitlement`;
}

function readCache(): CachedEntitlement | null {
  const raw = store.get('entitlement') as CachedEntitlement | undefined;
  if (!raw || typeof raw !== 'object') return null;
  return {
    token: (raw as CachedEntitlement).token,
    lastServerTimeMs:
      typeof raw.lastServerTimeMs === 'number' ? raw.lastServerTimeMs : 0
  };
}

function writeCache(token: EntitlementToken): void {
  const prev = readCache();
  const issued = Date.parse(token.issuedAt);
  store.set('entitlement', {
    token,
    // 단조 증가. 사용자가 파일에서 낮춰도 다음 성공 갱신에 다시 올라간다.
    lastServerTimeMs: Math.max(prev?.lastServerTimeMs ?? 0, Number.isFinite(issued) ? issued : 0)
  } satisfies CachedEntitlement);
}

export function clearEntitlementCache(): void {
  // 토큰만 지우고 lastServerTimeMs 는 남긴다. 로그아웃이 시계 방어를
  // 초기화하는 수단이 되면 안 된다.
  const prev = readCache();
  store.set('entitlement', {
    token: null,
    lastServerTimeMs: prev?.lastServerTimeMs ?? 0
  } satisfies CachedEntitlement);
}

function lockedState(
  status: SubscriptionState['status'],
  reason: string,
  source: SubscriptionState['source']
): SubscriptionState {
  return {
    entitled: false,
    status,
    plan: null,
    deviceLimit: 0,
    trialEndsAt: null,
    periodEnd: null,
    coverageEnd: null,
    daysRemaining: null,
    source,
    offline: lastRefreshFailedOffline,
    reason,
    checkedAt: new Date().toISOString()
  };
}

/**
 * 현재 구독 상태. 호출할 때마다 캐시된 토큰을 새로 검증한다.
 *
 * 로그아웃 상태는 잠금이다. "로그아웃하면 게이트가 사라진다"면 게이트가 아니다.
 */
export function getSubscriptionState(): SubscriptionState {
  if (!currentUserId) return lockedState('signed-out', 'signed_out', 'none');

  const cache = readCache();
  if (!cache || cache.token == null) {
    return lockedState('unknown', 'no_cached_token', 'none');
  }

  const result = verifyToken(cache.token, {
    publicKeyB64: publicKey(),
    nowMs: Date.now(),
    expectedUserId: currentUserId,
    lastServerTimeMs: cache.lastServerTimeMs
  });

  if (!result.ok) {
    const failure: VerifyFailure = result.failure;
    if (failure !== 'expired') {
      console.warn('[subscription] 캐시된 토큰을 거부했습니다:', failure);
    }
    return lockedState('unknown', failure, 'cache');
  }

  const token = result.token;
  const now = Date.now();
  return {
    entitled: token.entitled,
    status: token.status,
    plan: token.plan,
    deviceLimit: token.deviceLimit,
    trialEndsAt: token.trialEndsAt,
    periodEnd: token.periodEnd,
    coverageEnd: token.coverageEnd,
    daysRemaining: daysRemaining(token.coverageEnd, now),
    source: lastRefreshFailedOffline ? 'cache' : 'live',
    offline: lastRefreshFailedOffline,
    reason: token.reason,
    checkedAt: new Date(now).toISOString()
  };
}

function broadcastState(): void {
  broadcastFn?.(IPC.SubscriptionChanged, getSubscriptionState());
}

/** 사인인/사인아웃 시 index.ts 가 호출. 여기서만 사용자 컨텍스트가 바뀐다. */
export function setSubscriptionUser(userId: string | null): void {
  const changed = currentUserId !== userId;
  currentUserId = userId;
  if (!userId) {
    lastRefreshFailedOffline = false;
    clearEntitlementCache();
  }
  if (changed) broadcastState();
}

type RefreshOutcome =
  | { kind: 'updated'; entitled: boolean }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'skipped'; detail: string };

async function doRefresh(): Promise<RefreshOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { kind: 'skipped', detail: 'supabase_not_configured' };
  const url = entitlementUrl();
  if (!url) return { kind: 'skipped', detail: 'no_entitlement_url' };

  const { data, error } = await supabase.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || !session.user) {
    return { kind: 'skipped', detail: 'no_session' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: '{}',
      signal: controller.signal
    });
  } catch (err) {
    // 연결 거부·DNS·타임아웃. 판정이 아니라 "판정을 못 받았다".
    return {
      kind: 'unavailable',
      detail: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 401/403 도 unavailable 로 둔다. 토큰 만료·프록시 개입 등 서버가 "자격
    // 없음"을 말한 것이 아닌 경우가 대부분이고, 캐시는 어차피 72시간 뒤 만료된다.
    return { kind: 'unavailable', detail: `http_${res.status}` };
  }

  let body: { token?: unknown };
  try {
    body = (await res.json()) as { token?: unknown };
  } catch {
    return { kind: 'unavailable', detail: 'bad_json' };
  }

  const verified = verifyToken(body.token, {
    publicKeyB64: publicKey(),
    nowMs: Date.now(),
    expectedUserId: session.user.id,
    lastServerTimeMs: readCache()?.lastServerTimeMs ?? null
  });
  if (!verified.ok) {
    // 서명이 안 맞는 응답은 서버의 답이 아니다 (중간자 또는 키 불일치).
    // 캐시를 덮어쓰지 않는다.
    console.warn('[subscription] 서버 응답의 서명 검증 실패:', verified.failure);
    return { kind: 'unavailable', detail: `unverified_${verified.failure}` };
  }

  writeCache(verified.token);
  return { kind: 'updated', entitled: verified.token.entitled };
}

/**
 * entitlement 갱신. 앱 시작 / 로그인 직후 / 기기 하트비트에서 호출된다.
 * 새 타이머를 만들지 않는다 (계획서: 하트비트에 얹는다).
 */
export async function refreshEntitlement(
  trigger: 'startup' | 'signin' | 'heartbeat' | 'manual'
): Promise<SubscriptionState> {
  const now = Date.now();
  if (
    trigger === 'heartbeat' &&
    now - lastRefreshAtMs < MIN_REFRESH_INTERVAL_MS
  ) {
    return getSubscriptionState();
  }
  if (inFlight) {
    await inFlight;
    return getSubscriptionState();
  }

  inFlight = (async () => {
    lastRefreshAtMs = Date.now();
    const outcome = await doRefresh();
    if (outcome.kind === 'updated') {
      lastRefreshFailedOffline = false;
    } else if (outcome.kind === 'unavailable') {
      lastRefreshFailedOffline = true;
      console.warn(`[subscription] 갱신 실패(${trigger}) — 캐시 유지:`, outcome.detail);
    } else {
      // skipped: 로그인 자체가 없는 상태. 오프라인으로 표시하지 않는다.
      lastRefreshFailedOffline = false;
    }
  })().finally(() => {
    inFlight = null;
  });

  await inFlight;
  broadcastState();
  return getSubscriptionState();
}

/** 게이트에서 쓰는 잠금 사유 문구. 네트워크 문제와 미구독을 구분해서 보여준다. */
export function lockMessage(state: SubscriptionState): string {
  if (state.status === 'signed-out') return '로그인이 필요합니다.';
  if (state.reason === 'expired' || state.reason === 'no_cached_token') {
    return state.offline
      ? '구독 확인이 오래 지연되었습니다. 인터넷에 연결한 뒤 다시 시도하세요.'
      : '구독 확인이 필요합니다. 인터넷에 연결한 뒤 다시 시도하세요.';
  }
  if (state.reason === 'clock_rollback')
    return '시스템 시각이 올바르지 않습니다. 시간을 맞춘 뒤 다시 시도하세요.';
  if (
    state.reason === 'bad_signature' ||
    state.reason === 'malformed' ||
    state.reason === 'user_mismatch'
  )
    return '구독 정보를 확인할 수 없습니다. 다시 로그인해 주세요.';
  return '구독이 만료되었습니다. 구독 후 이용할 수 있습니다.';
}

export interface GateResult {
  ok: boolean;
  error?: string;
  state: SubscriptionState;
}

/**
 * 기능 진입 게이트. main 프로세스의 IPC 핸들러에서만 호출한다.
 *
 * 렌더러 버튼에만 걸면 ipcRenderer.invoke 를 직접 불러 우회할 수 있다.
 * 잠긴 상태에서 시도가 있었다는 사실은 broadcast 해서 dock 이 안내를 띄우게 한다.
 */
export function ensureEntitled(action: GateAction): GateResult {
  const state = getSubscriptionState();
  if (state.entitled) return { ok: true, state };
  const error = lockMessage(state);
  broadcastFn?.(IPC.SubscriptionBlocked, { action, state, message: error });
  console.warn(`[subscription] 잠김 상태에서 ${action} 시도를 차단했습니다 (${state.reason})`);
  return { ok: false, error, state };
}

/**
 * 결제 페이지 자동 로그인 링크를 admin-web 에 요청한다 (S3).
 *
 * 앱 안에서 이미 로그인한 의사에게 브라우저에서 비밀번호를 다시 치게 하는 것은
 * 결제 직전이라는 최악의 지점에 마찰을 넣는 일이다. 서버가 1회용 링크를 만들어
 * 준다. 여기서 URL 로 나가는 것은 Supabase 가 발급한 **1회용 OTP 해시**뿐이고
 * (수명 120초), refresh token 이나 장기 JWT 는 어떤 경로로도 URL 에 실리지 않는다.
 *
 * 실패하면 조용히 넘어가지 않고 이유를 남긴 뒤 일반 결제 페이지 주소를 돌려준다
 * -- 자동 로그인이 안 되는 것은 불편이지만, 결제 자체를 못 하게 되는 것은 손실이다.
 */
async function handoffUrl(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) return null;

  let endpoint: string;
  try {
    endpoint = new URL('/api/billing/handoff', billingUrl()).toString();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    if (!res.ok) {
      console.warn('[subscription] 자동 로그인 링크 요청 실패:', res.status);
      return null;
    }
    const body = (await res.json()) as { url?: unknown };
    return typeof body.url === 'string' ? body.url : null;
  } catch (err) {
    console.warn('[subscription] 자동 로그인 링크 요청 오류:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 결제 페이지를 외부 브라우저로 연다. 가능하면 자동 로그인 링크로. */
export async function openBillingPage(): Promise<boolean> {
  const url = (await handoffUrl()) ?? billingUrl();
  if (!/^https?:\/\//i.test(url)) {
    console.warn('[subscription] 허용되지 않은 결제 페이지 주소:', url);
    return false;
  }
  await shell.openExternal(url);
  return true;
}

export function initSubscription(opts: {
  broadcast: (channel: string, payload: unknown) => void;
}): void {
  broadcastFn = opts.broadcast;
}
