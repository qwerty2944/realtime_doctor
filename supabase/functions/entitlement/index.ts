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
// 판정 규칙은 A1 에서 _shared 로 뺐다. AI 프록시(ai-gemini, ai-realtime)가 같은
// 판정을 해야 하기 때문이다 -- 두 벌이 되면 갈라지고, 갈라진 날 "화면엔 만료인데
// API 는 계속 나간다"가 된다. 여기서 바뀐 것은 위치뿐이고 규칙은 그대로다.
import { derive, SUBSCRIPTION_COLUMNS, type Row } from '../_shared/entitlement.ts';
import {
  envPresence,
  healthResponse,
  isHealthRequest,
  rollUp,
  signingKeyUsable,
  tableReachable,
  type HealthCheck
} from '../_shared/health.ts';

/** 서명 토큰 유효기간 = 오프라인 유예 창(계획서 72시간). */
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

/**
 * GET ?health=1 -- 이 함수가 실제로 실패할 세 가지를 확인한다.
 *
 * 확인하는 것:
 *   env      -- 네 개의 환경변수가 존재하는가 (값은 보지 않는다)
 *   database -- service_role 로 `subscriptions` 에 닿는가. 이게 안 되면 이
 *               함수는 전원에게 503 을 주고, 그러면 모든 앱이 캐시 유예로
 *               버티다가 72시간 뒤 일제히 잠긴다.
 *   signing  -- ECDSA 개인키를 import 해서 실제로 한 번 서명하는가. 서명이
 *               안 되면 판정을 전달할 수단이 없고, 그건 자격 있는 의사가
 *               진료 중에 잠긴다는 뜻이다.
 *
 * 증명하지 못하는 것: 특정 사용자의 판정이 옳은지. 그건 그 사용자의 JWT 로
 * 실제 POST 를 해야 알 수 있고, 감시자는 그 계정을 갖고 있지 않다(그리고
 * 가져서도 안 된다).
 */
async function health(): Promise<Response> {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];

  checks.push(
    envPresence([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'ENTITLEMENT_PRIVATE_KEY'
    ])
  );

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url && serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    checks.push(await tableReachable(admin, 'subscriptions', 'database'));
    // plans 는 device_limit 의 출처다. 없으면 자격은 나가지만 기기 수가 0 이
    // 되어 앱이 등록을 못 한다 -- 치명적이지는 않으므로 critical 이 아니다.
    checks.push(await tableReachable(admin, 'plans', 'plans'));
  } else {
    checks.push({ name: 'database', ok: false, detail: '환경변수가 없어 조회를 시도하지 못함' });
  }

  checks.push(await signingKeyUsable('ENTITLEMENT_PRIVATE_KEY'));

  return healthResponse({
    surface: 'edge:entitlement',
    status: rollUp(checks, ['env', 'database', 'signing']),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
    provesWhenOk: [
      '함수가 배포되어 있고 요청을 받는다',
      'service_role 로 subscriptions/plans 를 읽을 수 있다',
      'ECDSA P-256 개인키를 import 해서 실제로 서명할 수 있다'
    ],
    doesNotProve: [
      '특정 사용자의 자격 판정이 옳은지 (사용자 JWT 가 필요하다)',
      '앱이 갖고 있는 공개키가 이 개인키와 짝인지 (검증은 앱 쪽에서 일어난다)',
      '토큰 만료·오프라인 유예 로직이 옳은지 (scripts/probe-entitlement.mjs 의 일이다)'
    ]
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // [HARD] 헬스체크는 호출자 JWT 검사보다 **먼저**다. 감시자에게 사용자 계정을
  // 요구하면 감시가 그 계정의 수명에 묶이고, 계정이 만료되는 날 감시도 같이
  // 조용히 멈춘다. 게이트웨이의 JWT 검증(anon 키면 통과)이 외부 노출을 막고,
  // 응답에는 구독 내용도 키도 들어가지 않으므로 새로 열리는 문은 없다.
  if (isHealthRequest(req)) return await health();
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
    .select(SUBSCRIPTION_COLUMNS)
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
