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
    // [HARD] 결제 화면과 관리 화면은 **다른 로그인 경로**로 보낸다.
    // 브랜드 도메인(entanglecare.com)에서 재작성되는 것은 `/billing/*` 뿐이라,
    // 결제 화면에 온 의사를 `/login` 으로 보내면 doctor-web 의 404 로 떨어진다.
    //
    // `req.nextUrl` 은 basePath 를 제외한 경로를 담고, 여기에 세팅한 pathname 은
    // 리다이렉트 시 Next 가 다시 접두사를 붙여 준다. 그래서 이 파일에서만은
    // withBasePath 를 쓰지 않는다 -- 쓰면 접두사가 두 번 붙는다.
    const url = req.nextUrl.clone();
    const isBilling = req.nextUrl.pathname.startsWith('/billing');
    url.pathname = isBilling ? '/billing/login' : '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 로그인된 누구든 /admin/* 진입 가능.
  // 데이터 격리는 RLS (user_id = auth.uid() OR public.is_admin()) 가 자동 처리.
  // qwerty.2944 같은 is_admin=true 계정만 전체 row, 나머지는 본인 row 만 봄.
  return res;
}
