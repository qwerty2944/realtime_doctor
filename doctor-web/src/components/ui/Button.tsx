import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * TDS action hierarchy:
   * - `primary`   filled blue, white text — the one main action per screen.
   * - `secondary` weak blue (blue-50 bg, blue text) — supporting action.
   * - `text`      no fill — low-emphasis / tertiary action.
   * - `danger`    filled red — destructive confirmation.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner and disables the button while keeping its width, so a
   * submit cannot be fired twice and the layout does not jump.
   */
  loading?: boolean;
  /**
   * Square, icon-only button. `aria-label` becomes REQUIRED (an icon with no
   * text label is invisible to screen readers).
   */
  iconOnly?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-action text-white active:bg-action-pressed disabled:bg-line-default disabled:text-content-disabled',
  secondary:
    'bg-action-weak text-action active:bg-action-weak-pressed disabled:bg-surface-canvas disabled:text-content-disabled',
  text: 'bg-transparent text-action active:bg-action-weak disabled:bg-transparent disabled:text-content-disabled',
  danger:
    'bg-status-danger text-white active:bg-red-600 disabled:bg-line-default disabled:text-content-disabled',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  // Primary size (md) meets the ~48px minimum touch target.
  sm: 'h-9 px-3.5 t7 gap-1.5',
  md: 'h-12 px-5 t6 gap-2',
  lg: 'h-14 px-6 t5 gap-2',
};

const ICON_ONLY_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'size-9',
  md: 'size-12',
  lg: 'size-14',
};

/**
 * TDS action button. No emoji; pass a lucide icon via children (or as the sole
 * child with `iconOnly` + `aria-label`).
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconOnly = false,
  disabled,
  type,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  if (iconOnly && !rest['aria-label']) {
    // Fail loudly in dev rather than shipping an unlabeled icon button.
    throw new Error('Button: `iconOnly` requires an `aria-label`.');
  }

  const shape = iconOnly ? ICON_ONLY_SIZE_CLASS[size] : SIZE_CLASS[size];

  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'relative inline-flex items-center justify-center rounded-xl font-semibold',
        'transition-colors select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        shape,
        VARIANT_CLASS[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2
          aria-hidden="true"
          className="absolute size-5 animate-spin"
        />
      ) : null}
      {/* Keep children mounted (preserves width) but hidden while loading. */}
      <span
        className={[
          'inline-flex items-center justify-center gap-2',
          loading ? 'invisible' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </span>
    </button>
  );
}
