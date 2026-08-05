import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCookieSupabase } from '@/lib/supabase/ssr';
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
  if (!user) redirect('/login?next=/billing');

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

  const status = sub?.status ?? 'none';
  const nextBilling =
    status === 'trialing' ? sub?.trial_ends_at ?? null : sub?.current_period_end ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-[11px] text-foreground/40 hover:text-foreground">
            ← 내 진료 기록
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">구독 관리</h1>
          <p className="mt-1 text-sm text-foreground/60">{user.email}</p>
        </div>
        <form action="/api/auth/signout" method="post">
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
            <BillingClient hasCard={!!sub?.has_billing_key} status={status} />
          </div>
        </div>

        {/* 해지 / 해지 취소 (S5) */}
        <div className="mt-6 border-t border-border pt-4">
          <CancelClient
            cancelAtPeriodEnd={!!sub?.cancel_at_period_end}
            currentPeriodEnd={sub?.current_period_end ?? null}
            status={status}
          />
        </div>
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
