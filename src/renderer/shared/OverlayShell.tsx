import * as React from 'react';
import { Droplet, Minus, PictureInPicture2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  SHORTCUT_DEFAULTS,
  type OverlayKey,
  type ShortcutId,
  type WindowGroupInfo
} from '../../shared/types';
import { formatAccelerator } from './accelerator';
import { useT, type TKey } from './i18n';

interface OverlayShellProps {
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hideMinimize?: boolean;
  hideOpacity?: boolean;
  /**
   * 환자 모드에서 표시할 환자명. 어느 환자의 데이터를 보고 있는지 항상 보이게
   * 하는 안전장치라 탭 그룹으로 묶여 제목이 탭바로 바뀌어도 계속 표시한다.
   */
  patientName?: string;
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

/** 이 창의 WindowKey + 탭 그룹 상태 + 드래그 머지 호버 여부. */
function useWindowGroup(): {
  myKey: OverlayKey | null;
  group: WindowGroupInfo | null;
  mergeHover: boolean;
} {
  const [myKey, setMyKey] = React.useState<OverlayKey | null>(null);
  const [groups, setGroups] = React.useState<WindowGroupInfo[]>([]);
  const [hoverTarget, setHoverTarget] = React.useState<OverlayKey | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void window.api.getWindowKey().then((k) => {
      if (!cancelled) setMyKey(k);
    });
    void window.api.windowGroups.get().then((g) => {
      if (!cancelled) setGroups(g);
    });
    const offGroups = window.api.windowGroups.onChange(setGroups);
    const offHover = window.api.windowGroups.onHover(setHoverTarget);
    return () => {
      cancelled = true;
      offGroups();
      offHover();
    };
  }, []);

  const group = myKey
    ? groups.find((g) => g.tabs.includes(myKey)) ?? null
    : null;
  return { myKey, group, mergeHover: hoverTarget !== null && hoverTarget === myKey };
}

/** 머지된 창의 탭바 — 클릭 전환, 호버 시 분리 버튼. */
function TabStrip({ group }: { group: WindowGroupInfo }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" data-no-drag>
      {group.tabs.map((key) => {
        const active = key === group.active;
        return (
          <div
            key={key}
            className={cn('overlay-tab group/tab', active && 'overlay-tab-active')}
          >
            <button
              type="button"
              className="min-w-0 truncate"
              onClick={() => {
                if (!active) window.api.windowGroups.activate(key);
              }}
              title={t(`window.${key}` as TKey)}
            >
              {t(`window.${key}` as TKey)}
            </button>
            <button
              type="button"
              className="overlay-tab-detach opacity-0 group-hover/tab:opacity-100"
              title={t('tabs.detach')}
              onClick={(e) => {
                e.stopPropagation();
                window.api.windowGroups.detach(key);
              }}
            >
              <PictureInPicture2 className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
      {/* 남는 공간은 드래그 핸들로 유지 */}
      <div
        className="h-5 min-w-4 flex-1"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
    </div>
  );
}

function ShortcutHint({ shortcutId }: { shortcutId: ShortcutId }) {
  const [accel, setAccel] = React.useState<string>(SHORTCUT_DEFAULTS[shortcutId]);
  // 포커스된 창의 로컬 키 이벤트로 잡힌 상태와, 다른 창에서 메인을 통해 받은
  // 브로드캐스트 상태 둘 다 본다. 둘 중 하나라도 true 면 hint 를 띄운다.
  const [localHeld, setLocalHeld] = React.useState(false);
  const [remoteHeld, setRemoteHeld] = React.useState(false);
  const show = localHeld || remoteHeld;

  React.useEffect(() => {
    void window.api.shortcuts.get().then((map) => setAccel(map[shortcutId]));
    return window.api.shortcuts.onChange((map) => setAccel(map[shortcutId]));
  }, [shortcutId]);

  // 메인이 재방송하는 modifier 상태 구독 — 포커스가 다른 창에 있어도 받음.
  React.useEffect(() => {
    return window.api.modifier.onChange(setRemoteHeld);
  }, []);

  // 이 창에서 직접 잡히는 키 이벤트 → 로컬 즉시 표시 + 메인에 알려서 전 창에 전파.
  React.useEffect(() => {
    const publish = (held: boolean) => {
      setLocalHeld(held);
      window.api.modifier.setHeld(held);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) publish(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) publish(false);
    };
    // 포커스 잃으면 이 창 로컬은 끄지만, 메인의 hold 상태는 그대로 유지(다른 창이
    // 아직 누르고 있을 수 있음). 새 창 keydown 이 들어오기 전까지는 remoteHeld 만
    // 반영한다.
    const onBlur = () => setLocalHeld(false);
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
  patientName,
  shortcutId
}: OverlayShellProps) {
  const t = useT();
  const [focused, setFocused] = React.useState<boolean>(
    typeof document !== 'undefined' && document.hasFocus()
  );
  const { group, mergeHover } = useWindowGroup();

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
          mergeHover && 'overlay-merge-target',
          className
        )}
      >
        <div className="overlay-titlebar">
          {group ? (
            <TabStrip group={group} />
          ) : (
            <span className="flex-1 truncate">{title}</span>
          )}
          {patientName && (
            <span
              className="flex min-w-0 shrink items-center gap-1 rounded-md border border-emerald-400/50 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100"
              title={`${t('patient.modeBadge')} · ${patientName}`}
            >
              <UserRound className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{patientName}</span>
            </span>
          )}
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
