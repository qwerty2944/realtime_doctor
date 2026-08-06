'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { AlertCircle } from 'lucide-react';

/** Props handed to the control so its a11y attributes stay in sync. */
export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

export interface FormFieldProps {
  label: string;
  /** Neutral helper text shown below the control when there is no error. */
  hint?: string;
  /**
   * Error message. Per the TDS rule it must state BOTH the cause and the fix,
   * e.g. "휴대폰 번호 11자리를 입력해 주세요" — never "오류가 발생했어요".
   */
  error?: string;
  required?: boolean;
  className?: string;
  /** Render-prop: spread `field` onto your control. */
  children: (field: FieldControlProps) => ReactNode;
}

/**
 * Label + control + message wrapper. Wires `id` / `aria-invalid` /
 * `aria-describedby` between the label, the control, and the message area so
 * screen readers announce the error against the right field.
 */
export default function FormField({
  label,
  hint,
  error,
  required = false,
  className = '',
  children,
}: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined;

  const field: FieldControlProps = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="t6 font-medium text-content-secondary">
        {label}
        {required ? <span className="ml-0.5 text-status-danger">*</span> : null}
      </label>

      {children(field)}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1 t7 text-status-danger"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="t7 text-content-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'aria-invalid' | 'aria-describedby'
  > {
  label: string;
  hint?: string;
  error?: string;
}

/** Box-style text input built on FormField. Usable by intake/dashboard forms. */
export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...inputProps
}: TextFieldProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required}>
      {(field) => (
        <input
          {...field}
          {...inputProps}
          required={required}
          className={[
            'h-12 w-full rounded-xl border bg-surface-default px-4 t5 text-content-primary',
            'placeholder:text-content-disabled',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
            error ? 'border-status-danger' : 'border-line-strong',
            'disabled:bg-surface-canvas disabled:text-content-disabled',
            className ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      )}
    </FormField>
  );
}
