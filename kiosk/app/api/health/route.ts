/**
 * GET /api/health -- 키오스크 헬스체크.
 *
 * (basePath 가 설정된 배포에서는 `/righthand/patient/api/health` 다.)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 무엇을 확인하는가 — "문진을 시작할 수 있는가"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 이 앱이 실패하는 방식은 하나로 모인다: **환자가 방문 코드를 넣었는데 문진이
 * 시작되지 않는다.** 그 경로 위에 있는 것만 확인한다.
 *
 *   env        -- 필수 환경변수 다섯 개(lib/env.ts 의 REQUIRED_ENV_VARS)가
 *                 전부 있는가. instrumentation.ts 가 부팅 때 한 번 보지만,
 *                 배포 후 변수가 지워지는 경우는 그 검사가 잡지 못한다.
 *   kiosk_config -- KIOSK_CLINICIANS 가 파싱되는가. 이게 깨지면 그 태블릿의
 *                 환자는 통째로 사라진다(encounters.user_id 가 틀리면 RLS 때문에
 *                 어떤 의사에게도 보이지 않는다). 화면에는 아무 이상이 없다.
 *   database   -- service_role 로 `visit_access_codes` 에 닿는가.
 *   intake_rpc -- `f_ops_intake_probe()` (0017). 실제
 *                 `redeem_visit_access_code()` 를 **롤백되는 서브트랜잭션 안에서**
 *                 호출한다. 코드를 소모하지 않고, 진료 행을 만들지 않고,
 *                 무차별 대입 카운터도 건드리지 않는다(반환값의
 *                 `consumedNothing` 이 그것을 증명한다).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 하지 않는 일
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   * Gemini 를 부르지 않는다. 키가 **있는지**만 본다. 감시가 매 실행마다 모델을
 *     부르면 감시 주기가 곧 비용이 되고, 비싼 감시는 결국 꺼진다. 그래서 만료된
 *     Gemini 키는 이 검사를 통과한다 -- 아래 doesNotProve 에 적어 둔다.
 *   * 환자·진료 행을 만들지 않는다. PHI 를 만드는 헬스체크는 그 자체가 사고다.
 *   * 유효한 코드로 성공 경로를 확인하지 않는다. 그러려면 코드를 발급하고
 *     소모해야 하고, 그건 진료 행 생성이다.
 *
 * 인증 없음: 응답에 비밀값도 환자 정보도 없다. 진료의 uuid 도 싣지 않는다
 * (슬러그만 싣는다).
 */

import { REQUIRED_ENV_VARS } from '@/lib/env';
import { getKioskRegistry } from '@/lib/intake/kiosk';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface IntakeProbe {
  ok?: boolean;
  reason?: string;
  detail?: string;
  verdict?: string;
  consumedNothing?: boolean;
  note?: string;
}

/**
 * PostgREST 는 head 요청이 401 로 끊길 때 `message` 가 빈 문자열인 오류를 준다.
 * 그대로 쓰면 "조회 실패: " 로 끝나는, 원인이 안 적힌 실패 문장이 나온다 --
 * 원인 없는 실패 보고는 사람이 다음에 무엇을 볼지 알 수 없게 만든다.
 */
function describe(error: { message?: string; code?: string; hint?: string | null }): string {
  const parts = [error.message?.trim(), error.code, error.hint ?? undefined].filter(
    (v) => v && v !== ''
  );
  return parts.length > 0 ? parts.join(' / ') : '원인 미상 (PostgREST 가 빈 오류를 반환)';
}

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];
  const extra: Record<string, unknown> = {};

  // ── 1) 환경변수 ────────────────────────────────────────────────────────
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === '';
  });
  checks.push({
    name: 'env',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `필수 환경변수 ${REQUIRED_ENV_VARS.length}개 모두 설정됨 (값은 확인하지 않음)`
        : `설정되지 않은 환경변수: ${missing.join(', ')}`
  });

  // ── 2) 키오스크 → 의사 매핑 ─────────────────────────────────────────────
  let firstClinicianId: string | null = null;
  let firstSlug: string | null = null;
  try {
    const registry = getKioskRegistry();
    const entries = [...registry.bySlug.entries()];
    firstSlug = entries[0]?.[0] ?? null;
    firstClinicianId = entries[0]?.[1] ?? null;
    checks.push({
      name: 'kiosk_config',
      ok: entries.length > 0,
      detail: `등록된 키오스크 ${entries.length}개: ${entries.map(([s]) => s).join(', ')}`
    });
    // 슬러그만 노출한다. 슬러그는 이미 태블릿 URL 에 공개된 값이고, 의사 uuid 는
    // 공개된 값이 아니다.
    extra.kioskSlugs = entries.map(([s]) => s);
  } catch (err) {
    checks.push({
      name: 'kiosk_config',
      ok: false,
      detail: err instanceof Error ? err.message : String(err)
    });
  }

  // ── 3) DB + 4) 문진 진입 경로 ──────────────────────────────────────────
  try {
    const db = createSupabaseAdminClient();

    const { error: dbErr } = await db
      .from('visit_access_codes')
      .select('*', { count: 'exact', head: true })
      .limit(1);
    checks.push({
      name: 'database',
      ok: !dbErr,
      detail: dbErr
        ? `visit_access_codes 조회 실패: ${describe(dbErr)}`
        : 'visit_access_codes 조회 가능 (행 내용은 읽지 않음)'
    });

    if (firstClinicianId) {
      const { data, error } = await db.rpc('f_ops_intake_probe', {
        p_clinician_id: firstClinicianId,
        p_kiosk_slug: firstSlug
      });
      const probe = data as IntakeProbe | null;
      const ok = !error && probe?.ok === true;
      checks.push({
        name: 'intake_rpc',
        ok,
        detail: error
          ? `f_ops_intake_probe 호출 실패: ${error.message}`
          : ok
            ? `방문 코드 판정 경로 정상 (판정=${probe?.verdict}, 소모 없음=${probe?.consumedNothing})`
            : `방문 코드 판정 경로 실패: ${probe?.reason ?? '알 수 없음'} ${probe?.detail ?? ''}`
      });
      // [HARD] 롤백이 깨지면 이 헬스체크 자체가 병원의 무차별 대입 예산을
      // 갉아먹는다. 값으로 드러내서 검사에 걸리게 한다.
      if (probe && probe.consumedNothing === false) {
        checks.push({
          name: 'intake_rpc_side_effect',
          ok: false,
          detail:
            '헬스체크가 방문 코드 실패 카운터를 소모했다. 롤백이 동작하지 않고 있으며, 이 검사를 자주 돌리면 실제 환자가 거절될 수 있다.'
        });
      }
      if (probe?.note) extra.intakeProbeNote = probe.note;
    } else {
      checks.push({
        name: 'intake_rpc',
        ok: false,
        detail: 'KIOSK_CLINICIANS 가 없어 문진 진입 경로를 확인하지 못했다.'
      });
    }
  } catch (err) {
    checks.push({
      name: 'database',
      ok: false,
      detail: `DB 예외: ${err instanceof Error ? err.message : String(err)}`
    });
  }

  // env / kiosk_config / database / intake_rpc 중 하나라도 깨지면 환자가 문진을
  // 시작할 수 없다. 전부 down 이다 -- 이 앱에는 "일부만 되는" 상태가 없다.
  const critical = ['env', 'kiosk_config', 'database', 'intake_rpc'];
  const status = checks.some((c) => !c.ok && critical.includes(c.name))
    ? 'down'
    : checks.some((c) => !c.ok)
      ? 'degraded'
      : 'ok';

  const report = {
    surface: 'kiosk',
    status,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    checks,
    provesWhenOk: [
      '키오스크가 배포되어 요청을 받는다',
      '이 태블릿이 담당 의사와 연결되어 있고 그 의사가 실제로 존재한다',
      'service_role 로 Supabase 에 닿는다',
      '방문 코드 판정 함수가 실제로 실행되며, 그 실행이 아무것도 소모하지 않는다'
    ],
    doesNotProve: [
      '유효한 방문 코드가 실제로 진료를 열어 주는지 (확인하려면 진료 행을 만들어야 한다)',
      'GEMINI_API_KEY 가 유효한지 -- 만료·한도초과 키도 통과한다 (확인하려면 유료 호출이 필요하다)',
      'CLOVA 음성 입력이 동작하는지 (선택 기능이며 provider 호출이 필요하다)',
      '문진 대화 품질이나 결과 해석의 정확성'
    ],
    extra
  };

  return new Response(JSON.stringify(report, null, 2), {
    status: status === 'down' ? 503 : 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}
