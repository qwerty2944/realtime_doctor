import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { withBasePath } from '@/lib/base-path';

/**
 * 의사 로그아웃 (결제 화면).
 *
 * `/api/auth/signout` 과 동작이 같은데 경로가 따로 있는 이유는 재작성 범위다.
 * 의사가 지나는 모든 경로가 `/billing/*` 과 `/api/billing/*` 두 접두사 안에
 * 있어야 doctor-web 의 rewrite 가 그 둘로 끝난다. `/api/auth/*` 까지 브랜드
 * 도메인에 열면 이 앱이 남의 도메인 네임스페이스를 한 칸 더 차지한다.
 *
 * 로그아웃 뒤에는 `/billing/login` 으로 보낸다. `/login` 은 브랜드 도메인에서
 * 재작성되지 않으므로 그리로 보내면 의사가 doctor-web 의 404 를 본다.
 */
export async function POST(request: Request) {
  const supabase = await getCookieSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL(withBasePath('/billing/login'), request.url), {
    status: 303
  });
}
