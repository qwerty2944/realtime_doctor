'use client';

import { useState, Suspense, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { Spinner } from '@/components/spinner';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get('error');
  const next = params.get('next') ?? '/admin';

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const [err, setErr] = useState<string | null>(
    errorParam === 'forbidden' ? '관리자 권한이 없는 계정입니다.' : null
  );
  const busy = signingIn || navigating;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSigningIn(true);
    const supabase = getBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pw
    });
    if (error) {
      setSigningIn(false);
      setErr(error.message);
      return;
    }
    // 라우팅이 끝날 때까지 스피너 유지: signingIn은 그대로 두고
    // transition으로 감싸서 navigating까지 끝나면 페이지가 이동됨.
    startNavigation(() => {
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <div>
          <Link
            href="/"
            className="text-[11px] text-foreground/40 hover:text-foreground"
          >
            ← 메인
          </Link>
          <h1 className="mt-1 text-xl font-semibold">로그인</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Realtime Doctor 계정으로 로그인하세요.
          </p>
        </div>
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
              이메일
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
              비밀번호
            </label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          {err && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-background hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Spinner />}
            {signingIn ? '확인 중…' : navigating ? '이동 중…' : '로그인'}
          </button>
        </fieldset>
        <div className="text-center text-xs text-foreground/60">
          계정이 없으세요?{' '}
          <Link href="/signup" className="text-accent hover:underline">
            회원가입
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
