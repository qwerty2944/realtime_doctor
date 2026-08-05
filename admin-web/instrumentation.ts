/**
 * 서버 부팅 훅.
 *
 * kiosk 와 같은 이유로 둔다: 결제 관련 설정이 빠졌다는 사실을 의사가 카드 등록
 * 버튼을 누른 순간이 아니라 **배포 직후에** 알아야 한다. 결제 흐름에서 늦게
 * 발견되는 설정 누락은 그대로 매출 손실이다.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // 빌드 단계에는 런타임 시크릿이 없을 수 있다. 빌드 실패와 설정 누락은 구분한다.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { assertBillingEnv } = await import('@/lib/env');
  assertBillingEnv();
  console.info('[admin-web] 결제 환경변수 확인 완료.');
}
