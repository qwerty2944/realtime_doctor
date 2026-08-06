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
export const DESKTOP_APP_VERSION = '0.8.0';

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

export type DesktopArtifactKey = 'mac-universal' | 'mac-arm64' | 'win-x64';

/** Which operating system an artifact is for. Drives the page's platform hint. */
export type ArtifactPlatform = 'mac' | 'windows';

export interface DesktopArtifact {
  key: DesktopArtifactKey;
  platform: ArtifactPlatform;
  /** Object path inside `RELEASE_BUCKET`. */
  storagePath: string;
  /** File name the browser should save as. */
  fileName: string;
  /** Korean label shown on the download button. */
  label: string;
  /** One-line Korean description of who this build is for. */
  description: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the installer. */
  sha256: string;
}

export const DESKTOP_ARTIFACTS: Record<DesktopArtifactKey, DesktopArtifact> = {
  'mac-universal': {
    key: 'mac-universal',
    platform: 'mac',
    storagePath: `mac/${DESKTOP_APP_VERSION}/realtime-doctor-${DESKTOP_APP_VERSION}-universal.dmg`,
    fileName: `Realtime Doctor-${DESKTOP_APP_VERSION}-universal.dmg`,
    label: 'macOS 공용 (Intel + Apple Silicon)',
    description: '어떤 Mac에서도 실행됩니다. 어느 쪽인지 모르겠다면 이 파일을 받으세요.',
    sizeBytes: 192_604_784,
    sha256: 'b78d6378b602e5a13ea958ab129d96e9848962cc752aa0d65751f3de40d44687',
  },
  'mac-arm64': {
    key: 'mac-arm64',
    platform: 'mac',
    storagePath: `mac/${DESKTOP_APP_VERSION}/realtime-doctor-${DESKTOP_APP_VERSION}-arm64.dmg`,
    fileName: `Realtime Doctor-${DESKTOP_APP_VERSION}-arm64.dmg`,
    label: 'macOS Apple Silicon 전용',
    description: 'M1 이후 Mac 전용입니다. 공용 파일보다 약 80MB 작습니다.',
    sizeBytes: 109_794_565,
    sha256: '5d4bcc9300c808b0208755fb8effebea5ce5ed90293ebb88da88ad4e8c3c4e88',
  },
  'win-x64': {
    key: 'win-x64',
    platform: 'windows',
    storagePath: `win/${DESKTOP_APP_VERSION}/realtime-doctor-${DESKTOP_APP_VERSION}-setup.exe`,
    fileName: `Realtime Doctor Setup ${DESKTOP_APP_VERSION}.exe`,
    label: 'Windows 64비트',
    description: '설치 위치를 고를 수 있는 일반 설치 파일입니다. Windows 10 이상 64비트용입니다.',
    sizeBytes: 86_460_695,
    sha256: 'd2f1eebe6ff8eb0c1f33fd34cb235b7fe221bb7a81736d2ff377fac00cb62acc',
  },
};

/** Display order on the page. */
export const DESKTOP_ARTIFACT_KEYS: readonly DesktopArtifactKey[] = [
  'mac-universal',
  'mac-arm64',
  'win-x64',
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
 * Windows is built for 0.8.0 and served from this catalog like any other file.
 *
 * The flag that used to live here (`WINDOWS_BUILD_AVAILABLE`) is gone rather
 * than flipped to `true`. It existed to say "no artifact exists", and a boolean
 * that is now permanently true is a second, weaker source of truth for
 * something the artifact list already states.
 *
 * Only publish a Windows entry when a CI run actually succeeded. An entry here
 * mints a signed URL for an object that must exist, so a catalogued-but-unbuilt
 * platform is a broken download button -- which is worse for a visitor than the
 * honest "not ready yet" message this replaced.
 */

/**
 * 0.7.0 is deliberately NOT offered any more.
 *
 * The objects are still in the bucket -- they are not deleted, because the audit
 * rows written for every 0.7.0 download name those paths and digests, and an
 * install already in the field may have to be identified later. But the catalog
 * is the only thing that can be signed (`signDesktopDownload` looks the path up
 * by key and never takes one from the request), so dropping the entries makes
 * them unreachable without touching the bytes.
 *
 * The reason is the whole point of this release. Every 0.7.0 installer carries
 * the owner's Gemini and OpenAI keys inside its app.asar. Handing out one more
 * copy hands out spendable keys that cannot be recalled without breaking every
 * install that already has them, and it is exactly what stops those keys from
 * being rotated. Continuing to offer the build we are trying to retire would
 * keep the door open indefinitely.
 */
export const RETIRED_VERSIONS = ['0.7.0'] as const;
