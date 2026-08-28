'use client';

import { useState, Suspense, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { Spinner } from '@/components/spinner';

interface LoginFormProps {
  /** `?next=` 가 없을 때 로그인 후 갈 곳. */
  defaultNext: string;
  /** 회원가입 링크 노출 여부. */
  showSignup: boolean;
  /** '← 메인' 링크. null 이면 렌더링하지 않는다. */
  homeHref: string | null;
}

function LoginFormInner({ defaultNext, showSignup, homeHref }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get('error');
  const next = params.get('next') ?? defaultNext;

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
          {homeHref && (
            <Link
              href={homeHref}
              className="text-[11px] text-foreground/40 hover:text-foreground"
            >
              ← 메인
            </Link>
          )}
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
        {/* 회원가입 링크는 관리 호스트에서만 보인다. 의사는 데스크톱 앱에서
            이미 계정을 만들고 오므로, 결제 화면에서 가입을 권하면 계정이 갈라진다. */}
        {showSignup && (
          <div className="text-center text-xs text-foreground/60">
            계정이 없으세요?{' '}
            <Link href="/signup" className="text-accent hover:underline">
              회원가입
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}

/**
 * 로그인 폼 본체. 두 경로가 이것을 공유한다:
 *
 *   /login          운영자 진입점 (관리 화면 호스트에서만 도달한다)
 *   /billing/login  의사 진입점  (entanglecare.com/righthand/billing/login)
 *
 * 왜 두 경로인가: 의사에게 보이는 표면 전부가 `/billing/*` 한 접두사 아래에
 * 있으면 doctor-web 의 재작성 규칙이 그 접두사 하나로 끝난다. `/login` 을 따로
 * 재작성하면 브랜드 도메인의 루트 네임스페이스를 이 앱이 한 칸 더 점유하게 되고,
 * 그건 doctor-web 이 나중에 자기 `/login` 을 만들 때 조용히 충돌한다.
 *
 * 복제가 아니라 공유인 이유는 명백하다 -- 로그인 폼이 두 벌이면 한쪽만 고쳐진다.
 */
export function LoginForm(props: LoginFormProps) {
  return (
    <Suspense fallback={null}>
      <LoginFormInner {...props} />
    </Suspense>
  );
}
