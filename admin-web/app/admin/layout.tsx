import { Nav } from '@/components/nav';
import { getCookieSupabase } from '@/lib/supabase/ssr';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = await getCookieSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle();
    isAdmin = !!profile?.is_admin;
  }

  return (
    <div className="min-h-screen">
      <Nav email={user?.email ?? null} isAdmin={isAdmin} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
