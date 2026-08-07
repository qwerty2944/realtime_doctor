/**
 * 헬스체크 응답의 공통 모양.
 *
 * ── 왜 kiosk/ 와 supabase/functions/_shared/ 에 같은 모양이 또 있는가
 *
 * 세 앱은 서로 다른 배포물이다. doctor-web 과 kiosk 는 독립 npm 프로젝트이고
 * (각자 lockfile 을 갖는다), Edge Function 은 Deno 다. 공유 패키지를 만들려면
 * 워크스페이스나 퍼블리시가 필요한데, 그건 헬스체크 하나를 위해 빌드 파이프라인
 * 을 바꾸는 일이다. 그래서 **타입과 30줄짜리 롤업만** 복제하고, 판정 로직은
 * 복제하지 않는다 -- 실제 검사 내용은 각 앱이 자기 의존성에 맞춰 따로 쓴다.
 *
 * 복제된 것이 갈라지면 무엇이 깨지는가: 프로버가 `status` 필드를 읽으므로,
 * 세 값('ok'|'degraded'|'down')만 유지되면 갈라져도 감시는 계속 동작한다.
 * 그게 이 파일이 얇은 이유다.
 */

export interface HealthCheck {
  /** 기계가 읽는 이름. 프로버와 사람이 이걸로 어느 검사가 깨졌는지 구분한다. */
  name: string;
  ok: boolean;
  /** 사람이 읽는 한 줄. [HARD] 절대 비밀값·환자 식별정보를 담지 않는다. */
  detail: string;
}

export interface HealthReport {
  surface: string;
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  latencyMs: number;
  checks: HealthCheck[];
  /** status 가 ok 일 때 이 응답이 증명하는 것. 실패한 응답에는 해당하지 않는다. */
  provesWhenOk: string[];
  /** [HARD] 이 응답이 증명하지 **못하는** 것. 이게 없는 헬스체크는 잘못된 확신을 판다. */
  doesNotProve: string[];
  /** 표면별 추가 정보(프로버 상태, 알림 대상 등). */
  extra?: Record<string, unknown>;
}

/** 필수 항목이 하나라도 깨지면 down. 그 외 실패는 degraded. */
export function rollUp(
  checks: HealthCheck[],
  critical: string[],
): 'ok' | 'degraded' | 'down' {
  if (checks.some((c) => !c.ok && critical.includes(c.name))) return 'down';
  if (checks.some((c) => !c.ok)) return 'degraded';
  return 'ok';
}

/**
 * 상태 코드 규칙:
 *   200 -- ok / degraded. 표면은 응답하고 있다.
 *   503 -- down. 이 표면이 실제로 실패할 의존성 중 하나가 깨져 있다.
 *
 * degraded 에 503 을 주지 않는 이유: 상태 코드만 보는 감시자에게 "완전히 죽음"
 * 과 "일부 이상"은 대응이 다르고, 둘을 같은 코드로 만들면 구별할 수 없다.
 * 프로버는 본문의 `status` 를 읽어 셋을 전부 구별한다.
 */
export function healthResponse(report: HealthReport): Response {
  return new Response(JSON.stringify(report, null, 2), {
    status: report.status === 'down' ? 503 : 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 캐시된 "정상"을 계속 보는 것은 감시의 최악 실패 모드다.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

/**
 * PostgREST 오류를 사람이 읽을 문장으로.
 *
 * head 요청이 401 로 끊기면 `message` 가 빈 문자열로 온다. 그대로 쓰면
 * "조회 실패: " 로 끝나는, 원인이 안 적힌 실패 보고가 된다 -- 그러면 읽는
 * 사람이 다음에 무엇을 봐야 할지 알 수 없다.
 */
export function describe(error: {
  message?: string;
  code?: string;
  hint?: string | null;
}): string {
  const parts = [error.message?.trim(), error.code, error.hint ?? undefined].filter(
    (v) => v && v !== '',
  );
  return parts.length > 0 ? parts.join(' / ') : '원인 미상 (PostgREST 가 빈 오류를 반환)';
}
