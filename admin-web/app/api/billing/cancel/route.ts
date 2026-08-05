import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { getServiceSupabase } from '@/lib/supabase/service';
import { ensureNextSchedule } from '@/lib/billing/cycle';
import { revokeUpcomingSchedules } from '@/lib/billing/dunning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/cancel  { cancel: boolean }
 *
 * 해지 예약 / 해지 취소. 계획서 5장: **이미 낸 기간은 끝까지 쓴다.**
 * 즉시 해지도, 자동 환불도 하지 않는다 -- 중도 환불은 관리자가 포트원
 * 콘솔에서 처리하고 상태를 수동 조정하는 것으로 정해져 있다.
 *
 * ── [HARD] 플래그만 세우면 카드는 그대로 긁힌다
 *
 * `cancel_at_period_end = true` 는 **우리 DB 안의 사실**일 뿐이다. 포트원에는
 * 이미 다음 결제일에 실행될 예약이 걸려 있고, 그 예약은 우리 DB 를 보지 않는다.
 * 그래서 해지의 실제 알맹이는 플래그가 아니라 아래의 예약 철회다. 이걸 빼먹으면
 * "해지했는데 다음 달에 결제됨"이 되고, 그건 버그가 아니라 분쟁이다.
 *
 * 순서도 중요하다: **먼저 플래그를 세우고 그다음에 철회한다.** 반대로 하면
 * 철회와 플래그 사이에 결제 성공 웹훅이 도착했을 때 그 웹훅이 (해지 사실을
 * 모른 채) 다음 주기를 다시 예약해버린다. 플래그가 먼저면 웹훅이 그것을 보고
 * 재예약을 건너뛴다 (webhook-handlers.ts 의 cancel_at_period_end 검사).
 *
 * 철회가 실패하면 사용자에게 사실대로 알린다. "해지됐습니다"라고 말해놓고
 * 청구가 나가는 것이 최악이다.
 *
 * ── 해지 취소(un-cancel)
 *
 * 기간이 끝나기 전이라면 되돌릴 수 있다. 되돌릴 때는 철회했던 예약을 다시
 * 만들어야 한다 -- 플래그만 내리면 다음 결제가 영원히 오지 않는다(감시 크론이
 * 하루 뒤에 복구해주긴 하지만, 그 하루를 기대는 설계로 두지 않는다).
 * 예약 생성은 여기서도 `ensureNextSchedule` 하나만 쓴다.
 */

interface Body {
  cancel?: unknown;
}

export async function POST(req: Request) {
  const supabase = await getCookieSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof body.cancel !== 'boolean') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const cancel = body.cancel;

  const db = getServiceSupabase();
  const { data: sub, error: subErr } = await db
    .from('subscriptions')
    .select(
      'user_id, status, current_period_end, cancel_at_period_end, billing_key, portone_customer_id'
    )
    .eq('user_id', user.id)
    .maybeSingle<{
      user_id: string;
      status: string | null;
      current_period_end: string | null;
      cancel_at_period_end: boolean | null;
      billing_key: string | null;
      portone_customer_id: string | null;
    }>();

  if (subErr) {
    console.error('[billing] 해지 처리 중 구독 조회 실패', subErr.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  if (!sub) return NextResponse.json({ error: 'no_subscription' }, { status: 404 });

  // 이미 종결된 구독은 해지할 것도, 되돌릴 것도 없다.
  if (sub.status === 'canceled' || sub.status === 'expired') {
    return NextResponse.json({ error: 'already_ended', status: sub.status }, { status: 409 });
  }

  const now = new Date();

  if (cancel) {
    // --- 1) 플래그 먼저 (웹훅이 재예약하지 못하게) ---------------------------
    const { error: flagErr } = await db
      .from('subscriptions')
      .update({ cancel_at_period_end: true, cancel_requested_at: now.toISOString() })
      .eq('user_id', user.id);
    if (flagErr) {
      console.error('[billing] 해지 플래그 설정 실패', flagErr.message);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }

    // --- 2) 포트원 예약 철회 (해지의 실제 알맹이) ---------------------------
    const revoked = await revokeUpcomingSchedules(db, {
      userId: user.id,
      billingKey: sub.billing_key,
      kind: 'all',
      now
    });

    if (revoked.error && revoked.attempted > 0) {
      // 되돌리지 않는다. 플래그는 세워진 채로 두고 감시 크론이 기간 종료 시
      // 다시 철회를 시도한다. 다만 사용자에게는 사실대로 말한다.
      console.error(
        `[billing] 해지 예약 철회 실패 user=${user.id} ids=${revoked.scheduleIds.join(',')}: ${revoked.error}`
      );
      return NextResponse.json(
        {
          ok: true,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: sub.current_period_end,
          scheduleRevoked: false,
          warning: 'schedule_revoke_failed'
        },
        { status: 200 }
      );
    }

    console.info(
      `[billing] 해지 예약 user=${user.id} 철회한 예약 ${revoked.revoked}건 ` +
        `기간 종료 ${sub.current_period_end}`
    );
    return NextResponse.json({
      ok: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: sub.current_period_end,
      scheduleRevoked: true,
      revokedCount: revoked.revoked
    });
  }

  // --- 해지 취소 -------------------------------------------------------------
  const periodEndMs = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
  if (!Number.isFinite(periodEndMs) || periodEndMs <= now.getTime()) {
    // 기간이 이미 끝났다. 되돌릴 수 없고, 다시 구독하려면 카드 등록부터다.
    return NextResponse.json({ error: 'period_already_ended' }, { status: 409 });
  }

  const { error: flagErr } = await db
    .from('subscriptions')
    .update({ cancel_at_period_end: false, cancel_requested_at: null })
    .eq('user_id', user.id);
  if (flagErr) {
    console.error('[billing] 해지 취소 실패', flagErr.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // 철회했던 예약을 되살린다. 결제 수단이 없으면(BillingKey.Deleted 등) 되살릴
  // 수 없다 -- 그 경우 카드를 다시 등록해야 한다.
  let rescheduled = false;
  let scheduleError: string | undefined;
  if (sub.billing_key && sub.portone_customer_id) {
    const res = await ensureNextSchedule(db, {
      userId: user.id,
      billingKey: sub.billing_key,
      customerId: sub.portone_customer_id,
      email: user.email ?? null,
      timeToPay: new Date(periodEndMs),
      origin: 'first_payment'
    });
    rescheduled = res.outcome !== 'failed';
    scheduleError = res.error;
    if (!rescheduled) {
      console.error(`[billing] 해지 취소 후 재예약 실패 user=${user.id}: ${res.error}`);
    }
  }

  console.info(`[billing] 해지 취소 user=${user.id} 재예약=${rescheduled}`);
  return NextResponse.json({
    ok: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: sub.current_period_end,
    rescheduled,
    ...(scheduleError ? { warning: 'reschedule_failed' } : {})
  });
}
