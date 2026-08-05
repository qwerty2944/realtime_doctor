/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
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
