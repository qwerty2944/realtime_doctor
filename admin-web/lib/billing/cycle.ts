import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN } from '@/lib/billing/plan';
import { cyclePaymentId } from '@/lib/billing/ids';
import { schedulePayment } from '@/lib/portone/client';

/**
 * 다음 주기 예약 -- **이 파일이 유일한 구현이다.**
 *
 * [HARD] 포트원의 `POST /payments/{id}/schedule` 은 미래 1건만 잡는다. 자동
 * 반복이 아니다. 따라서 예약은 세 곳에서 만들어져야 한다:
 *
 *   1) 첫 결제 직후            (app/api/billing/complete/route.ts, S3)
 *   2) 결제 성공 웹훅을 받을 때 (app/api/billing/webhook/route.ts, S4)
 *   3) 예약 누락 감시 크론      (app/api/billing/watchdog/route.ts, S4)
 *
 * 세 곳이 각자 예약 코드를 갖고 있으면 언젠가 한 곳만 고쳐지고, 그 결과는
 * "두 번째 달부터 조용히 과금이 멈춤"이다. 그래서 전부 여기를 부른다.
 * (S3 의 `TODO(S4)` 블록은 이 함수 호출로 대체됐다.)
 *
 * 멱등성:
 *   paymentId 는 (사용자, 결제일) 로 결정된다. 같은 날짜에 대해 몇 번을 불러도
 *   같은 paymentId 가 나오고, `payment_attempts.payment_id` 의 UNIQUE 가
 *   두 번째 이후를 막는다. 그래서 **먼저 행을 선점하고 그다음에 포트원을
 *   부른다** -- 순서를 뒤집으면 동시 호출 두 개가 모두 예약 API 에 도달한다.
 */

export type EnsureOutcome =
  /** 새로 예약했다. */
  | 'scheduled'
  /** 이미 같은 날짜의 예약이 있다. 아무것도 하지 않았다. */
  | 'already'
  /** 이전에 실패했던 예약을 다시 시도해 성공했다 (크론 복구 경로). */
  | 'repaired'
  /** 포트원 호출이 실패했다. 행은 schedule_failed 로 남아 크론이 다시 본다. */
  | 'failed';

export interface EnsureResult {
  outcome: EnsureOutcome;
  paymentId: string;
  timeToPay: string;
  error?: string;
}

export interface EnsureArgs {
  userId: string;
  billingKey: string;
  customerId: string;
  email: string | null;
  /** 다음 결제 시각. 보통 새 `current_period_end`. */
  timeToPay: Date;
  /** 진단용. payment_attempts.raw_json 에 남는다. */
  origin: 'first_payment' | 'webhook' | 'watchdog';
}

export async function ensureNextSchedule(
  db: SupabaseClient,
  args: EnsureArgs
): Promise<EnsureResult> {
  const paymentId = cyclePaymentId(args.userId, args.timeToPay);
  const iso = args.timeToPay.toISOString();

  // --- 1) 행 선점 ----------------------------------------------------------
  const { error: insertErr } = await db.from('payment_attempts').insert({
    user_id: args.userId,
    payment_id: paymentId,
    amount_krw: PLAN.totalKrw,
    status: 'scheduling',
    attempt_kind: 'cycle',
    scheduled_for: iso,
    raw_json: { kind: 'next_cycle', origin: args.origin }
  });

  let retryOfFailed = false;
  if (insertErr) {
    if ((insertErr as { code?: string }).code !== '23505') {
      return { outcome: 'failed', paymentId, timeToPay: iso, error: insertErr.message };
    }
    // 23505 = 같은 paymentId 가 이미 있다. 두 갈래다.
    const { data: existing } = await db
      .from('payment_attempts')
      .select('status')
      .eq('payment_id', paymentId)
      .maybeSingle();
    const status = existing?.status ?? '';
    if (
      status === 'schedule_failed' ||
      // S5: 해지하면서 철회한 예약이다. 해지를 취소하면 **다시 만들어야 한다**
      // -- 포트원 쪽 예약은 실제로 사라졌으므로 여기서 'already' 로 넘기면
      // 다음 결제가 영원히 오지 않는다.
      status === 'schedule_revoked' ||
      status === 'schedule_revoke_failed'
    ) {
      // 지난번에 포트원 호출이 깨졌거나 철회된 건이다. 이건 다시 시도해야 한다 --
      // 여기서 'already' 로 넘기면 크론이 영원히 복구하지 못한다.
      retryOfFailed = true;
    } else {
      // scheduled / scheduling / paid / failed 등: 이미 다뤄진 건이다.
      return { outcome: 'already', paymentId, timeToPay: iso };
    }
  }

  // --- 2) 포트원 예약 -------------------------------------------------------
  const res = await schedulePayment(paymentId, {
    billingKey: args.billingKey,
    customerId: args.customerId,
    email: args.email,
    timeToPay: args.timeToPay
  });

  if (!res.ok) {
    // 행을 지우지 않는다. 지우면 "예약을 시도했다가 실패했다"는 사실이 사라지고
    // 복구 대상인지 애초에 대상이 아니었는지 구분할 수 없다.
    await db
      .from('payment_attempts')
      .update({
        status: 'schedule_failed',
        failure_code: res.code,
        failure_message: res.message.slice(0, 500),
        raw_json: { kind: 'next_cycle', origin: args.origin, error: res.raw }
      })
      .eq('payment_id', paymentId);
    return { outcome: 'failed', paymentId, timeToPay: iso, error: `${res.code}: ${res.message}` };
  }

  await db
    .from('payment_attempts')
    .update({
      status: 'scheduled',
      scheduled_for: iso,
      // [HARD] 예약 id 는 지금 이 응답에서만 볼 수 있다. 여기서 안 남기면
      // 해지할 때 이 예약을 포트원에서 취소할 방법이 없어지고, 해지한 의사의
      // 카드가 그대로 긁힌다 (S5).
      portone_schedule_id: res.data.schedule?.id ?? null,
      failure_code: null,
      failure_message: null,
      raw_json: { kind: 'next_cycle', origin: args.origin, response: res.data }
    })
    .eq('payment_id', paymentId);

  return { outcome: retryOfFailed ? 'repaired' : 'scheduled', paymentId, timeToPay: iso };
}
