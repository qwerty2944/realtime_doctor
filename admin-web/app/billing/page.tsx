import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { withBasePath } from '@/lib/base-path';
import { missingPortOneEnv } from '@/lib/env';
import { PLAN, formatKrw } from '@/lib/billing/plan';
import { BillingClient } from './BillingClient';
import { CancelClient } from './CancelClient';

export const dynamic = 'force-dynamic';

type SelfRow = {
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  card_brand: string | null;
  card_last4: string | null;
  has_billing_key: boolean | null;
};

type AttemptRow = {
  payment_id: string;
  amount_krw: number;
  status: string;
  attempted_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  failure_message: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  trialing: '무료 체험 중',
  active: '이용 중',
  past_due: '결제 실패 (유예 중)',
  canceled: '해지됨',
  expired: '만료됨'
};

const ATTEMPT_LABEL: Record<string, string> = {
  paid: '결제 완료',
  failed: '결제 실패',
  pending: '처리 중',
  scheduled: '결제 예정',
  paid_activation_failed: '결제 완료 (반영 오류)'
};

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul'
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export default async function BillingPage() {
  const supabase = await getCookieSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/billing/login?next=/billing');

  // 클라이언트는 subscriptions 본 테이블이 아니라 0002 의 secret-free 뷰만 읽는다.
  // billing_key 는 이 뷰에 아예 컬럼이 없다.
  const { data: sub } = await supabase
    .from('subscriptions_self')
    .select(
      'plan_code, status, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, card_brand, card_last4, has_billing_key'
    )
    .maybeSingle<SelfRow>();

  const { data: attempts } = await supabase
    .from('payment_attempts')
    .select('payment_id, amount_krw, status, attempted_at, scheduled_for, created_at, failure_message')
    .order('created_at', { ascending: false })
    .limit(24)
    .returns<AttemptRow[]>();

  // 결제를 실제로 받을 수 있는 상태인가. API 라우트·헬스체크와 **같은 판정**을
  // 쓴다 (lib/env.ts). 판정이 갈라지면 "버튼은 보이는데 503" 이 된다.
  const billingReady = missingPortOneEnv().length === 0;

  const status = sub?.status ?? 'none';
  const nextBilling =
    status === 'trialing' ? sub?.trial_ends_at ?? null : sub?.current_period_end ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          {/* '내 진료 기록'(/admin) 으로 가는 링크를 두지 않는다. 그 경로는
              브랜드 도메인에서 재작성되지 않으므로 의사에게는 404 로 보이고,
              관리 호스트에서만 맞는 링크는 두 곳 중 한 곳에서 반드시 틀린다.
              의사는 데스크톱 앱에서 이 화면으로 오고, 앱으로 돌아간다. */}
          <h1 className="text-2xl font-semibold">구독 관리</h1>
          <p className="mt-1 text-sm text-foreground/60">{user.email}</p>
        </div>
        <form action={withBasePath('/api/billing/signout')} method="post">
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1 text-xs text-foreground/70 hover:bg-muted hover:text-foreground"
          >
            로그아웃
          </button>
        </form>
      </div>

      {/* 현재 상태 */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-foreground/50">현재 상태</div>
            <div className="mt-1 text-xl font-semibold">
              {STATUS_LABEL[status] ?? '구독 없음'}
            </div>
            <div className="mt-1 text-sm text-foreground/60">
              플랜: {sub?.plan_code ?? PLAN.code} · 기기 {PLAN.deviceLimit}대
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-foreground/50">
              {status === 'trialing' ? '체험 종료' : '다음 결제일'}
            </div>
            <div className="mt-1 text-lg font-medium">{fmtDate(nextBilling)}</div>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <div className="text-xs uppercase tracking-wide text-foreground/50">요금</div>
          <div className="mt-1 text-lg font-semibold">
            월 {formatKrw(PLAN.priceKrw)} <span className="text-sm font-normal">(VAT 별도)</span>
          </div>
          <div className="mt-1 text-sm text-foreground/60">
            실제 청구 금액 <strong className="text-foreground">{formatKrw(PLAN.totalKrw)}</strong>{' '}
            (부가세 {formatKrw(PLAN.vatKrw)} 포함)
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <div className="text-xs uppercase tracking-wide text-foreground/50">결제 수단</div>
          <div className="mt-1 text-sm">
            {sub?.has_billing_key ? (
              <span>
                {sub.card_brand ?? '카드'} ····{sub.card_last4 ?? '****'}
              </span>
            ) : (
              <span className="text-foreground/60">등록된 카드가 없습니다.</span>
            )}
          </div>
          <div className="mt-4">
            {billingReady ? (
              <BillingClient hasCard={!!sub?.has_billing_key} status={status} />
            ) : (
              <BillingNotReady trialEndsAt={sub?.trial_ends_at ?? null} status={status} />
            )}
          </div>
        </div>

        {/* 해지 / 해지 취소 (S5) */}
        {billingReady && (
          <div className="mt-6 border-t border-border pt-4">
            <CancelClient
              cancelAtPeriodEnd={!!sub?.cancel_at_period_end}
              currentPeriodEnd={sub?.current_period_end ?? null}
              status={status}
            />
          </div>
        )}
      </section>

      {/* 결제 내역 */}
      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">결제 내역</h2>
        {!attempts || attempts.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/60">아직 결제 내역이 없습니다.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-foreground/50">
              <tr>
                <th className="py-2">일시</th>
                <th className="py-2">금액</th>
                <th className="py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.payment_id} className="border-t border-border">
                  <td className="py-2">
                    {fmtDateTime(a.attempted_at ?? a.scheduled_for ?? a.created_at)}
                  </td>
                  <td className="py-2">{formatKrw(a.amount_krw)}</td>
                  <td className="py-2">
                    {ATTEMPT_LABEL[a.status] ?? a.status}
                    {a.failure_message && (
                      <span className="ml-2 text-xs text-red-300">{a.failure_message}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/**
 * 포트원 자격이 아직 없을 때 의사에게 보이는 것.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * [HARD] 되지 않는 것을 될 것처럼 보이게 하지 않는다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 여기서 흔한 실수는 버튼을 그대로 두고 눌렀을 때만 실패시키는 것이다. 그러면
 * 의사는 카드번호를 꺼내 입력하려다 실패를 만나고, 그 실패는 "이 서비스가
 * 고장났다"로 기억된다. 버튼 자체를 렌더링하지 않는다.
 *
 * 반대쪽 실수는 아무 말도 안 하는 것이다. 체험이 끝나 가는 의사에게 결제 화면이
 * 조용히 비어 있으면 그는 결제할 방법을 찾다가 포기한다. 그래서 지금 상태와
 * **그가 지금 할 수 있는 일**을 명시한다.
 *
 * 비어 있는 환경변수 이름은 이 화면에 싣지 않는다. 의사가 고칠 수 있는 것이
 * 아니고, 배포 구성을 사용자에게 노출할 이유도 없다. 그 정보는 부팅 로그와
 * `/api/health` 에 있고, 그쪽은 운영자가 본다.
 */
function BillingNotReady({
  trialEndsAt,
  status
}: {
  trialEndsAt: string | null;
  status: string;
}) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="text-sm font-semibold text-amber-200">
        카드 등록은 아직 준비 중입니다
      </div>
      <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
        결제 대행사 연동을 마무리하고 있습니다. 준비가 끝나면 이 화면에서 바로 카드
        등록과 구독 시작이 가능합니다.
      </p>
      {status === 'trialing' && trialEndsAt && (
        <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
          무료 체험은 {fmtDate(trialEndsAt)}까지입니다. 그전까지 결제가 열리지 않으면
          이용이 끊기지 않도록 체험 기간을 연장해 드립니다.
        </p>
      )}
      <p className="mt-3 text-xs text-amber-100/60">
        문의: 앱 내 문의하기 또는 담당자에게 직접 연락해 주세요.
      </p>
    </div>
  );
}
