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

  const { assertBootEnv } = await import('@/lib/env');
  // 코어 변수 누락과 옛 크론 시크릿 이름은 던진다. 포트원 자격 누락은 던지지
  // 않고 크게 로그를 남긴다 -- 결제만 꺼지고 나머지 화면은 계속 쓸 수 있어야
  // 한다. 자세한 근거는 lib/env.ts 의 REQUIRED_PORTONE_ENV_VARS 주석.
  assertBootEnv();
}
