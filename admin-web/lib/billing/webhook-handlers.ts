import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN } from '@/lib/billing/plan';
import { advancePeriod } from '@/lib/billing/period';
import { ensureNextSchedule } from '@/lib/billing/cycle';
import {
  DUNNING_COLUMNS,
  closeDunning,
  openDunning,
  type DunningSub
} from '@/lib/billing/dunning';
import { getPayment, type PaymentDetail } from '@/lib/portone/client';

/**
 * 웹훅 이벤트 처리 본체 (S4 에서 라우트에 있던 것을 S5 에서 분리).
 *
 * ── 왜 라우트에서 떼어냈나
 *
 * S4 는 처리를 `after()` 안에서 돌린다. 거기서 예외가 나면 `processing_error`
 * 만 남고 포트원은 이미 200 을 받았으므로 **재전송하지 않는다.** 즉 그 이벤트는
 * 우리가 직접 다시 실행하지 않으면 영원히 미처리다 (S4 가 남긴 알려진 구멍).
 *
 * 재실행 주체는 감시 크론이다. 크론이 라우트 핸들러를 부를 수는 없으므로
 * 처리 본체가 라우트 밖에 있어야 한다. 여기 있는 것이 **유일한 구현**이고,
 * 라우트와 크론이 같은 함수를 부른다 -- 갈라지면 "정상 경로는 고쳤는데 복구
 * 경로는 옛날 로직"이라는 최악의 형태가 된다.
 *
 * ── 재처리 안전성
 *
 * 이 함수는 몇 번을 다시 불러도 안전해야 한다. 기간 전진은
 * `payment_attempts` 를 `status <> 'paid'` 조건부로 갱신한 결과가 있을 때만
 * 하므로(멱등성 2겹), 같은 결제로 두 번 전진하지 않는다. 재처리는 이 성질에
 * 전적으로 기댄다.
 */

export interface HandledEvent {
  type: string;
  paymentId?: string;
  billingKey?: string;
}

/** 서명 통과한 페이로드에서 우리가 다루는 형태만 좁혀 꺼낸다. */
export function narrowEvent(payload: unknown): HandledEvent {
  const e = (payload ?? {}) as { type?: unknown; data?: Record<string, unknown> };
  const type = typeof e.type === 'string' ? e.type : 'Unknown';
  const data = e.data ?? {};
  return {
    type,
    paymentId: typeof data.paymentId === 'string' ? data.paymentId : undefined,
    billingKey: typeof data.billingKey === 'string' ? data.billingKey : undefined
  };
}

export async function handleWebhookEvent(
  db: SupabaseClient,
  event: HandledEvent
): Promise<void> {
  switch (event.type) {
    case 'Transaction.Paid':
      if (!event.paymentId) throw new Error('Transaction.Paid 에 paymentId 가 없다');
      await onPaid(db, event.paymentId);
      return;
    case 'Transaction.Failed':
      if (!event.paymentId) throw new Error('Transaction.Failed 에 paymentId 가 없다');
      await onFailed(db, event.paymentId);
      return;
    case 'BillingKey.Deleted':
      if (!event.billingKey) throw new Error('BillingKey.Deleted 에 billingKey 가 없다');
      await onBillingKeyDeleted(db, event.billingKey);
      return;
    default:
      // 관심 없는 이벤트. webhook_events 에는 이미 남았고 응답은 이미 200 이다.
      // 여기서 에러를 던지면 processing_error 만 쌓인다. 조용히 흘린다.
      console.info(`[webhook] 처리 대상 아님 type=${event.type}`);
  }
}

/** paymentId 로 사용자 찾기. 실패하면 포트원 customer.id 로 한 번 더 시도한다. */
async function resolveUser(
  db: SupabaseClient,
  paymentId: string,
  detail: PaymentDetail
): Promise<string | null> {
  const { data: attempt } = await db
    .from('payment_attempts')
    .select('user_id')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (attempt?.user_id) return attempt.user_id as string;

  const customerId = detail.customer?.id;
  if (!customerId) return null;
  const { data: sub } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('portone_customer_id', customerId)
    .maybeSingle();
  return (sub?.user_id as string | undefined) ?? null;
}

type SubRow = DunningSub & {
  billing_anchor_day: number | null;
};

const SUB_COLUMNS = `${DUNNING_COLUMNS}, billing_anchor_day`;

// ---------------------------------------------------------------------------
// 결제 성공
// ---------------------------------------------------------------------------
async function onPaid(db: SupabaseClient, paymentId: string): Promise<void> {
  // 웹훅은 "이 건에 뭔가 일어났다"까지만 말한다. 금액과 상태는 포트원에 묻는다.
  const res = await getPayment(paymentId);
  if (!res.ok) throw new Error(`결제 조회 실패 ${paymentId}: ${res.code} ${res.message}`);
  const detail = res.data;

  const status = (detail.status ?? '').toUpperCase();
  if (status !== 'PAID') {
    // 서명은 맞았지만 포트원의 현재 상태가 PAID 가 아니다 (취소된 뒤 도착한
    // 지연 웹훅 등). 기간을 늘리지 않는다.
    console.warn(`[webhook] Paid 이벤트지만 실제 상태가 ${status} 다. 무시. ${paymentId}`);
    return;
  }

  const userId = await resolveUser(db, paymentId, detail);
  if (!userId) throw new Error(`결제 ${paymentId} 의 사용자를 찾을 수 없다`);

  const amount = detail.amount?.total ?? PLAN.totalKrw;
  if (amount !== PLAN.totalKrw) {
    // 막지는 않는다(요금 변경 중일 수 있다). 실제 청구액을 그대로 기록한다.
    console.warn(`[webhook] 청구액 불일치 expected=${PLAN.totalKrw} actual=${amount} ${paymentId}`);
  }

  // --- 멱등성 2겹: 이미 paid 로 마감된 건이면 기간을 다시 늘리지 않는다 ------
  const nowIso = new Date().toISOString();
  const { data: marked, error: markErr } = await db
    .from('payment_attempts')
    .update({
      status: 'paid',
      attempted_at: detail.paidAt ?? nowIso,
      amount_krw: amount,
      failure_code: null,
      failure_message: null,
      raw_json: { kind: 'cycle_payment', source: 'webhook', payment: detail }
    })
    .eq('payment_id', paymentId)
    .neq('status', 'paid')
    .select('payment_id');

  if (markErr) throw new Error(`payment_attempts 갱신 실패: ${markErr.message}`);

  if (!marked || marked.length === 0) {
    // 두 갈래다: (a) 이미 paid -> 재처리 금지. (b) 행 자체가 없음(예약 없이
    // 포트원 콘솔에서 수동 결제한 경우 등) -> 새로 만들고 계속 진행한다.
    const { data: exists } = await db
      .from('payment_attempts')
      .select('status')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (exists) {
      console.info(`[webhook] 이미 처리된 결제. 기간 연장 생략 ${paymentId}`);
      return;
    }
    const { error: insErr } = await db.from('payment_attempts').insert({
      user_id: userId,
      payment_id: paymentId,
      amount_krw: amount,
      status: 'paid',
      attempt_kind: 'cycle',
      attempted_at: detail.paidAt ?? nowIso,
      raw_json: { kind: 'cycle_payment', source: 'webhook_unlinked', payment: detail }
    });
    if (insErr && (insErr as { code?: string }).code !== '23505') {
      throw new Error(`payment_attempts 생성 실패: ${insErr.message}`);
    }
    if (insErr) return; // 경합에서 졌다 = 다른 쪽이 처리했다.
  }

  // --- 기간 전진 -----------------------------------------------------------
  const { data: sub, error: subErr } = await db
    .from('subscriptions')
    .select(SUB_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<SubRow>();
  if (subErr) throw new Error(`구독 조회 실패: ${subErr.message}`);
  if (!sub) throw new Error(`구독 행이 없다 user=${userId}`);

  const now = new Date();
  const advanced = advancePeriod({
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
    anchorDay: sub.billing_anchor_day,
    now
  });
  if (advanced.basis === 'rebased') {
    // 정상 반복에서는 나오지 않는 값이다. 나왔다는 건 주기가 오래 끊겨 있었다는 뜻.
    console.warn(
      `[webhook] 주기를 이어붙이지 못하고 재기준했다 user=${userId} prevEnd=${sub.current_period_end}`
    );
  }

  const { error: updErr } = await db
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: advanced.periodStart.toISOString(),
      current_period_end: advanced.periodEnd.toISOString(),
      billing_anchor_day: advanced.anchorDay,
      // 결제가 됐으므로 유예는 끝났다.
      grace_until: null
    })
    .eq('user_id', userId);
  if (updErr) throw new Error(`구독 갱신 실패: ${updErr.message}`);

  // --- [S5] 어느 재시도 단에서 성공했든 사다리를 접는다 ----------------------
  // 남은 단(있어도 최대 1건)을 포트원에서 걷어내고 dunning 상태를 0 으로
  // 되돌린다. 이게 없으면 D+1 에 성공한 뒤 D+3 이 또 청구된다.
  const wasDunning = sub.status === 'past_due' || (sub.dunning_rung ?? 0) > 0;
  if (wasDunning) {
    const revoked = await closeDunning(db, sub, now);
    if (revoked.error) {
      console.error(
        `[webhook] 재시도 예약 철회 실패 user=${userId} ids=${revoked.scheduleIds.join(',')}: ${revoked.error}`
      );
    } else {
      console.info(
        `[webhook] dunning 종료 user=${userId} 철회한 재시도 예약 ${revoked.revoked}건`
      );
    }
  }

  // --- [HARD] 다음 주기 재예약 ----------------------------------------------
  // 이 호출이 S4 의 존재 이유다. 빠지면 두 번째 달부터 조용히 과금이 멈춘다.
  const billingKey = sub.billing_key ?? detail.billingKey ?? null;
  if (!billingKey || !sub.portone_customer_id) {
    console.error(`[webhook] 빌링키/고객id 가 없어 재예약 불가 user=${userId}`);
    return;
  }

  // 해지 예정이면 다음 주기를 잡지 않는다. 여기서 잡으면 "해지했는데 다음 달에
  // 또 청구됐다"가 된다 -- 해지 라우트가 방금 철회한 예약을 웹훅이 되살리는
  // 경주가 실제로 가능하다.
  if (sub.cancel_at_period_end) {
    console.info(`[webhook] 해지 예정 구독이라 다음 주기를 예약하지 않는다 user=${userId}`);
    return;
  }

  const scheduled = await ensureNextSchedule(db, {
    userId,
    billingKey,
    customerId: sub.portone_customer_id,
    email: detail.customer?.email ?? null,
    timeToPay: advanced.periodEnd,
    origin: 'webhook'
  });

  if (scheduled.outcome === 'failed') {
    // 사용자에게 보일 실패가 아니다. 결제는 성공했고 서비스는 열려 있다.
    // 감시 크론이 복구해야 하므로 크게 남긴다.
    console.error(
      `[webhook] 다음 주기 예약 실패 user=${userId} -> 감시 크론이 복구해야 한다: ${scheduled.error}`
    );
  } else {
    console.info(
      `[webhook] 다음 주기 예약 ${scheduled.outcome} user=${userId} at=${scheduled.timeToPay}`
    );
  }
}

// ---------------------------------------------------------------------------
// 결제 실패
// ---------------------------------------------------------------------------
async function onFailed(db: SupabaseClient, paymentId: string): Promise<void> {
  const res = await getPayment(paymentId);
  // 실패 건 조회는 실패해도 진행한다. 조회가 안 된다고 실패 사실을 버리면
  // past_due 로 넘어가지 못한 채 만료일만 지나간다.
  const detail: PaymentDetail = res.ok ? res.data : {};

  const userId = await resolveUser(db, paymentId, detail);
  if (!userId) throw new Error(`실패 결제 ${paymentId} 의 사용자를 찾을 수 없다`);

  const failure = detail.failure ?? {};
  const code = failure.pgCode ?? failure.reason ?? 'UNKNOWN';
  const message = failure.pgMessage ?? failure.reason ?? '결제 실패';

  const { data: marked } = await db
    .from('payment_attempts')
    .update({
      status: 'failed',
      attempted_at: new Date().toISOString(),
      failure_code: code.slice(0, 100),
      failure_message: message.slice(0, 500),
      raw_json: { kind: 'cycle_payment', source: 'webhook', payment: detail }
    })
    .eq('payment_id', paymentId)
    .neq('status', 'paid')
    .select('payment_id');

  if (!marked || marked.length === 0) {
    const { data: exists } = await db
      .from('payment_attempts')
      .select('status')
      .eq('payment_id', paymentId)
      .maybeSingle();
    if (!exists) {
      await db.from('payment_attempts').insert({
        user_id: userId,
        payment_id: paymentId,
        amount_krw: detail.amount?.total ?? PLAN.totalKrw,
        status: 'failed',
        attempt_kind: 'cycle',
        attempted_at: new Date().toISOString(),
        failure_code: code.slice(0, 100),
        failure_message: message.slice(0, 500),
        raw_json: { kind: 'cycle_payment', source: 'webhook_unlinked', payment: detail }
      });
    }
  }

  const { data: sub } = await db
    .from('subscriptions')
    .select(SUB_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<SubRow>();
  if (!sub) throw new Error(`구독 행이 없다 user=${userId}`);
  if (sub.status === 'canceled' || sub.status === 'expired') {
    console.info(`[webhook] 이미 종결된 구독의 결제 실패. 상태 유지 user=${userId}`);
    return;
  }

  // [S5] 유예 시작 / 사다리 개시. 유예 창은 연장되지 않고, dunning_started_at
  // 도 처음 한 번만 찍힌다 -- 매 실패마다 갱신하면 사다리가 계속 D+1 로 돌아간다.
  //
  // current_period_end 는 건드리지 않는다. 유예 중 자격 판정은 S2 의
  // max(current_period_end, grace_until) 이 하고, 유예 동안에는 기능을 막지
  // 않는다 -- 카드 하나 만료됐다고 진료 중에 앱이 멈추면 안 된다.
  const opened = await openDunning(db, sub, new Date());

  console.warn(
    `[webhook] 결제 실패 -> past_due user=${userId} grace_until=${opened.graceUntil} ` +
      `code=${code} (${opened.reused ? '기존 유예 유지' : '유예 개시'})`
  );
}

// ---------------------------------------------------------------------------
// 빌링키 삭제
// ---------------------------------------------------------------------------
async function onBillingKeyDeleted(db: SupabaseClient, billingKey: string): Promise<void> {
  // billing_key 로 찾는다. 이 컬럼은 service_role 만 읽을 수 있다.
  const { data: subs, error } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('billing_key', billingKey);
  if (error) throw new Error(`빌링키 소유자 조회 실패: ${error.message}`);
  if (!subs || subs.length === 0) {
    // 이미 지웠거나 우리 것이 아니다. 멱등하게 넘어간다.
    console.info('[webhook] 삭제된 빌링키에 해당하는 구독이 없다 (이미 정리됨)');
    return;
  }

  for (const s of subs) {
    const { error: updErr } = await db
      .from('subscriptions')
      .update({
        billing_key: null,
        card_brand: null,
        card_last4: null
      })
      .eq('user_id', s.user_id);
    if (updErr) throw new Error(`빌링키 제거 실패: ${updErr.message}`);
    console.warn(`[webhook] 빌링키 삭제 -> 결제수단 없음 user=${s.user_id}`);
  }

  // 상태(active/past_due)는 바꾸지 않는다. 이미 낸 기간까지는 쓸 수 있어야 하고,
  // 기간 만료 시 잠금은 entitlement 의 날짜 판정이 처리한다. 감시 크론은
  // billing_key 가 null 인 구독을 예약·재시도 대상에서 제외하므로 헛된 시도도
  // 생기지 않는다.
}
