import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * 결제 식별자 생성 (서버 전용).
 *
 * plan.ts 에서 분리한 이유는 단순하다: plan.ts 는 결제 화면(클라이언트
 * 컴포넌트)에서도 import 하는데, node:crypto 가 거기 딸려 들어가면 브라우저
 * 번들이 깨진다.
 */

/**
 * 포트원 customer.id.
 *
 * 포트원은 20자 제한을 두는데 uuid 는 하이픈을 빼도 32자다. 그래서 user_id 를
 * SHA-256 으로 접어 앞 18자만 쓴다 (72비트, 충돌은 실질적으로 없다).
 * 결정적(deterministic)이어야 한다 -- 서버가 빌링키를 검증할 때 "이 키가 이
 * 사용자의 것인가"를 이 값으로 판정하기 때문이다.
 */
export function portoneCustomerId(userId: string): string {
  return `rd${createHash('sha256').update(userId).digest('hex').slice(0, 18)}`;
}

/** 1회용 issueId. 포트원 규칙상 특수문자 없이. */
export function newIssueId(): string {
  return `ri${randomBytes(11).toString('hex')}`;
}

/**
 * 첫 결제의 paymentId. issueId 로부터 결정된다.
 *
 * 이게 멱등성의 핵심이다. 같은 카드 등록 요청은 몇 번을 다시 보내도 같은
 * paymentId 를 만들고, payment_attempts.payment_id 의 UNIQUE 제약과 포트원 쪽
 * paymentId 중복 거부가 각각 한 번씩 더 막는다.
 */
export function firstPaymentId(issueId: string): string {
  return `rdf_${issueId}`;
}

/** 다음 주기 예약의 paymentId. (사용자, 결제일) 조합으로 결정된다. */
export function cyclePaymentId(userId: string, timeToPay: Date): string {
  const day = timeToPay.toISOString().slice(0, 10).replace(/-/g, '');
  return `rdc_${portoneCustomerId(userId)}_${day}`;
}

/**
 * 재시도 사다리 한 단의 paymentId (S5). (사용자, **청구 대상 주기**, 단) 로
 * 결정된다 -- 재시도가 실행되는 날짜가 아니다.
 *
 * 이 선택이 이중청구 방지의 핵심이다. 실행 날짜를 넣으면 크론이 하루에 두 번
 * 돌거나 서버 시각이 자정을 걸칠 때 같은 단이 서로 다른 paymentId 로 두 번
 * 만들어질 수 있다. 주기 끝을 넣으면 **한 주기에 대해 각 단은 영원히 하나뿐**
 * 이고, payment_attempts.payment_id 의 UNIQUE 가 그걸 강제한다.
 *
 * 접두사도 다르다(rdr_ vs rdc_). 정기 예약과 재시도 예약은 절대 같은 id 공간을
 * 쓰지 않으므로, 한쪽이 다른 쪽을 "이미 있다"로 오인해 건너뛰는 일이 없다.
 */
export function dunningPaymentId(userId: string, cycleEnd: Date, rung: number): string {
  const day = cycleEnd.toISOString().slice(0, 10).replace(/-/g, '');
  return `rdr_${portoneCustomerId(userId)}_${day}_r${rung}`;
}

// 한 달 뒤 계산(구 addOneMonth)은 S4 에서 `lib/billing/period.ts` 로 옮겼다.
// 여기 남겨두면 "직전 날짜 기준 한 달"과 "앵커일 기준 한 달"이라는 서로 다른 두
// 규칙이 공존하게 되고, 말일 가입자의 결제일이 어느 쪽을 탔는지에 따라 조용히
// 달라진다. 주기 산술의 규칙은 period.ts 하나뿐이다.
