import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase/service';
import { CRON_SECRET_ENV, missingPortOneEnv, requireEnv } from '@/lib/env';
import { ensureNextSchedule } from '@/lib/billing/cycle';
import {
  DUNNING_COLUMNS,
  advanceDunningLadder,
  expireSubscription,
  graceLapsed,
  revokeUpcomingSchedules,
  type DunningSub
} from '@/lib/billing/dunning';
import { handleWebhookEvent, narrowEvent } from '@/lib/billing/webhook-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 대상이 많을 때 60초 기본값에 걸리지 않게. */
export const maxDuration = 300;

/**
 * POST /api/billing/watchdog -- 정기 점검 잡 (S4 예약 감시 + S5 dunning/만료/재처리).
 *
 * ── 이 잡이 존재하는 이유
 *
 * 포트원의 예약은 미래 1건뿐이라, 결제 성공 웹훅마다 다음 달을 새로 잡아야 한다.
 * 그 재예약이 빠지면 **아무 일도 일어나지 않는다.** 에러도, 실패한 결제도,
 * 로그 한 줄도 남지 않는다. 첫 증상은 "매출이 왜 안 늘지?" 다. 실패가 보이지
 * 않기 때문에 감시가 따로 필요하다.
 *
 * S5 에서 세 가지가 더 붙었다. 셋 다 "아무도 하지 않으면 조용히 틀린 채로
 * 남는" 일이라 같은 잡에 둔다:
 *
 *   * 재시도 사다리 (D+1 / D+3 / D+5) 를 한 단씩 진행
 *   * 유예가 끝난 past_due 를 expired 로, 기간이 끝난 해지 예정을 canceled 로
 *   * `after()` 안에서 죽은 웹훅 이벤트 재처리
 *
 * ── [HARD] 감시(연체 복구) vs dunning 우선순위 — 이중청구 방지
 *
 * S4 의 연체 복구 경로는 "active 인데 주기 끝이 지났고 예약이 없다"를 보고 +5분
 * 뒤 즉시 청구를 잡는다. dunning 재시도도 즉시 청구를 잡는다. 같은 사용자에게
 * 둘이 동시에 걸리면 한 주기에 두 번 청구된다.
 *
 * 규칙은 하나다:
 *
 *   **past_due 인 구독은 dunning 이 독점한다. 연체 복구 경로는 손대지 않는다.**
 *
 * 근거: 연체 복구는 "청구 시도 자체가 없었다"는 침묵을 메우는 장치다. past_due
 * 는 정의상 청구를 시도했고 실패했다는 뜻이므로 침묵이 아니다. 그 주기를 다시
 * 받아내는 책임은 이미 사다리에 있다. 그래서 상태 하나로 소유권이 갈린다.
 *
 * 방어는 세 겹이다:
 *   1) 아래 sweep 이 status 로 경로를 **먼저** 가른다 (past_due 는 연체 복구
 *      후보 목록에 들어오지도 않는다).
 *   2) 양쪽 모두 "미래 예약이 이미 있으면 아무것도 하지 않는다"를 먼저 본다.
 *   3) paymentId 가 결정적이고 payment_attempts.payment_id 가 UNIQUE 다.
 *      정기(rdc_)와 재시도(rdr_)는 접두사부터 다른 id 공간을 쓴다.
 *
 * ── 왜 pg_cron 이 아니라 HTTP 라우트 + 스케줄러인가
 *
 * 이 잡은 탐지만 하는 게 아니라 **복구**한다. 복구는 포트원 예약/취소 API
 * 호출이고, 그건 PORTONE_API_SECRET 을 쥔 서버만 할 수 있다. pg_cron 은 DB 안에서
 * 돌기 때문에 "예약이 없다"는 사실까지만 알 수 있고, 알아낸 걸로 할 수 있는 일이
 * 없다. 그래서 복구 로직은 서버에 두고, 트리거는 Vercel Cron 으로 매일 건다
 * (admin-web/vercel.json, 매일 UTC 18:00 = KST 03:00).
 *
 * ── [HARD] 인터페이스는 "Bearer $CRON_SECRET" 하나다 -- 이름이 계약이다
 *
 * Vercel Cron 은 환경변수 이름이 **정확히 `CRON_SECRET`** 일 때만 Authorization
 * 헤더를 붙인다. 다른 이름을 기대하면 크론은 매 실행 401 을 받고, 아래에서
 * 실행 기록을 인증 뒤에 쓰기 때문에 `subscription_watchdog_runs` 가 비어 있는
 * 채로 남는다 -- 증상이 "아무 일도 안 일어남"이라 이 잡이 탐지하려는 침묵과
 * 구분되지 않는다. 그래서 이름을 리터럴로 쓰지 않고 `CRON_SECRET_ENV` 를
 * 참조하며, 되돌림은 `scripts/assert-cron-secret-name.mjs` 가 빌드 단계에서
 * 막고, 그래도 인증이 깨지면 `/api/health` 의 `watchdog` 검사가 "마지막 실행이
 * 오래됐다"로 드러내 ops 프로버에 잡히게 한다.
 *
 * ── 조용한 0 과 안 도는 잡의 구분
 *
 * 실행할 때마다 `subscription_watchdog_runs` 에 행을 남긴다. 문제를 못 찾았을
 * 때도 남긴다. 이게 없으면 "오늘 이상 없음"과 "이 잡이 3월부터 안 돌고 있음"이
 * DB 상에서 완전히 같은 모습(=아무 흔적 없음)이 된다.
 */

/** 이미 지난 결제일을 복구할 때 최소한 이만큼은 미래로 잡는다. */
const MIN_LEAD_MS = 5 * 60 * 1000;
/** 한 번에 처리할 최대 구독 수. 남은 건 다음 실행이 가져간다. */
const BATCH = 200;
/** 웹훅 재처리 상한. 이걸 넘으면 재시도를 멈추고 미복구로 보고한다. */
const MAX_REPROCESS = 5;
/** 한 번에 재처리할 웹훅 이벤트 수. */
const WEBHOOK_BATCH = 50;

type Finding = {
  userId?: string;
  eventId?: string;
  issue:
    | 'no_upcoming_schedule'
    | 'period_end_passed'
    | 'dunning_retry'
    | 'grace_expired'
    | 'cancel_period_ended'
    | 'webhook_unprocessed'
    | 'webhook_unrecovered';
  action: string;
  paymentId?: string;
  timeToPay?: string;
  rung?: number;
  error?: string;
};

function authorized(req: Request): boolean {
  const expected = requireEnv(CRON_SECRET_ENV);
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

/** Vercel Cron 은 GET 으로 친다. 동작은 같다. */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

interface Counters {
  repaired: number;
  failed: number;
}

async function run() {
  const db = getServiceSupabase();
  const startedAt = new Date();

  // 실행 기록을 **먼저** 만든다. 중간에 죽어도 "돌긴 돌았다"가 남는다.
  const { data: runRow, error: runErr } = await db
    .from('subscription_watchdog_runs')
    .insert({ started_at: startedAt.toISOString() })
    .select('id')
    .single();
  if (runErr) {
    console.error('[watchdog] 실행 기록 생성 실패', runErr.message);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  const runId = runRow.id as string;

  const findings: Finding[] = [];
  const counters: Counters = { repaired: 0, failed: 0 };
  let checked = 0;
  let webhooksRetried = 0;
  let webhooksUnrecovered = 0;

  async function record(error?: string) {
    await db
      .from('subscription_watchdog_runs')
      .update({
        finished_at: new Date().toISOString(),
        checked_count: checked,
        missing_count: findings.length,
        repaired_count: counters.repaired,
        failed_count: counters.failed,
        details: findings,
        ...(error ? { error: error.slice(0, 1000) } : {})
      })
      .eq('id', runId);
  }

  // ── 포트원 자격이 없으면 여기서 멈춘다 ─────────────────────────────────
  //
  // 이 잡의 복구 수단(예약 생성·철회·재시도 청구)은 전부 포트원 REST 호출이다.
  // 자격이 없으면 탐지는 되지만 고칠 수가 없고, 고치지 못한 것을 findings 에
  // 'failed' 로 잔뜩 쌓아 두면 매일 같은 목록이 반복되면서 정작 사람이 봐야 할
  // 진짜 실패를 덮는다.
  //
  // [HARD] 그래도 **실행 기록은 이미 만들었다.** 위에서 행을 먼저 넣는 순서가
  // 여기서 값을 한다: "돌긴 돌았고 자격이 없어서 멈췄다"가 DB 에 남는다.
  // 조용히 끝나면 이 파일이 막으려는 실패(=흔적 없는 침묵)와 같은 모습이 된다.
  const missingPortOne = missingPortOneEnv();
  if (missingPortOne.length > 0) {
    const reason = `포트원 자격 미설정: ${missingPortOne.join(', ')}`;
    await record(reason);
    console.error(`[watchdog] run=${runId} 중단 — ${reason}`);
    return NextResponse.json(
      { error: 'not_configured', runId, detail: reason, missing: missingPortOne },
      { status: 503 }
    );
  }

  try {
    // 웹훅 재처리를 먼저 한다. 미처리 이벤트가 기간을 전진시켜야 할 건이라면,
    // 그걸 먼저 반영해야 아래 구독 점검이 낡은 상태를 보고 헛일하지 않는다.
    const wh = await reprocessWebhooks(db, findings, counters);
    webhooksRetried = wh.retried;
    webhooksUnrecovered = wh.unrecovered;

    checked = await sweep(db, findings, counters);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record(message);
    console.error('[watchdog] 실행 실패', message);
    return NextResponse.json({ error: 'internal', message }, { status: 500 });
  }

  await record();

  // 문제를 못 찾았을 때도 반드시 한 줄 남긴다.
  console.info(
    `[watchdog] run=${runId} checked=${checked} findings=${findings.length} ` +
      `repaired=${counters.repaired} failed=${counters.failed} ` +
      `webhooksRetried=${webhooksRetried} webhooksUnrecovered=${webhooksUnrecovered}`
  );

  return NextResponse.json({
    ok: true,
    runId,
    checked,
    missing: findings.length,
    repaired: counters.repaired,
    failed: counters.failed,
    webhooksRetried,
    webhooksUnrecovered,
    findings
  });
}

// ---------------------------------------------------------------------------
// 1) 웹훅 재처리 — S4 가 남긴 구멍
// ---------------------------------------------------------------------------
/**
 * `after()` 안에서 처리가 죽은 이벤트를 다시 돌린다.
 *
 * 포트원은 이미 200 을 받았으므로 재전송하지 않는다. 우리가 다시 돌리지 않으면
 * 그 결제의 기간 전진은 영원히 일어나지 않고, 의사는 돈을 냈는데 잠긴다.
 *
 * 멱등: 처리 본체가 `payment_attempts` 를 `status <> 'paid'` 조건부로 갱신한
 * 결과가 있을 때만 기간을 전진시킨다. 이미 성공적으로 반영된 건을 다시 돌려도
 * 두 번 전진하지 않는다 -- 이 성질이 없으면 재처리 자체가 위험한 기능이 된다.
 *
 * 상한을 둔다. 영구히 실패하는 이벤트(예: 삭제된 사용자)를 매일 무한히 다시
 * 돌리면 로그만 쌓이고 아무도 안 본다. 상한을 넘은 건은 **재시도를 멈추고
 * 미복구로 보고**한다 -- 조용히 사라지는 것보다 목록에 남는 편이 낫다.
 */
async function reprocessWebhooks(
  db: SupabaseClient,
  findings: Finding[],
  counters: Counters
): Promise<{ retried: number; unrecovered: number }> {
  const { data: rows, error } = await db
    .from('webhook_events')
    .select('portone_event_id, type, payload_json, reprocess_count, processing_error')
    .not('processing_error', 'is', null)
    .is('processed_at', null)
    .order('received_at', { ascending: true })
    .limit(WEBHOOK_BATCH)
    .returns<
      {
        portone_event_id: string;
        type: string | null;
        payload_json: unknown;
        reprocess_count: number;
        processing_error: string | null;
      }[]
    >();
  if (error) throw new Error(`미처리 웹훅 조회 실패: ${error.message}`);

  let retried = 0;
  let unrecovered = 0;

  for (const row of rows ?? []) {
    if (row.reprocess_count >= MAX_REPROCESS) {
      unrecovered += 1;
      findings.push({
        eventId: row.portone_event_id,
        issue: 'webhook_unrecovered',
        action: 'give_up',
        error: row.processing_error ?? undefined
      });
      // 조용히 넘기지 않는다. 여기 오면 사람이 봐야 한다.
      console.error(
        `[watchdog] 웹훅 재처리 포기 event=${row.portone_event_id} ` +
          `(${row.reprocess_count}회 실패): ${row.processing_error}`
      );
      continue;
    }

    retried += 1;
    const now = new Date().toISOString();
    try {
      await handleWebhookEvent(db, narrowEvent(row.payload_json));
      await db
        .from('webhook_events')
        .update({
          processed_at: now,
          processing_error: null,
          reprocess_count: row.reprocess_count + 1,
          last_reprocess_at: now
        })
        .eq('portone_event_id', row.portone_event_id);
      counters.repaired += 1;
      findings.push({
        eventId: row.portone_event_id,
        issue: 'webhook_unprocessed',
        action: 'reprocessed'
      });
      console.warn(`[watchdog] 웹훅 재처리 성공 event=${row.portone_event_id} type=${row.type}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .from('webhook_events')
        .update({
          processing_error: message.slice(0, 1000),
          reprocess_count: row.reprocess_count + 1,
          last_reprocess_at: now
        })
        .eq('portone_event_id', row.portone_event_id);
      counters.failed += 1;
      findings.push({
        eventId: row.portone_event_id,
        issue: 'webhook_unprocessed',
        action: 'reprocess_failed',
        error: message
      });
      console.error(`[watchdog] 웹훅 재처리 실패 event=${row.portone_event_id}: ${message}`);
    }
  }

  return { retried, unrecovered };
}

// ---------------------------------------------------------------------------
// 2) 구독 점검
// ---------------------------------------------------------------------------
type Candidate = DunningSub & { billing_anchor_day?: number | null };

async function sweep(
  db: SupabaseClient,
  findings: Finding[],
  counters: Counters
): Promise<number> {
  // 대상: 아직 종결되지 않은 구독 전부. 해지 예정(cancel_at_period_end)도
  // 포함한다 -- 기간이 끝났을 때 canceled 로 내리는 주체가 이 잡이기 때문이다.
  // trialing 은 제외한다. 체험은 청구 대상이 아니고, 만료 판정은 entitlement 의
  // trial_ends_at 이 한다.
  const { data: subs, error } = await db
    .from('subscriptions')
    .select(DUNNING_COLUMNS)
    .in('status', ['active', 'past_due'])
    .limit(BATCH)
    .returns<Candidate[]>();

  if (error) throw new Error(`구독 조회 실패: ${error.message}`);
  const rows = subs ?? [];
  const now = new Date();
  const nowMs = now.getTime();

  for (const sub of rows) {
    const periodEndMs = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
    const periodEndValid = Number.isFinite(periodEndMs);

    // ── 경로 0: 해지 예정 + 기간 종료 -> canceled ---------------------------
    // 다른 어떤 판정보다 먼저다. 해지한 사람에게 재시도를 걸면 안 된다.
    if (sub.cancel_at_period_end && periodEndValid && periodEndMs <= nowMs) {
      const revoked = await revokeUpcomingSchedules(db, {
        userId: sub.user_id,
        billingKey: sub.billing_key,
        kind: 'all',
        now
      });
      const { error: updErr } = await db
        .from('subscriptions')
        .update({
          status: 'canceled',
          canceled_at: now.toISOString(),
          dunning_rung: 0,
          dunning_started_at: null,
          dunning_cycle_end: null
        })
        .eq('user_id', sub.user_id)
        .in('status', ['active', 'past_due']);
      if (updErr) throw new Error(`canceled 전환 실패: ${updErr.message}`);
      counters.repaired += 1;
      findings.push({
        userId: sub.user_id,
        issue: 'cancel_period_ended',
        action: 'canceled',
        error: revoked.error
      });
      console.warn(`[watchdog] 해지 기간 종료 -> canceled user=${sub.user_id}`);
      continue;
    }

    // ── 경로 1: past_due 는 dunning 이 독점한다 -----------------------------
    // [HARD] 이 분기가 이중청구 방지의 1차 방어선이다. 여기서 continue 하므로
    // past_due 구독은 아래의 연체 복구(+5분 즉시 청구) 경로에 도달할 수 없다.
    if (sub.status === 'past_due') {
      // 1a. 유예가 끝났으면 만료. 사다리보다 먼저 본다 -- 유예가 끝난 뒤에
      //     재시도를 거는 것은 잠긴 계정에 청구하는 짓이다.
      if (graceLapsed(sub, now)) {
        const { revoked } = await expireSubscription(db, sub, now);
        counters.repaired += 1;
        findings.push({
          userId: sub.user_id,
          issue: 'grace_expired',
          action: 'expired',
          error: revoked.error
        });
        console.warn(
          `[watchdog] 유예 만료 -> expired user=${sub.user_id} grace_until=${sub.grace_until}`
        );
        continue;
      }

      // 1b. 다음 재시도 단이 필요하면 하나 예약한다.
      const ladder = await advanceDunningLadder(db, sub, now);
      if (ladder.outcome === 'not_due' || ladder.outcome === 'exhausted') continue;

      const finding: Finding = {
        userId: sub.user_id,
        issue: 'dunning_retry',
        action: ladder.outcome,
        rung: ladder.rung,
        paymentId: ladder.paymentId,
        timeToPay: ladder.timeToPay,
        error: ladder.error
      };
      if (ladder.outcome === 'scheduled') {
        counters.repaired += 1;
        console.warn(
          `[watchdog] dunning 재시도 ${ladder.rung}단 예약 user=${sub.user_id} at=${ladder.timeToPay}`
        );
      } else if (ladder.outcome === 'failed') {
        counters.failed += 1;
        console.error(
          `[watchdog] dunning 재시도 ${ladder.rung}단 예약 실패 user=${sub.user_id}: ${ladder.error}`
        );
      }
      findings.push(finding);
      continue;
    }

    // ── 경로 2: active 의 예약 누락 감시 (S4) -------------------------------
    // 결제 수단이 없으면 예약을 걸어봐야 소용없다. 해지 예정이면 걸어서는 안 된다.
    if (!sub.billing_key || !sub.portone_customer_id) continue;
    if (sub.cancel_at_period_end) continue;

    // 이 사용자에게 아직 오지 않은 예약이 하나라도 있는가.
    const { data: upcoming, error: upErr } = await db
      .from('payment_attempts')
      .select('payment_id, scheduled_for')
      .eq('user_id', sub.user_id)
      .eq('status', 'scheduled')
      .gt('scheduled_for', now.toISOString())
      .limit(1);
    if (upErr) throw new Error(`예약 조회 실패: ${upErr.message}`);
    if (upcoming && upcoming.length > 0) continue; // 정상.

    // 언제로 잡을 것인가.
    //   * 주기 끝이 미래   -> 원래 잡혔어야 할 그 시각.
    //   * 주기 끝이 과거   -> 청구가 이미 밀렸다. 주기를 **전진시키지 않는다**
    //     (전진시키면 받지도 않은 돈에 대해 서비스를 열어주는 셈이다). 대신
    //     곧바로 청구가 시도되도록 가까운 미래로 잡는다. 성공하면 그때 웹훅이
    //     정상 경로로 기간을 전진시킨다.
    const overdue = !periodEndValid || periodEndMs <= nowMs;
    const timeToPay = overdue ? new Date(nowMs + MIN_LEAD_MS) : new Date(periodEndMs);

    const finding: Finding = {
      userId: sub.user_id,
      issue: overdue ? 'period_end_passed' : 'no_upcoming_schedule',
      action: 'schedule',
      timeToPay: timeToPay.toISOString()
    };

    const res = await ensureNextSchedule(db, {
      userId: sub.user_id,
      billingKey: sub.billing_key,
      customerId: sub.portone_customer_id,
      email: null,
      timeToPay,
      origin: 'watchdog'
    });

    finding.paymentId = res.paymentId;
    finding.action = res.outcome;
    if (res.outcome === 'failed') {
      finding.error = res.error;
      counters.failed += 1;
      console.error(`[watchdog] 복구 실패 user=${sub.user_id}: ${res.error}`);
    } else if (res.outcome === 'already') {
      // 예약 행은 있는데 status 가 scheduled 가 아니었다(예: 이미 결제됨).
      // 실제 문제가 아니었다는 뜻이므로 복구로 세지 않는다.
      console.info(`[watchdog] 조치 불필요 user=${sub.user_id} (${res.paymentId} 이미 존재)`);
    } else {
      counters.repaired += 1;
      console.warn(
        `[watchdog] 예약 누락 복구 user=${sub.user_id} issue=${finding.issue} at=${finding.timeToPay}`
      );
    }
    findings.push(finding);
  }

  return rows.length;
}
