/**
 * GET|POST /api/ops/probe -- 관측 프로버 (O1).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 이 잡이 존재하는 이유
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 지금 이 제품에는 무엇이 깨졌는지 알려 주는 것이 하나도 없다. 키오스크가
 * 멈추면, entitlement 가 500 을 뿜기 시작하면, provider 키가 만료되면, 첫
 * 신호는 진료 중인 의사의 전화다. 월 7만원을 받으려는 도구가 눈이 먼 채로
 * 돌고 있는 상태가 가장 큰 운영 공백이다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 왜 admin-web 이 아니라 doctor-web 에 있는가
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 기존 Cron(`/api/billing/watchdog`)은 `admin-web/vercel.json` 에 있다. 관례를
 * 따르자면 프로버도 거기 있어야 한다. 그러지 않은 이유는 하나다:
 *
 *     **admin-web 은 아직 배포되지 않았다.**
 *
 * 배포되지 않은 앱의 Cron 은 실행되지 않는다. 거기 두면 이 프로버는 커밋된
 * 첫날부터 한 번도 돌지 않으면서 "감시가 붙었다"는 인상만 남기고, 그건 이
 * 기능이 없느니만 못한 상태다. doctor-web 은 `entanglecare.com` 을 서비스하며
 * 실제로 배포되어 있으므로 여기에 둔다. admin-web 이 배포되면 옮길 수 있으나,
 * 옮길 이유는 없다 -- 감시자는 감시 대상 중 가장 확실히 살아 있는 곳에 두는
 * 편이 낫다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 조용한 0 과 안 도는 잡의 구분 -- 그리고 이 잡 자신의 죽음
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `subscription_watchdog_runs`(0004)와 같은 원칙으로, 이상이 없어도 반드시
 * `ops_probe_runs` 에 한 줄 남긴다. 남기지 않으면 "오늘 전부 정상"과 "이 잡이
 * 3월부터 안 돌고 있음"이 DB 상에서 똑같이 아무 흔적 없음이 된다.
 *
 * 그런데 감시자에게는 한 겹이 더 있다. **조용히 죽는 크론을 감시하려고 만든
 * 잡이 조용히 죽으면 같은 버그가 한 층 위에서 반복된다.** 여기서 원리를
 * 분명히 해 둔다:
 *
 *   스케줄 잡은 자기 죽음을 스스로 알릴 수 없다. 죽은 뒤에는 아무 코드도 돌지
 *   않기 때문이다. 우회는 없다. 할 수 있는 것은 두 가지뿐이다.
 *
 *   (1) 사후 보고 — 실행할 때마다 이전 실행과의 간격을 재서, 기대보다 크면
 *       `missed_previous_run = true` 로 기록하고 알린다. 멈춤이 **끝난 뒤에는**
 *       반드시 드러난다. 안에서 할 수 있는 최선이 여기까지다.
 *
 *   (2) 상시 노출 — 매 실행이 `expected_next_run_at` 을 기록하고,
 *       `ops_probe_status` 뷰가 그 기대와 지금을 비교해 `prober_stale` 을
 *       계산한다. 그리고 그 값을 **`/api/health` 가 실어 나른다.** 즉 이 잡이
 *       죽으면, 죽은 그 순간부터, 사람이나 외부 감시기가 URL 하나
 *       (`https://entanglecare.com/api/health`)만 보면 알 수 있다.
 *
 *   (2)에는 남는 구멍이 하나 있고 숨기지 않는다: 크론과 헬스체크가 같은 Vercel
 *   계정 위에 있으므로 **Vercel 전체가 죽으면 둘 다 죽는다.** 그 경우를 보려면
 *   감시자가 Vercel 밖에 있어야 한다. 지금 구성은 그것을 하지 않으며, 해결책은
 *   외부 스케줄러가 같은 URL 을 치는 것이다(lib/ops/schedule.ts 주석 참조).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 인증
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Authorization: Bearer $CRON_SECRET`. Vercel Cron 은 `CRON_SECRET` 환경변수가
 * 있을 때 이 헤더를 자동으로 붙인다. 그래서 다른 이름을 쓰면 크론이 매번 401 을
 * 받고 **아무도 모르게 한 번도 성공하지 못한다** -- 기존 watchdog 이
 * `BILLING_CRON_SECRET` 을 쓰는 것은 이 함정에 걸려 있을 수 있다(보고서 참조).
 *
 * `CRON_SECRET` 이 없으면 요청을 받아 주지 않고 503 을 준다. 열어 두면 아무나
 * 프로버를 돌려 기록을 오염시킬 수 있고, 조용히 통과시키면 인증이 없다는 사실이
 * 숨는다. 이 미설정 상태는 `/api/health` 의 `prober` 검사에서 "한 번도 실행된
 * 적 없음"으로 드러난다.
 */

import { timingSafeEqual } from 'node:crypto';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { dispatchAlerts, alertTarget, type AlertCandidate } from '@/lib/ops/notify';
import { probeIntervalMinutes } from '@/lib/ops/schedule';
import { surfaces, type Surface } from '@/lib/ops/surfaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 표면이 여럿이고 각각 타임아웃이 있을 수 있다. 기본 60초로는 모자란다. */
export const maxDuration = 120;

/** 한 표면을 기다리는 상한. 이걸 넘기면 그 표면은 down 이다. */
const SURFACE_TIMEOUT_MS = 10_000;
/** 기대 간격을 이만큼 초과하면 "지난 실행을 걸렀다"로 본다. */
const MISSED_RUN_TOLERANCE = 1.5;

type SurfaceStatus = 'ok' | 'degraded' | 'down' | 'unknown';

interface SurfaceResult {
  surface: string;
  url: string;
  status: SurfaceStatus;
  httpStatus: number | null;
  latencyMs: number;
  /** 표면이 돌려준 개별 검사 결과. 실패한 것만 싣는다(정상 응답을 부풀리지 않기 위해). */
  failedChecks: { name: string; detail: string }[];
  issue: string | null;
  detail: string;
  impact: string;
}

function authorized(req: Request): { ok: true } | { ok: false; reason: string } {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return {
      ok: false,
      reason:
        'CRON_SECRET 이 설정되지 않았다. 스케줄러를 인증할 수 없으므로 프로버를 실행하지 않는다. ' +
        'Vercel 프로젝트 환경변수에 CRON_SECRET 을 추가하면 Vercel Cron 이 이 값을 Bearer 로 자동 전송한다.',
    };
  }
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'unauthorized' };
  }
  return { ok: true };
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

/** POST 도 받는다. 외부 스케줄러가 POST 만 보내는 경우가 흔하다. */
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  const auth = authorized(req);
  if (!auth.ok) {
    const misconfigured = auth.reason !== 'unauthorized';
    if (misconfigured) console.error('[ops]', auth.reason);
    return Response.json(
      { error: misconfigured ? 'not_configured' : 'unauthorized', detail: auth.reason },
      { status: misconfigured ? 503 : 401 },
    );
  }
  return run();
}

async function run(): Promise<Response> {
  const db = createSupabaseAdminClient();
  const startedAt = new Date();
  const intervalMinutes = probeIntervalMinutes();
  const expectedNextRunAt = new Date(startedAt.getTime() + intervalMinutes * 60_000);

  // ── 이전 실행과의 간격 (자기 죽음의 사후 탐지) ────────────────────────────
  let gapSeconds: number | null = null;
  let missedPreviousRun = false;
  {
    const { data: prev, error } = await db
      .from('ops_probe_runs')
      .select('started_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ started_at: string }>();
    if (error) {
      console.error('[ops] 이전 실행 조회 실패:', error.message);
    } else if (prev) {
      gapSeconds = Math.round((startedAt.getTime() - Date.parse(prev.started_at)) / 1000);
      missedPreviousRun = gapSeconds > intervalMinutes * 60 * MISSED_RUN_TOLERANCE;
    }
  }

  // ── 실행 기록을 **먼저** 만든다 ─────────────────────────────────────────
  // 중간에 죽어도 "돌긴 돌았다"가 남아야 한다. 0004 watchdog 과 같은 순서다.
  const { data: runRow, error: runErr } = await db
    .from('ops_probe_runs')
    .insert({
      started_at: startedAt.toISOString(),
      expected_next_run_at: expectedNextRunAt.toISOString(),
      gap_seconds: gapSeconds,
      missed_previous_run: missedPreviousRun,
      alert_target_configured: alertTarget() !== null,
      status: 'error', // 끝까지 못 가면 이 값이 남는다. 그게 맞다.
    })
    .select('id')
    .single<{ id: string }>();

  if (runErr || !runRow) {
    // 기록을 못 만들면 감시 자체가 성립하지 않는다. 조용히 성공하지 않는다.
    console.error('[ops] 실행 기록 생성 실패:', runErr?.message);
    return Response.json(
      { error: 'internal', detail: `실행 기록을 만들지 못했다: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.id;

  const results: SurfaceResult[] = [];
  let fatal: string | null = null;

  try {
    // 표면들은 서로 독립이므로 병렬로 친다. 순차로 돌면 표면 하나의 타임아웃이
    // 뒤의 전부를 밀어 실행 시간 상한에 걸린다.
    const list = surfaces();
    const settled = await Promise.all(list.map((s) => probeSurface(s)));
    results.push(...settled);
  } catch (err) {
    fatal = err instanceof Error ? err.message : String(err);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const degraded = results.filter((r) => r.status === 'degraded').length;
  const down = results.filter((r) => r.status === 'down' || r.status === 'unknown').length;

  // ── 알림 후보 ──────────────────────────────────────────────────────────
  const failing: AlertCandidate[] = [];
  for (const r of results) {
    if (r.status === 'ok') continue;
    failing.push({
      surface: r.surface,
      issue: r.issue ?? 'unhealthy',
      severity: r.status === 'degraded' ? 'degraded' : 'down',
      detail: `${r.detail} / 영향: ${r.impact}`,
    });
  }
  if (missedPreviousRun) {
    // [HARD] 프로버 자신의 멈춤. 이걸 알리지 않으면 "감시가 3일 쉬었다"가
    // 아무 데도 안 남는다 -- 이 기능이 막으려는 실패와 정확히 같은 모양이다.
    failing.push({
      surface: 'prober',
      issue: 'missed_run',
      severity: 'degraded',
      detail:
        `이전 실행과의 간격이 ${gapSeconds}초로 기대(${intervalMinutes * 60}초)를 크게 넘었다. ` +
        '이 잡이 그동안 돌지 않았고, 그동안 아무도 제품을 지켜보지 않았다.',
    });
  }
  const healthySurfaces = results.filter((r) => r.status === 'ok').map((r) => r.surface);
  if (!missedPreviousRun) healthySurfaces.push('prober');

  const alerts = await dispatchAlerts(db, runId, failing, healthySurfaces);

  // ── 상태 판정 ──────────────────────────────────────────────────────────
  let status: 'ok' | 'degraded' | 'down' | 'error';
  if (fatal) {
    status = 'error';
  } else if (results.some((r) => (r.status === 'down' || r.status === 'unknown') && isCritical(r.surface))) {
    status = 'down';
  } else if (down > 0 || degraded > 0 || missedPreviousRun) {
    status = 'degraded';
  } else if (!alerts.targetConfigured && failing.length > 0) {
    // 보낼 것이 있었는데 보낼 곳이 없었다. 제품은 멀쩡해도 감시는 반쪽이다.
    status = 'degraded';
  } else {
    status = 'ok';
  }

  const details = results.map((r) => ({
    surface: r.surface,
    url: r.url,
    status: r.status,
    httpStatus: r.httpStatus,
    latencyMs: r.latencyMs,
    failedChecks: r.failedChecks,
    issue: r.issue,
    detail: r.detail,
  }));

  const { error: updErr } = await db
    .from('ops_probe_runs')
    .update({
      finished_at: new Date().toISOString(),
      status,
      surface_count: results.length,
      ok_count: ok,
      degraded_count: degraded,
      down_count: down,
      details: {
        surfaces: details,
        // [HARD] 전달하지 못한 알림의 내용을 그대로 남긴다. 채널이 붙는 날
        // 무엇을 놓쳤는지 확인할 수 있어야 하고, 지금은 이것이 "알림이 안
        // 나가고 있다"의 가장 구체적인 증거다.
        wouldHaveSent: alerts.wouldHaveSent,
      },
      alert_target_configured: alerts.targetConfigured,
      alerts_sent: alerts.sent,
      alerts_suppressed: alerts.suppressed,
      alerts_undeliverable: alerts.undeliverable,
      alert_error: alerts.error,
      error: fatal,
    })
    .eq('id', runId);
  if (updErr) console.error('[ops] 실행 기록 갱신 실패:', updErr.message);

  // 정상일 때도 반드시 한 줄 남긴다. Vercel 런타임 로그가 지금은 유일하게
  // 사람에게 닿는 두 번째 경로다.
  console.info(
    `[ops] run=${runId} status=${status} surfaces=${results.length} ok=${ok} ` +
      `degraded=${degraded} down=${down} gap=${gapSeconds ?? 'n/a'}s ` +
      `missedPrev=${missedPreviousRun} alertTarget=${alerts.targetConfigured} ` +
      `sent=${alerts.sent} suppressed=${alerts.suppressed} undeliverable=${alerts.undeliverable}`,
  );
  if (!alerts.targetConfigured) {
    console.warn(
      '[ops] OPS_ALERT_WEBHOOK_URL 미설정 — 이상이 발견되어도 아무에게도 전달되지 않는다.',
    );
  }

  return Response.json({
    ok: true,
    runId,
    status,
    intervalMinutes,
    expectedNextRunAt: expectedNextRunAt.toISOString(),
    gapSeconds,
    missedPreviousRun,
    counts: { surfaces: results.length, ok, degraded, down },
    alerts: {
      targetConfigured: alerts.targetConfigured,
      sent: alerts.sent,
      suppressed: alerts.suppressed,
      undeliverable: alerts.undeliverable,
      error: alerts.error,
      wouldHaveSent: alerts.wouldHaveSent,
    },
    surfaces: details,
    error: fatal,
  });
}

function isCritical(name: string): boolean {
  return surfaces().find((s) => s.name === name)?.critical ?? false;
}

/**
 * 한 표면을 친다.
 *
 * 세 가지를 구별한다. 구별하지 않으면 "제품이 죽었다"와 "감시가 못 물어봤다"가
 * 같은 알림이 되고, 둘은 부르는 사람이 다르다.
 *
 *   down     -- 응답이 없거나(네트워크·타임아웃), 5xx/4xx 를 주거나, 본문이
 *               스스로 'down' 이라고 말한다.
 *   degraded -- 응답은 정상이고 본문이 'degraded' 라고 말한다.
 *   unknown  -- 200 을 받았지만 본문을 헬스 보고서로 해석할 수 없다. 표면이
 *               다른 무언가로 바뀌었거나 라우팅이 엉뚱한 곳을 가리킨다.
 *               'ok' 로 세지 않는 것이 핵심이다.
 */
async function probeSurface(s: Surface): Promise<SurfaceResult> {
  const started = Date.now();
  const base = {
    surface: s.name,
    url: s.url,
    impact: s.impact,
    failedChecks: [] as { name: string; detail: string }[],
  };

  let res: Response;
  try {
    res = await fetch(s.url, {
      method: 'GET',
      headers: edgeHeaders(s),
      cache: 'no-store',
      signal: AbortSignal.timeout(SURFACE_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: 'down',
      httpStatus: null,
      latencyMs: Date.now() - started,
      issue: 'unreachable',
      detail: `응답 없음: ${message}`,
    };
  }

  const latencyMs = Date.now() - started;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 아래에서 unknown 으로 처리된다. */
  }

  const report = body as
    | { status?: string; checks?: { name: string; ok: boolean; detail: string }[] }
    | null;

  const failedChecks =
    report?.checks?.filter((c) => !c.ok).map((c) => ({ name: c.name, detail: c.detail })) ?? [];

  if (report?.status === 'ok' || report?.status === 'degraded' || report?.status === 'down') {
    const status = report.status as SurfaceStatus;
    return {
      ...base,
      status,
      httpStatus: res.status,
      latencyMs,
      failedChecks,
      issue: status === 'ok' ? null : (failedChecks[0]?.name ?? 'unhealthy'),
      detail:
        status === 'ok'
          ? `정상 (${latencyMs}ms)`
          : `실패한 검사: ${failedChecks.map((c) => `${c.name}(${c.detail})`).join('; ') || '상세 없음'}`,
    };
  }

  if (!res.ok) {
    return {
      ...base,
      status: 'down',
      httpStatus: res.status,
      latencyMs,
      issue: 'http_error',
      detail: `HTTP ${res.status} 이고 헬스 보고서를 돌려주지 않았다.`,
    };
  }

  // [HARD] 200 인데 헬스 보고서가 아니다. 이걸 정상으로 세면 라우팅이 엉뚱한
  // 페이지(예: 404 HTML, 로그인 리다이렉트)를 가리켜도 감시는 계속 초록이다.
  return {
    ...base,
    status: 'unknown',
    httpStatus: res.status,
    latencyMs,
    issue: 'not_a_health_report',
    detail:
      '200 을 받았지만 본문이 헬스 보고서가 아니다. 라우팅이 다른 곳을 가리키고 있을 수 있다.',
  };
}

/**
 * Edge Function 게이트웨이는 JWT 검증이 켜져 있어 인증 헤더가 없으면 함수
 * 코드에 닿기 전에 401 이 된다. anon 키는 유효한 JWT 이므로 게이트웨이를
 * 통과하고, 헬스 분기는 그 뒤 사용자 JWT 검사보다 먼저 실행된다.
 *
 * anon 키는 이미 클라이언트 번들에 들어가는 공개 값이라 여기 쓰는 것으로
 * 새로 노출되는 것은 없다.
 */
function edgeHeaders(s: Surface): Record<string, string> {
  if (s.kind !== 'edge') return {};
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return anon ? { Authorization: `Bearer ${anon}`, apikey: anon } : {};
}
