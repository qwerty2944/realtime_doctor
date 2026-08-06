import Link from 'next/link';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { requireAdmin } from '@/lib/admin-gate';
import { costForRow, type UnpricedSummary, type UsageRow } from '@/lib/pricing';
import { fmtInt, fmtUsd, fmtDate } from '@/lib/format';
import { UnpricedNotice } from '@/components/unpriced-notice';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  await requireAdmin();
  const supabase = await getCookieSupabase();

  const [
    { data: profiles = [] },
    { data: events = [] },
    { data: sessions = [] }
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id, email, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('usage_events')
      .select(
        'user_id, ts, provider, task, model, prompt_tokens, output_tokens, total_tokens, chars, duration_ms'
      )
      .order('ts', { ascending: false })
      .limit(50_000),
    supabase.from('sessions').select('user_id, started_at')
  ]);

  const profileRows = (profiles ?? []) as Array<{
    user_id: string;
    email: string | null;
    created_at: string;
  }>;
  const eventRows = (events ?? []) as Array<UsageRow & { user_id: string; ts: string }>;
  const sessionRows = (sessions ?? []) as Array<{
    user_id: string;
    started_at: string;
  }>;

  const costByUser = new Map<string, number>();
  const lastTsByUser = new Map<string, string>();
  // 사용자별 비용은 산정 가능한 행만 더한다. 어떤 사용자 행이 얼마나 빠졌는지는
  // 표 위 배너로 알린다 — 말없이 낮은 금액을 보여주면 열 자체가 못 믿을 값이 된다.
  const unpricedByUser = new Map<string, number>();
  const unpricedLabels = new Set<string>();
  let unpricedCount = 0;
  for (const r of eventRows) {
    const cost = costForRow(r);
    if (cost.priced) {
      costByUser.set(r.user_id, (costByUser.get(r.user_id) ?? 0) + cost.usd);
    } else {
      unpricedCount += 1;
      unpricedLabels.add(cost.label);
      unpricedByUser.set(r.user_id, (unpricedByUser.get(r.user_id) ?? 0) + 1);
    }
    if (!lastTsByUser.has(r.user_id)) lastTsByUser.set(r.user_id, r.ts);
  }
  const unpriced: UnpricedSummary = {
    count: unpricedCount,
    labels: [...unpricedLabels].sort()
  };
  const sessionsByUser = new Map<string, number>();
  for (const s of sessionRows) {
    sessionsByUser.set(s.user_id, (sessionsByUser.get(s.user_id) ?? 0) + 1);
  }

  const rows = profileRows
    .map((p) => ({
      id: p.user_id,
      email: p.email ?? '',
      created_at: p.created_at,
      last_activity: lastTsByUser.get(p.user_id) ?? null,
      sessions: sessionsByUser.get(p.user_id) ?? 0,
      cost: costByUser.get(p.user_id) ?? 0,
      unpricedEvents: unpricedByUser.get(p.user_id) ?? 0
    }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">사용자</h1>
      <UnpricedNotice summary={unpriced} scope="누적" />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground/50">
              <th className="px-4 py-3 text-left">이메일</th>
              <th className="px-4 py-3 text-left">가입일</th>
              <th className="px-4 py-3 text-left">최근 활동</th>
              <th className="px-4 py-3 text-right">세션</th>
              <th className="px-4 py-3 text-right">총 비용</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-foreground/50">
                  사용자가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr
                key={u.id}
                className="border-b border-border/40 last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="text-foreground hover:text-accent"
                  >
                    {u.email || u.id}
                  </Link>
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {fmtDate(u.created_at)}
                </td>
                <td className="px-4 py-3 text-foreground/70">
                  {fmtDate(u.last_activity)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {fmtInt(u.sessions)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {fmtUsd(u.cost)}
                  {u.unpricedEvents > 0 && (
                    <span
                      className="ml-1 whitespace-nowrap font-sans text-[10px] text-amber-400"
                      title="단가를 모르는 모델이라 이 사용자의 합계에서 빠진 이벤트 수"
                    >
                      +미산정 {fmtInt(u.unpricedEvents)}건
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
