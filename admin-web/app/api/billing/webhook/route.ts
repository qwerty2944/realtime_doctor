import { NextResponse, after } from 'next/server';
import { verify, WebhookVerificationError } from '@portone/server-sdk/webhook';
import { getServiceSupabase } from '@/lib/supabase/service';
import { requireEnv } from '@/lib/env';
import { handleWebhookEvent, narrowEvent } from '@/lib/billing/webhook-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/webhook -- 포트원 V2 웹훅 수신 (S4, 처리 본체는 S5 에서
 * `lib/billing/webhook-handlers.ts` 로 분리).
 *
 * ── 왜 Edge Function 이 아니라 여기인가
 *
 * 이 엔드포인트가 성공 시 반드시 해야 하는 일이 **다음 달 재예약**이다. 그건
 * 포트원 REST 호출(`lib/portone/client.ts`)과 주기 산술(`lib/billing/period.ts`),
 * paymentId 규칙(`lib/billing/ids.ts`), service_role 클라이언트를 전부 필요로 하고
 * 그 넷은 이미 admin-web 에 있다. Deno Edge Function 으로 가면 같은 것을 한 벌 더
 * 만들게 되고, 그러면 "S3 의 예약 코드"와 "S4 의 예약 코드"가 갈라진다. 갈라진
 * 두 구현 중 하나만 고쳐지는 날 과금이 조용히 멈춘다 -- S4 가 존재하는 이유가
 * 정확히 그 실패 모드다. 그래서 재예약 구현을 하나로 유지할 수 있는 쪽에 둔다.
 * 포트원 API Secret 과 웹훅 시크릿은 여기서도 서버 전용 env 로만 읽는다.
 *
 * ── [HARD] 서명 검증은 파싱보다, DB 쓰기보다 먼저
 *
 * 검증 없는 웹훅 엔드포인트는 "JSON 하나 POST 하면 아무 구독이나 켜지는" 구멍,
 * 즉 유료화 전체의 인증 우회다. 그래서 아래 순서를 지킨다:
 *
 *   1. 원문 바이트를 그대로 읽는다  (req.text() -- 아래 주석 참조)
 *   2. 서명 검증
 *   3. 실패 시 400, DB 는 손도 대지 않는다
 *   4. 통과한 뒤에야 파싱 결과를 쓴다
 *
 * ── 원문(raw body) 읽기
 *
 * 서명은 `{webhook-id}.{webhook-timestamp}.{원문}` 에 대한 HMAC 이다. 원문이
 * 한 바이트라도 달라지면 검증이 깨진다. Next.js Route Handler 는 요청 본문을
 * 미리 파싱하지 않으므로(Express + body-parser 와 다른 점) `await req.text()` 가
 * 수신한 바이트를 그대로 준다. 이 라우트에서는 `req.json()` 을 절대 부르지
 * 않는다 -- 부르는 순간 재직렬화된 문자열로 검증하게 되고, 키 순서·공백·유니코드
 * 이스케이프가 달라져 조용히 전부 실패한다.
 *
 * ── 빠른 200 과 그 대가
 *
 * 포트원은 응답이 늦으면 재전송한다. 그래서 (a) 이벤트 기록 = 멱등성 선점만
 * 동기로 하고, (b) 실제 처리는 `after()` 로 응답 뒤에 돌린다.
 *
 * 그 대가로 `after()` 안에서 죽으면 포트원은 이미 200 을 받았으므로 재전송하지
 * 않는다. 그래서 처리 본체를 라우트 밖(`lib/billing/webhook-handlers.ts`)에 두고,
 * 감시 크론이 `processing_error is not null and processed_at is null` 행을 집어
 * **같은 함수로** 다시 돌린다 (S5). 정상 경로와 복구 경로가 서로 다른 코드를
 * 타면 복구가 조용히 낡는다.
 */

export async function POST(req: Request) {
  // --- 1) 원문 --------------------------------------------------------------
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400 });
  }

  // --- 2) 서명 검증 (DB 접근 전) --------------------------------------------
  let payload: unknown;
  try {
    payload = await verify(
      requireEnv('PORTONE_WEBHOOK_SECRET'),
      raw,
      Object.fromEntries(req.headers)
    );
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      // 401 이 아니라 400 이다. 포트원은 4xx 를 재전송하지 않으므로 어느 쪽이든
      // 재시도 폭풍은 없고, 이건 자격 문제가 아니라 요청이 잘못된 것이다.
      console.warn('[webhook] 서명 검증 실패', err.reason);
      return NextResponse.json({ error: 'invalid_signature', reason: err.reason }, { status: 400 });
    }
    console.error('[webhook] 검증 중 예외', err);
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const event = narrowEvent(payload);
  const eventId = req.headers.get('webhook-id') ?? '';
  if (!eventId) {
    // verify() 가 이미 헤더 존재를 요구하므로 여기 오는 일은 없다. 그래도
    // 이벤트 id 없이 진행하면 멱등성 1겹이 통째로 사라지므로 명시적으로 막는다.
    return NextResponse.json({ error: 'missing_event_id' }, { status: 400 });
  }

  const db = getServiceSupabase();

  // --- 3) 이벤트 선점 = 멱등성 1겹 ------------------------------------------
  const { error: eventErr } = await db.from('webhook_events').insert({
    portone_event_id: eventId,
    type: event.type,
    payload_json: payload as Record<string, unknown>,
    attempt_count: 1
  });

  if (eventErr) {
    if ((eventErr as { code?: string }).code === '23505') {
      // 재전송. 아무것도 다시 하지 않는다. 다만 몇 번 왔는지는 남긴다 --
      // 재전송이 잦다는 건 우리 200 이 제때 못 갔다는 신호다.
      const { data: prev } = await db
        .from('webhook_events')
        .select('attempt_count')
        .eq('portone_event_id', eventId)
        .maybeSingle();
      await db
        .from('webhook_events')
        .update({ attempt_count: (prev?.attempt_count ?? 1) + 1 })
        .eq('portone_event_id', eventId);
      console.info(`[webhook] 재전송 무시 event=${eventId} type=${event.type}`);
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    console.error('[webhook] 이벤트 기록 실패', eventErr.message);
    // 기록하지 못했으면 멱등성을 보장할 수 없다. 5xx 로 재전송을 유도한다.
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // --- 4) 처리는 응답 뒤에 ---------------------------------------------------
  after(async () => {
    try {
      await handleWebhookEvent(db, event);
      await db
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString(), processing_error: null })
        .eq('portone_event_id', eventId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[webhook] 처리 실패', eventId, event.type, message);
      // processed_at 은 비워 두고 사유를 남긴다. 포트원은 이미 200 을 받았으므로
      // 재전송되지 않는다 -- 이 행을 감시 크론이 집어 재처리한다 (S5).
      await db
        .from('webhook_events')
        .update({ processing_error: message.slice(0, 1000) })
        .eq('portone_event_id', eventId);
    }
  });

  return NextResponse.json({ ok: true, type: event.type }, { status: 200 });
}
