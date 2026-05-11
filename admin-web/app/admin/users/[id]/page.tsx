import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServiceSupabase } from '@/lib/supabase/server';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtDate, fmtInt, fmtUsd } from '@/lib/format';
import { DailyCostLine, TaskCostBar } from '@/components/usage-charts';

export const dynamic = 'force-dynamic';

const DAYS = 30;

export default async function UserDetail({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceSupabase();

  const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(id);
  if (userErr || !userRes?.user) notFound();
  const user = userRes.user;

  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceIso = since.toISOString();

  const [{ data: events = [] }, { data: sessions = [] }] = await Promise.all([
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
      .from('sessions')
      .select('id, started_at, ended_at, transcribe_provider')
      .eq('user_id', id)
      .order('started_at', { ascending: false })
      .limit(100)
  ]);

  const rows = (events ?? []) as Array<UsageRow & { ts: string }>;
  const sessionRows = (sessions ?? []) as Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    transcribe_provider: string | null;
  }>;

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
        <h1 className="mt-1 text-lg font-semibold">{user.email}</h1>
        <p className="text-xs text-foreground/50">
          가입 {fmtDate(user.created_at)} · {user.id}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="최근 30일 비용" value={fmtUsd(total)} />
        <Card title="이벤트 수" value={fmtInt(rows.length)} sub="최근 30일" />
        <Card title="세션" value={fmtInt(sessionRows.length)} sub="전체" />
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

      <Section title="세션 (최근 100건)">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground/50">
                <th className="px-3 py-2 text-left">시작</th>
                <th className="px-3 py-2 text-left">종료</th>
                <th className="px-3 py-2 text-left">공급자</th>
                <th className="px-3 py-2 text-left font-mono">id</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-4 text-center text-foreground/50"
                  >
                    세션 없음
                  </td>
                </tr>
              )}
              {sessionRows.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2 text-foreground/80">
                    {fmtDate(s.started_at)}
                  </td>
                  <td className="px-3 py-2 text-foreground/60">
                    {fmtDate(s.ended_at)}
                  </td>
                  <td className="px-3 py-2 text-foreground/60">
                    {s.transcribe_provider ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-foreground/50">
                    {s.id.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
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
