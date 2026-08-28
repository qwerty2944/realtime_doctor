import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * SERVER ONLY. This is how patient-facing intake writes reach the database:
 * patients are not authenticated, so the anon role has no table policies and all
 * intake writes must go through server-side API routes that use this client.
 *
 * Never import this from a Client Component.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createSupabaseAdminClient was called in the browser. The service-role key must never reach the client.',
    );
  }

  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        // No session persistence: this client acts on behalf of the server.
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
