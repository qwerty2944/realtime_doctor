/**
 * Shell for every signed-in dashboard screen.
 *
 * Lives in the `(app)` route group so that /righthand/doctor/login, which must render
 * for a visitor with no session, does not inherit the header or the auth check.
 *
 * `requireDoctor()` runs here rather than relying on the proxy: the proxy is an
 * optimistic navigation gate, this is the boundary that actually resolves identity
 * and provisions the `doctors` row every approval needs.
 */

import Link from 'next/link';
import { Stethoscope } from 'lucide-react';

import SignOutButton from '@/app/righthand/doctor/(app)/SignOutButton';
import DraftNotice from '@/components/DraftNotice';
import { requireDoctor } from '@/lib/auth/doctor';

export default async function DashboardAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const doctor = await requireDoctor();

  return (
    <div className="flex min-h-full flex-col bg-surface-canvas">
      <header className="border-b border-line-default bg-surface-default">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
          {/*
            No navigation: the web dashboard is a single statistics screen. The
            waiting list, session detail, settings and admin tools live in the
            native app.
          */}
          <Link
            href="/righthand/doctor/statistics"
            className="flex items-center gap-2 t5 font-semibold text-content-primary"
          >
            <Stethoscope aria-hidden="true" className="size-5 text-action" />
            진료실 통계
          </Link>

          <div className="flex items-center gap-3">
            <span className="t-meta text-content-tertiary">{doctor.name} 선생님</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Bottom padding clears the sticky notice so it never covers content. */}
      <div className="flex flex-1 flex-col pb-12">{children}</div>

      {/*
        Spec section 8: the draft notice must stay visible on every screen that
        shows AI output. Every screen in this group does, so it is pinned here
        rather than repeated per page where it could be forgotten.
      */}
      <DraftNotice variant="sticky" />
    </div>
  );
}
