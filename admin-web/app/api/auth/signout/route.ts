import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { withBasePath } from '@/lib/base-path';

/**
 * 운영자 로그아웃. 관리 화면 호스트에서만 도달한다.
 *
 * [HARD] `new URL('/login', request.url)` 은 경로를 통째로 갈아치우므로 basePath
 * 가 사라진다. Next 는 Route Handler 가 만드는 Location 에 접두사를 붙여 주지
 * 않는다. 그래서 withBasePath 를 통과시킨다 -- 빠지면 로그아웃 후 도메인 루트로
 * 튕겨 나가고, 브랜드 도메인에서는 그게 doctor-web 의 404 다.
 */
export async function POST(request: Request) {
  const supabase = await getCookieSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL(withBasePath('/login'), request.url), { status: 303 });
}
