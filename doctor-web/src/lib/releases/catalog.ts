/**
 * Catalog of downloadable desktop-app builds.
 *
 * Safe to import from Client Components: it holds no key and no secret, only the
 * facts the download page prints and the server needs to sign an object.
 *
 * Why the digests live in source
 * ------------------------------
 * A user who cannot verify what they downloaded has no way to notice tampering,
 * so the page prints a SHA-256 next to every file. Keeping it here rather than
 * in the database means the value is reviewed in a pull request and carried in
 * git history, which is a stronger provenance story than a row anyone with the
 * service-role key could quietly rewrite.
 *
 * [HARD] When a new build is uploaded, update `sizeBytes` and `sha256` in the
 * same commit. A stale digest is worse than none: it teaches users that a
 * mismatch is normal.
 *
 * Recorded from the built artifacts with `shasum -a 256` and `stat -f %z`.
 */

/** Version of the builds catalogued below. Matches the root package.json. */
export const DESKTOP_APP_VERSION = '0.7.0';

/** Private Supabase Storage bucket. Nothing in it is reachable without a signature. */
export const RELEASE_BUCKET = 'app-releases';

/**
 * Lifetime of a minted download URL, in seconds.
 *
 * Two minutes, and the shortness costs the user nothing. Supabase Storage checks
 * the signature when a request STARTS: a transfer already in flight is not
 * interrupted when the token expires, which was measured against this bucket --
 * a 5 MB body under a 5-second URL completed over 16 seconds, while a fresh
 * request with the same expired URL was refused with HTTP 400. So the TTL only
 * has to cover the hop from the API response to the browser opening the
 * connection, not the minutes it takes to pull 184 MB.
 *
 * What it buys: a URL that leaks -- pasted into a chat, left in a browser
 * history, captured from a shared screen -- is a bearer token for an installer
 * carrying the owner's API keys. Two minutes bounds how long that leak is worth
 * anything. It is deliberately not "long enough to be convenient", because the
 * measurement above shows convenience does not depend on it.
 */
export const SIGNED_URL_TTL_SECONDS = 120;

export type DesktopArtifactKey = 'mac-universal' | 'mac-arm64';

export interface DesktopArtifact {
  key: DesktopArtifactKey;
  /** Object path inside `RELEASE_BUCKET`. */
  storagePath: string;
  /** File name the browser should save as. */
  fileName: string;
  /** Korean label shown on the download button. */
  label: string;
  /** One-line Korean description of who this build is for. */
  description: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the .dmg. */
  sha256: string;
}

export const DESKTOP_ARTIFACTS: Record<DesktopArtifactKey, DesktopArtifact> = {
  'mac-universal': {
    key: 'mac-universal',
    storagePath: `mac/${DESKTOP_APP_VERSION}/realtime-doctor-${DESKTOP_APP_VERSION}-universal.dmg`,
    fileName: `Realtime Doctor-${DESKTOP_APP_VERSION}-universal.dmg`,
    label: 'macOS 공용 (Intel + Apple Silicon)',
    description: '어떤 Mac에서도 실행됩니다. 어느 쪽인지 모르겠다면 이 파일을 받으세요.',
    sizeBytes: 192_584_992,
    sha256: 'aa4faf28ffd822e98902534ef07b33a769a4144c8942cb9dcbd9c2e674fbcad9',
  },
  'mac-arm64': {
    key: 'mac-arm64',
    storagePath: `mac/${DESKTOP_APP_VERSION}/realtime-doctor-${DESKTOP_APP_VERSION}-arm64.dmg`,
    fileName: `Realtime Doctor-${DESKTOP_APP_VERSION}-arm64.dmg`,
    label: 'macOS Apple Silicon 전용',
    description: 'M1 이후 Mac 전용입니다. 공용 파일보다 약 80MB 작습니다.',
    sizeBytes: 109_794_853,
    sha256: '2de5cb77a7f2c7f8873ff93b2df3281f0694b24f3c40db132a338b3d678e0798',
  },
};

/** Display order on the page. */
export const DESKTOP_ARTIFACT_KEYS: readonly DesktopArtifactKey[] = [
  'mac-universal',
  'mac-arm64',
];

export function isDesktopArtifactKey(value: unknown): value is DesktopArtifactKey {
  return typeof value === 'string' && value in DESKTOP_ARTIFACTS;
}

/**
 * Human-readable size. Pure and deterministic so the server render and the
 * client hydration produce identical text.
 */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)}MB`;
}

/**
 * Windows is genuinely not built for this version.
 *
 * `dist:win` exists in the root package.json but has not been run for 0.7.0, so
 * there is no artifact to serve. The page states this rather than linking to
 * nothing or quietly showing only macOS -- a visitor on Windows must be able to
 * tell "not yet" apart from "this page is broken".
 */
export const WINDOWS_BUILD_AVAILABLE = false;
