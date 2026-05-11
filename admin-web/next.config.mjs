/** @type {import('next').NextConfig} */
const nextConfig = {
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
