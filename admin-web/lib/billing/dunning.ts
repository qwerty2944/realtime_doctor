import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN } from '@/lib/billing/plan';
import { dunningPaymentId } from '@/lib/billing/ids';
import { revokeSchedules, schedulePayment } from '@/lib/portone/client';

/**
 * 결제 실패 대응 — 재시도 사다리 / 유예 만료 / 예약 철회 (S5).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 왜 "크론이 한 단씩 늦게 예약한다"인가 (선택한 구현)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 후보는 둘이었다.
 *
 *  (A) 실패 시점에 D+1·D+3·D+5 세 건을 포트원에 한꺼번에 예약한다.
 *  (B) 감시 크론이 매일 돌면서 "지금 뭐가 필요한지"를 보고 **한 번에 한 단만**
 *      예약한다.  ← 채택
 *
 * (A) 를 버린 이유는 "성공하면 나머지를 취소한다"가 곧 **네트워크 호출 2건이
 * 반드시 성공해야 이중청구가 안 난다**는 뜻이기 때문이다. D+1 에서 결제가
 * 성공했는데 취소 호출이 타임아웃 나면, D+3 과 D+5 가 그대로 살아 있고 의사는
 * 한 달에 세 번 청구된다. 실패해도 손실이 "청구 누락"인 쪽과 "중복 청구"인
 * 쪽이 있으면 전자를 골라야 한다 -- 청구 누락은 크론이 복구하지만, 중복 청구는
 * 환불·분쟁이고 신뢰를 잃는다.
 *
 * (B) 에서는 **미결 재시도 예약이 항상 최대 1건**이다. 어느 단에서 성공하면
 * 다음 단은 애초에 만들어지지 않는다 -- 취소할 것이 없으니 취소가 실패할 수도
 * 없다. 남은 위험은 "이미 걸려 있는 단 하나"뿐이고 그건 아래 closeDunning()
 * 이 걷어내되, 걷어내기에 실패해도 그 결제는 포트원에서 실행될 때
 * `payment_attempts.payment_id` 와 웹훅의 멱등성 2겹에 걸려 기간을 두 번
 * 늘리지 않는다.
 *
 * 크론 주기(하루 1회)로 D+1/D+3/D+5 를 표현하는 데 문제가 없다. 사다리 자체가
 * 일 단위이고, 각 단은 `dunning_started_at + N일` 이후 첫 크론에서 잡힌다.
 * 몇 시간 늦어도 유예 7일 안에 세 단이 모두 소화된다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 재시도 폭풍이 불가능한 이유 (3겹)
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  1겹  `dunning_rung` 을 **조건부 UPDATE** 로 올린다 (`eq('dunning_rung', 단-1)`).
 *       크론 두 개가 동시에 돌아도 UPDATE 가 행을 돌려받는 쪽은 하나뿐이다.
 *  2겹  paymentId 가 (사용자, **주기 끝**, 단) 으로 결정되고
 *       `payment_attempts.payment_id` 가 UNIQUE 다. 실행 날짜가 아니라 주기
 *       끝을 쓰므로, 크론이 하루에 열 번 돌아도 같은 단은 하나뿐이다.
 *  3겹  포트원이 같은 paymentId 의 재예약을 거부한다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 유예 중에는 절대 잠그지 않는다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 이 파일은 status 와 날짜만 만진다. 기능 차단은 entitlement 가
 * `max(current_period_end, grace_until)` 로 판정하므로, past_due 인 동안에는
 * 유예 마감까지 자격이 유지된다. 카드 하나 만료됐다고 진료 중에 앱이 멈추는
 * 일은 이 설계에서 구조적으로 일어나지 않는다.
 */

/** 계획서 4장: 유예 7일. */
export const GRACE_DAYS = 7;

/**
 * 재시도 단의 오프셋(일). 계획서의 D+1 / D+3 / D+5.
 * 인덱스 i 는 rung = i+1 에 해당한다.
 */
export const RETRY_OFFSET_DAYS = [1, 3, 5] as const;
export const MAX_RUNG = RETRY_OFFSET_DAYS.length;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DunningSub {
  user_id: string;
  status: string | null;
  current_period_end: string | null;
  grace_until: string | null;
  billing_key: string | null;
  portone_customer_id: string | null;
  dunning_rung: number | null;
  dunning_started_at: string | null;
  dunning_cycle_end: string | null;
  cancel_at_period_end?: boolean | null;
}

export const DUNNING_COLUMNS =
  'user_id, status, current_period_end, grace_until, billing_key, portone_customer_id, ' +
  'dunning_rung, dunning_started_at, dunning_cycle_end, cancel_at_period_end';

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------------------
// 유예 시작 — 결제 실패 웹훅에서 호출
// ---------------------------------------------------------------------------
export interface OpenResult {
  graceUntil: string;
  /** 이미 열려 있던 유예를 그대로 쓴 경우 true. */
  reused: boolean;
}

/**
 * `past_due` 로 내리고 유예를 연다.
 *
 * 유예 창은 **연장되지 않는다** (S4 에서 정한 규칙 그대로). 이미 열려 있는
 * 유예 안에서 재시도가 또 실패했다고 7일을 다시 주면 유예가 영원해지고, 돈을
 * 안 낸 계정이 무한히 열려 있게 된다.
 *
 * dunning_started_at 도 같은 이유로 처음 한 번만 찍는다 -- 매 실패마다 갱신하면
 * 사다리가 계속 처음으로 돌아가 D+1 만 무한 반복된다.
 */
export async function openDunning(
  db: SupabaseClient,
  sub: DunningSub,
  now: Date
): Promise<OpenResult> {
  const nowMs = now.getTime();
  const existingGrace = ms(sub.grace_until);
  const graceOpen = existingGrace !== null && existingGrace > nowMs;
  const graceUntil = graceOpen
    ? sub.grace_until!
    : new Date(nowMs + GRACE_DAYS * DAY_MS).toISOString();

  const alreadyDunning = sub.status === 'past_due' && !!sub.dunning_started_at && graceOpen;

  const patch: Record<string, unknown> = { status: 'past_due', grace_until: graceUntil };
  if (!alreadyDunning) {
    patch.dunning_started_at = now.toISOString();
    patch.dunning_rung = 0;
    // 어느 주기를 받으려고 하는 dunning 인지 기록한다. 감시 크론의 연체 복구
    // 경로와의 충돌 판정이 전부 이 값을 기준으로 이뤄진다.
    patch.dunning_cycle_end = sub.current_period_end;
  }

  const { error } = await db.from('subscriptions').update(patch).eq('user_id', sub.user_id);
  if (error) throw new Error(`past_due 전환 실패: ${error.message}`);

  return { graceUntil, reused: alreadyDunning };
}

// ---------------------------------------------------------------------------
// 미결 재시도 예약 철회
// ---------------------------------------------------------------------------
/**
 * 아직 실행되지 않은 예약을 포트원에서 걷어낸다.
 *
 * `kind` 로 대상을 좁힌다:
 *   'dunning'  -- 재시도 단만 (결제 성공 시).
 *   'all'      -- 정기 예약 포함 (해지 시).
 *
 * 포트원 호출이 실패해도 예외를 던지지 않는다. 던지면 "결제는 성공했는데
 * 정리에 실패해서 웹훅 처리 전체가 에러"가 되고, 그 편이 훨씬 나쁘다. 대신
 * 실패 사실을 돌려주고 호출부가 로그를 남긴다.
 */
export interface RevokeResult {
  attempted: number;
  revoked: number;
  scheduleIds: string[];
  error?: string;
}

export async function revokeUpcomingSchedules(
  db: SupabaseClient,
  args: { userId: string; billingKey: string | null; kind: 'dunning' | 'all'; now: Date }
): Promise<RevokeResult> {
  let q = db
    .from('payment_attempts')
    .select('payment_id, portone_schedule_id, attempt_kind')
    .eq('user_id', args.userId)
    .eq('status', 'scheduled')
    .gt('scheduled_for', args.now.toISOString());
  if (args.kind === 'dunning') q = q.eq('attempt_kind', 'dunning_retry');

  const { data: rows, error } = await q.returns<
    { payment_id: string; portone_schedule_id: string | null; attempt_kind: string }[]
  >();
  if (error) return { attempted: 0, revoked: 0, scheduleIds: [], error: error.message };

  const pending = rows ?? [];
  if (pending.length === 0) return { attempted: 0, revoked: 0, scheduleIds: [] };

  const scheduleIds = pending
    .map((r) => r.portone_schedule_id)
    .filter((id): id is string => !!id);

  let revokeErr: string | undefined;
  if (scheduleIds.length > 0 && args.billingKey) {
    const res = await revokeSchedules({ billingKey: args.billingKey, scheduleIds });
    if (!res.ok) revokeErr = `${res.code}: ${res.message}`;
  } else if (scheduleIds.length === 0) {
    // 예약 id 가 없는 행이 남아 있다는 건 예약 응답을 못 받았거나 0005 이전에
    // 만들어진 행이라는 뜻이다. 포트원 쪽에 예약이 실재할 수 있으므로 조용히
    // 성공으로 처리하지 않는다.
    revokeErr = 'no_schedule_id';
  }

  // 로컬 상태는 포트원 호출 성공 여부와 무관하게 정리한다 -- 예약이 남아 있는
  // 것으로 표시해두면 감시 크론이 "예약 있음"으로 보고 복구를 건너뛴다.
  const ids = pending.map((r) => r.payment_id);
  await db
    .from('payment_attempts')
    .update({
      status: revokeErr ? 'schedule_revoke_failed' : 'schedule_revoked',
      failure_message: revokeErr ? revokeErr.slice(0, 500) : null
    })
    .in('payment_id', ids);

  return {
    attempted: pending.length,
    revoked: revokeErr ? 0 : scheduleIds.length,
    scheduleIds,
    error: revokeErr
  };
}

// ---------------------------------------------------------------------------
// 유예 종료(성공) — 결제 성공 웹훅에서 호출
// ---------------------------------------------------------------------------
/**
 * 어느 단에서든 결제가 성공하면 사다리를 접는다.
 *
 * 남아 있는 단(있어도 1건)을 포트원에서 걷어내고 dunning 컬럼을 0 으로
 * 되돌린다. 정기 월간 예약의 복원은 호출부(onPaid)가 ensureNextSchedule 로
 * 이어서 한다 -- 예약 생성 구현은 여전히 하나뿐이다.
 */
export async function closeDunning(
  db: SupabaseClient,
  sub: DunningSub,
  now: Date
): Promise<RevokeResult> {
  const res = await revokeUpcomingSchedules(db, {
    userId: sub.user_id,
    billingKey: sub.billing_key,
    kind: 'dunning',
    now
  });
  await db
    .from('subscriptions')
    .update({ dunning_rung: 0, dunning_started_at: null, dunning_cycle_end: null })
    .eq('user_id', sub.user_id);
  return res;
}

// ---------------------------------------------------------------------------
// 사다리 진행 — 감시 크론에서 호출
// ---------------------------------------------------------------------------
export type LadderOutcome =
  /** 아직 다음 단의 시각이 안 됐다. */
  | 'not_due'
  /** 사다리를 다 썼다. 유예 만료를 기다린다. */
  | 'exhausted'
  /** 결제 수단이 없어 재시도할 수 없다. */
  | 'no_billing_key'
  /** 이미 미래 예약이 있다 (다른 경로가 잡아뒀다). 아무것도 하지 않는다. */
  | 'already_scheduled'
  /** 이번 단을 예약했다. */
  | 'scheduled'
  /** 포트원 예약 호출이 실패했다. 다음 크론이 같은 단을 다시 시도한다. */
  | 'failed';

export interface LadderResult {
  outcome: LadderOutcome;
  rung?: number;
  paymentId?: string;
  timeToPay?: string;
  error?: string;
}

/**
 * 다음 재시도 단이 필요하면 하나 예약한다.
 *
 * [HARD] 이중청구 방지의 1차 방어선은 여기 맨 앞의 "미래 예약이 이미 있으면
 * 손대지 않는다" 검사다. 감시 크론의 연체 복구 경로와 이 사다리가 같은 사용자를
 * 동시에 보더라도, 둘 다 예약을 만들기 전에 같은 조건을 확인하고 둘 중 하나만
 * 통과한다. (감시 크론 쪽은 애초에 past_due 를 연체 복구 대상에서 제외하지만,
 * 방어는 한 겹으로 두지 않는다.)
 */
export async function advanceDunningLadder(
  db: SupabaseClient,
  sub: DunningSub,
  now: Date
): Promise<LadderResult> {
  const nowMs = now.getTime();
  const startedAt = ms(sub.dunning_started_at);
  const rung = sub.dunning_rung ?? 0;

  if (startedAt === null) {
    // past_due 인데 사다리 정보가 없다 (0005 이전에 실패한 행). 지금을 기준으로
    // 사다리를 연다. 유예 마감은 이미 잡혀 있으므로 건드리지 않는다.
    await db
      .from('subscriptions')
      .update({
        dunning_started_at: now.toISOString(),
        dunning_rung: 0,
        dunning_cycle_end: sub.current_period_end
      })
      .eq('user_id', sub.user_id);
    return { outcome: 'not_due' };
  }

  if (rung >= MAX_RUNG) return { outcome: 'exhausted' };

  const nextRung = rung + 1;
  const dueAt = startedAt + RETRY_OFFSET_DAYS[nextRung - 1] * DAY_MS;
  if (nowMs < dueAt) return { outcome: 'not_due', rung: nextRung };

  if (!sub.billing_key || !sub.portone_customer_id) {
    return { outcome: 'no_billing_key', rung: nextRung };
  }

  // --- 이중청구 방어 1: 미래 예약이 이미 있으면 아무것도 하지 않는다 --------
  const { data: upcoming, error: upErr } = await db
    .from('payment_attempts')
    .select('payment_id')
    .eq('user_id', sub.user_id)
    .eq('status', 'scheduled')
    .gt('scheduled_for', now.toISOString())
    .limit(1);
  if (upErr) return { outcome: 'failed', rung: nextRung, error: upErr.message };
  if (upcoming && upcoming.length > 0) {
    return { outcome: 'already_scheduled', rung: nextRung, paymentId: upcoming[0].payment_id };
  }

  // --- 이중청구 방어 2: 단 소유권을 조건부 UPDATE 로 선점 -------------------
  const { data: claimed, error: claimErr } = await db
    .from('subscriptions')
    .update({ dunning_rung: nextRung })
    .eq('user_id', sub.user_id)
    .eq('dunning_rung', rung)
    .eq('status', 'past_due')
    .select('user_id');
  if (claimErr) return { outcome: 'failed', rung: nextRung, error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    // 다른 실행이 먼저 이 단을 가져갔거나 상태가 바뀌었다.
    return { outcome: 'already_scheduled', rung: nextRung };
  }

  // --- 이중청구 방어 3: (사용자, 주기끝, 단) 결정적 paymentId + UNIQUE -------
  const cycleEnd = sub.dunning_cycle_end
    ? new Date(sub.dunning_cycle_end)
    : sub.current_period_end
      ? new Date(sub.current_period_end)
      : now;
  const paymentId = dunningPaymentId(sub.user_id, cycleEnd, nextRung);

  // 재시도는 "지금 곧" 실행돼야 한다. 예약 시각을 과거로 주면 포트원이 거부한다.
  const timeToPay = new Date(nowMs + 5 * 60 * 1000);

  const { error: insErr } = await db.from('payment_attempts').insert({
    user_id: sub.user_id,
    payment_id: paymentId,
    amount_krw: PLAN.totalKrw,
    status: 'scheduling',
    attempt_kind: 'dunning_retry',
    dunning_rung: nextRung,
    scheduled_for: timeToPay.toISOString(),
    raw_json: { kind: 'dunning_retry', rung: nextRung, cycleEnd: cycleEnd.toISOString() }
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      // 같은 단이 이미 만들어져 있다. 단 번호만 올라가고 예약은 중복되지 않는다.
      return { outcome: 'already_scheduled', rung: nextRung, paymentId };
    }
    return { outcome: 'failed', rung: nextRung, paymentId, error: insErr.message };
  }

  const res = await schedulePayment(paymentId, {
    billingKey: sub.billing_key,
    customerId: sub.portone_customer_id,
    email: null,
    timeToPay
  });

  if (!res.ok) {
    await db
      .from('payment_attempts')
      .update({
        status: 'schedule_failed',
        failure_code: res.code,
        failure_message: res.message.slice(0, 500)
      })
      .eq('payment_id', paymentId);
    // 단 번호는 되돌리지 않는다. 되돌리면 다음 크론이 같은 단을 다시 시도하고,
    // 포트원이 계속 거절하는 상황에서 하루 한 번씩 영원히 시도하게 된다.
    // 사다리는 앞으로만 간다 -- 최종 판정은 유예 만료가 한다.
    return {
      outcome: 'failed',
      rung: nextRung,
      paymentId,
      timeToPay: timeToPay.toISOString(),
      error: `${res.code}: ${res.message}`
    };
  }

  await db
    .from('payment_attempts')
    .update({
      status: 'scheduled',
      portone_schedule_id: res.data.schedule?.id ?? null,
      raw_json: { kind: 'dunning_retry', rung: nextRung, response: res.data }
    })
    .eq('payment_id', paymentId);

  return {
    outcome: 'scheduled',
    rung: nextRung,
    paymentId,
    timeToPay: timeToPay.toISOString()
  };
}

// ---------------------------------------------------------------------------
// 유예 만료 → expired
// ---------------------------------------------------------------------------
/**
 * [HARD] entitlement 의 날짜 판정과 **정확히 같은 조건**에서만 만료시킨다.
 *
 * S2 의 판정은 past_due 에 대해 `coverage = max(current_period_end, grace_until)`
 * 이고 `now >= coverage` 면 자격 없음이다. 그래서 여기서도 **둘 다 지났을 때만**
 * expired 로 내린다. 한쪽만 보고 내리면 두 판정이 어긋나서, DB 는 만료인데
 * entitlement 는 아직 열어주는(또는 그 반대의) 구간이 생긴다.
 *
 * 두 판정이 어긋나면 안 되는 이유는 단순하다. 잠금은 entitlement 가 하고, 청구
 * 중단·화면 표시·크론 대상 선정은 status 가 한다. 어긋나는 순간 "화면에는
 * 만료라고 뜨는데 기능은 되는" 상태나 "잠겼는데 청구는 계속되는" 상태가 된다.
 *
 * 그래서 이 전환은 entitlement 의 판정을 **바꾸지 않는다**. 이미 자격이 없어진
 * 구독의 DB 상태를 뒤늦게 사실과 일치시키는 것뿐이다.
 */
export function graceLapsed(sub: DunningSub, now: Date): boolean {
  const nowMs = now.getTime();
  const periodEnd = ms(sub.current_period_end);
  const grace = ms(sub.grace_until);
  // entitlement 와 동일: 둘 다 null 이면 자격 없음(= 만료로 취급).
  if (periodEnd === null && grace === null) return true;
  const coverage = Math.max(periodEnd ?? -Infinity, grace ?? -Infinity);
  return nowMs >= coverage;
}

export async function expireSubscription(
  db: SupabaseClient,
  sub: DunningSub,
  now: Date
): Promise<{ revoked: RevokeResult }> {
  // 만료됐는데 예약이 남아 있으면 잠긴 계정에 청구가 나간다. 먼저 걷어낸다.
  const revoked = await revokeUpcomingSchedules(db, {
    userId: sub.user_id,
    billingKey: sub.billing_key,
    kind: 'all',
    now
  });
  const { error } = await db
    .from('subscriptions')
    .update({
      status: 'expired',
      dunning_rung: 0,
      dunning_started_at: null,
      dunning_cycle_end: null
    })
    .eq('user_id', sub.user_id)
    .eq('status', 'past_due');
  if (error) throw new Error(`expired 전환 실패: ${error.message}`);
  return { revoked };
}
