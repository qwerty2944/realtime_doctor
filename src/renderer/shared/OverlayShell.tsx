import * as React from 'react';
import { Droplet, Minus, PictureInPicture2, Unlink, UserRound } from 'lucide-react';
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
  type SnapChoiceAction,
  type SnapChoicePrompt,
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

/**
 * 이 창이 가장자리 스냅 클러스터에 속해 있는가.
 *
 * 분리를 단축키에만 두면 붙어 있는 상태를 벗어나는 방법을 아무도 발견하지
 * 못한다 — 탭 그룹에는 이미 눈에 보이는 분리 버튼이 있으므로 스냅에도 같은
 * 수준의 affordance 를 둔다. 붙어 있지 않을 때는 아예 렌더하지 않는다.
 */
function useSnapped(myKey: OverlayKey | null): boolean {
  const [keys, setKeys] = React.useState<OverlayKey[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void window.api.windowSnaps.get().then((k) => {
      if (!cancelled) setKeys(k);
    });
    const off = window.api.windowSnaps.onChange(setKeys);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return myKey !== null && keys.includes(myKey);
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

/**
 * 겹쳐 놓은 드랍의 선택지 — 대상 창의 렌더러가 그린다.
 *
 * [왜 전용 창이 아니라 대상 창 안인가] 오버레이는 전부 OverlayShell 을 쓰므로
 * 여기 한 곳에 그리면 7개 창 전부가 대상이 될 수 있다. 새 BrowserWindow 를 띄우면
 * 엔트리·always-on-top 순서·위치 계산·수명주기가 통째로 따라오는데, 얻는 것은
 * "창 밖 클릭으로 닫기" 하나뿐이다. 그 하나는 Esc 와 새 드래그로 대체된다.
 *
 * 포커스는 훔치지 않는다 — main 은 broadcast 만 하고 focus() 하지 않으므로
 * 다른 곳에 타이핑하던 흐름이 끊기지 않는다.
 */
function useSnapChoice(): SnapChoicePrompt | null {
  const [prompt, setPrompt] = React.useState<SnapChoicePrompt | null>(null);
  React.useEffect(() => window.api.windowSnaps.choice.onPrompt(setPrompt), []);
  // 선택지가 떠 있는 동안에는 **모든** 오버레이가 Esc 를 듣는다 — 포커스가 어느
  // 창에 있든 취소할 수 있어야 하기 때문. (앱 밖에 포커스가 있으면 닿지 않는다.)
  React.useEffect(() => {
    if (!prompt) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.api.windowSnaps.choice.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [prompt]);
  return prompt;
}

function SnapChoiceOverlay({ prompt }: { prompt: SnapChoicePrompt }) {
  const t = useT();
  const cancel = () => window.api.windowSnaps.choice.cancel();
  const pick = (action: SnapChoiceAction) =>
    window.api.windowSnaps.choice.apply({
      dragged: prompt.dragged,
      target: prompt.target,
      action
    });

  const btn =
    'rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[11px] font-medium text-foreground/90 transition-colors hover:border-amber-300/70 hover:bg-amber-500/30';

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      // 패널 바깥(=이 창 안의 다른 곳) 클릭은 취소다.
      onMouseDown={cancel}
      data-no-drag
    >
      <div
        className="flex flex-col items-center gap-2 rounded-xl border border-amber-300/60 bg-neutral-900/95 px-3 py-2.5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-semibold text-amber-100">
          {t('snapChoice.title')}
        </div>
        <button type="button" className={btn} onClick={() => pick('top')}>
          {t('snapChoice.top')}
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} onClick={() => pick('left')}>
            {t('snapChoice.left')}
          </button>
          {prompt.canMerge && (
            <button type="button" className={btn} onClick={() => pick('merge')}>
              {t('snapChoice.merge')}
            </button>
          )}
          <button type="button" className={btn} onClick={() => pick('right')}>
            {t('snapChoice.right')}
          </button>
        </div>
        <button type="button" className={btn} onClick={() => pick('bottom')}>
          {t('snapChoice.bottom')}
        </button>
        <button
          type="button"
          className="mt-0.5 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={cancel}
        >
          {t('snapChoice.dismiss')}
        </button>
      </div>
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
  const { myKey, group, mergeHover } = useWindowGroup();
  const snapped = useSnapped(myKey);
  const snapChoice = useSnapChoice();
  const myChoice = snapChoice && myKey && snapChoice.target === myKey ? snapChoice : null;

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
          {/*
            분리 버튼은 타이틀바 **맨 앞**에 둔다.
            [왜 앞인가] 예전에는 오른쪽 끝(투명도 슬라이더·최소화 옆)에 아이콘만
            놓았다. 그 자리는 폭 280px 짜리 창에서 가장 먼저 눌리는 구간이고,
            테두리 없는 ghost 아이콘이라 옆의 최소화 버튼과 구별되지 않았다 —
            사용자가 "분리 버튼을 만들어 달라" 고 다시 요청한 이유다(버튼은 이미
            있었다). 앞쪽은 폭이 줄어도 마지막까지 남는 자리이고, 대신 제목이
            truncate 되므로 무엇도 잘리지 않는다.
            [왜 텍스트까지] 아이콘만으로는 "떼어내기" 를 읽어낼 수 없다. 스냅
            강조색(amber)과 같은 색을 써서 "붙어 있음" 표시와 짝을 이루게 한다.
          */}
          {snapped && myKey && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-no-drag
                  className="flex shrink-0 items-center gap-1 rounded-md border border-amber-400/70 bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-amber-500/45"
                  onClick={() => window.api.windowSnaps.detach(myKey)}
                >
                  <Unlink className="h-2.5 w-2.5 shrink-0" />
                  {t('snap.detachAction')}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('snap.detach')}</TooltipContent>
            </Tooltip>
          )}
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
          {/*
            붙어 있는 동안에는 투명도 슬라이더를 접는다. 타이틀바가 좁아서
            (최소 폭 280px) 분리 버튼과 슬라이더가 함께 들어가면 둘 다 눌린다 —
            둘 중 하나를 고른다면, 지금 당장 벗어나야 하는 상태(분리)가 취향
            조정(투명도)보다 급하다. 떼어내면 슬라이더는 곧바로 돌아온다.
          */}
          {!hideOpacity && !snapped && <OpacityControl />}
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
        {myChoice && <SnapChoiceOverlay prompt={myChoice} />}
      </div>
    </TooltipProvider>
  );
}
