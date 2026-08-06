/**
 * Environment variable access.
 *
 * Values are read lazily inside functions rather than at module scope so that
 * `next build` succeeds with an empty .env.local. A missing variable fails loudly
 * at the point of use instead of silently producing a broken client.
 *
 * IMPORTANT -- server vs browser:
 * `requireEnv` indexes `process.env` dynamically, which only works on the server.
 * Next.js inlines `NEXT_PUBLIC_*` values into the client bundle only when they
 * appear as *static* member expressions (`process.env.NEXT_PUBLIC_FOO`); a dynamic
 * lookup defeats that substitution and reads the empty browser `process` polyfill.
 * Client components must therefore pass the statically-referenced value to
 * `requireEnvValue` instead of calling `requireEnv`.
 */

/**
 * Validates an already-resolved environment value. Safe in the browser because the
 * caller performs the static `process.env.NEXT_PUBLIC_X` reference itself.
 */
export function requireEnvValue(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example and set it in .env.local.`,
    );
  }
  return value;
}

/**
 * Server-only. Dynamic lookup is fine because the real `process.env` is available.
 */
export function requireEnv(name: string): string {
  return requireEnvValue(name, process.env[name]);
}
