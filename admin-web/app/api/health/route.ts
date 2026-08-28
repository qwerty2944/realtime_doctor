/**
 * GET /api/health -- admin-web 의 헬스체크.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] "Next 가 떴다"는 헬스체크가 아니다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 이 앱이 실제로 실패하는 지점은 프로세스가 아니라 그 아래에 있다: service_role
 * 로 구독 테이블에 닿는가, 결제를 받을 자격이 있는가, 그리고 결제 주기를
 * 지키는 크론이 실제로 돌고 있는가. 그 셋 중 무엇이 깨져도 Node 는 멀쩡하다.
 * 아무것도 없는 것보다 나쁜 200 을 만들지 않기 위해 그 셋만 확인한다.
 *
 * 확인 항목
 * ---------
 *   env       -- service_role 클라이언트를 만들 수 있는가 (코어 변수 존재).
 *   database  -- service_role 로 `subscriptions` 에 실제로 닿는가. 이 앱이
 *                존재하는 이유인 테이블이고, RLS 상 service_role 만 읽는다.
 *                즉 이 검사는 키가 유효하다는 것까지 증명한다.
 *   portone   -- 결제를 받을 수 있는 자격이 설정돼 있는가. **이름만** 본다.
 *   watchdog  -- 결제 주기 감시 크론이 최근에 돌았는가. 아래 별도 항목.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] watchdog 항목이 여기 있는 이유 -- 이 앱의 가장 조용한 실패
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `/api/billing/watchdog` 은 재예약 누락·연체·해지 만료를 복구한다. 그 잡이
 * 멈추면 **에러도, 실패한 결제도, 로그 한 줄도 남지 않는다.** 첫 증상은 몇 달 뒤
 * "매출이 왜 안 늘지?" 다.
 *
 * 그리고 그 잡을 멈추는 가장 쉬운 방법은 코드 버그가 아니라 **환경변수 이름**
 * 이다. Vercel Cron 은 `CRON_SECRET` 이라는 이름에만 Bearer 를 붙이므로, 다른
 * 이름을 기대하면 매 실행 401 이 되고, 그 라우트는 실행 기록을 인증 뒤에 쓰므로
 * `subscription_watchdog_runs` 가 비어 있는 채로 남는다. "이상 없음"과
 * "한 번도 안 돎"이 DB 상에서 같은 모습이 되는 것이다.
 *
 * 그래서 여기서 마지막 실행 시각을 읽어 **밖에서 보이게** 만든다. doctor-web 의
 * ops 프로버가 이 URL 을 매일 읽으므로, 크론 인증이 어떤 이유로든 다시 깨지면
 * 그날부터 감시 보고서에 뜬다. 침묵이 더는 침묵으로 남지 않는 지점이 여기다.
 *
 * 인증: 없다. 응답에 비밀값도 환자 정보도 없다. 인증을 걸면 감시자가 자격을 들고
 * 다녀야 하고, 그 자격이 만료되는 날 감시도 조용히 멈춘다.
 */

import { getServiceSupabase } from '@/lib/supabase/service';
import { billingConfigured, missingPortOneEnv } from '@/lib/env';
import {
  describe,
  healthResponse,
  rollUp,
  type HealthCheck,
  type HealthReport
} from '@/lib/ops/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 크론 주기(하루). admin-web/vercel.json 의 `0 18 * * *` 과 같은 뜻이다.
 * 한 번 거른 것은 배포나 콜드 스타트일 수 있고, 두 번은 멈춘 것이다 --
 * doctor-web 의 `staleAfterMinutes()` 와 같은 규칙(주기 x 2)을 쓴다.
 */
const WATCHDOG_INTERVAL_MINUTES = 1440;
const WATCHDOG_STALE_AFTER_MS = WATCHDOG_INTERVAL_MINUTES * 2 * 60_000;

interface WatchdogRun {
  started_at: string;
  finished_at: string | null;
  checked_count: number;
  missing_count: number;
  repaired_count: number;
  failed_count: number;
  error: string | null;
}

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];
  const extra: Record<string, unknown> = {};

  // 클라이언트 생성 자체가 던질 수 있다(코어 변수 누락). 그것도 결과여야 하므로
  // 안에서 잡는다 -- 500 을 던지면 감시자는 "앱이 죽었다"만 알고 이유를 모른다.
  let db: ReturnType<typeof getServiceSupabase> | null = null;
  try {
    db = getServiceSupabase();
    checks.push({ name: 'env', ok: true, detail: '코어 환경변수 설정됨 (값은 확인하지 않음)' });
  } catch (err) {
    checks.push({
      name: 'env',
      ok: false,
      detail: err instanceof Error ? err.message : String(err)
    });
  }

  // ── 결제 자격 ───────────────────────────────────────────────────────────
  // [HARD] 이름만 싣는다. 값은 절대 응답에 들어가지 않는다.
  const missing = missingPortOneEnv();
  checks.push({
    name: 'portone',
    ok: billingConfigured(),
    detail: billingConfigured()
      ? '포트원 자격 4종이 모두 설정돼 있다 (값의 유효성은 확인하지 않음)'
      : `포트원 자격이 없어 결제 기능이 꺼져 있다. 비어 있는 이름: ${missing.join(', ')}. ` +
        '/billing 은 "준비 중"을 표시하고 /api/billing/* 는 503 을 준다. ' +
        '체험이 끝나는 의사는 결제할 방법이 없다.'
  });
  extra.billing = { configured: billingConfigured(), missingEnvNames: missing };

  if (db) {
    // ── DB 도달성 ─────────────────────────────────────────────────────────
    // head 요청이라 행 내용은 한 바이트도 오지 않는다.
    try {
      const { error } = await db
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .limit(1);
      checks.push({
        name: 'database',
        ok: !error,
        detail: error
          ? `subscriptions 조회 실패: ${describe(error)}`
          : 'service_role 로 subscriptions 조회 가능 (행 내용은 읽지 않음)'
      });
    } catch (err) {
      checks.push({
        name: 'database',
        ok: false,
        detail: `DB 예외: ${err instanceof Error ? err.message : String(err)}`
      });
    }

    // ── 감시 크론의 생사 ──────────────────────────────────────────────────
    try {
      const { data, error } = await db
        .from('subscription_watchdog_runs')
        .select('started_at, finished_at, checked_count, missing_count, repaired_count, failed_count, error')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle<WatchdogRun>();

      if (error) {
        checks.push({
          name: 'watchdog',
          ok: false,
          detail: `subscription_watchdog_runs 조회 실패: ${describe(error)}`
        });
      } else if (!data) {
        // 배포 직후에는 정상이다. 하루가 지나도 이 상태면 크론이 붙지 않았거나
        // 인증이 깨진 것이고, 둘 다 조용히 넘어가서는 안 된다.
        checks.push({
          name: 'watchdog',
          ok: false,
          detail:
            '결제 감시 크론이 한 번도 실행된 적 없다 (subscription_watchdog_runs 가 비어 있음). ' +
            '배포 직후라면 첫 실행을 기다리는 중이고, 하루가 지났다면 크론이 붙지 않았거나 ' +
            `Bearer 인증이 401 로 거절되고 있다 (Vercel 프로젝트 환경변수 CRON_SECRET 확인).`
        });
        extra.watchdog = { everRan: false, intervalMinutes: WATCHDOG_INTERVAL_MINUTES };
      } else {
        const ageMs = Date.now() - Date.parse(data.started_at);
        const stale = ageMs > WATCHDOG_STALE_AFTER_MS;
        const ageHours = Math.round(ageMs / 3_600_000);
        checks.push({
          name: 'watchdog',
          ok: !stale && !data.error,
          detail: stale
            ? `결제 감시 크론이 멈춘 것으로 보인다. 마지막 실행 ${ageHours}시간 전 ` +
              `(기대 주기 ${WATCHDOG_INTERVAL_MINUTES / 60}시간). 재예약 누락·연체 복구가 그동안 아무도 하지 않았다.`
            : data.error
              ? `마지막 실행이 오류로 끝났다: ${data.error}`
              : `마지막 실행 ${ageHours}시간 전, 점검 ${data.checked_count}건 / 발견 ${data.missing_count}건 / 복구 ${data.repaired_count}건 / 실패 ${data.failed_count}건`
        });
        extra.watchdog = {
          everRan: true,
          lastRunAt: data.started_at,
          finished: data.finished_at !== null,
          ageSeconds: Math.round(ageMs / 1000),
          stale,
          intervalMinutes: WATCHDOG_INTERVAL_MINUTES,
          lastError: data.error,
          checked: data.checked_count,
          missing: data.missing_count,
          repaired: data.repaired_count,
          failed: data.failed_count
        };
      }
    } catch (err) {
      checks.push({
        name: 'watchdog',
        ok: false,
        detail: `감시 크론 상태 조회 예외: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  const report: HealthReport = {
    surface: 'admin-web',
    // env/database 가 깨지면 이 앱은 아무것도 못 한다 -> down.
    // portone/watchdog 가 깨지면 화면은 뜨지만 돈이 흐르지 않는다 -> degraded.
    // [HARD] portone 미설정을 down 으로 올리지 않는 이유: 자격이 도착하기 전의
    // 배포가 계속 'down' 이면 그 색이 정상이 되고, 나중에 진짜 장애가 나도
    // 아무도 구분하지 못한다. degraded 는 "동작하지만 반쪽"이고 그게 사실이다.
    status: rollUp(checks, ['env', 'database']),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
    provesWhenOk: [
      'admin-web 이 배포되어 요청을 받는다',
      'service_role 키가 유효하고 구독 테이블에 실제로 닿는다',
      '결제를 받을 자격(포트원 4종)이 설정돼 있다',
      '결제 주기 감시 크론이 최근에 실행됐다'
    ],
    doesNotProve: [
      '포트원 자격의 **유효성** -- 이름이 있다는 것만 확인한다. 실제 결제는 유료 호출이라 감시 주기에 태우지 않는다',
      '카드 등록 흐름 전체 (브라우저 SDK 와 PG 결제창이 필요하다)',
      'is_admin 게이트 (로그인 세션이 필요하다)',
      '재작성 경로 -- 이 주소는 배포 자체를 직접 친다'
    ],
    extra
  };

  return healthResponse(report);
}
