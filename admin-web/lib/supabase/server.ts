import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

// 모든 public 테이블이 RLS off 라서 anon key 만으로 어드민 페이지 데이터 조회 가능.
// service_role 키는 사용하지 않음 — 운영자/배포자가 별도로 관리 안 해도 됨.
export function getAdminSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing. ' +
        'Set them in Vercel project env vars (or .env.local for dev).'
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cached;
}
