/**
 * 환자 정보 단계의 생년월일 입력 헬퍼.
 *
 * 고령 환자는 휴대폰 키패드에서 하이픈을 치는 걸 어려워한다. 그래서 입력은
 * 숫자 8자리("19540309")로 받는다. 그 아래(API, DB, Electron)는 전부 ISO
 * `yyyy-mm-dd` 를 계속 쓰므로, 변환은 제출 시점에 `toIsoBirthDate` 에서
 * 딱 한 번 일어난다.
 */

const BIRTH_DATE_DIGITS = 8;

/**
 * 숫자만 남기고 8자로 자른다.
 *
 * 키 입력과 붙여넣기 양쪽에서 돌아가므로, 붙여넣은 "1954-03-09" 는 거절되지
 * 않고 "19540309" 가 된다.
 */
export function normalizeBirthDateInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, BIRTH_DATE_DIGITS);
}

/** 8자리를 내부 ISO 표현으로 변환. 입력이 유효하다고 가정한다. */
export function toIsoBirthDate(digits: string): string {
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** 8자리가 실제 달력 날짜일 때만 true (20240231 등을 거른다). */
function isRealDate(digits: string): boolean {
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * 숫자만 있는 생년월일을 검증한다.
 *
 * @param digits `normalizeBirthDateInput` 를 이미 통과한 값
 * @param today  ISO `yyyy-mm-dd`. 사전순으로 비교한다.
 * @returns 한국어 에러 메시지, 또는 문제가 없으면 null
 */
export function validateBirthDate(digits: string, today: string): string | null {
  if (digits === '') {
    return '생년월일을 입력해 주세요.';
  }
  if (digits.length !== BIRTH_DATE_DIGITS || !isRealDate(digits)) {
    return '생년월일을 숫자 8자리로 입력해 주세요. (예: 19540309)';
  }
  if (toIsoBirthDate(digits) > today) {
    return '생년월일이 오늘 이후일 수 없습니다. 날짜를 다시 확인해 주세요.';
  }
  return null;
}
