/**
 * POST /api/dashboard/downloads
 *
 * Hands a signed, short-lived URL for a desktop-app installer to a caller with a
 * verified session, and records the grant.
 *
 * Why this route is gated at all
 * ------------------------------
 * The installers are built with the owner's Gemini / OpenAI / CLOVA API keys
 * embedded (`EMBEDDED_ENV_KEYS`, electron.vite.config.ts), and the app grants a
 * 7-day trial on signup. A public link is therefore an invitation to sign up
 * repeatedly with fresh addresses and spend the owner's credit. Requiring a
 * session makes every copy attributable, which is the point.
 *
 * [HARD] The service-role key never leaves the server and the client is never
 * given anything it can sign with. The browser receives one already-minted URL,
 * for one artifact, valid for `SIGNED_URL_TTL_SECONDS`.
 *
 * POST rather than a GET redirect: a GET would be prefetched by browsers and
 * link previewers, each prefetch minting a URL and writing an audit row for a
 * download nobody asked for, and it would leave the artifact in referrers and
 * history. A POST is only sent when someone clicks.
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import { logAppDownload } from '@/lib/audit';
import { requireDoctorForApi } from '@/lib/auth/doctor';
import { z } from 'zod';

import {
  DESKTOP_APP_VERSION,
  DESKTOP_ARTIFACT_KEYS,
  type DesktopArtifactKey,
} from '@/lib/releases/catalog';
import { signDesktopDownload } from '@/lib/releases/signing';

// Never cached: every response contains a distinct short-lived credential.
export const dynamic = 'force-dynamic';

const downloadRequestSchema = z.object({
  // Enumerated, not a path. The object path is looked up from the catalog, so a
  // caller cannot steer the signature at another object in the bucket.
  artifact: z.enum(DESKTOP_ARTIFACT_KEYS as unknown as [DesktopArtifactKey, ...DesktopArtifactKey[]], {
    message: '요청한 파일을 찾을 수 없습니다.',
  }),
});

/**
 * First entry of `x-forwarded-for`, when it parses as an address.
 *
 * The header is client-supplied and Vercel overwrites it at the edge, but a
 * self-hosted or misconfigured deployment might not. It is stored for
 * correlation only -- never for authorization -- and a forged value can at worst
 * pollute one audit row that already carries a verified `user_id`. Unparseable
 * input becomes null rather than failing the download: the `inet` column would
 * reject it and refusing a legitimate doctor over a malformed header is a worse
 * outcome than a null.
 */
function parseForwardedIp(request: Request): string | null {
  const header = request.headers.get('x-forwarded-for');
  if (!header) return null;

  const first = header.split(',')[0]?.trim();
  if (!first) return null;

  // Bracketed IPv6 ("[::1]:443") and "host:port" forms both appear in the wild.
  const unbracketed = first.startsWith('[') ? first.slice(1, first.indexOf(']')) : first;
  const candidate = unbracketed.includes(':') && unbracketed.split(':').length === 2
    ? unbracketed.split(':')[0]
    : unbracketed;

  if (!candidate) return null;

  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)
    && candidate.split('.').every((octet) => Number(octet) <= 255);
  const isIpv6 = /^[0-9a-fA-F:]+$/.test(candidate) && candidate.includes(':');

  return isIpv4 || isIpv6 ? candidate : null;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireDoctorForApi();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(
    request,
    downloadRequestSchema,
    '다운로드 요청이 올바르지 않습니다.',
  );
  if (!parsed.ok) return parsed.response;

  try {
    const signed = await signDesktopDownload(parsed.data.artifact);

    // Audit BEFORE the URL leaves the server. An unattributable copy of a build
    // carrying live API keys is exactly what this route exists to prevent, so a
    // failed write discards the minted URL instead of releasing it unlogged.
    await logAppDownload({
      userId: auth.doctor.id,
      artifactKey: signed.artifact.key,
      appVersion: DESKTOP_APP_VERSION,
      storagePath: signed.artifact.storagePath,
      sha256: signed.artifact.sha256,
      urlTtlSeconds: signed.expiresInSeconds,
      requestIp: parseForwardedIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    return Response.json(
      {
        url: signed.url,
        expiresInSeconds: signed.expiresInSeconds,
        fileName: signed.artifact.fileName,
        sha256: signed.artifact.sha256,
      },
      // Belt and braces alongside `dynamic`: a short-lived credential must not
      // be held by any cache between here and the browser.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[POST /api/dashboard/downloads] Failed to issue a download URL.', error);
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
