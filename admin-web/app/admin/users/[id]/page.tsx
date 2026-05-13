import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { requireAdmin } from '@/lib/admin-gate';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtDate, fmtInt, fmtUsd } from '@/lib/format';
import { DailyCostLine, TaskCostBar } from '@/components/usage-charts';
import { SessionListToolbar } from '@/components/session-list-toolbar';
import { SessionList } from '@/components/session-list';
import { fetchSessionCards } from '@/lib/sessions-fetch';
import { SESSION_COLORS, type SessionColor } from '@/lib/session-colors';

export const dynamic = 'force-dynamic';

const DAYS = 30;

export default async function UserDetail({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    sort?: string;
    range?: string;
    colors?: string;
    pinned?: string;
  }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await getCookieSupabase();

  const selectedColors = (sp.colors ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is SessionColor => (SESSION_COLORS as readonly string[]).includes(c));

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('user_id, email, created_at')
    .eq('user_id', id)
    .maybeSingle();
  if (profileErr || !profile) notFound();
  const user = profile as { user_id: string; email: string | null; created_at: string };

  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceIso = since.toISOString();

  const [{ data: events = [] }, allCards, filteredCards] = await Promise.all([
    supabase
      .from('usage_events')
      .select(
        'ts, provider, task, model, prompt_tokens, output_tokens, total_tokens, chars, duration_ms'
      )
      .eq('user_id', id)
      .gte('ts', sinceIso)
      .order('ts', { ascending: false })
      .limit(20_000),
    fetchSessionCards(supabase, { userId: id }),
    fetchSessionCards(supabase, {
      userId: id,
      q: sp.q,
      sort: (sp.sort as 'recent' | 'oldest' | 'duration' | 'chunks') ?? 'recent',
      range: (sp.range as '7' | '30' | 'all') ?? 'all',
      colors: selectedColors.length > 0 ? selectedColors : undefined,
      pinnedOnly: sp.pinned === '1'
    })
  ]);

  const rows = (events ?? []) as Array<UsageRow & { ts: string }>;
  const total = rows.reduce((s, r) => s + costForRow(r), 0);

  const byDay = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    byDay.set(d.toISOString().slice(5, 10), 0);
  }
  for (const r of rows) {
    const key = r.ts.slice(5, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + costForRow(r));
  }
  const lineData = Array.from(byDay, ([date, cost]) => ({ date, cost }));

  const byTask = new Map<string, number>();
  for (const r of rows) {
    byTask.set(r.task, (byTask.get(r.task) ?? 0) + costForRow(r));
  }
  const taskBar = Array.from(byTask, ([task, cost]) => ({ task, cost })).sort(
    (a, b) => b.cost - a.cost
  );

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/users"
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          ← 사용자 목록
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{user.email || user.user_id}</h1>
        <p className="text-xs text-foreground/50">
          가입 {fmtDate(user.created_at)} · {user.user_id}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="최근 30일 비용" value={fmtUsd(total)} />
        <Card title="이벤트 수" value={fmtInt(rows.length)} sub="최근 30일" />
        <Card title="세션" value={fmtInt(allCards.length)} sub="전체" />
      </div>

      <Section title="일별 비용 (USD, 최근 30일)">
        <DailyCostLine data={lineData} />
      </Section>

      <Section title="task별 비용 (최근 30일)">
        {taskBar.length === 0 ? (
          <p className="text-sm text-foreground/60">데이터 없음</p>
        ) : (
          <TaskCostBar data={taskBar} />
        )}
      </Section>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">세션</h2>
        </div>
        <SessionListToolbar total={allCards.length} shown={filteredCards.length} />
        {filteredCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-foreground/60">
            조건에 맞는 세션이 없습니다.
          </div>
        ) : (
          <SessionList
            cards={filteredCards}
            hrefPrefix={`/admin/users/${id}/sessions`}
          />
        )}
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
