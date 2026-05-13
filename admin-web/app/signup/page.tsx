'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim()) return setErr('이메일을 입력하세요.');
    if (pw.length < 6) return setErr('비밀번호는 6자 이상이어야 합니다.');
    if (pw !== pw2) return setErr('비밀번호 확인이 일치하지 않습니다.');

    setBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: pw
    });
    if (error) {
      setBusy(false);
      const m = error.message.toLowerCase();
      if (m.includes('user already registered'))
        setErr('이미 가입된 이메일입니다.');
      else if (m.includes('invalid email')) setErr('이메일 형식이 올바르지 않습니다.');
      else setErr(error.message);
      return;
    }
    if (!data.session) {
      // 즉시 세션 미발급 — 자격 그대로 로그인 시도
      const signIn = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pw
      });
      if (signIn.error) {
        setBusy(false);
        setErr(signIn.error.message);
        return;
      }
    }
    setBusy(false);
    router.replace('/admin');
    router.refresh();
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
          <h1 className="mt-1 text-xl font-semibold">회원가입</h1>
          <p className="mt-1 text-sm text-foreground/60">
            가입하면 본인 진료 기록이 안전하게 저장됩니다.
          </p>
        </div>
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
            autoComplete="new-password"
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="6자 이상"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
            비밀번호 확인
          </label>
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="다시 입력"
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
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-background hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? '처리 중…' : '회원가입'}
        </button>
        <div className="text-center text-xs text-foreground/60">
          이미 계정이 있으세요?{' '}
          <Link href="/login" className="text-accent hover:underline">
            로그인
          </Link>
        </div>
      </form>
    </div>
  );
}
