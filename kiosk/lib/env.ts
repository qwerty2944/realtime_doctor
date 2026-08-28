/**
 * 환경변수 접근.
 *
 * 값은 모듈 최상위가 아니라 함수 안에서 늦게 읽는다. 그래야 .env 없이도
 * `next build` 가 통과한다. 대신 서버가 실제로 뜰 때 `assertRequiredEnv()`(
 * instrumentation.ts 에서 호출)가 한 번에 전부 검사해서, 첫 환자가 문진을
 * 누르는 순간이 아니라 배포 직후에 크게 실패한다.
 *
 * 서버 전용이다. `process.env[name]` 동적 인덱싱은 브라우저에서 동작하지
 * 않는다(Next 는 `process.env.NEXT_PUBLIC_X` 정적 참조만 인라인한다).
 * 이 앱은 클라이언트에서 환경변수를 읽을 일이 없으므로 그 경로는 아예 두지 않는다.
 */

/** 서버가 뜨려면 반드시 있어야 하는 변수들. */
export const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'KIOSK_TOKEN_SECRET',
  'KIOSK_CLINICIANS',
  'GEMINI_API_KEY'
] as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. See kiosk/.env.example.`
    );
  }
  return value;
}

/** 있으면 트림해서 돌려주고, 없으면 null. 선택 변수용. */
export function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * 서버 부팅 시 한 번 실행되는 검사.
 *
 * 개별 변수를 요구 시점에 던지게만 두면, 키가 하나 빠졌을 때 환자가 문진
 * 마지막 턴에서 500 을 보는 식으로 늦게·엉뚱하게 터진다. 여기서 전부 모아
 * 한 번에 이름을 대며 죽는다.
 */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `[kiosk] 필수 환경변수가 없어 서버를 시작할 수 없습니다: ${missing.join(', ')}\n` +
        'kiosk/.env.example 을 참고해서 .env.local (또는 배포 플랫폼의 환경변수)에 설정하세요.'
    );
  }
}
