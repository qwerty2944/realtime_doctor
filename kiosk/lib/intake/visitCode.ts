/**
 * 방문 코드(visit access code) 표기 규칙. 서버·클라이언트 공용.
 *
 * 정본은 DB 다 — `supabase/migrations/0009_visit_access_codes.sql` 의
 * `visit_code_alphabet()` / `visit_code_length()` / `normalize_visit_code()`.
 * 여기 있는 것은 **같은 규칙의 화면쪽 사본**이고, 하는 일은 두 가지뿐이다:
 * 입력칸을 보기 좋게 다듬는 것과, 길이가 안 맞는 입력을 서버까지 보내지 않는 것.
 *
 * [HARD] 이 파일은 **판정하지 않는다.** 코드가 유효한지는 오직 DB 의
 * `redeem_visit_access_code()` 만 안다. 여기서 하는 검사는 편의이고, 이걸
 * 통과했다고 해서 아무 권한도 생기지 않는다 — 권한 판정을 클라이언트가 볼 수
 * 있는 코드에 나눠 담기 시작하면 두 판정이 갈라지는 날이 온다.
 */

/**
 * 26자. 소리내 읽거나 받아 적을 때 헷갈리는 짝을 양쪽 다 뺐다:
 * 0/O, 1/I/L, 2/Z, 5/S, 8/B, U/V, O/Q.
 *
 * 양쪽을 다 뺐기 때문에 잘못 읽은 글자는 **다른 유효한 코드가 되지 않고
 * 그냥 거부된다.** 한쪽만 남겼다면 'O' 를 '0' 으로 고쳐 읽는 보정이 필요했을
 * 것이고, 그 보정은 오타를 조용히 남의 코드로 바꿔놓을 수 있다.
 */
export const VISIT_CODE_ALPHABET = '23456789ACDEFGHJKMNPRTVWXY';

export const VISIT_CODE_LENGTH = 7;

/** 화면 표기는 4-3 으로 끊는다: `A2CD-4EF`. 읽어주기도 받아적기도 이 쪽이 쉽다. */
const VISIT_CODE_GROUP = 4;

const NON_ALPHABET = new RegExp(`[^${VISIT_CODE_ALPHABET}]`, 'g');

/**
 * 입력값을 표준형으로. 대문자로 올리고 알파벳 밖 글자(공백, 하이픈, 오타)를
 * 버린다. DB 의 `normalize_visit_code()` 와 같은 규칙이다.
 */
export function normalizeVisitCode(raw: string): string {
  return raw.toUpperCase().replace(NON_ALPHABET, '');
}

/** 길이만 본다. 유효성은 서버가 판정한다. */
export function isVisitCodeShaped(raw: string): boolean {
  return normalizeVisitCode(raw).length === VISIT_CODE_LENGTH;
}

/** 표시용: `A2CD-4EF`. 입력 중인 부분 문자열에도 안전하게 동작한다. */
export function formatVisitCode(raw: string): string {
  const normalized = normalizeVisitCode(raw).slice(0, VISIT_CODE_LENGTH);
  if (normalized.length <= VISIT_CODE_GROUP) return normalized;
  return `${normalized.slice(0, VISIT_CODE_GROUP)}-${normalized.slice(VISIT_CODE_GROUP)}`;
}
