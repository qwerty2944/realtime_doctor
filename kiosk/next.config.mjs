/**
 * 배포 하위 경로.
 *
 * 키오스크는 도메인 루트가 아니라 `<도메인>/righthand/patient` 에서 서비스된다
 * (배포구조 문서 1장). 값은 **경로 조각뿐**이고 호스트명은 들어가지 않는다 —
 * 도메인은 아직 구매 전이고, 코드 어디에도 도메인을 박지 않는다.
 *
 * 비워두면 루트 배포로 동작한다. 로컬 개발과 기존 프로브가 그대로 돌아가야
 * 하므로 그것이 기본값이다.
 *
 * 클라이언트의 `fetch()` 는 Next 가 접두해 주지 않으므로 `lib/basePath.ts` 의
 * `apiPath()` 를 쓴다. 두 곳에서 읽지만 출처는 이 환경변수 하나다.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  // 빈 문자열을 그대로 넘기면 Next 가 "/" 접두를 요구하며 거부한다.
  ...(basePath ? { basePath } : {}),
  // 키오스크는 realtime_doctor 저장소 안의 독립 npm 프로젝트다. 루트에도
  // lockfile 이 있어서 Next 가 그쪽을 워크스페이스 루트로 추론하는데, 그러면
  // 이 앱의 의존성 해석이 Electron 앱 쪽으로 새어나간다. 여기로 못박는다.
  turbopack: { root: import.meta.dirname },
  // 문진 화면은 절대 캐시되면 안 된다. 태블릿을 공유하는 환경에서
  // 앞 환자의 화면이 뒷 환자에게 그대로 복원되는 것을 막는다.
  async headers() {
    return [
      {
        source: '/intake/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]
      }
    ];
  }
};

export default nextConfig;
