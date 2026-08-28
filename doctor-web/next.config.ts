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

/**
 * The billing surface is ALSO a separate Vercel deployment (`admin-web`, built
 * from `admin-web/`). Same reasoning as the kiosk: it holds a service-role key,
 * a PortOne API secret and a webhook secret, none of which this app may carry.
 *
 * ── Why billing is rewritten here but the vendor admin is NOT
 *
 * That one deployment serves two audiences. Doctors need the billing pages to
 * feel like part of the product they already pay for, so they are put on the
 * brand domain below. The vendor's usage / cost / user / pricing screens
 * (`/righthand/admin/*` on that deployment) are deliberately absent from the
 * list: they stay reachable only on the deployment's own Vercel hostname.
 *
 * [HARD] That is defence in depth, not the control. The control is the
 * server-side `is_admin` check in admin-web (lib/admin-gate.ts) which runs before
 * any vendor data is fetched. Leaving the path out of this list only means the
 * brand domain does not advertise it; someone who finds the deployment URL still
 * gets redirected out. Obscurity mistaken for a gate is how gates go missing.
 *
 * ── Why not a subdomain
 *
 * `billing.entanglecare.com` would need no rewrite and no path prefix, and it was
 * the first choice. It is not available from this repo: DNS authority for
 * entanglecare.com is at Cloudflare (NS: odin/roxy.ns.cloudflare.com), not at
 * Vercel, and there is no wildcard record there. Shipping it would have meant a
 * billing page that resolves nowhere, which is worse than the prefix.
 */
const ADMIN_ORIGIN = process.env.ADMIN_WEB_ORIGIN ?? "https://realtime-doctor-admin.vercel.app";

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

        /**
         * admin-web, doctor-facing paths only.
         *
         * [HARD] Same rule as the kiosk: the path is NOT stripped. admin-web is
         * built with `NEXT_PUBLIC_BASE_PATH=/righthand`, so its pages, its API
         * routes AND its `/_next/*` bundles all live under that prefix on its own
         * deployment. Forwarding to `/billing` would serve HTML whose script tags
         * point at `entanglecare.com/righthand/_next/...` and get nothing back —
         * a page that renders and then does nothing, with no error anywhere.
         *
         * The `_next` rule is what makes the page actually work; it is not
         * optional and it does not collide with this app, whose own bundles are
         * at `/_next/*` (no basePath here).
         */
        {
          source: "/righthand/billing",
          destination: `${ADMIN_ORIGIN}/righthand/billing`,
        },
        {
          source: "/righthand/billing/:path*",
          destination: `${ADMIN_ORIGIN}/righthand/billing/:path*`,
        },
        {
          source: "/righthand/api/billing/:path*",
          destination: `${ADMIN_ORIGIN}/righthand/api/billing/:path*`,
        },
        /**
         * The health endpoint is exposed through the brand domain on purpose:
         * the ops prober probes this URL, so a broken rewrite rule is caught by
         * the same run that checks the app. Probing the deployment's own
         * hostname would report "admin-web healthy" on a day when no doctor can
         * reach the billing page at all. Same argument as the kiosk surface.
         */
        {
          source: "/righthand/api/health",
          destination: `${ADMIN_ORIGIN}/righthand/api/health`,
        },
        {
          source: "/righthand/_next/:path*",
          destination: `${ADMIN_ORIGIN}/righthand/_next/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
