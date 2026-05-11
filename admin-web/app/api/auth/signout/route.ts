import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';

export async function POST(request: Request) {
  const supabase = await getCookieSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
