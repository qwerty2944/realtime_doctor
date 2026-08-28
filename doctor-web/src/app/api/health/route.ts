/**
 * GET /api/health -- doctor-web 의 헬스체크.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] "Node 가 살아 있다"는 헬스체크가 아니다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 이 라우트가 200 을 돌려주는 것만으로는 아무것도 증명되지 않는다. Next 가 뜨는
 * 것과 의사가 통계 화면을 볼 수 있는 것 사이에는 Supabase 연결, service_role
 * 키, 네 개의 `f_web_stats_*` 함수가 있고, 그 중 어느 것이 깨져도 이 프로세스는
 * 멀쩡하다. 아무것도 없는 것보다 나쁜 200 을 만들지 않기 위해, 이 앱이 **실제로
 * 실패할 지점**만 확인한다.
 *
 * 확인 항목
 * ---------
 *   database  -- service_role 로 `web_stats_export_audit` 에 닿는가. 이 앱이
 *                쓰기를 하는 유일한 테이블이고, CSV 내보내기는 이 쓰기가
 *                실패하면 다운로드를 거부한다.
 *   stats_rpc -- `f_ops_stats_probe()` (0017). 네 개의 통계 함수를 합성 subject
 *                로 **실제로 실행**한다. 자세한 증명 범위는 그 함수의 주석에.
 *   prober    -- 감시자 자신이 살아 있는가. 아래 별도 항목 참조.
 *   alerting  -- 알림이 갈 곳이 있는가. 아래 별도 항목 참조.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 왜 프로버의 생사를 여기서 보고하는가
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 스케줄 잡은 **자기 죽음을 스스로 알릴 수 없다.** 죽은 뒤에는 아무 코드도 돌지
 * 않기 때문이다. 이건 원리이고 우회할 수 없다. 할 수 있는 것은 죽음을 바깥에서
 * **한 번의 조회로 보이게** 만드는 것뿐이고, 그게 이 항목이다.
 *
 * `ops_probe_status` 뷰가 마지막 실행의 `expected_next_run_at` 과 지금을
 * 비교해서 `prober_stale` 을 계산한다. 임계값이 뷰 한 곳에만 있으므로 판독자가
 * 늘어나도 서로 어긋나지 않는다.
 *
 * 그래서 오늘 사람이 볼 URL 은 이 하나다. 이 응답의 `extra.prober` 가
 * `stale: true` 이면 감시가 멈춘 것이고, 그때는 화면이 아무리 멀쩡해 보여도
 * **아무도 지켜보고 있지 않다**는 뜻이다.
 *
 * 인증: 없다. 응답에 비밀값도 환자 정보도 없고, 인증을 걸면 감시자가 자격을
 * 들고 다녀야 해서 그 자격이 만료되는 날 감시도 조용히 멈춘다.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  describe,
  healthResponse,
  rollUp,
  type HealthCheck,
  type HealthReport,
} from '@/lib/ops/report';
import { alertTarget } from '@/lib/ops/notify';
import { probeIntervalMinutes } from '@/lib/ops/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProbeStatusRow {
  run_id: string;
  started_at: string;
  status: string;
  down_count: number;
  degraded_count: number;
  age_seconds: number;
  seconds_late: number | null;
  prober_stale: boolean;
  alert_target_configured: boolean;
  alerts_undeliverable: number;
  open_issue_count: number;
}

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];
  const extra: Record<string, unknown> = {};

  // 환경변수가 없으면 클라이언트 생성 자체가 던진다. 그 경우도 결과여야 하므로
  // 검사 안에서 잡는다 -- 500 을 던지면 감시자는 "앱이 죽었다"만 알고 이유를
  // 모른다.
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  try {
    admin = createSupabaseAdminClient();
    checks.push({ name: 'env', ok: true, detail: '필수 환경변수 3개 설정됨 (값은 확인하지 않음)' });
  } catch (err) {
    checks.push({
      name: 'env',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (admin) {
    // 1) DB 도달성. head 요청이라 행 내용은 한 바이트도 오지 않는다.
    try {
      const { error } = await admin
        .from('web_stats_export_audit')
        .select('*', { count: 'exact', head: true })
        .limit(1);
      checks.push({
        name: 'database',
        ok: !error,
        detail: error
          ? `web_stats_export_audit 조회 실패: ${describe(error)}`
          : 'web_stats_export_audit 조회 가능 (행 내용은 읽지 않음)',
      });
    } catch (err) {
      checks.push({
        name: 'database',
        ok: false,
        detail: `DB 예외: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 2) 통계 RPC. 화면 전체가 여기에 달려 있다.
    try {
      const { data, error } = await admin.rpc('f_ops_stats_probe');
      const payload = data as { ok?: boolean; detail?: string; note?: string } | null;
      const ok = !error && payload?.ok === true;
      checks.push({
        name: 'stats_rpc',
        ok,
        detail: error
          ? `f_ops_stats_probe 호출 실패: ${describe(error)}`
          : ok
            ? 'f_web_stats_* 네 함수가 실제 테이블 위에서 실행됨'
            : `통계 함수 실행 실패: ${payload?.detail ?? '알 수 없음'}`,
      });
      if (payload?.note) extra.statsProbeNote = payload.note;
    } catch (err) {
      checks.push({
        name: 'stats_rpc',
        ok: false,
        detail: `통계 RPC 예외: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3) 감시자 자신. + 4) 알림 대상.
    try {
      const { data, error } = await admin
        .from('ops_probe_status')
        .select('*')
        .maybeSingle<ProbeStatusRow>();

      if (error) {
        checks.push({
          name: 'prober',
          ok: false,
          detail: `ops_probe_status 조회 실패: ${describe(error)}`,
        });
      } else if (!data) {
        // 한 번도 안 돌았다. 배포 직후에는 정상이지만, 하루가 지나도 이 상태면
        // 크론이 붙지 않은 것이다. 조용히 넘기지 않는다.
        checks.push({
          name: 'prober',
          ok: false,
          detail:
            '프로버가 한 번도 실행된 적 없음 (ops_probe_runs 가 비어 있음). 배포 직후라면 첫 크론을 기다리는 중이고, 하루가 지났다면 크론이 붙지 않은 것이다.',
        });
        extra.prober = { everRan: false, intervalMinutes: probeIntervalMinutes() };
        const targetNow = alertTarget() !== null;
        checks.push({
          name: 'alerting',
          ok: targetNow,
          detail: targetNow
            ? '알림 대상(OPS_ALERT_WEBHOOK_URL)이 설정되어 있다'
            : '알림 대상(OPS_ALERT_WEBHOOK_URL)이 설정되지 않았다. 이상은 DB 에 기록되지만 아무에게도 전달되지 않는다.',
        });
        extra.alerting = { targetConfigured: targetNow };
      } else {
        checks.push({
          name: 'prober',
          ok: !data.prober_stale,
          detail: data.prober_stale
            ? `프로버가 멈춘 것으로 보인다. 마지막 실행 ${Math.round(data.age_seconds / 60)}분 전, 예정보다 ${Math.round((data.seconds_late ?? 0) / 60)}분 지연. 지금 이 제품은 아무도 지켜보지 않고 있다.`
            : `마지막 실행 ${Math.round(data.age_seconds / 60)}분 전, 결과 ${data.status}`,
        });

        // [HARD] 알림 대상 미설정을 별도 검사로 올린다. 조용히 no-op 하는
        // 알림기는 이 기능이 막으려는 실패 그 자체다.
        //
        // 판정 근거는 **지금 이 프로세스의 환경변수**이지 마지막 실행의 기록이
        // 아니다. 프로버는 이 앱 안에서 돌므로 여기서 보는 값이 곧 프로버가 쓸
        // 값이고, 마지막 실행 기록은 과거 사실이다. 기록만 보면 "지난주에는
        // 설정돼 있었다"가 "지금 알림이 나간다"로 읽힌다.
        const targetNow = alertTarget() !== null;
        checks.push({
          name: 'alerting',
          ok: targetNow,
          detail: targetNow
            ? '알림 대상(OPS_ALERT_WEBHOOK_URL)이 설정되어 있다'
            : '알림 대상(OPS_ALERT_WEBHOOK_URL)이 설정되지 않았다. 이상은 DB 에 기록되지만 **아무에게도 전달되지 않는다.** 채널을 붙이기 전까지는 이 URL 을 사람이 직접 봐야 한다.',
        });

        extra.prober = {
          everRan: true,
          runId: data.run_id,
          lastRunAt: data.started_at,
          lastRunStatus: data.status,
          ageSeconds: data.age_seconds,
          secondsLate: data.seconds_late,
          stale: data.prober_stale,
          intervalMinutes: probeIntervalMinutes(),
          downCount: data.down_count,
          degradedCount: data.degraded_count,
          openIssueCount: data.open_issue_count,
        };
        extra.alerting = {
          // 지금 설정된 상태.
          targetConfigured: targetNow,
          // 마지막 실행 시점의 상태. 둘이 다르면 설정이 바뀐 것이다.
          targetConfiguredAtLastRun: data.alert_target_configured,
          undeliverableLastRun: data.alerts_undeliverable,
        };
      }
    } catch (err) {
      checks.push({
        name: 'prober',
        ok: false,
        detail: `프로버 상태 조회 예외: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const report: HealthReport = {
    surface: 'doctor-web',
    // env/database/stats_rpc 가 깨지면 통계 화면이 동작하지 않는다 -> down.
    // prober/alerting 이 깨지면 제품은 돌지만 아무도 지켜보지 않는다 -> degraded.
    status: rollUp(checks, ['env', 'database', 'stats_rpc']),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
    provesWhenOk: [
      'doctor-web 이 배포되어 요청을 받는다',
      'service_role 로 Supabase 에 닿고 감사 테이블을 읽을 수 있다',
      '통계 화면이 쓰는 네 함수가 실제 테이블 위에서 실행된다',
      '감시 프로버가 최근에 돌았는지, 그리고 알림이 갈 곳이 있는지',
    ],
    doesNotProve: [
      '통계 숫자가 옳은지 -- 합성 subject 는 행을 갖지 않으므로 집계는 항상 0 이다',
      '의사 로그인·쿠키 갱신·`authenticated` 권한 경로 (브라우저 세션이 필요하다)',
      '키오스크나 Edge Function 의 상태 (각자의 /api/health 가 답한다)',
    ],
    extra,
  };

  return healthResponse(report);
}
