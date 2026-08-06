/**
 * Doctor identity for the statistics dashboard. SERVER ONLY.
 *
 * This module used to provision a row in a web-owned `doctors` table and read a
 * `role` column off it. Neither exists: the web now reads the native app's
 * Supabase project (`yhwvwojjwwlcrvpfxgag`), whose per-user table is
 * `public.profiles(user_id, email, is_admin, created_at)` — no `role`, no
 * `settings_json`. The old code failed on its very first statement at sign-in.
 *
 * Two consequences of moving onto `profiles`, both deliberate:
 *
 *   1. **Nothing is provisioned here.** The row is created by the database's own
 *      signup trigger (`handle_new_user_profile`, app migration `0000:57`), and
 *      `authenticated` holds SELECT and nothing else on the table (`0000:335`,
 *      re-asserted by `0013`'s allowlist). A web-side upsert would need the
 *      service-role key to write a row the database already wrote, so a missing
 *      profile is reported rather than papered over.
 *   2. **The read runs on the cookie-backed client**, not the service role. The
 *      `profiles_select_own_or_admin` policy (`0000:378`) already scopes it to
 *      the caller's own row, so the service role would only widen what this
 *      module can see for no gain.
 *
 * Authorization is re-checked here rather than being inherited from the proxy.
 * The proxy is an optimistic gate for navigation; route handlers and pages must
 * not treat "the request reached me" as proof of a session.
 */

import { redirect } from 'next/navigation';

import { jsonError } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const DOCTOR_LOGIN_PATH = '/righthand/doctor/login';

export interface DoctorIdentity {
  id: string;
  email: string;
  name: string;
  /**
   * `profiles.is_admin`. The app's admin signal, read back from the database on
   * every request rather than from the JWT: app metadata is minted at sign-in,
   * so a revoked admin would keep their privileges until the token expired.
   *
   * The web dashboard has no admin-only screen today. The flag is still resolved
   * because it is the only authorization bit this schema has, and a future admin
   * surface reading it from anywhere else would be reading a stale copy.
   */
  isAdmin: boolean;
}

/** Fall back to the local part of the email so the header is never blank. */
function deriveName(email: string, metadataName: unknown): string {
  if (typeof metadataName === 'string' && metadataName.trim() !== '') {
    return metadataName.trim();
  }
  const localPart = email.split('@')[0];
  return localPart === '' ? '의료진' : localPart;
}

/**
 * Resolve the signed-in doctor from the session and `public.profiles`.
 *
 * Returns null when there is no valid session. Uses `getUser()`, which verifies
 * the token with the auth server, rather than `getSession()`, which trusts the
 * cookie.
 */
export async function getDoctor(): Promise<DoctorIdentity | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  const user = data.user;
  const email = user.email ?? '';
  if (email === '') {
    // Password sign-in always carries an email; anything else is a misconfigured
    // provider and must not be silently treated as a valid doctor.
    console.error(`[auth] Auth user ${user.id} has no email address; refusing to treat it as a doctor.`);
    return null;
  }

  const { data: row, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to read the profile for ${user.id}: ${profileError.message}`);
  }

  if (!row) {
    // The signup trigger should have written this row. Its absence means the
    // account was created by a path that bypassed the trigger, and guessing
    // `is_admin = false` would hide that from whoever has to fix it.
    throw new Error(
      `No public.profiles row for auth user ${user.id}. The signup trigger did not run for this account.`,
    );
  }

  return {
    id: user.id,
    email,
    name: deriveName(email, user.user_metadata?.name),
    // Fail closed: anything not exactly `true` is an ordinary doctor.
    isAdmin: (row as { is_admin?: unknown }).is_admin === true,
  };
}

/** Page-level guard. Redirects to the login screen when there is no session. */
export async function requireDoctor(): Promise<DoctorIdentity> {
  const doctor = await getDoctor();
  if (!doctor) redirect(DOCTOR_LOGIN_PATH);
  return doctor;
}

export type ApiDoctorResult =
  | { ok: true; doctor: DoctorIdentity }
  | { ok: false; response: Response };

/** Route-handler guard. Returns a ready-made 401 instead of redirecting. */
export async function requireDoctorForApi(): Promise<ApiDoctorResult> {
  const doctor = await getDoctor();
  if (!doctor) {
    return { ok: false, response: jsonError(401, '로그인이 필요합니다. 다시 로그인해 주세요.') };
  }
  return { ok: true, doctor };
}
