import Link from 'next/link';
import { MobileNavDrawer } from './mobile-nav-drawer';

const NAV_LINKS = [
  { href: '/install', label: '설치' },
  { href: '/guide', label: '사용법' },
  { href: '/login', label: '로그인' }
];

export function PublicNav() {
  return (
    <header className="border-b border-border/40">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold md:text-lg">
          <span className="text-accent">●</span> Realtime Doctor
        </Link>

        {/* Desktop nav — md 이상에서만 inline */}
        <nav className="hidden items-center gap-5 text-sm text-foreground/70 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
          <Link
            href="/signup"
            className="rounded-md bg-accent/15 px-3 py-1.5 text-accent hover:bg-accent/25"
          >
            회원가입
          </Link>
        </nav>

        {/* Mobile — 햄버거 + drawer (< md) */}
        <div className="md:hidden">
          <MobileNavDrawer />
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-6 text-xs text-foreground/50 sm:flex-row sm:justify-between sm:px-6">
        <span className="text-center sm:text-left">
          © 2026 Realtime Doctor · 내부 사용 비공개 프로젝트
        </span>
        <div className="flex flex-wrap justify-center gap-4">
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
