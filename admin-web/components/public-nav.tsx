import Link from 'next/link';

export function PublicNav() {
  return (
    <header className="border-b border-border/40">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-accent">●</span> Realtime Doctor
        </Link>
        <nav className="flex items-center gap-5 text-sm text-foreground/70">
          <Link href="/install" className="hover:text-foreground">
            설치
          </Link>
          <Link href="/guide" className="hover:text-foreground">
            사용법
          </Link>
          <Link
            href="/login"
            className="text-foreground/50 hover:text-foreground"
          >
            로그인
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-foreground/50">
        <span>© 2026 Realtime Doctor · 내부 사용 비공개 프로젝트</span>
        <div className="flex gap-4">
          <Link href="/install" className="hover:text-foreground">
            설치
          </Link>
          <Link href="/guide" className="hover:text-foreground">
            사용법
          </Link>
          <Link href="/login" className="hover:text-foreground">
            로그인
          </Link>
        </div>
      </div>
    </footer>
  );
}
