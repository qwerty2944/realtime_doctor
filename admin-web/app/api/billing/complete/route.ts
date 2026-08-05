import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { getServiceSupabase } from '@/lib/supabase/service';
import { PLAN } from '@/lib/billing/plan';
import { portoneCustomerId } from '@/lib/billing/ids';
import { addMonthOnAnchor, anchorDayOf } from '@/lib/billing/period';
import { ensureNextSchedule } from '@/lib/billing/cycle';
import { getBillingKey, maskedCard, payWithBillingKey } from '@/lib/portone/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/complete  { issueId, billingKey }
 *
 * 브라우저에서 빌링키 발급이 끝나면 여기로 온다. 순서는 아래 그대로이고,
 * 각 단계는 앞 단계가 성공했을 때만 실행된다.
 *
 *   1) 발급 요청 선점 (멱등성 잠금)
 *   2) 포트원에 직접 물어 빌링키 검증
 *   3) 결제 시도 행 선점 (멱등성 2단)
 *   4) 첫 결제
 *   5) 성공 시에만 구독 활성화
 *   6) 다음 주기 예약
 *
 * [HARD] 2번이 없으면 이 엔드포인트는 "빌링키가 발급됐다고 주장하면 구독을
 * 켜주는" 엔드포인트다. 브라우저가 보내는 것은 주장일 뿐이므로, 그 주장이
 * 포트원에 실재하고 **이 사용자의 것인지**를 서버가 직접 확인한다.
 *
 * 멱등성 (폼 두 번 제출 = 결제 한 번):
 *   - 1번의 조건부 UPDATE (`consumed_at is null`) 는 원자적이다. 동시에 두 요청이
 *     와도 UPDATE 가 행을 돌려받는 쪽은 하나뿐이고, 진 쪽은 결제 호출에
 *     도달하지 못한다.
 *   - 3번의 payment_attempts.payment_id 는 UNIQUE 이고 issueId 로부터 결정되므로,
 *     설령 1번을 통과한 요청이 둘이라도 INSERT 단계에서 하나가 탈락한다.
 *   - 포트원도 같은 paymentId 의 재결제를 거부한다. 세 겹 중 하나만 남아도 이중
 *     청구는 일어나지 않는다.
 */

/** 이 라우트는 subscriptions 를 쓰므로 전부 service_role 로만 동작한다. */
function svc() {
  return getServiceSupabase();
}

interface Body {
  issueId?: unknown;
  billingKey?: unknown;
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
  const issueId = typeof body.issueId === 'string' ? body.issueId.trim() : '';
  const billingKey = typeof body.billingKey === 'string' ? body.billingKey.trim() : '';
  if (!issueId || !billingKey) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const db = svc();

  // --- 1) 발급 요청 선점 -----------------------------------------------------
  const { data: claimed, error: claimErr } = await db
    .from('billing_issue_requests')
    .update({ consumed_at: new Date().toISOString(), billing_key: billingKey })
    .eq('issue_id', issueId)
    .eq('user_id', user.id)
    .is('consumed_at', null)
    .select('issue_id, customer_id, payment_id')
    .maybeSingle();

  if (claimErr) {
    console.error('[billing] issue 요청 선점 실패', claimErr.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  if (!claimed) {
    // 두 갈래다: (a) 이미 처리된 요청 -> 중복 제출. 현재 상태를 그대로 돌려주고
    // 아무것도 하지 않는다. (b) 없거나 남의 요청 -> 거부.
    const { data: existing } = await db
      .from('billing_issue_requests')
      .select('user_id, outcome')
      .eq('issue_id', issueId)
      .maybeSingle();
    if (existing && existing.user_id === user.id) {
      return NextResponse.json(
        { ok: true, duplicate: true, outcome: existing.outcome ?? 'unknown' },
        { status: 200 }
      );
    }
    return NextResponse.json({ error: 'unknown_issue_id' }, { status: 400 });
  }

  const expectedCustomerId = portoneCustomerId(user.id);
  const paymentId = claimed.payment_id;

  async function finish(outcome: string) {
    await db.from('billing_issue_requests').update({ outcome }).eq('issue_id', issueId);
  }

  // --- 2) 빌링키 서버 검증 ---------------------------------------------------
  const lookup = await getBillingKey(billingKey);
  if (!lookup.ok) {
    console.warn('[billing] 빌링키 조회 실패', lookup.status, lookup.code, lookup.message);
    await finish('rejected');
    return NextResponse.json(
      { error: 'billing_key_unverified', detail: lookup.code },
      { status: 400 }
    );
  }
  const info = lookup.data;
  const statusOk = (info.status ?? '').toUpperCase() === 'ISSUED';
  const ownerOk = info.customer?.id === expectedCustomerId;
  // issueId 는 응답에 없을 수도 있다. 있으면 반드시 일치해야 하고, 없으면
  // customer.id 일치로 소유권을 판정한다 (customer.id 는 user_id 에서 결정된다).
  const issueOk = !info.issueId || info.issueId === issueId;
  if (!statusOk || !ownerOk || !issueOk) {
    console.warn(
      `[billing] 빌링키 검증 거부 status=${info.status} owner=${ownerOk} issue=${issueOk}`
    );
    await finish('rejected');
    return NextResponse.json(
      { error: 'billing_key_rejected', detail: !statusOk ? 'status' : !ownerOk ? 'owner' : 'issue_id' },
      { status: 400 }
    );
  }

  // --- 3) 결제 시도 행 선점 --------------------------------------------------
  const { error: insertErr } = await db.from('payment_attempts').insert({
    user_id: user.id,
    payment_id: paymentId,
    amount_krw: PLAN.totalKrw,
    status: 'pending',
    attempted_at: new Date().toISOString(),
    raw_json: { kind: 'first_payment', issue_id: issueId }
  });
  if (insertErr) {
    // 23505 = unique_violation. 같은 paymentId 가 이미 있다 = 이미 청구했다.
    if ((insertErr as { code?: string }).code === '23505') {
      await finish('duplicate');
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    console.error('[billing] 결제 시도 행 생성 실패', insertErr.message);
    await finish('failed');
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // --- 4) 첫 결제 ------------------------------------------------------------
  const paid = await payWithBillingKey(paymentId, {
    billingKey,
    customerId: expectedCustomerId,
    email: user.email ?? null
  });

  if (!paid.ok) {
    await db
      .from('payment_attempts')
      .update({
        status: 'failed',
        failure_code: paid.code,
        failure_message: paid.message.slice(0, 500),
        raw_json: { kind: 'first_payment', issue_id: issueId, error: paid.raw }
      })
      .eq('payment_id', paymentId);
    await finish('failed');
    // 구독은 건드리지 않는다. 결제되지 않은 구독을 켜는 것보다 다시 시도하게
    // 하는 편이 낫다.
    console.warn('[billing] 첫 결제 실패', paid.code, paid.message);
    return NextResponse.json(
      { error: 'payment_failed', code: paid.code, message: paid.message },
      { status: 402 }
    );
  }

  // --- 5) 활성화 -------------------------------------------------------------
  const card = maskedCard(info);
  const periodStart = new Date();
  // 앵커일(결제 기준일)을 여기서 확정하고 저장한다. 이후 모든 주기는 이 값을
  // 기준으로 계산되므로, 31일 가입자가 2월에 28일로 잘려도 3월에 31일로 돌아온다.
  // (lib/billing/period.ts 의 규칙 2)
  const anchorDay = anchorDayOf(periodStart);
  const periodEnd = addMonthOnAnchor(periodStart, anchorDay);

  const { error: subErr } = await db
    .from('subscriptions')
    .update({
      plan_code: PLAN.code,
      status: 'active',
      billing_key: billingKey,
      portone_customer_id: expectedCustomerId,
      card_brand: card.brand,
      card_last4: card.last4,
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      billing_anchor_day: anchorDay,
      cancel_at_period_end: false,
      grace_until: null
    })
    .eq('user_id', user.id);

  if (subErr) {
    // 돈은 빠져나갔는데 상태를 못 바꿨다. 조용히 넘기면 결제한 의사가 잠긴 채로
    // 남는다 -- 로그를 크게 남기고 사용자에게도 사실대로 알린다.
    console.error('[billing] 결제는 성공했으나 구독 갱신 실패', subErr.message, paymentId);
    await db
      .from('payment_attempts')
      .update({ status: 'paid_activation_failed', raw_json: { paymentId, error: subErr.message } })
      .eq('payment_id', paymentId);
    await finish('paid_activation_failed');
    return NextResponse.json({ error: 'activation_failed', paymentId }, { status: 500 });
  }

  await db
    .from('payment_attempts')
    .update({
      status: 'paid',
      raw_json: { kind: 'first_payment', issue_id: issueId, response: paid.data }
    })
    .eq('payment_id', paymentId);

  // --- 6) 다음 주기 예약 -----------------------------------------------------
  //
  // S4 에서 `lib/billing/cycle.ts` 로 옮겼다. 예약을 만드는 곳은 세 군데(첫 결제,
  // 결제 성공 웹훅, 감시 크론)인데 구현은 하나뿐이어야 한다 -- 갈라지면 언젠가
  // 한 곳만 고쳐지고, 그 결과는 "두 번째 달부터 조용히 과금이 멈춤"이다.
  const scheduled = await ensureNextSchedule(db, {
    userId: user.id,
    billingKey,
    customerId: expectedCustomerId,
    email: user.email ?? null,
    timeToPay: periodEnd,
    origin: 'first_payment'
  });

  if (scheduled.outcome === 'failed') {
    // 첫 결제는 성공했으므로 사용자에게 실패라고 말하지 않는다. 대신 크게 남긴다.
    // 감시 크론이 복구 대상으로 집어간다.
    console.error('[billing] 다음 주기 예약 실패 — 감시 크론이 복구해야 한다', scheduled.error);
  }

  await finish('paid');

  return NextResponse.json({
    ok: true,
    status: 'active',
    paymentId,
    amountKrw: PLAN.totalKrw,
    currentPeriodEnd: periodEnd.toISOString(),
    nextScheduled: scheduled.outcome !== 'failed',
    card
  });
}
