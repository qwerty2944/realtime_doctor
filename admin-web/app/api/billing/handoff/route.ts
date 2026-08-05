import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase/service';
import { buildHandoffUrl, HANDOFF_TTL_MS } from '@/lib/billing/handoff';
import { appOrigin, requireEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/handoff
 *
 * Electron main 이 자기 세션의 access token 을 Bearer 로 보내면, 브라우저에서
 * 한 번만 쓸 수 있는 자동 로그인 링크를 돌려준다. 응답에는 1회용 OTP 해시를
 * 담은 URL 만 들어가고, refresh token 은 어느 쪽으로도 흐르지 않는다.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 사용자 식별은 오직 JWT 로만 한다. 본문에서 이메일이나 userId 를 받으면
  // 남의 계정으로 로그인 링크를 뽑을 수 있다.
  const asCaller = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: userData, error: userErr } = await asCaller.auth.getUser(jwt);
  const email = userData?.user?.email;
  if (userErr || !userData?.user || !email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = appOrigin();
  const { data, error } = await getServiceSupabase().auth.admin.generateLink({
    type: 'magiclink',
    email
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('[billing] generateLink 실패', error?.message);
    return NextResponse.json({ error: 'handoff_unavailable' }, { status: 503 });
  }

  return NextResponse.json({
    url: buildHandoffUrl(origin, tokenHash),
    expiresInMs: HANDOFF_TTL_MS
  });
}
