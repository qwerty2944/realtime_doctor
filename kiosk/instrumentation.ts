/**
 * 서버 부팅 훅.
 *
 * Next 는 서버가 뜰 때 `register()` 를 한 번 호출한다. 필수 환경변수와 키오스크
 * 매핑을 여기서 전부 검사해서, 설정이 빠졌을 때 **배포 직후에 크게** 실패하게
 * 한다. 이게 없으면 첫 환자가 마지막 질문에 답한 순간에야 500 이 뜨고, 그때
 * 남는 것은 "접수처에 알려 주세요" 한 문장뿐이다.
 */

export async function register(): Promise<void> {
  // Edge 런타임에서도 이 훅이 돌지만, 우리 라우트는 전부 Node 런타임이고
  // 검사 대상 변수도 Node 쪽에서만 의미가 있다.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertRequiredEnv } = await import('@/lib/env');
  const { getKioskRegistry } = await import('@/lib/intake/kiosk');

  assertRequiredEnv();
  // 매핑 형식까지 여기서 검증한다. JSON 오타 하나가 "그 태블릿으로 들어온
  // 환자만 통째로 사라지는" 실패로 나타나면 원인을 찾을 수 없다.
  const registry = getKioskRegistry();

  console.info(
    `[kiosk] Ready. Registered kiosks: ${[...registry.bySlug.keys()].join(', ')}`
  );
}
