'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/base-path';

export function Nav({
  email,
  isAdmin
}: {
  email: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const links = isAdmin
    ? [
        { href: '/admin', label: '개요' },
        { href: '/admin/users', label: '사용자' },
        { href: '/admin/pricing', label: '가격' }
      ]
    : [{ href: '/admin', label: '내 진료 기록' }];
  const isActive = (href: string) =>
    pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
  return (
    <nav className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/admin" className="text-sm font-semibold">
          리얼타임 닥터{' '}
          {isAdmin && <span className="text-accent">어드민</span>}
        </Link>
        <div className="flex flex-1 gap-4">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  // 같은 페이지를 다시 누르면 서버 데이터 새로고침
                  if (pathname === l.href) router.refresh();
                }}
                className={`text-sm transition-colors ${
                  active
                    ? 'font-semibold text-accent'
                    : 'text-foreground/70 hover:text-foreground'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <span className="text-xs text-foreground/50">{email ?? ''}</span>
        <form action={withBasePath('/api/auth/signout')} method="post">
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1 text-xs text-foreground/70 hover:bg-muted hover:text-foreground"
          >
            로그아웃
          </button>
        </form>
      </div>
    </nav>
  );
}
