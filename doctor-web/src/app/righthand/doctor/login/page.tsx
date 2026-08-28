import { Stethoscope } from 'lucide-react';

import LoginForm from '@/app/righthand/doctor/login/LoginForm';

/** Kept in sync with `DASHBOARD_HOME_PATH` in `@/lib/auth/doctor` (server-only module). */
const DASHBOARD_HOME_PATH = '/righthand/doctor';

// noindex in addition to the robots.txt disallow: a disallowed URL can still be
// indexed from an inbound link, and a login wall is not a search result we want.
export const metadata = {
  title: '의료진 로그인',
  robots: { index: false, follow: false },
};

/**
 * Reject anything that is not a local dashboard path.
 *
 * `next` comes from the query string, so without this an emailed link could bounce
 * a doctor to an external site immediately after a successful sign-in.
 */
function safeNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return DASHBOARD_HOME_PATH;
  if (!value.startsWith(DASHBOARD_HOME_PATH)) return DASHBOARD_HOME_PATH;
  // Protocol-relative URLs ("//evil.example") also start with a slash.
  if (value.startsWith('//')) return DASHBOARD_HOME_PATH;
  return value;
}

export default async function DashboardLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-surface-canvas px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-8 rounded-2xl bg-surface-default p-8 shadow-sm">
        <header className="flex flex-col items-center gap-2 text-center">
          <Stethoscope aria-hidden="true" className="size-8 text-action" />
          <h1 className="t3 font-semibold text-content-primary">진료실 대시보드</h1>
          <p className="t6 text-content-tertiary">의료진 계정으로 로그인해 주세요.</p>
        </header>

        <LoginForm next={safeNext(params.next)} />
      </div>
    </main>
  );
}
