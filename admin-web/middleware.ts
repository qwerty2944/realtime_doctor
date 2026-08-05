import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// /admin/*, /billing 게이트. /login, /api/auth/signout 등은 자유로.
// [주의] /billing/handoff 는 **의도적으로 제외**한다. 그 라우트가 하는 일이
// 세션을 만드는 것이라, 게이트에 걸리면 자기 자신이 로그인으로 튕겨 나간다.
export const config = {
  matcher: ['/admin/:path*', '/billing']
};

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 로그인된 누구든 /admin/* 진입 가능.
  // 데이터 격리는 RLS (user_id = auth.uid() OR public.is_admin()) 가 자동 처리.
  // qwerty.2944 같은 is_admin=true 계정만 전체 row, 나머지는 본인 row 만 봄.
  return res;
}
