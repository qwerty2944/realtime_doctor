'use client';

/**
 * Email + password sign-in for physicians (spec section 1).
 *
 * Uses the browser Supabase client, which only ever holds the anon key. On success
 * the session cookie is set by @supabase/ssr and `router.refresh()` re-runs the
 * server components so the dashboard renders with the new session.
 */

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LogIn } from 'lucide-react';

import { Button, TextField } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const GENERIC_FAILURE = '이메일 또는 비밀번호를 확인해 주세요.';

export interface LoginFormProps {
  /** Path to return to after signing in. Already validated by the page. */
  next: string;
}

export default function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        // Deliberately generic: distinguishing "no such account" from "wrong
        // password" would confirm which addresses are registered physicians.
        console.error('[dashboard] Sign-in failed.', signInError);
        setError(GENERIC_FAILURE);
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (caught) {
      console.error('[dashboard] Sign-in request failed.', caught);
      setError('연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <TextField
        label="이메일"
        type="email"
        name="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <TextField
        label="비밀번호"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-danger bg-status-danger-weak px-3 py-2 t6 text-status-danger"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full">
        <LogIn aria-hidden="true" className="size-5" />
        {submitting ? '로그인 중' : '로그인'}
      </Button>
    </form>
  );
}
