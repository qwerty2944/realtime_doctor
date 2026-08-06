'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireEnvValue } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Browser Supabase client, used for doctor auth and Realtime subscriptions on
 * the dashboard. Only ever carries the anon key.
 *
 * The `process.env.NEXT_PUBLIC_*` references below MUST stay as literal static
 * member expressions: that is the only form Next.js inlines into the client
 * bundle at build time. Do not refactor them into a dynamic `process.env[name]`
 * lookup or a variable-keyed helper -- the value becomes `undefined` in the
 * browser while continuing to work on the server.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;

  cached = createBrowserClient(
    requireEnvValue('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );

  return cached;
}
