import Link from 'next/link';

export function Nav({ email }: { email: string | null }) {
  const links = [
    { href: '/admin', label: '개요' },
    { href: '/admin/users', label: '사용자' },
    { href: '/admin/pricing', label: '가격' }
  ];
  return (
    <nav className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/admin" className="text-sm font-semibold">
          Realtime Doctor <span className="text-accent">Admin</span>
        </Link>
        <div className="flex flex-1 gap-4">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-foreground/70 hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <span className="text-xs text-foreground/50">{email ?? ''}</span>
        <form action="/api/auth/signout" method="post">
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
