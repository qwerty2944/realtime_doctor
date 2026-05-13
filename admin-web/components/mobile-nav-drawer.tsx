'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Drawer } from 'vaul';

const LINKS = [
  { href: '/install', label: '설치' },
  { href: '/guide', label: '사용법' },
  { href: '/login', label: '로그인' }
];

export function MobileNavDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} direction="right">
      <Drawer.Trigger asChild>
        <button
          type="button"
          aria-label="메뉴 열기"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border/50 bg-card/40 text-foreground/80 hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Drawer.Content className="fixed right-0 top-0 z-50 flex h-full w-[80vw] max-w-sm flex-col border-l border-border/40 bg-background outline-none">
          <Drawer.Title className="sr-only">메뉴</Drawer.Title>
          <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
            <span className="text-sm font-semibold">
              <span className="text-accent">●</span> Realtime Doctor
            </span>
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-foreground/60 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 px-3 py-4">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-base text-foreground/80 hover:bg-accent/10 hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-md bg-accent/15 px-3 py-3 text-base font-medium text-accent hover:bg-accent/25"
            >
              회원가입 →
            </Link>
          </nav>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
