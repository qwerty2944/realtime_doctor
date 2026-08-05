'use client';

/**
 * 문진 화면 전용 프리미티브.
 *
 * righthand 의 디자인 토큰 시스템을 통째로 가져오는 대신, 이 흐름이 실제로
 * 쓰는 네 가지만 평범한 Tailwind 로 다시 만들었다. 이 앱의 화면은 넷뿐이라
 * 토큰 레이어가 벌어들일 복잡도가 없다.
 *
 * 공통 제약(고령 환자):
 *   - 터치 타깃 최소 56px (`min-h-touch`)
 *   - 본문 18px 이상 (globals.css 의 루트 폰트로 확보)
 *   - 상태를 색으로만 구분하지 않는다 — 텍스트나 아이콘을 함께 쓴다
 */

import { AlertCircle, LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const palette =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500'
      : 'bg-white text-slate-900 border-2 border-slate-300 hover:bg-slate-100 disabled:text-slate-400';

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`flex min-h-touch w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-xl font-semibold transition-colors disabled:cursor-not-allowed ${palette} ${className}`}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-6 animate-spin" /> : null}
      {children}
    </button>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, required, ...rest }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-lg font-semibold text-slate-800">
        {label}
        {/* 필수 표시는 색이 아니라 글자로. 색맹 환자에게도 읽혀야 한다. */}
        {required ? <span className="ml-2 text-base text-red-600">필수</span> : null}
      </label>
      <input
        {...rest}
        id={id}
        aria-describedby={[hint ? hintId : null, error ? errorId : null]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        className={`min-h-touch rounded-2xl border-2 bg-white px-4 py-3 text-xl text-slate-900 placeholder:text-slate-400 ${
          error ? 'border-red-500' : 'border-slate-300'
        }`}
      />
      {hint ? (
        <p id={hintId} className="text-base text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-base font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-3 rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-4 text-lg leading-relaxed text-red-800"
    >
      <AlertCircle aria-hidden="true" className="mt-1 size-6 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** AI 초안이지 진단이 아니라는 고지. 환자용 화면에도 계속 붙여둔다. */
export function DraftNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`text-base leading-relaxed text-slate-500 ${className}`}>
      문진 내용은 담당 의사의 진료 참고용 초안이며 진단이 아닙니다. 최종 판단은 의사가 합니다.
    </p>
  );
}
