/**
 * 상품 조건 (tasks/subscription-plan.md 에서 확정).
 *
 * 표기와 청구가 다르다는 점이 중요하다. 국내 B2B 관행에 따라 "월 70,000원
 * (VAT 별도)" 로 표기하고, 실제로 카드에서 빠져나가는 금액은 77,000원이다.
 * 결제 직전 화면에는 반드시 77,000원을 명시한다 -- 표기와 청구가 어긋나면
 * 이탈과 분쟁이 생긴다.
 */
export const PLAN = {
  code: 'standard',
  name: 'Standard',
  /** VAT 제외 표기가. plans.price_krw 와 같아야 한다. */
  priceKrw: 70_000,
  vatKrw: 7_000,
  /** 실제 청구액. PortOne amount.total. */
  totalKrw: 77_000,
  deviceLimit: 2,
  orderName: '리얼타임 닥터 월 이용권'
} as const;

export function formatKrw(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}
