// realtime_doctor -- Edge Function 공통 헬스체크 (O1).
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] "200 이 떴다"는 헬스체크가 아니다
// ══════════════════════════════════════════════════════════════════════════
//
// Deno 가 살아 있다는 사실만 확인하는 200 은 아무것도 없는 것보다 나쁘다.
// 잘못된 확신을 만들기 때문이다. entitlement 는 서명키가 만료되면 죽고,
// AI 프록시는 provider 키가 만료되거나 DB 를 못 읽으면 죽는데, 그 어떤
// 경우에도 런타임은 멀쩡히 200 을 돌려줄 수 있다.
//
// 그래서 각 함수는 **자기가 실제로 실패할 의존성**만 확인한다. 확인 항목은
// 응답에 이름과 함께 실려 나가고, 각 항목이 무엇을 증명하지 **못하는지**도
// `provesWhenOk` / `doesNotProve` 로 같이 나간다 -- 헬스체크를 읽는 사람이 그
// 한계를 코드를 열어보지 않고 알 수 있어야 한다.
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] 헬스체크가 하지 않는 일
// ══════════════════════════════════════════════════════════════════════════
//
//   * provider(Gemini/OpenAI/CLOVA)를 호출하지 않는다. 호출하면 감시가 곧
//     비용이 되고, 자주 돌릴수록 비싸지는 감시는 결국 안 돌리게 된다.
//   * PHI 를 만들지 않고 읽지도 않는다. 존재 확인용 count 만 쓴다.
//   * 인증 정보를 응답에 담지 않는다. 환경변수는 **이름과 존재 여부**만 나간다.
//
// ══════════════════════════════════════════════════════════════════════════
// 접근 방식: `GET ?health=1`
// ══════════════════════════════════════════════════════════════════════════
//
// 이 프로젝트의 Edge Function 은 게이트웨이에서 JWT 검증이 켜져 있다(인증
// 헤더 없이 부르면 함수 코드에 닿기도 전에 401). anon 키는 유효한 JWT 이므로
// 게이트웨이를 통과하고, 그 뒤에 이 분기가 사용자 JWT 검사보다 **먼저**
// 실행된다. 즉 감시자는 anon 키만 있으면 되고, 사용자 계정은 필요 없다.
//
// anon 키로 열려 있어도 새로 새는 것은 없다: 아래 응답에는 구독 내용도,
// 기기 목록도, 키도 들어가지 않는다.

export interface HealthCheck {
  /** 기계가 읽는 이름. 프로버가 이걸로 분류한다. */
  name: string;
  ok: boolean;
  /** 사람이 읽는 한 줄. 절대 비밀값을 담지 않는다. */
  detail: string;
}

export interface HealthReport {
  surface: string;
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  latencyMs: number;
  checks: HealthCheck[];
  provesWhenOk: string[];
  doesNotProve: string[];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

/** 이 요청이 헬스체크인가. GET + `?health=1` 만 인정한다. */
export function isHealthRequest(req: Request): boolean {
  if (req.method !== 'GET') return false;
  return new URL(req.url).searchParams.get('health') === '1';
}

/**
 * 환경변수 존재 확인.
 *
 * [HARD] 값은 절대 응답에 넣지 않는다. 이름과 boolean 만. 그리고 "있다"는
 * "유효하다"가 아니다 -- 만료된 provider 키도 여기서는 통과한다. 그 한계는
 * 호출자가 `doesNotProve` 에 적어야 한다.
 */
export function envPresence(names: string[]): HealthCheck {
  const missing = names.filter((n) => {
    const v = Deno.env.get(n);
    return !v || v.trim() === '';
  });
  return {
    name: 'env',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `필수 환경변수 ${names.length}개 모두 설정됨 (값은 확인하지 않음)`
        : `설정되지 않은 환경변수: ${missing.join(', ')}`
  };
}

/**
 * 이 함수가 실제로 읽는 테이블에 닿는지 확인한다.
 *
 * `head: true` + `count: 'exact'` 라서 행 내용은 한 바이트도 오지 않는다.
 * 그러면서도 (a) service_role 키가 유효하고 (b) PostgREST 가 살아 있고
 * (c) 그 테이블이 존재하며 (d) service_role 이 SELECT 권한을 갖고 있다는
 * 네 가지를 한 번에 확인한다 -- 이 넷 중 하나만 깨져도 함수 본체가 죽는다.
 */
export async function tableReachable(
  // deno-lint-ignore no-explicit-any
  admin: any,
  table: string,
  checkName: string
): Promise<HealthCheck> {
  try {
    const { error } = await admin.from(table).select('*', { count: 'exact', head: true }).limit(1);
    if (error) {
      return { name: checkName, ok: false, detail: `${table} 조회 실패: ${error.message}` };
    }
    return { name: checkName, ok: true, detail: `${table} 조회 가능 (행 내용은 읽지 않음)` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name: checkName, ok: false, detail: `${table} 조회 예외: ${message}` };
  }
}

/**
 * 서명키가 실제로 서명을 만들어 내는지 확인한다.
 *
 * entitlement 의 유일한 산출물은 **서명된** 판정이다. 서명에 실패하면 그
 * 함수는 500 만 돌려주는 껍데기이고, 그 상태에서도 DB 조회와 런타임은 멀쩡히
 * 살아 있다. 그래서 키 존재 확인(`envPresence`)으로는 부족하고, 실제로
 * import 해서 실제로 한 번 서명해 봐야 한다.
 *
 * 서명 결과는 버린다. 응답에는 길이조차 싣지 않는다.
 */
export async function signingKeyUsable(envName: string): Promise<HealthCheck> {
  const b64 = Deno.env.get(envName);
  if (!b64) {
    return { name: 'signing', ok: false, detail: `${envName} 가 설정되지 않음` };
  }
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const key = await crypto.subtle.importKey(
      'pkcs8',
      bytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode('rdent.health.canary')
    );
    return {
      name: 'signing',
      ok: true,
      detail: 'ECDSA P-256 개인키 import + 서명 1회 성공 (결과는 폐기)'
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name: 'signing', ok: false, detail: `서명키 사용 불가: ${message}` };
  }
}

/**
 * 결과를 HTTP 로 옮긴다.
 *
 * 상태 코드 규칙:
 *   200 -- ok / degraded. 표면은 응답하고 있다.
 *   503 -- down. 이 함수가 실제로 실패할 의존성 중 하나가 깨져 있다.
 *
 * degraded 를 200 으로 두는 이유: 상태 코드만 보는 감시자에게 "완전히 죽음"과
 * "일부 이상"은 다른 대응이고, degraded 에 503 을 주면 둘을 구별할 수 없게
 * 된다. 프로버는 본문의 `status` 를 읽어 셋을 전부 구별한다.
 */
export function healthResponse(report: HealthReport): Response {
  return new Response(JSON.stringify(report, null, 2), {
    status: report.status === 'down' ? 503 : 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      // 감시 응답이 캐시되면 캐시된 "정상"을 계속 보게 된다. 최악의 실패 모드다.
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}

/** 필수 항목이 하나라도 깨지면 down. 그 외 실패는 degraded. */
export function rollUp(checks: HealthCheck[], critical: string[]): 'ok' | 'degraded' | 'down' {
  if (checks.some((c) => !c.ok && critical.includes(c.name))) return 'down';
  if (checks.some((c) => !c.ok)) return 'degraded';
  return 'ok';
}

/**
 * 두 AI 프록시(ai-gemini, ai-realtime)의 헬스체크.
 *
 * 둘의 확인 항목은 provider 키 이름 하나만 빼고 완전히 같다 -- 둘 다
 * `openGate()` 를 지나야만 동작하고, 그 게이트의 의존성은 `subscriptions`
 * 하나다. 두 벌로 두면 한쪽만 고쳐지는 날이 오므로 여기 한 벌로 둔다
 * (게이트 자체를 _shared/gate.ts 에 한 벌로 둔 것과 같은 이유다).
 *
 * [HARD] provider 를 호출하지 않는다. 키가 **있는지**만 본다. 만료된 키는 이
 * 검사를 통과하며, 그 한계는 아래 doesNotProve 에 명시된다. 감시가 매 실행마다
 * 유료 API 를 두드리면 감시 주기가 곧 비용이 되고, 비싼 감시는 결국 꺼진다.
 */
export async function aiProxyHealth(
  surface: string,
  providerKeyEnv: string
): Promise<Response> {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];

  checks.push(
    envPresence(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', providerKeyEnv])
  );

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url && serviceKey) {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    // 게이트가 읽는 테이블. 여기가 끊기면 게이트는 fail-closed 로 전원을
    // 거절하고(gate.ts 헤더), 분석·요약·구술이 통째로 멈춘다.
    checks.push(await tableReachable(admin, 'subscriptions', 'database'));
    // 계량이 기록되는 곳. 끊겨도 기능은 돌지만 원가를 알 수 없게 된다 --
    // 월 7만원 상품에서 원가를 모른다는 건 마진을 모른다는 뜻이라 degraded 다.
    checks.push(await tableReachable(admin, 'usage_events', 'metering'));
  } else {
    checks.push({ name: 'database', ok: false, detail: '환경변수가 없어 조회를 시도하지 못함' });
  }

  return healthResponse({
    surface,
    status: rollUp(checks, ['env', 'database']),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
    provesWhenOk: [
      '함수가 배포되어 있고 요청을 받는다',
      `${providerKeyEnv} 가 비어 있지 않다`,
      '게이트가 읽는 subscriptions 와 계량이 쓰는 usage_events 에 닿는다'
    ],
    doesNotProve: [
      `${providerKeyEnv} 가 유효한지 -- 만료·정지·한도초과 키도 이 검사를 통과한다 (확인하려면 유료 호출이 필요하다)`,
      'provider 자체가 살아 있는지',
      '자격 판정이 옳은지 (사용자 JWT 가 필요하다)'
    ]
  });
}
