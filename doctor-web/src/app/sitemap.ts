import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/**
 * Public routes only.
 *
 * Deliberately absent, and why:
 * - `/api/*`            — machine endpoints, nothing to index.
 * - `/righthand/doctor/*` — login-gated (login, dashboard, download, statistics).
 * - `/righthand/patient*` — per-patient intake links on a separate deployment.
 * - `/righthand/billing*` — auth-gated billing on a separate deployment.
 * - `/intake`, `/dashboard*` — permanent redirects to the private paths above.
 *
 * A sitemap is a list of pages we want cited. Add a route here only when a
 * logged-out visitor should be able to read it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl('/'),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: absoluteUrl('/righthand'),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ];
}
