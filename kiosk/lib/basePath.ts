/**
 * 배포 하위 경로(base path).
 *
 * 키오스크는 도메인 루트가 아니라 `entanglecare.com/righthand/patient` 처럼
 * **하위 경로**에서 서비스된다(배포구조 문서 1장). 지금까지 이 앱은 루트 배포
 * 전제로 짜여 있었다.
 *
 * [HARD] 도메인은 아직 구매 전이다. 그래서 이 값은 경로 조각 하나(`/righthand/patient`)
 * 일 뿐이고 호스트명은 어디에도 들어가지 않는다. 도메인이 정해져도 이 파일은
 * 바뀌지 않는다.
 *
 * 빈 값(기본)이면 루트 배포로 동작한다 — 로컬 개발과 기존 프로브가 그대로
 * 돌아가야 하기 때문이다.
 *
 * `next.config.mjs` 의 `basePath` 가 링크·정적자원·헤더 규칙을 알아서 접두하지만
 * **`fetch()` 는 접두하지 않는다.** 그래서 클라이언트가 API 를 부를 때는 반드시
 * `apiPath()` 를 거친다. 이걸 빠뜨리면 로컬(루트 배포)에서는 멀쩡하고 실제
 * 배포에서만 문진 시작이 404 가 되는데, 그건 우리가 가장 늦게 발견할 종류의
 * 고장이다.
 */

/**
 * `NEXT_PUBLIC_` 접두사가 필요한 이유: 이 값은 브라우저 번들 안에서 읽힌다.
 * Next 는 `process.env.NEXT_PUBLIC_X` 형태의 **정적 참조만** 인라인하므로
 * 동적 인덱싱(`process.env[name]`)으로는 읽을 수 없다.
 *
 * 이 앱에서 클라이언트로 나가는 환경변수는 이것 하나뿐이고, 담고 있는 것은
 * 공개 URL 의 경로 조각이다. 비밀이 아니다.
 */
const RAW = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** 정규화: 앞에 `/` 를 붙이고 뒤 `/` 는 뗀다. 빈 값은 빈 값 그대로. */
function normalize(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '/') return '';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '');
}

export const BASE_PATH = normalize(RAW);

/** 앱 내부 절대경로에 base path 를 붙인다. 인자는 항상 `/` 로 시작한다. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** `fetch()` 용. `withBasePath` 와 같지만 호출부에서 의도가 드러난다. */
export const apiPath = withBasePath;
