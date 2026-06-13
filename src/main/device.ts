import { app } from 'electron';
import { hostname } from 'node:os';
import { IPC, type DeviceInfo } from '../shared/types.js';
import { getDeviceId } from './store.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 기기인증.
 *
 * 로그인하면 이 설치본의 deviceId(electron-store 에 영구 저장된 UUID)를
 * Supabase `devices` 테이블에 등록한다. 사용자는 자신의 기기 목록을 보고
 * 다른 기기를 원격 해지(revoke)할 수 있으며, 해지된 기기는 다음 확인
 * 시점(로그인/주기 하트비트)에 강제 로그아웃된다.
 */

const HEARTBEAT_MS = 5 * 60 * 1000;

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

async function handleRevoked(): Promise<void> {
  stopHeartbeat();
  broadcastFn?.(IPC.DeviceRevoked, {
    message: '이 기기의 접근이 차단되어 로그아웃되었습니다.'
  });
  try {
    await forceSignOutFn?.();
  } catch (err) {
    warn('forceSignOut', err);
  }
}

/**
 * 로그인 직후 호출. 기기를 등록(upsert)하고 해지 여부를 확인한다.
 * @returns true = 기기 사용 가능, false = 해지된 기기(로그아웃 처리됨).
 */
export async function registerCurrentDevice(userId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return true;
  const deviceId = getDeviceId();
  try {
    const { data: existing, error: selErr } = await supabase
      .from('devices')
      .select('id, status')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .maybeSingle();
    if (selErr) {
      warn('register:select', selErr.message);
      return true; // 네트워크/스키마 문제로 인증이 사용성을 막지 않게 함
    }
    if (existing?.status === 'revoked') {
      await handleRevoked();
      return false;
    }
    const { error: upErr } = await supabase.from('devices').upsert(
      {
        user_id: userId,
        device_id: deviceId,
        name: hostname(),
        platform: process.platform,
        app_version: app.getVersion(),
        status: 'active',
        last_seen_at: new Date().toISOString()
      },
      { onConflict: 'user_id,device_id' }
    );
    if (upErr) warn('register:upsert', upErr.message);
    startHeartbeat(userId);
    return true;
  } catch (err) {
    warn('register', err);
    return true;
  }
}

/** 주기적으로 last_seen 갱신 + 원격 해지 감지. */
function startHeartbeat(userId: string): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void (async () => {
      const supabase = getSupabase();
      if (!supabase) return;
      try {
        const { data, error } = await supabase
          .from('devices')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('device_id', getDeviceId())
          .select('status')
          .maybeSingle();
        if (error) {
          warn('heartbeat', error.message);
          return;
        }
        if (data?.status === 'revoked') await handleRevoked();
      } catch (err) {
        warn('heartbeat', err);
      }
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
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('devices')
      .select(
        'id, device_id, name, platform, app_version, status, created_at, last_seen_at'
      )
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });
    if (error) {
      warn('list', error.message);
      return [];
    }
    const mine = getDeviceId();
    return ((data ?? []) as Array<Omit<DeviceInfo, 'isCurrent'>>).map((d) => ({
      ...d,
      isCurrent: d.device_id === mine
    }));
  } catch (err) {
    warn('list', err);
    return [];
  }
}

/** 기기 해지. 현재 기기를 해지하면 즉시 로그아웃된다. */
export async function revokeDevice(
  userId: string,
  rowId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'DB가 설정되지 않았습니다.' };
  try {
    const { data, error } = await supabase
      .from('devices')
      .update({ status: 'revoked' })
      .eq('user_id', userId)
      .eq('id', rowId)
      .select('device_id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data?.device_id === getDeviceId()) await handleRevoked();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
