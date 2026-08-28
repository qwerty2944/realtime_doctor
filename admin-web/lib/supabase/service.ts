import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '@/lib/env';

/**
 * service_role 클라이언트 (S3).
 *
 * 0002 의 설계상 public.subscriptions 는 service_role 만 쓸 수 있다. 결제 라우트가
 * 구독 상태를 바꾸는 유일한 경로이므로 여기서만 이 클라이언트를 만든다.
 *
 * [HARD] 'server-only' import 가 있으므로 이 모듈이 클라이언트 컴포넌트 그래프에
 * 섞이면 빌드가 깨진다. 그게 의도다 -- service_role 키는 브라우저에 갈 수 없다.
 */

let cached: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return cached;
}
