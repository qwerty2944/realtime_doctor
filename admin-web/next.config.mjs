/**
 * ══════════════════════════════════════════════════════════════════════════
 * basePath -- 이 앱은 doctor-web 아래에 얹혀 산다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 이 배포물은 두 개의 주소로 도달한다:
 *
 *   의사(결제)  https://entanglecare.com/righthand/billing
 *               -> doctor-web 의 rewrite 가 이 배포로 넘긴다 (next.config.ts).
 *   운영자(관리) https://<이 프로젝트의 Vercel 주소>/righthand/admin
 *               -> 재작성 대상이 아니다. 브랜드 도메인에서는 도달하지 않는다.
 *
 * [HARD] 경로 접두사는 **재작성에서 벗겨지지 않는다.** 키오스크와 같은 이유다:
 * `/_next/*` 정적 자산은 basePath 아래에 생기므로, 접두사 없이 얹으면 브라우저가
 * `entanglecare.com/_next/...` 를 요청하고 그건 doctor-web 의 번들이다. 페이지는
 * HTML 만 뜨고 자바스크립트가 통째로 죽는, 원인 찾기 어려운 실패가 된다.
 * 그래서 이 앱도 자기 자산을 `/righthand/_next/*` 에 두고, doctor-web 은 그
 * 경로를 그대로 넘긴다.
 *
 * 값을 환경변수로 뺀 이유: 로컬 개발과 배포별 주소(*.vercel.app)에서도 같은
 * 경로로 동작해야 디버깅이 한 벌로 끝난다. 미설정이면 접두사 없이 동작한다.
 * NEXT_PUBLIC_ 인 이유는 클라이언트 코드(lib/base-path.ts)도 같은 값을 봐야
 * 하기 때문이다 -- fetch 와 form action 에는 Next 가 접두사를 붙여 주지 않는다.
 *
 * @type {import('next').NextConfig}
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig = {
  ...(basePath ? { basePath } : {}),
  experimental: {},
  // 빌링은 항상 최신이어야 하므로 fetch caching 막음.
  // 페이지별로 `export const dynamic = 'force-dynamic'` 도 부착.
  async headers() {
    return [
      {
        source: '/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]
      }
    ];
  }
};

export default nextConfig;
