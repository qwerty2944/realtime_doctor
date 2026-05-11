import Link from 'next/link';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { costForRow, type UsageRow } from '@/lib/pricing';
import { fmtInt, fmtUsd, fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
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
  for (const r of eventRows) {
    costByUser.set(r.user_id, (costByUser.get(r.user_id) ?? 0) + costForRow(r));
    if (!lastTsByUser.has(r.user_id)) lastTsByUser.set(r.user_id, r.ts);
  }
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
      cost: costByUser.get(p.user_id) ?? 0
    }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">사용자</h1>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
