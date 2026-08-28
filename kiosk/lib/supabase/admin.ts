import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';

/**
 * 서비스 롤 Supabase 클라이언트. RLS 를 통째로 우회한다.
 *
 * SERVER ONLY. 환자는 인증되지 않으므로 anon 롤에는 적용될 정책이 없고,
 * 문진의 모든 쓰기는 서버 API 라우트에서 이 클라이언트로만 나간다.
 * (`supabase/migrations/0001_patients_encounters.sql` 의 정책은 전부
 * `to authenticated` 다 — anon 으로는 한 행도 못 넣는다.)
 *
 * 절대 클라이언트 컴포넌트에서 import 하지 않는다.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createSupabaseAdminClient was called in the browser. The service-role key must never reach the client.'
    );
  }

  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        // 서버가 자기 권한으로 행동한다. 세션을 유지할 이유가 없다.
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}
