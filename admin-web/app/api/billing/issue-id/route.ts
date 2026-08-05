import { NextResponse } from 'next/server';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { getServiceSupabase } from '@/lib/supabase/service';
import { firstPaymentId, newIssueId, portoneCustomerId } from '@/lib/billing/ids';
import { requireEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/issue-id
 *
 * 카드 등록 창을 열기 직전에 호출한다. 서버가 1회용 issueId 를 만들어 사용자에게
 * 묶어두고, 브라우저 SDK 에 필요한 공개 값(storeId/channelKey/customerId)을 함께
 * 돌려준다.
 *
 * issueId 를 브라우저가 만들지 않는 이유: 완료 처리 때 "이 빌링키가 우리가 방금
 * 시작한 발급 요청의 결과가 맞는가"를 서버가 확인할 근거가 필요하다.
 */
export async function POST() {
  const supabase = await getCookieSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const issueId = newIssueId();
  const customerId = portoneCustomerId(user.id);

  const { error } = await getServiceSupabase().from('billing_issue_requests').insert({
    issue_id: issueId,
    user_id: user.id,
    customer_id: customerId,
    payment_id: firstPaymentId(issueId)
  });
  if (error) {
    console.error('[billing] issue 요청 저장 실패', error.message);
    return NextResponse.json({ error: 'issue_unavailable' }, { status: 503 });
  }

  return NextResponse.json({
    issueId,
    customerId,
    storeId: requireEnv('NEXT_PUBLIC_PORTONE_STORE_ID'),
    channelKey: requireEnv('NEXT_PUBLIC_PORTONE_CHANNEL_KEY')
  });
}
