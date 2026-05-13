import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { requireAdmin } from '@/lib/admin-gate';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtDate, fmtDuration, fmtInt, fmtUsd } from '@/lib/format';
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

  const [
    { data: events = [] },
    { data: lifetimeEventsRows = [] },
    { count: chunkCount = 0 },
    { count: analysisCount = 0 },
    { count: summaryCount = 0 },
    { count: dictationCount = 0 },
    { data: recentEventsRows = [] },
    allCards,
    filteredCards
  ] = await Promise.all([
    supabase
      .from('usage_events')
      .select(
        'ts, provider, task, model, prompt_tokens, output_tokens, total_tokens, chars, duration_ms'
      )
      .eq('user_id', id)
      .gte('ts', sinceIso)
      .order('ts', { ascending: false })
      .limit(20_000),
    supabase
      .from('usage_events')
      .select('provider, task, model, prompt_tokens, output_tokens, total_tokens, chars, duration_ms')
      .eq('user_id', id)
      .limit(50_000),
    supabase
      .from('transcript_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id),
    supabase
      .from('analyses')
      .select('session_id', { count: 'exact', head: true })
      .eq('user_id', id),
    supabase
      .from('summaries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id),
    supabase
      .from('dictations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id),
    supabase
      .from('usage_events')
      .select('ts, provider, task, model, prompt_tokens, output_tokens, total_tokens, chars, duration_ms')
      .eq('user_id', id)
      .order('ts', { ascending: false })
      .limit(50),
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

  const lifetimeRows = (lifetimeEventsRows ?? []) as UsageRow[];
  const lifetimeCost = lifetimeRows.reduce((s, r) => s + costForRow(r), 0);
  const lifetimeTokens = lifetimeRows.reduce(
    (s, r) => s + ((r.total_tokens as number | null | undefined) ?? 0),
    0
  );
  const lifetimeDurationMs = lifetimeRows.reduce(
    (s, r) => s + ((r.duration_ms as number | null | undefined) ?? 0),
    0
  );

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

  const byProvider = new Map<string, { calls: number; cost: number }>();
  for (const r of lifetimeRows) {
    const cur = byProvider.get(r.provider) ?? { calls: 0, cost: 0 };
    cur.calls += 1;
    cur.cost += costForRow(r);
    byProvider.set(r.provider, cur);
  }
  const providerStats = Array.from(byProvider, ([provider, v]) => ({ provider, ...v })).sort(
    (a, b) => b.cost - a.cost
  );

  const byModel = new Map<string, { calls: number; cost: number; tokens: number }>();
  for (const r of lifetimeRows) {
    const key = r.model || '—';
    const cur = byModel.get(key) ?? { calls: 0, cost: 0, tokens: 0 };
    cur.calls += 1;
    cur.cost += costForRow(r);
    cur.tokens += ((r.total_tokens as number | null | undefined) ?? 0);
    byModel.set(key, cur);
  }
  const modelStats = Array.from(byModel, ([model, v]) => ({ model, ...v })).sort(
    (a, b) => b.cost - a.cost
  );

  const recentEvents = (recentEventsRows ?? []) as Array<UsageRow & { ts: string }>;

  const firstSessionAt = allCards.length > 0
    ? allCards.reduce((min, c) => (new Date(c.started_at) < min ? new Date(c.started_at) : min), new Date())
    : null;
  const lastSessionAt = allCards.length > 0
    ? allCards.reduce((max, c) => (new Date(c.started_at) > max ? new Date(c.started_at) : max), new Date(0))
    : null;

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
          가입 {fmtDate(user.created_at)}
          {firstSessionAt && (
            <> · 첫 세션 {fmtDate(firstSessionAt.toISOString())}</>
          )}
          {' · '}
          <span className="font-mono">{user.user_id}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title="최근 30일 비용" value={fmtUsd(total)} sub={`이벤트 ${fmtInt(rows.length)}`} />
        <Card title="누적 비용" value={fmtUsd(lifetimeCost)} sub={`이벤트 ${fmtInt(lifetimeRows.length)}`} />
        <Card title="총 토큰" value={fmtInt(lifetimeTokens)} sub="모든 LLM 호출" />
        <Card title="총 처리 시간" value={fmtDuration(lifetimeDurationMs)} sub="duration_ms 합계" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card title="세션" value={fmtInt(allCards.length)} sub={lastSessionAt ? `마지막 ${fmtDate(lastSessionAt.toISOString())}` : '—'} />
        <Card title="발화 청크" value={fmtInt(chunkCount ?? 0)} />
        <Card title="분석" value={fmtInt(analysisCount ?? 0)} />
        <Card title="임상 노트" value={fmtInt(summaryCount ?? 0)} />
        <Card title="받아쓰기" value={fmtInt(dictationCount ?? 0)} />
      </div>

      <Section title="일별 비용 (USD, 최근 30일)">
        <DailyCostLine data={lineData} />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="task별 비용 (최근 30일)">
          {taskBar.length === 0 ? (
            <p className="text-sm text-foreground/60">데이터 없음</p>
          ) : (
            <TaskCostBar data={taskBar} />
          )}
        </Section>

        <Section title="공급자별 (누적)">
          {providerStats.length === 0 ? (
            <p className="text-sm text-foreground/60">데이터 없음</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {providerStats.map((p) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <span className="font-mono text-foreground/80">{p.provider}</span>
                  <span className="flex items-center gap-3 text-foreground/70">
                    <span className="text-[11px] text-foreground/50">호출 {fmtInt(p.calls)}</span>
                    <span className="font-mono">{fmtUsd(p.cost)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="모델별 (누적)">
        {modelStats.length === 0 ? (
          <p className="text-sm text-foreground/60">데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-foreground/50">
                  <th className="px-2 py-1.5">모델</th>
                  <th className="px-2 py-1.5 text-right">호출</th>
                  <th className="px-2 py-1.5 text-right">토큰</th>
                  <th className="px-2 py-1.5 text-right">비용</th>
                </tr>
              </thead>
              <tbody>
                {modelStats.map((m) => (
                  <tr key={m.model} className="border-t border-border/40">
                    <td className="px-2 py-1.5 font-mono text-foreground/80">{m.model}</td>
                    <td className="px-2 py-1.5 text-right">{fmtInt(m.calls)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtInt(m.tokens)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtUsd(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="최근 활동 (이벤트 50건)">
        {recentEvents.length === 0 ? (
          <p className="text-sm text-foreground/60">데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-foreground/50">
                  <th className="px-2 py-1.5">시각 (KST)</th>
                  <th className="px-2 py-1.5">공급자</th>
                  <th className="px-2 py-1.5">task</th>
                  <th className="px-2 py-1.5">모델</th>
                  <th className="px-2 py-1.5 text-right">입력 토큰</th>
                  <th className="px-2 py-1.5 text-right">출력 토큰</th>
                  <th className="px-2 py-1.5 text-right">처리 ms</th>
                  <th className="px-2 py-1.5 text-right">비용</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((r, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-foreground/70">
                      {fmtDate(r.ts)}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-foreground/80">{r.provider}</td>
                    <td className="px-2 py-1.5 text-foreground/80">{r.task}</td>
                    <td className="px-2 py-1.5 font-mono text-foreground/70">{r.model}</td>
                    <td className="px-2 py-1.5 text-right">{fmtInt(r.prompt_tokens ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtInt(r.output_tokens ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtInt(r.duration_ms ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtUsd(costForRow(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
