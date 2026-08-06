import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The patient and doctor screens moved under /righthand. Printed QR codes,
   * bookmarks and previously generated intake links still point at the old paths,
   * so they are redirected rather than left to 404.
   */
  async redirects() {
    return [
      { source: "/intake", destination: "/righthand/patient", permanent: true },
      { source: "/dashboard", destination: "/righthand/doctor", permanent: true },
      { source: "/dashboard/:path*", destination: "/righthand/doctor/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
