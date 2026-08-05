// realtime_doctor -- device Edge Function (S5).
//
// 기기 등록 / 하트비트 / 목록 / 해지를 전부 서버에서 처리한다.
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] 왜 클라이언트가 devices 테이블에 직접 쓰지 않는가
// ══════════════════════════════════════════════════════════════════════════
//
// S5 이전에는 Electron 이 anon 키로 `devices` 를 직접 upsert 했다. 그 구조에서
// "기기 2대 제한"은 클라이언트가 세는 숫자이므로 제한이 아니다:
//
//   * 세 번째 기기가 그냥 INSERT 하면 된다 (개수를 세는 코드를 안 부르면 끝).
//   * 해지된 기기가 `status = 'active'` 로 UPDATE 하면 원격 해지가 무효가 된다.
//   * anon 키는 이미 저장소에 커밋돼 있으므로 앱을 뜯을 필요조차 없고 curl 이면
//     충분하다.
//
// 그래서 0005 에서 `devices` 의 쓰기 권한을 authenticated 에게서 전부 걷어내고
// (GRANT 없음 + 정책 없음 = 두 번 거부), 모든 쓰기를 이 함수의 service_role 로
// 몬다. 클라이언트에 남는 것은 자기 행 SELECT 뿐이다.
//
// 판정 근거인 device_limit 은 `plans` 에서 읽는다. 클라이언트가 보내는 값은
// 어떤 것도 판정에 쓰지 않는다 -- userId 조차 본문에서 받지 않고 caller 의 JWT
// 에서만 얻는다 (entitlement 함수와 같은 규칙).
//
// ══════════════════════════════════════════════════════════════════════════
// 한도 초과 시 무엇을 하는가
// ══════════════════════════════════════════════════════════════════════════
//
// 가장 오래된 기기를 자동으로 밀어내지 않는다. 진료실 데스크톱과 노트북을 쓰는
// 의사가 집에서 잠깐 로그인하면 진료실 기기가 조용히 끊기고, 다음 날 아침
// 진료 직전에 그 사실을 알게 된다. 대신 **등록된 기기 목록을 돌려주고 어느
// 것을 내릴지 사용자가 고르게 한다.** 아무것도 고르지 않으면 새 기기는
// 등록되지 않고, 기존 기기들은 그대로 살아 있다 -- 실패해도 이미 쓰던 환경이
// 망가지지 않는 쪽이 기본값이다.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

interface DeviceRow {
  id: string;
  device_id: string;
  name: string;
  platform: string;
  app_version: string;
  status: string;
  created_at: string;
  last_seen_at: string;
}

const DEVICE_COLUMNS =
  'id, device_id, name, platform, app_version, status, created_at, last_seen_at';

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'server_misconfigured' }, 500);

  // 호출자 식별. [HARD] userId 는 본문에서 받지 않는다 -- 받으면 남의 기기를
  // 해지할 수 있다.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
  if (!jwt) return json({ error: 'unauthorized' }, 401);

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const action = str(body.action, 32);
  const deviceId = str(body.deviceId, 128);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  async function listDevices(): Promise<DeviceRow[]> {
    const { data, error } = await admin
      .from('devices')
      .select(DEVICE_COLUMNS)
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });
    if (error) throw new Error(`devices lookup failed: ${error.message}`);
    return (data ?? []) as DeviceRow[];
  }

  /** 이 사용자의 플랜이 허용하는 기기 수. 클라이언트 입력은 쓰지 않는다. */
  async function deviceLimit(): Promise<number> {
    const { data: sub } = await admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', userId)
      .maybeSingle();
    const planCode = (sub?.plan_code as string | undefined) ?? 'standard';
    const { data: plan } = await admin
      .from('plans')
      .select('device_limit')
      .eq('code', planCode)
      .maybeSingle();
    // 플랜을 못 읽으면 0 이다. fail-closed -- 알 수 없는 한도를 무제한으로
    // 해석하면 제한이 없는 것과 같다.
    return typeof plan?.device_limit === 'number' ? plan.device_limit : 0;
  }

  try {
    switch (action) {
      // ---------------------------------------------------------------------
      case 'list':
        return json({ ok: true, devices: await listDevices() }, 200);

      // ---------------------------------------------------------------------
      case 'register': {
        if (!deviceId) return json({ error: 'bad_request' }, 400);

        const existing = await listDevices();
        const mine = existing.find((d) => d.device_id === deviceId);

        // 해지된 기기는 재등록으로 되살아나지 않는다. 되살아난다면 원격 해지가
        // "앱을 껐다 켜면 풀리는" 기능이 된다.
        if (mine?.status === 'revoked') {
          return json({ ok: false, error: 'device_revoked', devices: existing }, 200);
        }

        const limit = await deviceLimit();
        const activeOthers = existing.filter(
          (d) => d.status === 'active' && d.device_id !== deviceId
        );

        // 이미 등록된 기기는 개수를 다시 세지 않는다 -- 매번 로그인할 때마다
        // 자기 자신 때문에 한도에 걸리면 안 된다.
        if (!mine && activeOthers.length >= limit) {
          return json(
            {
              ok: false,
              error: 'device_limit_exceeded',
              limit,
              devices: existing.filter((d) => d.status === 'active')
            },
            200
          );
        }

        const now = new Date().toISOString();
        const { error: upErr } = await admin.from('devices').upsert(
          {
            user_id: userId,
            device_id: deviceId,
            name: str(body.name, 120),
            platform: str(body.platform, 40),
            app_version: str(body.appVersion, 40),
            status: 'active',
            last_seen_at: now,
            revoked_at: null
          },
          { onConflict: 'user_id,device_id' }
        );
        if (upErr) throw new Error(`register failed: ${upErr.message}`);

        return json({ ok: true, limit, devices: await listDevices() }, 200);
      }

      // ---------------------------------------------------------------------
      case 'heartbeat': {
        if (!deviceId) return json({ error: 'bad_request' }, 400);
        // 상태 확인과 last_seen 갱신을 한 번에. status 는 서버가 보내는 값이며
        // revoked 면 앱이 즉시 로그아웃한다.
        const { data, error } = await admin
          .from('devices')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('device_id', deviceId)
          // 해지된 기기의 last_seen 은 갱신하지 않는다. 해지된 기기가 계속
          // "방금 접속함"으로 보이면 목록이 거짓말을 한다.
          .eq('status', 'active')
          .select('status')
          .maybeSingle();
        if (error) throw new Error(`heartbeat failed: ${error.message}`);
        if (data) return json({ ok: true, status: 'active' }, 200);

        // 갱신된 행이 없다 = 해지됐거나 등록 자체가 사라졌다. 둘 다 접근 차단이다.
        const { data: row } = await admin
          .from('devices')
          .select('status')
          .eq('user_id', userId)
          .eq('device_id', deviceId)
          .maybeSingle();
        return json({ ok: true, status: row?.status === 'revoked' ? 'revoked' : 'unregistered' }, 200);
      }

      // ---------------------------------------------------------------------
      case 'revoke': {
        // rowId 로 지정한다. 어느 쪽이든 user_id 조건이 함께 걸리므로 남의 기기는
        // 건드릴 수 없다.
        const rowId = str(body.rowId, 64);
        if (!rowId) return json({ error: 'bad_request' }, 400);
        const { data, error } = await admin
          .from('devices')
          .update({ status: 'revoked', revoked_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('id', rowId)
          .select('device_id')
          .maybeSingle();
        if (error) throw new Error(`revoke failed: ${error.message}`);
        if (!data) return json({ ok: false, error: 'not_found' }, 200);
        return json(
          { ok: true, revokedDeviceId: data.device_id, devices: await listDevices() },
          200
        );
      }

      // ---------------------------------------------------------------------
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (err) {
    console.error('[device]', err);
    return json({ error: 'internal' }, 500);
  }
});
