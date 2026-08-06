import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';

/**
 * Cookie-backed Supabase client for Server Components, Server Actions and
 * Route Handlers. Runs as the signed-in doctor, so RLS policies apply.
 *
 * In Next.js 16 `cookies()` is async, hence this factory is async too.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Setting cookies during Server Component rendering is not allowed.
            // Session refresh is handled by the proxy / route handlers instead,
            // so ignoring this specific case is safe and expected.
          }
        },
      },
    },
  );
}
