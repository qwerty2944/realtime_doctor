import 'server-only';
import { BASE_PATH } from './base-path';

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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 크론 시크릿의 이름은 `CRON_SECRET` 이어야 한다 -- 취향이 아니라 계약이다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Vercel Cron 은 프로젝트 환경변수에 **정확히 `CRON_SECRET` 이라는 이름**이
 * 있을 때만 스케줄 호출에 `Authorization: Bearer <값>` 을 붙인다. 다른 이름을
 * 쓰면 헤더가 아예 오지 않고, 크론은 매 실행 401 을 받는다.
 *
 * 그게 왜 특별히 나쁜가: `/api/billing/watchdog` 은 실행 기록
 * (`subscription_watchdog_runs`)을 **인증 이후에** 쓴다. 그래서 401 이 나면
 * 행이 한 줄도 안 남고, DB 상의 모습이 "오늘 이상 없음"도 아니고 그냥
 * **아무 흔적 없음**이 된다 -- 이 잡이 탐지하려고 만들어진 조용한 과금 중단과
 * 구분이 불가능한 증상이다. 감시자가 같은 침묵으로 죽는 셈이다.
 *
 * 이 이름이 되돌려지는 것을 막는 장치는 셋이다:
 *
 *   1) 이 상수. 라우트는 문자열 리터럴이 아니라 `CRON_SECRET_ENV` 를 읽는다.
 *   2) `scripts/assert-cron-secret-name.mjs` (npm `prebuild` 로 자동 실행).
 *      옛 이름(아래 LEGACY_CRON_SECRET_ENV 가 조립하는 문자열)이 소스에 다시
 *      나타나면 **빌드가 실패**한다. 가드 자신과 이 파일이 그 문자열을 리터럴로
 *      담지 않는 이유가 그것이다 -- 담으면 자기 자신을 잡는다.
 *      Vercel 도 `npm run build` 를 부르므로 배포 경로에서 반드시 걸린다.
 *   3) `/api/health` 의 `watchdog` 검사. 인증이 어떤 이유로든 다시 깨지면
 *      "마지막 실행이 없다/오래됐다"로 드러나고, doctor-web 의 ops 프로버가
 *      그 헬스체크를 매일 읽는다. 침묵이 더는 침묵으로 남지 않는다.
 *
 * doctor-web 의 `/api/ops/probe` 도 같은 이름을 쓴다. 두 크론이 같은 규칙을
 * 따르는 것이 옳고, 그쪽 주석에 이 함정이 먼저 기록돼 있었다.
 */
export const CRON_SECRET_ENV = 'CRON_SECRET';

/**
 * 쓰면 안 되는 옛 이름. 상수로 남겨 두는 이유는 부팅 검사가 "이 이름이 설정돼
 * 있다"를 발견했을 때 사람이 읽을 수 있는 오류를 낼 수 있어야 하기 때문이다.
 * (문자열이 이 파일에만 존재하도록 prebuild 가드가 이 파일을 예외 처리한다.)
 */
export const LEGACY_CRON_SECRET_ENV = ['BILLING', 'CRON', 'SECRET'].join('_');

/**
 * 이게 없으면 앱이 뜰 이유가 없는 변수들. 부팅 시 죽는다.
 *
 * 포트원 자격은 여기 없다 -- 아래 REQUIRED_PORTONE_ENV_VARS 주석 참조.
 */
export const REQUIRED_CORE_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  // 구독 테이블은 0002 설계상 service_role 만 쓸 수 있다.
  'SUPABASE_SERVICE_ROLE_KEY',
  // 없으면 Electron 자동 로그인 링크의 서명을 만들 수 없다.
  'BILLING_HANDOFF_SECRET',
  // 없으면 "누구나 부를 수 있는 크론"이 된다.
  CRON_SECRET_ENV
] as const;

/**
 * 결제를 **실제로 받으려면** 필요한 변수들. 없어도 서버는 뜬다.
 *
 * ── 왜 부팅 실패에서 내렸는가
 *
 * 이 앱은 결제 페이지만 들고 있는 것이 아니다. 운영자의 사용량·비용·사용자 관리
 * 화면과 의사 본인의 진료 기록 화면이 같은 배포물 안에 있고, 그 화면들은 포트원
 * 자격과 아무 상관이 없다. 자격이 도착할 때까지 앱 전체를 못 뜨게 하면 "결제만
 * 아직"이 "아무것도 없음"이 된다.
 *
 * [HARD] 대신 없는 상태를 **숨기지 않는다.** 없으면:
 *   * 부팅 로그가 어떤 이름이 비었는지 크게 남긴다
 *   * `/billing` 이 "결제 준비 중"을 명시하고 카드 등록 버튼을 렌더링하지 않는다
 *   * 결제 관련 API 라우트는 전부 503 + 이유를 돌려준다 (200 을 흉내내지 않는다)
 *   * `/api/health` 가 `degraded` 로 떨어져 프로버에 잡힌다
 *
 * 자리표시자 값을 넣는 선택지는 없다. 넣는 순간 결제창이 열리고 PG 가 거절하며,
 * 그건 "설정이 안 됐다"가 아니라 "결제가 고장났다"로 보인다.
 */
export const REQUIRED_PORTONE_ENV_VARS = [
  // 브라우저 SDK 에 그대로 넘어가는 공개 값 (포트원 콘솔 > 상점 정보 / 연동 정보).
  'NEXT_PUBLIC_PORTONE_STORE_ID',
  'NEXT_PUBLIC_PORTONE_CHANNEL_KEY',
  // 서버 전용.
  'PORTONE_API_SECRET',
  // 없으면 "누구나 POST 해서 남의 구독을 켤 수 있는 웹훅"이 된다.
  'PORTONE_WEBHOOK_SECRET'
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

function missingOf(names: readonly string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === '';
  });
}

/** 포트원 자격 중 비어 있는 것들. 비어 있지 않으면 빈 배열. */
export function missingPortOneEnv(): string[] {
  return missingOf(REQUIRED_PORTONE_ENV_VARS);
}

/**
 * 결제를 실제로 받을 수 있는 상태인가.
 *
 * 화면·API·헬스체크가 전부 이 한 함수를 본다. 판정이 여러 곳에 흩어지면
 * "버튼은 보이는데 API 는 503" 같은 반쪽 상태가 생긴다.
 */
export function billingConfigured(): boolean {
  return missingPortOneEnv().length === 0;
}

/**
 * 서버 부팅 시 한 번 실행되는 검사.
 *
 * 빌드 단계에서는 건너뛴다. Vercel 빌드 컨테이너에 런타임 시크릿이 없을 수 있고,
 * 빌드 실패와 설정 누락은 구분돼야 한다.
 *
 * 세 가지를 한다:
 *   1) 코어 변수가 없으면 **던진다**. 이건 앱이 뜰 이유가 없는 상태다.
 *   2) 옛 크론 시크릿 이름만 설정돼 있고 `CRON_SECRET` 이 없으면 **던진다.**
 *      이 조합이 정확히 "크론이 매 실행 401 을 받고 아무 흔적도 안 남기는"
 *      배포다. 뜬 채로 조용히 틀린 것보다 안 뜨는 편이 낫다.
 *   3) 포트원 자격이 없으면 죽지 않고 **크게 로그를 남긴다.**
 */
export function assertBootEnv(): void {
  const missingCore = missingOf(REQUIRED_CORE_ENV_VARS);
  if (missingCore.length > 0) {
    throw new Error(
      `[admin-web] 필수 환경변수가 없어 서버를 시작할 수 없습니다: ${missingCore.join(', ')}\n` +
        'admin-web/.env.example 을 참고해서 .env.local (또는 배포 플랫폼의 환경변수)에 설정하세요.'
    );
  }

  const legacy = process.env[LEGACY_CRON_SECRET_ENV];
  if (legacy && legacy.trim() !== '') {
    throw new Error(
      `[admin-web] 더 이상 쓰지 않는 환경변수 ${LEGACY_CRON_SECRET_ENV} 가 설정돼 있습니다.\n` +
        `Vercel Cron 은 ${CRON_SECRET_ENV} 라는 이름에만 Bearer 토큰을 붙입니다. ` +
        `${LEGACY_CRON_SECRET_ENV} 를 삭제하고 ${CRON_SECRET_ENV} 하나만 남기세요. ` +
        '둘이 공존하면 어느 쪽이 실제로 쓰이는지 사람이 오해하고, 그 오해의 증상은 ' +
        '"감시 크론이 조용히 한 번도 안 돎"입니다.'
    );
  }

  const missingPortOne = missingPortOneEnv();
  if (missingPortOne.length > 0) {
    // [HARD] 조용히 넘기지 않는다. 이 줄이 없으면 "결제가 꺼져 있다"는 사실이
    // 의사가 카드 등록 버튼을 찾다가 발견하는 것이 된다.
    console.error(
      `[admin-web] 포트원 자격이 없어 **결제 기능이 꺼진 상태로** 기동합니다: ${missingPortOne.join(', ')}\n` +
        '  · /billing 은 "결제 준비 중"을 표시하고 카드 등록을 시작하지 않습니다.\n' +
        '  · /api/billing/* 는 503 을 돌려줍니다 (성공을 흉내내지 않습니다).\n' +
        '  · /api/health 는 degraded 로 보고되어 ops 프로버에 잡힙니다.'
    );
  } else {
    console.info('[admin-web] 결제 환경변수 확인 완료.');
  }
}

/** 포트원 REST 기본 주소. 테스트에서 목 서버로 갈아끼우기 위해 설정으로 뺀다. */
export function portoneApiBase(): string {
  return (optionalEnv('PORTONE_API_BASE') ?? 'https://api.portone.io').replace(/\/+$/, '');
}

/**
 * 사용자가 실제로 여는 주소의 접두사 (오리진 + basePath).
 *
 * Electron 자동 로그인 핸드오프 링크를 만들 때 쓴다. **basePath 를 포함해야
 * 한다** -- 이 앱은 `entanglecare.com/righthand` 아래에 얹혀 있고, 링크에서
 * 접두사가 빠지면 앱이 여는 브라우저 창이 doctor-web 의 404 로 간다.
 *
 * NEXT_PUBLIC_APP_ORIGIN 이 우선이고, 없으면 Vercel 의 배포별 주소로 떨어진다.
 * 배포별 주소는 재작성을 지나지 않으므로 그 자체로 동작하지만 브랜드 도메인이
 * 아니다 -- 운영에서는 반드시 명시적으로 설정한다.
 */
export function publicBaseUrl(): string {
  const explicit = optionalEnv('NEXT_PUBLIC_APP_ORIGIN');
  const origin = explicit
    ? explicit.replace(/\/+$/, '')
    : optionalEnv('VERCEL_URL')
      ? `https://${optionalEnv('VERCEL_URL')}`
      : 'http://localhost:3000';
  return `${origin}${BASE_PATH}`;
}
