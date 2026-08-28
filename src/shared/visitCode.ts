/**
 * 방문 코드 표기 — main 과 renderer 가 같이 쓰는 **한 벌**.
 *
 * 정본은 DB 다: `supabase/migrations/0009_visit_access_codes.sql` 의
 * `visit_code_alphabet()` / `visit_code_length()` / `normalize_visit_code()`.
 * 키오스크 쪽에도 같은 규칙의 사본이 있다(`kiosk/lib/intake/visitCode.ts`) —
 * 두 앱은 npm 프로젝트가 갈라져 있어 모듈을 공유할 수 없기 때문이고, 그래서
 * 이 파일도 저 파일도 **판정하지 않는다**. 둘 다 표기만 한다.
 *
 * E1 이 정한 규칙을 그대로 따른다: 같은 개념의 함수가 두 벌이 되면 한쪽만
 * 고쳐지는 날이 온다. 여기서는 main(발급 후 URL 조립)과 renderer(화면 표기)가
 * 이 파일 하나를 쓴다.
 */

export const VISIT_CODE_ALPHABET = '23456789ACDEFGHJKMNPRTVWXY';
export const VISIT_CODE_LENGTH = 7;

/** 표시는 4-3 으로 끊는다. 읽어주기도, 받아적기도 이 쪽이 쉽다. */
const VISIT_CODE_GROUP = 4;

const NON_ALPHABET = new RegExp(`[^${VISIT_CODE_ALPHABET}]`, 'g');

export function normalizeVisitCode(raw: string): string {
  return raw.toUpperCase().replace(NON_ALPHABET, '');
}

/** `A2CD-4EF`. 화면과 QR 이 서로 다른 모양을 보여주지 않도록 한 곳에서 만든다. */
export function formatVisitCode(raw: string): string {
  const normalized = normalizeVisitCode(raw).slice(0, VISIT_CODE_LENGTH);
  if (normalized.length <= VISIT_CODE_GROUP) return normalized;
  return `${normalized.slice(0, VISIT_CODE_GROUP)}-${normalized.slice(VISIT_CODE_GROUP)}`;
}

/**
 * 태블릿이 열 URL 을 만든다: `<키오스크 주소>/intake?k=<슬러그>&c=<코드>`.
 *
 * [HARD] 도메인은 **설정에서 온다.** `entanglecare.com` 을 포함해 어떤
 * 호스트명도 코드에 넣지 않는다 — 도메인은 아직 구매 전이고, 배포 주소가
 * 바뀔 때 릴리스를 다시 내야 하는 구조를 만들지 않는다.
 *
 * 설정이 비어 있으면 null 을 돌려준다. 그러면 화면은 QR 대신 "키오스크 주소를
 * 먼저 설정하세요" 를 말한다. 틀린 QR 을 그리는 것보다 안 그리는 편이 낫다 —
 * 안 되는 QR 은 환자 앞에서 실패하고, 그 실패의 원인은 접수처가 알 수 없다.
 */
export function buildKioskIntakeUrl(
  kioskBaseUrl: string,
  code: string,
  kioskSlug: string | null
): string | null {
  const trimmed = kioskBaseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;

  let url: URL;
  try {
    url = new URL(`${trimmed}/intake`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const slug = kioskSlug?.trim();
  if (slug) url.searchParams.set('k', slug);
  url.searchParams.set('c', normalizeVisitCode(code));
  return url.toString();
}
