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

interface OverlayShellProps {
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hideMinimize?: boolean;
  hideOpacity?: boolean;
}

function OpacityControl() {
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
        투명도 {Math.round(opacity * 100)}%
      </TooltipContent>
    </Tooltip>
  );
}

export function OverlayShell({
  title,
  badge,
  actions,
  children,
  className,
  hideMinimize = false,
  hideOpacity = false
}: OverlayShellProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('overlay-shell dark', className)}>
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
                title="최소화"
                className="h-7 w-7"
                onClick={() => window.api.minimizeWindow()}
              >
                <Minus />
              </Button>
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </TooltipProvider>
  );
}
