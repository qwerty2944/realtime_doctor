// probe-model-swap 전용 aiProxy 스텁.
//
// 모델 비교 프로브는 배포 전 상태에서 돈다 -- 프록시가 아직 없다. 그래서 이
// 스텁이 로그인 토큰 자리에 더미를 넣고, 주소는 로컬 릴레이(GEMINI_API_BASE)로
// 간다. 게이트를 우회하는 것이 아니라, **아직 존재하지 않는 게이트** 앞에서
// 모델의 스키마 준수만 따로 측정하기 위한 것이다.
export class NotSignedInError extends Error {}
export function geminiProxyUrl() {
  return process.env.GEMINI_API_BASE ?? '';
}
export function realtimeMintUrl() {
  return '';
}
export async function aiAccessToken() {
  return 'probe-token';
}
export function aiProxyConfigured() {
  return true;
}
