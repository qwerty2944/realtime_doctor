/**
 * Canonical public origin for this deployment.
 *
 * Single source of truth for absolute URLs (metadataBase, og:url, sitemap,
 * robots, JSON-LD @id). Do not hardcode the domain anywhere else.
 *
 * Overridable so preview deployments do not advertise the production domain.
 * `NEXT_PUBLIC_` because `metadataBase` is evaluated during the client-referenced
 * metadata pass as well; a bare `SITE_URL` would be empty there.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://entanglecare.com'
).replace(/\/+$/, '');

/**
 * Stable JSON-LD node id for the company. The homepage defines the Organization
 * at this id; other pages reference it instead of restating the company facts,
 * so there is one place for them to be wrong.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/** Absolute URL for a site-relative path (`/righthand` -> `https://.../righthand`). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
