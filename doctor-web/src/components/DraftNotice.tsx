import { Info } from 'lucide-react';

const NOTICE_TEXT = '본 내용은 의사 참고용 초안이며 진단이 아닙니다';

export interface DraftNoticeProps {
  /**
   * `banner`   - full width block, for the top of a results page.
   * `inline`   - compact single line, for placing under a card or tab.
   * `sticky`   - pinned to the bottom of the viewport so it stays visible.
   */
  variant?: 'banner' | 'inline' | 'sticky';
  className?: string;
}

/**
 * Persistent notice required on every screen that shows AI output (spec section 8).
 * Icon only, no emoji.
 */
export default function DraftNotice({
  variant = 'banner',
  className = '',
}: DraftNoticeProps) {
  const base =
    'flex items-center gap-2 border border-status-warning bg-status-warning-weak text-orange-900';

  const byVariant: Record<NonNullable<DraftNoticeProps['variant']>, string> = {
    banner: 'w-full rounded-md px-4 py-3 text-sm',
    inline: 'rounded px-3 py-2 text-xs',
    sticky:
      'fixed inset-x-0 bottom-0 z-50 justify-center rounded-none px-4 py-2 text-xs shadow-[0_-1px_3px_rgba(0,0,0,0.08)]',
  };

  return (
    <div
      role="note"
      aria-label="AI 초안 고지"
      className={`${base} ${byVariant[variant]} ${className}`.trim()}
    >
      <Info aria-hidden="true" className="size-4 shrink-0" />
      <span>{NOTICE_TEXT}</span>
    </div>
  );
}

export { NOTICE_TEXT };
