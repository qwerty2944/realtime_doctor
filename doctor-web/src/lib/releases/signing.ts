/**
 * Mints signed download URLs for desktop-app installers. SERVER ONLY.
 *
 * [HARD] This is the only path to an installer, and it exists because there must
 * not be a second one. The `app-releases` bucket has no storage RLS policy, so
 * `anon` and `authenticated` can neither read, list nor sign an object in it --
 * only the service-role client here can. Do not add a policy granting
 * `authenticated` read on the bucket: it would let any signed-in browser mint
 * its own URL with no audit row and no TTL, which is the gate itself.
 *
 * The caller is responsible for verifying the session BEFORE calling this, and
 * for recording the grant after. See `src/app/api/dashboard/downloads/route.ts`.
 */

import {
  DESKTOP_ARTIFACTS,
  RELEASE_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type DesktopArtifact,
  type DesktopArtifactKey,
} from '@/lib/releases/catalog';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface SignedDownload {
  url: string;
  expiresInSeconds: number;
  artifact: DesktopArtifact;
}

/**
 * Sign one catalogued artifact for immediate download.
 *
 * The object path comes from the catalog keyed by `DesktopArtifactKey`, never
 * from the request body, so a caller cannot walk out of the release prefix into
 * another object in the bucket.
 *
 * Throws on failure; the route turns that into a 500 and returns no URL.
 */
export async function signDesktopDownload(
  key: DesktopArtifactKey,
): Promise<SignedDownload> {
  const artifact = DESKTOP_ARTIFACTS[key];
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.storage
    .from(RELEASE_BUCKET)
    .createSignedUrl(artifact.storagePath, SIGNED_URL_TTL_SECONDS, {
      // Makes the browser save the file under its release name instead of
      // opening it or naming it after the object path.
      download: artifact.fileName,
    });

  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign ${RELEASE_BUCKET}/${artifact.storagePath}: ${error?.message ?? 'no URL returned'}`,
    );
  }

  return {
    url: data.signedUrl,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    artifact,
  };
}
