import * as React from 'react';
import { Droplet, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SHORTCUT_DEFAULTS, type ShortcutId } from '../../shared/types';
import { formatAccelerator } from './accelerator';
import { useT } from './i18n';

interface OverlayShellProps {
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hideMinimize?: boolean;
  hideOpacity?: boolean;
  /** 이 창의 토글 단축키 id. 지정 시 Cmd/Ctrl 누르고 있을 때 hint 오버레이 표시. */
  shortcutId?: ShortcutId;
}

function OpacityControl() {
  const t = useT();
  const [opacity, setOpacity] = React.useState(1);

  React.useEffect(() => {
    let cancelled = false;
    window.api.getOpacity().then((v) => {
      if (!cancelled) setOpacity(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (next: number) => {
    setOpacity(next);
    window.api.setOpacity(next);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-1.5 py-1"
          data-no-drag
        >
          <Droplet className="h-2.5 w-2.5 text-muted-foreground" />
          <Slider
            className="w-14"
            value={[opacity]}
            min={0.2}
            max={1}
            step={0.05}
            onValueChange={(v) => onChange(v[0] ?? 1)}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t('common.opacity')} {Math.round(opacity * 100)}%
      </TooltipContent>
    </Tooltip>
  );
}

function ShortcutHint({ shortcutId }: { shortcutId: ShortcutId }) {
  const [accel, setAccel] = React.useState<string>(SHORTCUT_DEFAULTS[shortcutId]);
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    void window.api.shortcuts.get().then((map) => setAccel(map[shortcutId]));
    return window.api.shortcuts.onChange((map) => setAccel(map[shortcutId]));
  }, [shortcutId]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Mac 의 Cmd 또는 Win/Linux 의 Ctrl 만 holding → hint 표시.
      if (e.metaKey || e.ctrlKey) setShow(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) setShow(false);
    };
    const onBlur = () => setShow(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
      <div className="rounded-2xl border border-emerald-300/70 bg-black/55 px-6 py-3 font-mono text-3xl font-bold text-emerald-200 shadow-[0_0_24px_rgba(110,255,200,0.6)] backdrop-blur-sm">
        {formatAccelerator(accel)}
      </div>
    </div>
  );
}

export function OverlayShell({
  title,
  badge,
  actions,
  children,
  className,
  hideMinimize = false,
  hideOpacity = false,
  shortcutId
}: OverlayShellProps) {
  const t = useT();
  const [focused, setFocused] = React.useState<boolean>(
    typeof document !== 'undefined' && document.hasFocus()
  );

  React.useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          'relative overlay-shell dark',
          focused && 'overlay-focused',
          className
        )}
      >
        <div className="overlay-titlebar">
          <span className="flex-1 truncate">{title}</span>
          {badge}
          {actions}
          {!hideOpacity && <OpacityControl />}
          {!hideMinimize && (
            <div className="flex items-center" data-no-drag>
              <Button
                size="icon"
                variant="ghost"
                title={t('common.minimize')}
                className="h-7 w-7"
                onClick={() => window.api.minimizeWindow()}
              >
                <Minus />
              </Button>
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        {shortcutId && <ShortcutHint shortcutId={shortcutId} />}
      </div>
    </TooltipProvider>
  );
}
