/**
 * 헬스체크 응답의 공통 모양.
 *
 * doctor-web/src/lib/ops/report.ts, kiosk/lib/ops/report.ts 와 같은 파일이다.
 * 세 앱은 서로 다른 배포물(각자 lockfile 을 갖는 독립 npm 프로젝트)이라, 공유
 * 패키지를 만들려면 워크스페이스나 퍼블리시가 필요하다. 헬스체크 하나 때문에
 * 빌드 파이프라인을 바꾸지 않는다. 그래서 **타입과 롤업만** 복제하고 판정
 * 로직은 복제하지 않는다 -- 실제 검사 내용은 각 앱이 자기 의존성에 맞춰 쓴다.
 *
 * 복제가 갈라져도 감시는 계속 동작한다: 프로버가 읽는 것은 `status` 필드
 * 하나이고, 세 값('ok'|'degraded'|'down')만 유지되면 된다. 그게 이 파일이
 * 얇은 이유다.
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
  /** status 가 ok 일 때 이 응답이 증명하는 것. */
  provesWhenOk: string[];
  /** [HARD] 이 응답이 증명하지 **못하는** 것. 이게 없는 헬스체크는 잘못된 확신을 판다. */
  doesNotProve: string[];
  extra?: Record<string, unknown>;
}

/** 필수 항목이 하나라도 깨지면 down. 그 외 실패는 degraded. */
export function rollUp(checks: HealthCheck[], critical: string[]): 'ok' | 'degraded' | 'down' {
  if (checks.some((c) => !c.ok && critical.includes(c.name))) return 'down';
  if (checks.some((c) => !c.ok)) return 'degraded';
  return 'ok';
}

/**
 * 상태 코드 규칙:
 *   200 -- ok / degraded. 표면은 응답하고 있다.
 *   503 -- down. 이 표면이 실제로 실패할 의존성 중 하나가 깨져 있다.
 */
export function healthResponse(report: HealthReport): Response {
  return new Response(JSON.stringify(report, null, 2), {
    status: report.status === 'down' ? 503 : 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 캐시된 "정상"을 계속 보는 것은 감시의 최악 실패 모드다.
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}

/** PostgREST 오류를 사람이 읽을 문장으로. 401 로 끊기면 message 가 비어 온다. */
export function describe(error: {
  message?: string;
  code?: string;
  hint?: string | null;
}): string {
  const parts = [error.message?.trim(), error.code, error.hint ?? undefined].filter(
    (v) => v && v !== ''
  );
  return parts.length > 0 ? parts.join(' / ') : '원인 미상 (PostgREST 가 빈 오류를 반환)';
}
