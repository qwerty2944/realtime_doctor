import 'server-only';
import { NextResponse } from 'next/server';
import { missingPortOneEnv } from '@/lib/env';

/**
 * 포트원 자격이 없을 때 결제 라우트가 돌려줄 응답.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 없는 것을 있는 것처럼 보이게 하지 않는다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 자격이 아직 없는 상태에서 취할 수 있었던 다른 선택지는 두 개였고 둘 다 나쁘다:
 *
 *   * 자리표시자 값을 넣는다 -> 결제창이 열리고 PG 가 거절한다. 의사에게는
 *     "설정이 안 됐다"가 아니라 **"내 카드가 거절당했다"** 로 보인다. 그건
 *     설정 누락을 결제 장애로 위장하는 짓이다.
 *   * 200 에 `{ok:false}` 를 담는다 -> 감시자와 로그는 정상으로 센다.
 *
 * 그래서 503 이다. "이 서버는 지금 이 기능을 제공하지 않는다"는 뜻이고,
 * `missing` 에 **이름만** 실어 무엇이 비었는지 사람이 바로 알 수 있게 한다.
 * [HARD] 값은 절대 싣지 않는다.
 *
 * 같은 판정을 `/billing` 화면과 `/api/health` 도 쓴다 (lib/env.ts 의
 * billingConfigured). 판정이 한 곳이라 "버튼은 보이는데 API 는 503" 같은 반쪽
 * 상태가 생기지 않는다.
 */
export function billingUnavailable(): NextResponse | null {
  const missing = missingPortOneEnv();
  if (missing.length === 0) return null;
  console.error(`[billing] 결제 라우트 거부 — 포트원 자격 미설정: ${missing.join(', ')}`);
  return NextResponse.json(
    {
      error: 'billing_not_configured',
      message: '결제 시스템이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      missing
    },
    { status: 503 }
  );
}
