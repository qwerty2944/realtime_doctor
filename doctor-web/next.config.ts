import type { NextConfig } from "next";

/**
 * The patient intake kiosk is a SEPARATE Vercel deployment (`righthand-patient`,
 * built from `kiosk/`). It is not a page in this app and never will be — the two
 * surfaces have different owners, different release cadences and different
 * secrets (the kiosk holds a service-role key and a Gemini key; this app must
 * not).
 *
 * This app owns the `entanglecare.com` routing, so it is the thing that has to
 * put the kiosk back on the public path.
 */
const KIOSK_ORIGIN = "https://righthand-patient.vercel.app";

const nextConfig: NextConfig = {
  /**
   * The patient and doctor screens moved under /righthand. Printed QR codes,
   * bookmarks and previously generated intake links still point at the old paths,
   * so they are redirected rather than left to 404.
   *
   * None of these sources overlaps the /righthand/patient rewrite below:
   * redirects match `/intake`, `/dashboard` and `/dashboard/*` only. `/intake`
   * lands on `/righthand/patient` as a fresh request, which the rewrite then
   * serves — so the redirect depends on the rewrite rather than shadowing it.
   */
  async redirects() {
    return [
      { source: "/intake", destination: "/righthand/patient", permanent: true },
      { source: "/dashboard", destination: "/righthand/doctor", permanent: true },
      { source: "/dashboard/:path*", destination: "/righthand/doctor/:path*", permanent: true },
    ];
  },

  /**
   * [HARD] The path is NOT stripped. The kiosk is built with
   * `NEXT_PUBLIC_BASE_PATH=/righthand/patient`, so its pages, static assets and
   * API routes all live under that prefix on its own deployment too. Forwarding
   * to the kiosk's `/` would 404 for exactly that reason.
   *
   * `beforeFiles` rather than the default (`afterFiles`): afterFiles rewrites are
   * checked before dynamic routes but after them is not a property worth relying
   * on. This app has no route under /righthand/patient today, and beforeFiles
   * keeps that true even if somebody later adds a catch-all under /righthand.
   */
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/righthand/patient",
          destination: `${KIOSK_ORIGIN}/righthand/patient`,
        },
        {
          source: "/righthand/patient/:path*",
          destination: `${KIOSK_ORIGIN}/righthand/patient/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
