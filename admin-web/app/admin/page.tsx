import { getCookieSupabase } from '@/lib/supabase/ssr';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtDate, fmtInt, fmtUsd } from '@/lib/format';
import { DailyCostLine, ProviderCallsBar } from '@/components/usage-charts';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const DAYS = 30;

export default async function AdminOverview() {
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
    return <UserDashboard userId={user!.id} />;
  }

  return <AdminDashboard supabase={supabase} />;
}

// ──────────────────────────────────────────────────────────────
// 일반 사용자: 본인 진료 기록
// ──────────────────────────────────────────────────────────────

async function UserDashboard({ userId }: { userId: string }) {
  const supabase = await getCookieSupabase();

  const [{ data: sessions = [] }, { data: chunks = [] }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, started_at, ended_at, transcribe_provider, audio_path')
      .order('started_at', { ascending: false }),
    supabase
      .from('transcript_chunks')
      .select('session_id, text, timestamp_ms')
      .order('timestamp_ms', { ascending: true })
  ]);

  const sessionRows = (sessions ?? []) as Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    transcribe_provider: string | null;
    audio_path: string | null;
  }>;
  const chunkRows = (chunks ?? []) as Array<{
    session_id: string;
    text: string;
  }>;

  const byId = new Map<string, { count: number; first: string }>();
  for (const c of chunkRows) {
    const cur = byId.get(c.session_id);
    if (!cur) byId.set(c.session_id, { count: 1, first: c.text });
    else cur.count += 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">내 진료 기록</h1>
        <p className="mt-1 text-sm text-foreground/60">
          저장된 진료 세션을 시간순으로 확인할 수 있습니다.
        </p>
      </div>

      {sessionRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="text-sm text-foreground/70">아직 저장된 세션이 없습니다.</p>
          <p className="mt-2 text-xs text-foreground/50">
            앱에서 진료를 한 번 진행하면 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sessionRows.map((s) => {
            const meta = byId.get(s.id);
            return (
              <li key={s.id}>
                <Link
                  href={`/admin/users/${userId}/sessions/${s.id}`}
                  className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/60"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {fmtDate(s.started_at)}
                    </div>
                    <div className="text-[11px] text-foreground/50">
                      {meta?.count ?? 0} 발화
                      {s.audio_path ? ' · 음성 보관' : ''}
                    </div>
                  </div>
                  {meta?.first && (
                    <div className="mt-2 line-clamp-2 text-sm text-foreground/70">
                      {meta.first}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between text-[11px] text-foreground/40">
                    <span>
                      {s.ended_at ? '종료됨' : '진행 중'}
                    </span>
                    <span className="font-mono">{s.id.slice(0, 8)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
