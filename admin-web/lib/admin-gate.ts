import 'server-only';
import { redirect } from 'next/navigation';
import { getCookieSupabase } from './supabase/ssr';

/** is_admin=true 가 아니면 /admin 으로 redirect (운영자 전용 페이지 게이트). */
export async function requireAdmin(): Promise<void> {
  const supabase = await getCookieSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.is_admin) redirect('/admin');
}
