import 'server-only';

/**
 * 서버 전용 환경변수 접근 (S3).
 *
 * kiosk/lib/env.ts 와 같은 방식이다. 값은 모듈 최상위가 아니라 함수 안에서
 * 늦게 읽어 `next build` 가 .env 없이도 통과하게 하고, 대신 서버가 실제로 뜰 때
 * instrumentation.ts 가 `assertBillingEnv()` 로 한 번에 검사해서 **배포 직후에
 * 크게** 실패하게 한다. 이게 없으면 의사가 카드 등록 버튼을 누르는 순간에야
 * 500 이 뜬다 -- 결제 흐름에서 가장 나쁜 타이밍이다.
 *
 * [HARD] PORTONE_API_SECRET 과 SUPABASE_SERVICE_ROLE_KEY 는 NEXT_PUBLIC_ 접두사가
 * 붙지 않는다. 붙이는 순간 브라우저 번들에 인라인된다.
 */

/** 결제 기능이 동작하려면 반드시 있어야 하는 변수들. */
export const REQUIRED_BILLING_ENV_VARS = [
  // 브라우저 SDK 에 그대로 넘어가는 공개 값 (포트원 콘솔 > 상점 정보 / 연동 정보).
  'NEXT_PUBLIC_PORTONE_STORE_ID',
  'NEXT_PUBLIC_PORTONE_CHANNEL_KEY',
  // 서버 전용.
  'PORTONE_API_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BILLING_HANDOFF_SECRET',
  // S4. 이 둘이 없으면 각각 "누구나 POST 해서 남의 구독을 켤 수 있는 웹훅"과
  // "누구나 부를 수 있는 크론"이 된다. 부팅 시 죽는 쪽이 옳다.
  'PORTONE_WEBHOOK_SECRET',
  'BILLING_CRON_SECRET'
] as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. See admin-web/.env.example.`
    );
  }
  return value.trim();
}

export function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * 서버 부팅 시 한 번 실행되는 검사.
 *
 * 빌드 단계에서는 건너뛴다. Vercel 빌드 컨테이너에 런타임 시크릿이 없을 수 있고,
 * 빌드 실패와 설정 누락은 구분돼야 한다.
 */
export function assertBillingEnv(): void {
  const missing = REQUIRED_BILLING_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `[admin-web] 결제 관련 필수 환경변수가 없어 서버를 시작할 수 없습니다: ${missing.join(', ')}\n` +
        'admin-web/.env.example 을 참고해서 .env.local (또는 배포 플랫폼의 환경변수)에 설정하세요.'
    );
  }
}

/** 포트원 REST 기본 주소. 테스트에서 목 서버로 갈아끼우기 위해 설정으로 뺀다. */
export function portoneApiBase(): string {
  return (optionalEnv('PORTONE_API_BASE') ?? 'https://api.portone.io').replace(/\/+$/, '');
}

/**
 * 자기 자신의 공개 주소. Electron 자동 로그인 핸드오프 URL 을 만들 때 쓴다.
 * Vercel 에서는 VERCEL_URL 로 대체 가능.
 */
export function appOrigin(): string {
  const explicit = optionalEnv('NEXT_PUBLIC_APP_ORIGIN');
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = optionalEnv('VERCEL_URL');
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}
