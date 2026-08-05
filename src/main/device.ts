import { app } from 'electron';
import { hostname } from 'node:os';
import { IPC, type DeviceInfo } from '../shared/types.js';
import { getDeviceId } from './store.js';
import { refreshEntitlement } from './subscription.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 기기인증.
 *
 * 로그인하면 이 설치본의 deviceId(electron-store 에 영구 저장된 UUID)를
 * `devices` 에 등록한다. 사용자는 자신의 기기 목록을 보고 다른 기기를 원격
 * 해지(revoke)할 수 있으며, 해지된 기기는 다음 확인 시점(로그인/주기 하트비트)에
 * 강제 로그아웃된다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] S5: 모든 쓰기가 `device` Edge Function 을 거친다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 예전에는 이 파일이 anon 키로 `devices` 를 직접 upsert 했다. 그러면 플랜의
 * 기기 수 제한이 **클라이언트가 세는 숫자**가 되고, 그건 제한이 아니다 --
 * 개수를 세는 코드를 안 부르고 INSERT 하면 그만이고, 해지된 행을 active 로
 * UPDATE 하면 원격 해지도 무효가 된다. anon 키는 이미 코드에 커밋돼 있어서
 * 앱을 뜯을 필요조차 없다.
 *
 * 그래서 0005 에서 authenticated 의 쓰기 권한을 전부 걷어냈고, 등록·하트비트·
 * 해지는 service_role 을 쥔 Edge Function 만 할 수 있다. 여기 남은 코드는
 * 그 함수를 부르고 답을 화면에 옮기는 일뿐이다 -- 판정은 하나도 하지 않는다.
 *
 * 한도 초과 시 이 파일은 **아무 기기도 자동으로 밀어내지 않는다.** 서버가
 * 돌려준 기기 목록을 dock 에 broadcast 하고, 어느 것을 내릴지는 의사가 고른다.
 */

const HEARTBEAT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let heartbeatTimer: NodeJS.Timeout | null = null;
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
let forceSignOutFn: (() => Promise<void>) | null = null;

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[device:${scope}]`, msg);
}

export function initDeviceAuth(opts: {
  broadcast: (channel: string, payload: unknown) => void;
  forceSignOut: () => Promise<void>;
}): void {
  broadcastFn = opts.broadcast;
  forceSignOutFn = opts.forceSignOut;
}

function deviceFunctionUrl(): string | null {
  const explicit = process.env.DEVICE_FUNCTION_URL;
  if (explicit) return explicit;
  const base = process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/functions/v1/device`;
}

interface DeviceCallResult {
  ok: boolean;
  /** 서버가 판정을 돌려줬는가. false 면 네트워크/설정 문제다. */
  reached: boolean;
  error?: string;
  limit?: number;
  status?: 'active' | 'revoked' | 'unregistered';
  devices?: DeviceInfo[];
  revokedDeviceId?: string;
}

/**
 * Edge Function 호출.
 *
 * [HARD] 네트워크 실패와 "서버가 거부했다"를 구분한다(`reached`). 둘을 같이
 * 취급하면 진료실 와이파이가 잠깐 끊겼을 때 등록 실패로 읽혀 잠기거나, 반대로
 * 거부를 네트워크 문제로 읽어 그냥 통과시키게 된다. 구독 게이트에서 정한 것과
 * 같은 원칙이다.
 */
async function callDevice(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<DeviceCallResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reached: false, error: 'supabase_not_configured' };
  const url = deviceFunctionUrl();
  if (!url) return { ok: false, reached: false, error: 'no_device_function_url' };

  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { ok: false, reached: false, error: 'no_session' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
    if (!res.ok) {
      return { ok: false, reached: res.status < 500, error: `http_${res.status}` };
    }
    const body = (await res.json()) as Omit<DeviceCallResult, 'reached'>;
    const mine = getDeviceId();
    return {
      ...body,
      reached: true,
      devices: body.devices?.map((d) => ({ ...d, isCurrent: d.device_id === mine }))
    };
  } catch (err) {
    return {
      ok: false,
      reached: false,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleRevoked(): Promise<void> {
  stopHeartbeat();
  broadcastFn?.(IPC.DeviceRevoked, {
    message: '이 기기의 접근이 차단되어 로그아웃되었습니다.'
  });
  try {
    // 강제 로그아웃 = 게이트 잠금. auth 의 onSignedOut 이 오버레이를 숨기고
    // PHI 를 지우며, setSubscriptionUser(null) 이 구독 상태를 signed-out 으로
    // 내리므로 진행 중이던 녹음·분석의 다음 IPC 호출부터 전부 막힌다.
    await forceSignOutFn?.();
  } catch (err) {
    warn('forceSignOut', err);
  }
}

export type RegisterOutcome =
  /** 등록 완료(또는 이미 등록됨). 정상 사용. */
  | { kind: 'ok' }
  /** 이 기기가 해지됐다. 로그아웃 처리됨. */
  | { kind: 'revoked' }
  /** 한도 초과. 사용자가 내릴 기기를 골라야 한다. */
  | { kind: 'limit'; limit: number; devices: DeviceInfo[] }
  /** 서버에 닿지 못했다. 사용성을 막지 않는다 (구독 게이트가 따로 막는다). */
  | { kind: 'unavailable'; detail: string };

/**
 * 로그인 직후 호출. 기기를 등록하고 해지/한도를 확인한다.
 *
 * 서버에 닿지 못한 경우 통과시키는 이유: 기기 등록은 **동시 사용 대수 제한**
 * 이지 결제 게이트가 아니다. 진료실 네트워크가 끊겼다고 앱을 못 쓰게 만들 이유가
 * 없고, 실제 유료 게이트는 구독 토큰(72시간 유예)이 따로 담당한다. 반대로
 * 서버가 명시적으로 거부했을 때는 반드시 막는다.
 */
export async function registerCurrentDevice(userId: string): Promise<boolean> {
  void userId; // 사용자 식별은 서버가 JWT 로 한다. 여기서 보내지 않는다.
  const res = await callDevice('register', {
    deviceId: getDeviceId(),
    name: hostname(),
    platform: process.platform,
    appVersion: app.getVersion()
  });

  if (!res.reached) {
    warn('register', res.error ?? 'unreachable');
    startHeartbeat();
    return true;
  }

  if (res.ok) {
    startHeartbeat();
    return true;
  }

  if (res.error === 'device_revoked') {
    await handleRevoked();
    return false;
  }

  if (res.error === 'device_limit_exceeded') {
    // 아무 기기도 자동으로 밀어내지 않는다. 선택은 dock 이 받는다.
    broadcastFn?.(IPC.DeviceLimitExceeded, {
      limit: res.limit ?? 0,
      devices: res.devices ?? []
    });
    console.warn(`[device] 기기 한도 초과 (limit=${res.limit}). 사용자 선택 대기.`);
    // 로그아웃하지는 않는다. 의사는 이 화면에서 기기를 골라 내려야 하고,
    // 그러려면 로그인 상태가 유지돼야 한다. 하트비트는 걸지 않는다 --
    // 등록되지 않은 기기이므로 갱신할 행이 없다.
    return false;
  }

  warn('register', res.error ?? 'unknown');
  startHeartbeat();
  return true;
}

/**
 * 기기 하나를 내리고 이 기기를 다시 등록한다 (한도 초과 대화상자에서 호출).
 * 두 동작이 한 번에 일어나야 한다 -- 사이에 다른 기기가 로그인하면 다시 한도에
 * 걸리고, 의사는 왜 안 되는지 알 수 없다.
 */
export async function releaseAndRegister(
  rowId: string
): Promise<{ ok: boolean; error?: string; devices?: DeviceInfo[] }> {
  const revoked = await callDevice('revoke', { rowId });
  if (!revoked.reached) return { ok: false, error: '서버에 연결할 수 없습니다.' };
  if (!revoked.ok) return { ok: false, error: '기기를 해제하지 못했습니다.' };

  // 자기 자신을 내린 경우 (한도 초과 화면에서는 이 기기가 목록에 없으므로
  // 실제로는 일어나지 않지만, 방어적으로).
  if (revoked.revokedDeviceId === getDeviceId()) {
    await handleRevoked();
    return { ok: false, error: '이 기기의 접근이 해제되었습니다.' };
  }

  const outcome = await registerCurrentDevice('');
  if (!outcome) return { ok: false, error: '기기 등록에 실패했습니다.', devices: revoked.devices };
  return { ok: true, devices: revoked.devices };
}

/** 주기적으로 last_seen 갱신 + 원격 해지 감지. */
function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    // 구독 갱신을 이 하트비트에 얹는다. 별도 타이머를 만들지 않는다는 계획서
    // 결정 그대로다. 실패해도 기기 하트비트를 막지 않는다 (구독 쪽은 내부에서
    // 캐시 유예로 처리한다).
    void refreshEntitlement('heartbeat').catch(() => undefined);
    void (async () => {
      const res = await callDevice('heartbeat', { deviceId: getDeviceId() });
      if (!res.reached) {
        warn('heartbeat', res.error ?? 'unreachable');
        return;
      }
      // [HARD] 해지된 기기는 다음 하트비트에서 반드시 접근을 잃는다.
      // unregistered 도 같다 -- 등록이 사라진 기기를 계속 열어두면 관리자가
      // 행을 지우는 것으로는 접근을 끊을 수 없게 된다.
      if (res.status === 'revoked' || res.status === 'unregistered') await handleRevoked();
    })();
  }, HEARTBEAT_MS);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export async function listDevices(userId: string): Promise<DeviceInfo[]> {
  void userId;
  const res = await callDevice('list');
  if (!res.reached || !res.ok) {
    warn('list', res.error ?? 'unavailable');
    return [];
  }
  return res.devices ?? [];
}

/** 기기 해지. 현재 기기를 해지하면 즉시 로그아웃된다. */
export async function revokeDevice(
  userId: string,
  rowId: string
): Promise<{ ok: boolean; error?: string }> {
  void userId;
  const res = await callDevice('revoke', { rowId });
  if (!res.reached) return { ok: false, error: '서버에 연결할 수 없습니다.' };
  if (!res.ok) return { ok: false, error: '해지에 실패했습니다.' };
  if (res.revokedDeviceId === getDeviceId()) await handleRevoked();
  return { ok: true };
}
