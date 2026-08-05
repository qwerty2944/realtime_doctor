import 'server-only';
import { portoneApiBase, requireEnv } from '@/lib/env';
import { PLAN } from '@/lib/billing/plan';

/**
 * 포트원 V2 REST 클라이언트 (S3에서 쓰는 세 개만).
 *
 * PG 는 나이스페이 또는 스마트로 중 하나로 정해질 예정인데, 둘 다 V2 CARD
 * 빌링키를 같은 방식으로 지원한다. 그래서 **PG 종속 코드를 한 줄도 두지 않고**
 * 채널을 전부 설정(PORTONE_CHANNEL_KEY)으로 몬다. bypass 옵션도 넣지 않는다 --
 * 넣는 순간 PG 를 바꿀 때 코드를 고쳐야 한다.
 *
 * 인증 헤더는 `Authorization: PortOne {API Secret}` 이다 (Bearer 가 아니다).
 */

const AUTH_SCHEME = 'PortOne';
/** 결제 API 가 늦게 답해도 라우트가 영원히 매달려 있으면 안 된다. */
const TIMEOUT_MS = 20_000;

export interface PortOneError {
  ok: false;
  /** HTTP 상태 또는 네트워크 실패 시 0. */
  status: number;
  code: string;
  message: string;
  raw: unknown;
}

export type PortOneResult<T> = ({ ok: true; data: T } | PortOneError);

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<PortOneResult<T>> {
  const url = `${portoneApiBase()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `${AUTH_SCHEME} ${requireEnv('PORTONE_API_SECRET')}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch (err) {
    // 네트워크 실패. "결제가 안 됐다"가 아니라 "결제 결과를 모른다"이다.
    // 호출부는 이 경우 구독을 활성화하지 않는다.
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : String(err),
      raw: null
    };
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const obj = (parsed ?? {}) as { type?: string; message?: string };
    return {
      ok: false,
      status: res.status,
      code: obj.type ?? `HTTP_${res.status}`,
      message: obj.message ?? text.slice(0, 300),
      raw: parsed
    };
  }
  return { ok: true, data: (parsed ?? {}) as T };
}

// ---------------------------------------------------------------------------
// 빌링키 조회 -- 브라우저 주장에 대한 유일한 반증 수단
// ---------------------------------------------------------------------------
export interface BillingKeyCard {
  publisher?: string;
  issuer?: string;
  brand?: string;
  name?: string;
  number?: string;
}

export interface BillingKeyInfo {
  status?: string;
  billingKey?: string;
  issueId?: string;
  customer?: { id?: string; email?: string; name?: string };
  methods?: { card?: BillingKeyCard }[];
  issuedAt?: string;
}

export function getBillingKey(billingKey: string): Promise<PortOneResult<BillingKeyInfo>> {
  return call<BillingKeyInfo>('GET', `/billing-keys/${encodeURIComponent(billingKey)}`);
}

/** 조회 결과에서 화면에 보여줄 마스킹 정보만 뽑는다. 카드번호 전체는 저장하지 않는다. */
export function maskedCard(info: BillingKeyInfo): { brand: string | null; last4: string | null } {
  const card = info.methods?.find((m) => m.card)?.card;
  if (!card) return { brand: null, last4: null };
  const digits = (card.number ?? '').replace(/\D/g, '');
  return {
    brand: card.issuer ?? card.publisher ?? card.name ?? card.brand ?? null,
    last4: digits.length >= 4 ? digits.slice(-4) : null
  };
}

// ---------------------------------------------------------------------------
// 빌링키 즉시 결제
// ---------------------------------------------------------------------------
export interface BillingKeyPaymentBody {
  billingKey: string;
  orderName: string;
  customer: { id: string; email?: string };
  amount: { total: number };
  currency: 'KRW';
  productType: 'DIGITAL';
  productCount: number;
}

export interface PaidResponse {
  payment?: { id?: string; status?: string; paidAt?: string };
}

export function payWithBillingKey(
  paymentId: string,
  args: { billingKey: string; customerId: string; email?: string | null }
): Promise<PortOneResult<PaidResponse>> {
  const body: BillingKeyPaymentBody = {
    billingKey: args.billingKey,
    orderName: PLAN.orderName,
    customer: args.email ? { id: args.customerId, email: args.email } : { id: args.customerId },
    amount: { total: PLAN.totalKrw },
    currency: 'KRW',
    productType: 'DIGITAL',
    productCount: 1
  };
  return call<PaidResponse>('POST', `/payments/${encodeURIComponent(paymentId)}/billing-key`, body);
}

// ---------------------------------------------------------------------------
// 결제 단건 조회 (S4 웹훅 전용)
// ---------------------------------------------------------------------------
/**
 * [HARD] 웹훅 본문에는 `paymentId`, `storeId`, `transactionId` 뿐이다. 금액도
 * 상태도 들어 있지 않다. 그래서 웹훅은 "이 결제 건에 무슨 일이 있었다"는 사실만
 * 전달하고, **무슨 일이 있었는지는 서버가 포트원에 직접 물어서** 판정한다.
 *
 * 이 구조는 보안상으로도 유리하다. 서명이 통과한 웹훅이라도 우리가 믿는 것은
 * paymentId 하나뿐이고, 금액·상태·고객은 전부 포트원의 답에서 온다.
 */
export interface PaymentDetail {
  id?: string;
  status?: string;
  paidAt?: string;
  billingKey?: string;
  scheduleId?: string;
  orderName?: string;
  customer?: { id?: string; email?: string };
  amount?: { total?: number; paid?: number };
  failure?: { reason?: string; pgCode?: string; pgMessage?: string };
}

export function getPayment(paymentId: string): Promise<PortOneResult<PaymentDetail>> {
  return call<PaymentDetail>('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

// ---------------------------------------------------------------------------
// 다음 주기 예약
// ---------------------------------------------------------------------------
export interface ScheduleResponse {
  schedule?: { id?: string; timeToPay?: string };
}

export function schedulePayment(
  paymentId: string,
  args: {
    billingKey: string;
    customerId: string;
    email?: string | null;
    timeToPay: Date;
  }
): Promise<PortOneResult<ScheduleResponse>> {
  const payment: BillingKeyPaymentBody = {
    billingKey: args.billingKey,
    orderName: PLAN.orderName,
    customer: args.email ? { id: args.customerId, email: args.email } : { id: args.customerId },
    amount: { total: PLAN.totalKrw },
    currency: 'KRW',
    productType: 'DIGITAL',
    productCount: 1
  };
  return call<ScheduleResponse>('POST', `/payments/${encodeURIComponent(paymentId)}/schedule`, {
    payment,
    // ISO8601 + 오프셋. toISOString() 은 항상 Z 로 끝나므로 요건을 만족한다.
    timeToPay: args.timeToPay.toISOString()
  });
}

// ---------------------------------------------------------------------------
// 예약 취소 (S5)
// ---------------------------------------------------------------------------
/**
 * [HARD] 해지가 "다음 달 청구를 실제로 멈추는 것"이 되려면 이 호출이 반드시
 * 있어야 한다. `cancel_at_period_end` 플래그만 세우고 여기를 부르지 않으면
 * **포트원은 예약대로 카드를 긁는다.** 해지한 의사에게 청구되는 것은 단순
 * 버그가 아니라 분쟁 사안이다.
 *
 * 성공 시 재시도 사다리에서도 쓴다 -- 어느 재시도 단에서든 결제가 성공하면
 * 남아 있는 재시도 예약을 여기서 걷어낸다.
 *
 * 규격이 특이하다: `DELETE /payment-schedules` 인데 본문이 아니라
 * **쿼리스트링 `requestBody`** 에 JSON 을 싣는다 (@portone/server-sdk 의
 * revokePaymentSchedules 가 하는 것과 동일한 방식). DELETE 에 본문을 실으면
 * 중간 프록시가 떨어뜨리는 경우가 있어서 포트원이 이렇게 만든 것으로 보인다.
 */
export interface RevokeSchedulesResponse {
  revokedScheduleIds?: string[];
  revokedAt?: string;
}

export function revokeSchedules(args: {
  billingKey: string;
  scheduleIds: string[];
}): Promise<PortOneResult<RevokeSchedulesResponse>> {
  const requestBody = JSON.stringify({
    billingKey: args.billingKey,
    scheduleIds: args.scheduleIds
  });
  return call<RevokeSchedulesResponse>(
    'DELETE',
    `/payment-schedules?requestBody=${encodeURIComponent(requestBody)}`
  );
}
