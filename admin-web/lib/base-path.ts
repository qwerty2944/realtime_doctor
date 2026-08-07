/**
 * basePath 인식 경로 만들기. **서버·클라이언트 양쪽에서 쓴다** (server-only 아님).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] Next 가 자동으로 붙여 주지 않는 세 곳이 있다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `basePath` 를 켜면 `<Link>`, `useRouter().push/replace`, 그리고 정적 자산
 * (`/_next/*`) 은 Next 가 알아서 접두사를 붙인다. 하지만 아래 셋은 붙지 않는다:
 *
 *   1) `fetch('/api/...')`      -- 브라우저 fetch 는 Next 를 지나지 않는다.
 *   2) `<form action="/...">`   -- 브라우저가 그대로 제출한다.
 *   3) 우리가 문자열로 만드는 절대 URL (핸드오프 링크 등).
 *
 * 셋 다 붙이는 것을 잊으면 **도메인 루트로 요청이 나간다.** 이 앱이
 * `entanglecare.com/righthand` 아래에 재작성으로 얹혀 있으므로, 그 요청은
 * doctor-web 에 도착해 404 가 된다 -- "결제 준비에 실패했습니다"만 보이고 원인은
 * 어디에도 안 남는 종류의 실패다. 그래서 리터럴 대신 이 헬퍼를 쓴다.
 *
 * 값은 빌드타임에 인라인돼야 하므로 `NEXT_PUBLIC_` 접두사가 필수이고,
 * `process.env.NEXT_PUBLIC_BASE_PATH` 를 **리터럴 그대로** 읽어야 한다
 * (Next 의 치환은 문자열 대체이므로 동적 인덱싱은 치환되지 않는다).
 */

function normalize(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return '';
  return value.startsWith('/') ? value : `/${value}`;
}

/** 예: '/righthand'. 미설정이면 ''. */
export const BASE_PATH = normalize(process.env.NEXT_PUBLIC_BASE_PATH);

/** '/api/billing/complete' -> '/righthand/api/billing/complete' */
export function withBasePath(path: string): string {
  if (!path.startsWith('/')) throw new Error(`withBasePath: 절대 경로여야 합니다: ${path}`);
  return `${BASE_PATH}${path}`;
}
