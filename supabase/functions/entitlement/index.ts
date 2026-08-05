// realtime_doctor -- entitlement Edge Function (S2).
//
// 앱이 자기 구독 상태를 물으면, 서버가 판정한 결과에 서명해서 돌려준다.
// 클라이언트는 이 토큰의 서명과 만료만 검증하면 되고, 판정 자체는 절대 하지 않는다.
//
// [HARD] fail-closed. 아래 어떤 경로로든 "확신을 갖고 자격 있음"이 아니면
// entitled=false 다. 특히:
//   * subscriptions 행이 없다  -> 자격 없음. (0002 의 가입 트리거는 의도적으로
//     fail-open 이라 DB 장애 때 행이 없는 유저가 생길 수 있다. 행 없음을
//     "무제한"으로 해석하면 그 순간 결제 시스템 전체가 무의미해진다.)
//   * DB 조회 에러 -> 자격 없음. 토큰을 아예 발급하지 않고 5xx 를 준다
//     (앱은 이걸 네트워크 장애로 취급해 캐시로 버틴다 -- 아래 주석 참조).
//   * 인증 실패 -> 401, 토큰 없음.
//
// 서명: ECDSA P-256 / SHA-256 (IEEE-P1363 raw r||s). 비대칭이어야 하는 이유는
// 명확하다. HMAC 은 검증자가 곧 발급자다 -- Electron 번들에 공유 비밀을 넣는
// 순간 누구나 entitled=true 토큰을 스스로 찍어낼 수 있다. 개인키는 이 함수의
// 환경변수에만 있고, 앱에는 공개키만 박힌다.

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** 서명 토큰 유효기간 = 오프라인 유예 창(계획서 72시간). */
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type Row = {
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  grace_until: string | null;
};

/** 서명 대상 클레임. sig 를 제외한 전부가 서명에 들어간다. */
interface Claims {
  v: 1;
  userId: string;
  entitled: boolean;
  /** 날짜까지 반영한 실효 상태. row 의 status 와 다를 수 있다. */
  status: 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled' | 'none';
  /** DB 에 적혀 있던 원본 status. 진단용. */
  rawStatus: string;
  plan: string;
  deviceLimit: number;
  trialEndsAt: string | null;
  periodEnd: string | null;
  graceUntil: string | null;
  /** 자격이 유지되는 마지막 시각. 남은 일수 계산의 근거. */
  coverageEnd: string | null;
  reason: string;
  issuedAt: string;
  expiresAt: string;
}

/**
 * 서명 대상 문자열.
 *
 * JSON.stringify 의 키 순서에 의존하지 않는다. Deno 와 Node 가 같은 바이트를
 * 만들어야 하는데, 그걸 런타임의 직렬화 구현에 맡기는 건 미래의 버그다.
 * 필드 순서를 코드로 고정하고 개행으로 잇는다. (앱 쪽 subscriptionToken.ts 의
 * canonicalize 와 반드시 동일해야 한다.)
 */
function canonicalize(c: Claims): string {
  return [
    'rdent.v1',
    String(c.v),
    c.userId,
    c.entitled ? 'true' : 'false',
    c.status,
    c.rawStatus,
    c.plan,
    String(c.deviceLimit),
    c.trialEndsAt ?? '',
    c.periodEnd ?? '',
    c.graceUntil ?? '',
    c.coverageEnd ?? '',
    c.reason,
    c.issuedAt,
    c.expiresAt
  ].join('\n');
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: CryptoKey | null = null;

async function signingKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const b64 = Deno.env.get('ENTITLEMENT_PRIVATE_KEY');
  if (!b64) throw new Error('ENTITLEMENT_PRIVATE_KEY is not configured');
  cachedKey = await crypto.subtle.importKey(
    'pkcs8',
    bytesFromB64(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  return cachedKey;
}

async function sign(c: Claims): Promise<string> {
  const key = await signingKey();
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(canonicalize(c))
  );
  return b64urlFromBytes(new Uint8Array(sig));
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * 날짜 우선순위 규칙 (S2 에서 확정).
 *
 * status 를 그대로 믿지 않는다. 크론이 한 번 실패하면 current_period_end 가
 * 과거인 채로 status='active' 인 행이 남는데, 그걸 믿으면 결제가 끊긴 계정이
 * 영원히 열린다. 반대로 날짜만 보면 canceled 계정이 기간 안이라고 열린다.
 * 그래서 둘 다 본다:
 *
 *   1. 행 없음                  -> 자격 없음 (fail-closed).
 *   2. status 가 종결 상태
 *      (canceled | expired)     -> 날짜와 무관하게 자격 없음.
 *   3. 그 외에는 status 가 "어떤 날짜가 유효한지"만 정하고,
 *      실제 판정은 그 날짜가 한다:
 *        trialing -> trial_ends_at
 *        active   -> current_period_end
 *        past_due -> max(current_period_end, grace_until)
 *                    (유예 중에는 막지 않는다 -- 계획서 4장)
 *   4. 해당 날짜가 없음(null)   -> 자격 없음. "언제까지인지 모르는 자격"은
 *                                 데이터 오류이고, 오류는 닫는 쪽으로 푼다.
 *   5. entitled = now < coverageEnd.
 *
 * 만료로 판정되면 실효 status 를 'expired' 로 내려 적는다 -- 앱은 DB 가 뭐라고
 * 적어놨든 화면에 "만료"를 보여줘야 한다.
 */
function derive(row: Row | null, nowMs: number): {
  entitled: boolean;
  status: Claims['status'];
  coverageEnd: string | null;
  reason: string;
} {
  if (!row) {
    return {
      entitled: false,
      status: 'none',
      coverageEnd: null,
      reason: 'no_subscription_row'
    };
  }

  const raw = (row.status ?? '').trim();

  if (raw === 'canceled' || raw === 'expired') {
    return { entitled: false, status: raw, coverageEnd: null, reason: `status_${raw}` };
  }

  let coverage: number | null = null;
  let basis = '';
  if (raw === 'trialing') {
    coverage = ms(row.trial_ends_at);
    basis = 'trial_ends_at';
  } else if (raw === 'active') {
    coverage = ms(row.current_period_end);
    basis = 'current_period_end';
  } else if (raw === 'past_due') {
    const a = ms(row.current_period_end);
    const b = ms(row.grace_until);
    coverage = a === null ? b : b === null ? a : Math.max(a, b);
    basis = 'max(current_period_end,grace_until)';
  } else {
    return {
      entitled: false,
      status: 'none',
      coverageEnd: null,
      reason: `unknown_status_${raw || 'empty'}`
    };
  }

  if (coverage === null) {
    return {
      entitled: false,
      status: 'expired',
      coverageEnd: null,
      reason: `missing_${basis}`
    };
  }

  const iso = new Date(coverage).toISOString();
  if (nowMs >= coverage) {
    return { entitled: false, status: 'expired', coverageEnd: iso, reason: `lapsed_${basis}` };
  }
  return {
    entitled: true,
    status: raw as Claims['status'],
    coverageEnd: iso,
    reason: `covered_by_${basis}`
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'server_misconfigured' }, 500);

  // 호출자 식별. userId 를 본문에서 받지 않는 것이 핵심이다 -- 받았다면 남의
  // userId 로 토큰을 발급받을 수 있다. 반드시 caller 의 JWT 에서만 얻는다.
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

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // billing_key / portone_customer_id 는 select 목록에 없다. 내려보낼 일이
  // 없는 값은 애초에 가져오지도 않는다.
  const { data: rows, error: subErr } = await admin
    .from('subscriptions')
    .select(
      'plan_code, status, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, grace_until'
    )
    .eq('user_id', userId)
    .limit(1);

  if (subErr) {
    // 토큰을 만들지 않는다. entitled=false 토큰을 주면 앱이 그걸 확정 판정으로
    // 받아들여 캐시를 덮어쓰고 잠근다 -- DB 순간 장애가 전원 잠금이 된다.
    // 5xx 는 앱 쪽에서 "네트워크 장애"로 분류돼 캐시 유예로 흘러간다.
    console.error('[entitlement] subscription lookup failed', subErr.message);
    return json({ error: 'lookup_failed' }, 503);
  }

  const row = (rows?.[0] as Row | undefined) ?? null;

  let deviceLimit = 0;
  const planCode = row?.plan_code ?? 'standard';
  const { data: plan } = await admin
    .from('plans')
    .select('device_limit')
    .eq('code', planCode)
    .maybeSingle();
  if (plan && typeof plan.device_limit === 'number') deviceLimit = plan.device_limit;

  const now = Date.now();
  const d = derive(row, now);
  // 자격이 없으면 기기 수도 0. "만료됐지만 2대는 쓸 수 있다"는 해석 여지를 없앤다.
  const claims: Claims = {
    v: 1,
    userId,
    entitled: d.entitled,
    status: d.status,
    rawStatus: row?.status ?? 'none',
    plan: planCode,
    deviceLimit: d.entitled ? deviceLimit : 0,
    trialEndsAt: row?.trial_ends_at ?? null,
    periodEnd: row?.current_period_end ?? null,
    graceUntil: row?.grace_until ?? null,
    coverageEnd: d.coverageEnd,
    reason: d.reason,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString()
  };

  let sig: string;
  try {
    sig = await sign(claims);
  } catch (err) {
    // 서명 불가 = 판정을 전달할 수단이 없음. 서명 없는 판정은 절대 내보내지 않는다.
    console.error('[entitlement] signing failed', err);
    return json({ error: 'signing_unavailable' }, 500);
  }

  return json({ token: { ...claims, sig } }, 200);
});
