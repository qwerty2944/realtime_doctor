// realtime_doctor -- AI 프록시 공통 게이트 (A1).
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] 왜 이 파일이 존재하는가
// ══════════════════════════════════════════════════════════════════════════
//
// A1 이전에는 GEMINI_API_KEY 와 OPENAI_API_KEY 가 Electron 번들 안에 인라인돼
// 있었다(`electron.vite.config.ts` 의 EMBEDDED_ENV_KEYS). 그 구조에서는:
//
//   * 빌드 하나만 손에 넣으면 누구나 소유자의 API 크레딧을 무제한으로 쓴다.
//     구독 게이트는 Electron 안에 있고, 키도 Electron 안에 있다 -- 게이트를
//     지나지 않고 키만 꺼내 쓰면 그만이다.
//   * 키가 샜을 때 회수하려면 새 키로 다시 빌드해서 전 설치본에 재배포해야
//     한다. 즉 실질적으로 회수 불가능하다.
//   * 사용량은 클라이언트가 자진 신고한다(`src/main/sessions.ts` 의 logUsage).
//     수정한 클라이언트는 그냥 신고를 안 하면 된다. 그래서 고객당 원가를 알 수
//     없다 -- 월 7만원 상품에서 원가를 모른다는 건 마진을 모른다는 뜻이다.
//
// 이 게이트를 지나야만 provider 호출이 일어나고, 지나간 사실이 서버에서
// `usage_events` 로 기록된다. 클라이언트가 건너뛸 수 있는 계량은 계량이 아니다.
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] fail-closed
// ══════════════════════════════════════════════════════════════════════════
//
// 아래 어떤 경로로든 "확신을 갖고 자격 있음"이 아니면 provider 를 호출하지
// 않는다. 호출자 함수는 openGate() 가 ok:false 를 주면 그 Response 를 그대로
// 돌려주고 끝낸다 -- 게이트 뒤로 넘어가는 코드 경로가 하나뿐이어야 한다.
//
//   * Authorization 헤더 없음 / JWT 검증 실패 -> 401
//   * subscriptions 행 없음 / 만료 / 해지      -> 402 (결제 필요)
//   * DB 조회 에러                              -> 503
//   * 서버 환경변수 누락                        -> 500
//
// DB 조회 에러에서 entitlement 함수와 결론이 다르다는 점에 주의. entitlement 는
// 5xx 를 주고 앱이 캐시로 버티게 한다(장애가 전원 잠금이 되면 안 되니까).
// 여기서는 "버틴다"가 곧 "소유자 크레딧을 쓴다"이므로 버티지 않고 거절한다.
// DB 가 죽은 5분 동안 분석이 안 되는 것과, DB 가 죽은 5분 동안 아무나 크레딧을
// 쓸 수 있는 것 중 후자가 비교할 수 없이 나쁘다.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { derive, SUBSCRIPTION_COLUMNS, type Row } from './entitlement.ts';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-rd-task, x-rd-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export interface GateOk {
  ok: true;
  userId: string;
  admin: SupabaseClient;
  /** 앱이 보낸 작업 이름. 계량용 라벨일 뿐 판정에는 쓰지 않는다. */
  task: string;
  /** 앱이 보낸 세션 id. FK 위반을 피하려고 존재 확인 후에만 쓴다. */
  sessionId: string | null;
}

export interface GateDenied {
  ok: false;
  response: Response;
}

export type Gate = GateOk | GateDenied;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/**
 * 인증 + 자격 확인. 통과했을 때만 ok:true 를 준다.
 *
 * [HARD] userId 는 본문에서 받지 않는다 -- 받는 순간 남의 계정으로 청구되는
 * 호출을 만들 수 있다. entitlement / device 함수와 같은 규칙이다.
 */
export async function openGate(req: Request): Promise<Gate> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) {
    console.error('[gate] server misconfigured: SUPABASE_* env missing');
    return { ok: false, response: json({ error: 'server_misconfigured' }, 500) };
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
  if (!jwt) return { ok: false, response: json({ error: 'unauthorized' }, 401) };

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let userId: string;
  try {
    const { data, error } = await asCaller.auth.getUser(jwt);
    if (error || !data?.user) {
      return { ok: false, response: json({ error: 'unauthorized' }, 401) };
    }
    userId = data.user.id;
  } catch (err) {
    // getUser 가 던지는 경우(Auth 서버 장애 등)도 인증 실패로 닫는다.
    console.error('[gate] getUser threw', err);
    return { ok: false, response: json({ error: 'unauthorized' }, 401) };
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let row: Row | null;
  try {
    const { data, error } = await admin
      .from('subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('user_id', userId)
      .limit(1);
    if (error) {
      console.error('[gate] subscription lookup failed', error.message);
      return { ok: false, response: json({ error: 'lookup_failed' }, 503) };
    }
    row = (data?.[0] as Row | undefined) ?? null;
  } catch (err) {
    console.error('[gate] subscription lookup threw', err);
    return { ok: false, response: json({ error: 'lookup_failed' }, 503) };
  }

  const d = derive(row, Date.now());
  if (!d.entitled) {
    return {
      ok: false,
      response: json(
        { error: 'not_entitled', status: d.status, reason: d.reason },
        402
      )
    };
  }

  return {
    ok: true,
    userId,
    admin,
    task: str(req.headers.get('x-rd-task'), 40),
    sessionId: str(req.headers.get('x-rd-session-id'), 64) || null
  };
}

export interface UsageRecord {
  provider: string;
  task: string;
  model: string;
  prompt_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  chars?: number | null;
  duration_ms?: number | null;
}

/**
 * 서버가 관측한 사용량을 기록한다.
 *
 * `source='server'` 로 적는다 -- 기존 클라이언트 신고 행(`source='client'`)과
 * 섞이면 과금 근거로 못 쓴다. 0016 마이그레이션 참조.
 *
 * session_id 는 앱이 보낸 값을 그대로 믿지 않고 **본인 소유인지 확인한 뒤에만**
 * 넣는다. FK 위반으로 계량 행 전체가 날아가는 걸 막는 목적도 있지만, 더 중요한
 * 건 남의 세션에 자기 사용량을 붙일 수 없어야 한다는 것이다.
 *
 * [HARD] 기록 실패가 provider 응답을 막지는 않는다 -- 이미 돈은 나갔고, 여기서
 * 500 을 주면 사용자는 돈이 나간 호출의 결과를 못 받는다. 대신 반드시 로그를
 * 남긴다. 조용히 사라지면 "계량이 되고 있다"는 착각이 생긴다.
 */
export async function recordUsage(
  gate: GateOk,
  rec: UsageRecord
): Promise<void> {
  let sessionId: string | null = null;
  if (gate.sessionId) {
    try {
      const { data } = await gate.admin
        .from('sessions')
        .select('id')
        .eq('id', gate.sessionId)
        .eq('user_id', gate.userId)
        .maybeSingle();
      if (data?.id) sessionId = data.id as string;
    } catch {
      /* 세션 확인 실패는 계량 자체를 막지 않는다. session_id 없이 기록한다. */
    }
  }

  try {
    const { error } = await gate.admin.from('usage_events').insert({
      user_id: gate.userId,
      session_id: sessionId,
      provider: rec.provider,
      task: rec.task,
      model: rec.model,
      prompt_tokens: rec.prompt_tokens ?? null,
      output_tokens: rec.output_tokens ?? null,
      total_tokens: rec.total_tokens ?? null,
      chars: rec.chars ?? null,
      duration_ms: rec.duration_ms ?? null,
      source: 'server'
    });
    if (error) console.error('[gate] recordUsage failed', error.message);
  } catch (err) {
    console.error('[gate] recordUsage threw', err);
  }
}
