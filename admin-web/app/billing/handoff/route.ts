import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { verifyHandoff } from '@/lib/billing/handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /billing/handoff?t=..&e=..&s=..
 *
 * Electron 이 외부 브라우저로 여는 주소. 봉투(HMAC + 120초 만료)를 확인한 뒤
 * 1회용 OTP 를 세션으로 교환하고 결제 페이지로 보낸다. 교환은 전적으로 서버에서
 * 일어나고, 세션은 HttpOnly 쿠키로만 남는다.
 *
 * 실패는 전부 /login 으로 보낸다. 여기서 실패했다는 것은 링크가 오래됐거나
 * 이미 쓰였다는 뜻이고, 그때 할 수 있는 일은 평범하게 로그인하는 것뿐이다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const check = verifyHandoff(url.searchParams);
  if (!check.ok) {
    console.warn('[billing] 핸드오프 링크 거부:', check.reason);
    return NextResponse.redirect(new URL('/login?next=/billing', req.url), { status: 303 });
  }

  const supabase = await getCookieSupabase();
  const { error } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: check.tokenHash
  });
  if (error) {
    // 이미 사용된 OTP 도 여기로 온다 -- 재사용 방지는 GoTrue 가 한다.
    console.warn('[billing] 핸드오프 OTP 교환 실패:', error.message);
    return NextResponse.redirect(new URL('/login?next=/billing', req.url), { status: 303 });
  }

  return NextResponse.redirect(new URL('/billing', req.url), { status: 303 });
}
