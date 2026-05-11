import { getServiceSupabase } from '@/lib/supabase/server';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtInt, fmtUsd } from '@/lib/format';
import { DailyCostLine, ProviderCallsBar } from '@/components/usage-charts';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const DAYS = 30;

export default async function AdminOverview() {
  const supabase = getServiceSupabase();
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceIso = since.toISOString();

  const { data: events = [] } = await supabase
    .from('usage_events')
    .select(
      'user_id, ts, provider, task, model, prompt_tokens, output_tokens, total_tokens, chars, duration_ms'
    )
    .gte('ts', sinceIso)
    .order('ts', { ascending: false })
    .limit(20_000);

  const rows = (events ?? []) as Array<UsageRow & { user_id: string; ts: string }>;

  // total cost
  const total = rows.reduce((s, r) => s + costForRow(r), 0);

  // by-day for line chart
  const byDay = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(5, 10); // MM-DD
    byDay.set(key, 0);
  }
  for (const r of rows) {
    const key = r.ts.slice(5, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + costForRow(r));
  }
  const lineData = Array.from(byDay, ([date, cost]) => ({ date, cost }));

  // by-provider bar
  const byProvider = new Map<string, number>();
  for (const r of rows) {
    byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1);
  }
  const barData = Array.from(byProvider, ([provider, calls]) => ({
    provider,
    calls
  })).sort((a, b) => b.calls - a.calls);

  // top users by cost
  const byUser = new Map<string, number>();
  for (const r of rows) {
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + costForRow(r));
  }
  const topUserIds = Array.from(byUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const userIds = topUserIds.map((u) => u[0]);

  let emailById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 100
    });
    emailById = Object.fromEntries(
      (users?.users ?? []).map((u) => [u.id, u.email ?? ''])
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="최근 30일 비용 합계" value={fmtUsd(total)} />
        <Card title="이벤트 수" value={fmtInt(rows.length)} sub="최근 30일" />
        <Card
          title="고유 사용자"
          value={fmtInt(byUser.size)}
          sub="최근 30일"
        />
      </div>

      <Section title="일별 비용 (USD, 최근 30일)">
        <DailyCostLine data={lineData} />
      </Section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Section title="공급자별 호출 횟수">
          <ProviderCallsBar data={barData} />
        </Section>

        <Section title="비용 상위 사용자">
          {topUserIds.length === 0 ? (
            <p className="text-sm text-foreground/60">데이터 없음</p>
          ) : (
            <ul className="space-y-2">
              {topUserIds.map(([id, cost]) => (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/users/${id}`}
                    className="truncate text-foreground hover:text-accent"
                  >
                    {emailById[id] || id}
                  </Link>
                  <span className="font-mono text-foreground/80">
                    {fmtUsd(cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  sub
}: {
  title: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-foreground/50">
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-foreground/40">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
