import { getCookieSupabase } from '@/lib/supabase/ssr';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtDuration, fmtInt, fmtUsd } from '@/lib/format';
import {
  DailyCostLine,
  DailySessionsLine,
  ProviderCallsBar
} from '@/components/usage-charts';
import { SessionCard } from '@/components/session-card';
import { SessionListToolbar } from '@/components/session-list-toolbar';
import { fetchSessionCards } from '@/lib/sessions-fetch';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const DAYS = 30;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export default async function AdminOverview({
  searchParams
}: {
  searchParams: Promise<{ q?: string; sort?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await getCookieSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user!.id)
    .maybeSingle();
  const isAdmin = !!profile?.is_admin;

  if (!isAdmin) {
    return <UserDashboard userId={user!.id} searchParams={sp} />;
  }

  return <AdminDashboard supabase={supabase} />;
}

// ──────────────────────────────────────────────────────────────
// 일반 사용자: 본인 진료 기록
// ──────────────────────────────────────────────────────────────

async function UserDashboard({
  userId,
  searchParams
}: {
  userId: string;
  searchParams: { q?: string; sort?: string; range?: string };
}) {
  const supabase = await getCookieSupabase();

  const [allCards, filteredCards] = await Promise.all([
    fetchSessionCards(supabase, { userId }),
    fetchSessionCards(supabase, {
      userId,
      q: searchParams.q,
      sort: (searchParams.sort as 'recent' | 'oldest' | 'duration' | 'chunks') ?? 'recent',
      range: (searchParams.range as '7' | '30' | 'all') ?? 'all'
    })
  ]);

  // Stats
  const total = allCards.length;
  let totalChunks = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  let thisWeek = 0;
  const weekStart = startOfWeekKstUtcMs();
  for (const c of allCards) {
    totalChunks += c.chunk_count;
    const start = new Date(c.started_at).getTime();
    if (start >= weekStart) thisWeek += 1;
    if (c.ended_at) {
      totalDurationMs += new Date(c.ended_at).getTime() - start;
      durationCount += 1;
    }
  }
  const avgDuration = durationCount > 0 ? totalDurationMs / durationCount : 0;

  // Daily sessions (last 14 days, KST buckets)
  const days = 14;
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + KST_OFFSET_MS - i * 24 * 60 * 60 * 1000);
    buckets.set(d.toISOString().slice(5, 10), 0);
  }
  for (const c of allCards) {
    const d = new Date(new Date(c.started_at).getTime() + KST_OFFSET_MS);
    const key = d.toISOString().slice(5, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const lineData = Array.from(buckets, ([date, sessions]) => ({ date, sessions }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">내 진료 기록</h1>
        <p className="mt-1 text-sm text-foreground/60">
          저장된 진료 세션과 통계를 한눈에 확인할 수 있습니다.
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="text-sm text-foreground/70">아직 저장된 세션이 없습니다.</p>
          <p className="mt-2 text-xs text-foreground/50">
            앱에서 진료를 한 번 진행하면 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card title="총 진료" value={fmtInt(total)} />
            <Card title="이번 주" value={fmtInt(thisWeek)} sub="월~일 (KST)" />
            <Card title="평균 진료 시간" value={fmtDuration(avgDuration)} />
            <Card title="총 발화" value={fmtInt(totalChunks)} />
          </div>

          <Section title="일별 진료 (최근 14일, KST)">
            <DailySessionsLine data={lineData} />
          </Section>

          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">세션</h2>
            </div>
            <SessionListToolbar total={total} shown={filteredCards.length} />
            {filteredCards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-foreground/60">
                조건에 맞는 세션이 없습니다.
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredCards.map((c) => (
                  <li key={c.id}>
                    <SessionCard
                      s={c}
                      href={`/admin/users/${userId}/sessions/${c.id}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Monday start of week in KST, returned as UTC ms
function startOfWeekKstUtcMs(): number {
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const day = nowKst.getUTCDay(); // 0 = Sun in KST since we shifted
  const daysSinceMonday = (day + 6) % 7;
  const monKst = new Date(nowKst);
  monKst.setUTCHours(0, 0, 0, 0);
  monKst.setUTCDate(monKst.getUTCDate() - daysSinceMonday);
  return monKst.getTime() - KST_OFFSET_MS;
}

// ──────────────────────────────────────────────────────────────
// 어드민 dashboard (qwerty.2944 등 is_admin=true 전용)
// ──────────────────────────────────────────────────────────────

async function AdminDashboard({
  supabase
}: {
  supabase: Awaited<ReturnType<typeof getCookieSupabase>>;
}) {
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

  const byProvider = new Map<string, number>();
  for (const r of rows) {
    byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1);
  }
  const barData = Array.from(byProvider, ([provider, calls]) => ({
    provider,
    calls
  })).sort((a, b) => b.calls - a.calls);

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
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email')
      .in('user_id', userIds);
    emailById = Object.fromEntries(
      ((profiles ?? []) as Array<{ user_id: string; email: string | null }>).map(
        (p) => [p.user_id, p.email ?? '']
      )
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="최근 30일 비용 합계" value={fmtUsd(total)} />
        <Card title="이벤트 수" value={fmtInt(rows.length)} sub="최근 30일" />
        <Card title="고유 사용자" value={fmtInt(byUser.size)} sub="최근 30일" />
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
                  <span className="font-mono text-foreground/80">{fmtUsd(cost)}</span>
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
