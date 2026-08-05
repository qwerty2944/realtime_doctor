import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  CreditCard,
  // Check, // (주석 처리된 provider 다이얼로그에서만 사용)
  Eye,
  EyeOff,
  FileText,
  Globe,
  HelpCircle,
  Keyboard,
  LayoutGrid,
  LogOut,
  Mic,
  MonitorSmartphone,
  NotebookPen,
  Power,
  Save,
  // SlidersHorizontal, // (주석 처리된 provider 다이얼로그용)
  Star,
  StarOff,
  Trash2,
  UserRound,
  Users
} from 'lucide-react';
import {
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  TRIAL_BANNER_DAYS,
  type Language,
  type ShortcutId,
  type SubscriptionState,
  type SubscriptionStatus
} from '../../shared/types';
import { accelFromEvent, formatAccelerator } from '../shared/accelerator';
import { useT } from '../shared/i18n';

type AuthMode = 'login' | 'signup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { OverlayShell } from '../shared/OverlayShell';
import { CareActivityReportDialog } from './CareActivityReportDialog';
import { CareActivityReviewDialog } from './CareActivityReviewDialog';
import { VisitCodeDialog } from './VisitCodeDialog';
import { cn } from '@/lib/utils';
import type {
  AuthState,
  CloudSyncSettings,
  DeviceInfo,
  DeviceLimitNotice,
  LocalSaveSettings
} from '../../shared/types';

interface WindowState {
  key: string;
  title: string;
  minimized: boolean;
  visible: boolean;
  opacity: number;
}

interface LayoutInfo {
  name: string;
  builtin: boolean;
  isDefault: boolean;
}

const ORDER = [
  'transcript',
  'diagnosis',
  'terms',
  'questions',
  'summary',
  'dictation',
  'patients'
];

const META: Record<
  string,
  { tkey: import('../shared/i18n').TKey; Icon: React.ComponentType<{ className?: string }> }
> = {
  transcript: { tkey: 'window.transcript', Icon: Mic },
  diagnosis: { tkey: 'window.diagnosis', Icon: Activity },
  terms: { tkey: 'window.terms', Icon: BookOpen },
  questions: { tkey: 'window.questions', Icon: HelpCircle },
  summary: { tkey: 'window.summary', Icon: FileText },
  dictation: { tkey: 'window.dictation', Icon: NotebookPen },
  patients: { tkey: 'window.patients', Icon: Users }
};

const TOGGLE_ID: Record<string, ShortcutId> = {
  transcript: 'toggleTranscript',
  diagnosis: 'toggleDiagnosis',
  terms: 'toggleTerms',
  questions: 'toggleQuestions',
  summary: 'toggleSummary',
  dictation: 'toggleDictation',
  patients: 'togglePatients'
};

const BUILTIN_LABELS: Record<string, string> = {
  'right-stack': '우측 스택 (기본)',
  'left-stack': '좌측 스택',
  'wide-grid': '상단 격자',
  'corner-compact': '컴팩트 코너'
};

function layoutLabel(name: string): string {
  return BUILTIN_LABELS[name] ?? name;
}

const SUB_STATUS_TKEY: Record<SubscriptionStatus, import('../shared/i18n').TKey> = {
  trialing: 'sub.statusTrialing',
  active: 'sub.statusActive',
  past_due: 'sub.statusPastDue',
  expired: 'sub.statusExpired',
  canceled: 'sub.statusCanceled',
  none: 'sub.statusNone',
  'signed-out': 'sub.statusSignedOut',
  unknown: 'sub.statusUnknown'
};

/**
 * 배너를 띄울 상황인지.
 *
 * 계획서: 체험 만료 D-7 부터, 그리고 만료/결제실패 때. 정상 구독 중에는 아무
 * 것도 띄우지 않는다 — 상시 배너는 곧 무시된다.
 */
function subBannerKey(
  s: SubscriptionState | null
): import('../shared/i18n').TKey | null {
  if (!s) return null;
  if (s.status === 'signed-out') return 'sub.bannerSignedOut';
  if (!s.entitled) {
    // 네트워크 문제로 확인을 못 한 것과 실제 만료를 구분해서 말한다.
    if (s.offline || s.status === 'unknown') return 'sub.bannerOffline';
    return 'sub.bannerExpired';
  }
  if (s.status === 'past_due') return 'sub.bannerPastDue';
  if (
    s.status === 'trialing' &&
    s.daysRemaining !== null &&
    s.daysRemaining <= TRIAL_BANNER_DAYS
  )
    return 'sub.bannerTrialEnding';
  return null;
}

export default function DockApp() {
  const t = useT();
  const [states, setStates] = useState<WindowState[]>([]);
  const [layouts, setLayouts] = useState<LayoutInfo[]>([]);
  const [defaultLayout, setDefaultLayoutName] = useState<string>('');
  // provider 선택은 이제 언어가 결정. UI 는 주석 처리됨. (디버깅용으로 IPC 호출은 유지)
  // const [providers, setProviders] = useState<TranscribeProviderInfo[]>([]);
  // const [provider, setProvider] = useState<TranscribeProviderId>('gemini');
  // const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [language, setLanguageState] = useState<Language | null | undefined>(undefined);
  const [authState, setAuthState] = useState<AuthState>({ status: 'signed-out' });
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [emailInput, setEmailInput] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudSyncSettings>({
    enabled: false,
    saveTranscripts: false,
    saveAudio: false
  });
  const [localSave, setLocalSaveState] = useState<LocalSaveSettings>({
    enabled: true,
    saveAudio: false
  });
  // 구독 (S2). main 이 서명 토큰을 검증한 결과만 받아 보여준다 — 렌더러는
  // 판정에 관여하지 않는다.
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  /** 잠긴 상태에서 기능 호출이 막혔을 때 표시할 안내. */
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [deviceBusy, setDeviceBusy] = useState<string | null>(null);
  /**
   * 기기 수 한도 초과 (S5). 서버가 등록을 거부하면서 준 목록을 그대로 띄운다.
   * 선택을 앱 안에서 받는 이유: 이 순간 의사는 **새 기기 앞에 서 있다.** 브라우저를
   * 열어 다시 로그인하게 만드는 것은 가장 마찰이 큰 지점에 마찰을 더하는 일이다.
   */
  const [deviceLimit, setDeviceLimit] = useState<DeviceLimitNotice | null>(null);
  const [deviceLimitError, setDeviceLimitError] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Record<ShortcutId, string>>(
    SHORTCUT_DEFAULTS
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  // Dock 창이 작아서 dropdown/dialog 가 잘리지 않게, 어느 팝오버라도 열려 있는
  // 동안은 dock window 를 일시적으로 크게 확장한다. 여러 개가 동시에 열려도
  // 마지막이 닫힐 때만 줄어들도록 ref-count.
  const popoverCountRef = useRef(0);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const onPopoverOpenChange = useCallback((open: boolean) => {
    const prev = popoverCountRef.current;
    const next = Math.max(0, prev + (open ? 1 : -1));
    popoverCountRef.current = next;
    setPopoverOpen(next > 0);
    if (prev === 0 && next > 0) window.api.popoverEnter();
    else if (prev > 0 && next === 0) window.api.popoverLeave();
  }, []);

  const refresh = useCallback(async () => {
    const [s, l, d, a, c, sc, lang, ls] = await Promise.all([
      window.api.listWindowStates(),
      window.api.listLayouts(),
      window.api.getDefaultLayout(),
      window.api.auth.getState(),
      window.api.cloudSync.get(),
      window.api.shortcuts.get(),
      window.api.language.get(),
      window.api.localSave.get()
    ]);
    setStates(s);
    setLayouts(l);
    setDefaultLayoutName(d);
    setAuthState(a);
    setCloud(c);
    setShortcuts(sc);
    setLanguageState(lang);
    setLocalSaveState(ls);
  }, []);

  useEffect(() => {
    void refresh();
    const offWindows = window.api.onWindowsStateChange((payload) => setStates(payload));
    const offAuth = window.api.auth.onStateChange((s) => {
      setAuthState(s);
      if (s.status === 'signed-in') {
        setEmailInput('');
        setPwInput('');
        setPwConfirm('');
        setAuthError(null);
      }
    });
    const offShortcuts = window.api.shortcuts.onChange((map) => setShortcuts(map));
    const offLang = window.api.language.onChange((l) => setLanguageState(l));
    const offFocus = window.api.onWindowFocusChange((key) => setFocusedKey(key));
    void window.api.subscription.get().then(setSub).catch(() => {});
    const offSub = window.api.subscription.onChange((s) => {
      setSub(s);
      if (s.entitled) setBlockedMsg(null);
    });
    const offBlocked = window.api.subscription.onBlocked((n) => {
      setBlockedMsg(n.message);
      setSub(n.state);
    });
    const offRevoked = window.api.devices.onRevokedNotice(({ message }) => {
      // main 이 보낸 메시지를 그대로 표시 (effect 의존성에 t 를 넣으면
      // 렌더마다 재구독+refresh 루프가 생기므로 고정 fallback 사용).
      setAuthError(message || '이 기기의 접근이 차단되어 로그아웃되었습니다.');
      setAccountOpen(true);
    });
    const offLimit = window.api.devices.onLimitExceeded((notice) => {
      setDeviceLimitError(null);
      setDeviceLimit(notice);
    });
    return () => {
      offWindows();
      offAuth();
      offShortcuts();
      offLang();
      offFocus();
      offSub();
      offBlocked();
      offRevoked();
      offLimit();
    };
  }, [refresh]);

  // 앱 시작 시 자동으로 계정 다이얼로그를 띄우지 않는다 — 사용자가 직접 계정
  // 아이콘을 눌러서 로그인/회원가입 하도록 한다. (이전엔 로그아웃 상태에서 강제
  // 오픈했지만, 앱 켤 때마다 큰 다이얼로그가 뜨는 게 거슬려서 제거.)

  const handleSignIn = async () => {
    setAuthError(null);
    if (!emailInput.trim()) {
      setAuthError(t('auth.errorEmailRequired'));
      return;
    }
    if (!pwInput) {
      setAuthError(t('auth.errorPasswordRequired'));
      return;
    }
    setAuthBusy(true);
    try {
      const res = await window.api.auth.signIn(emailInput.trim(), pwInput);
      if (!res.ok) setAuthError(res.error ?? t('auth.errorLoginFailed'));
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignUp = async () => {
    setAuthError(null);
    if (!emailInput.trim()) {
      setAuthError(t('auth.errorEmailRequired'));
      return;
    }
    if (pwInput.length < 6) {
      setAuthError(t('auth.errorPasswordTooShort'));
      return;
    }
    if (pwInput !== pwConfirm) {
      setAuthError(t('auth.errorPasswordMismatch'));
      return;
    }
    setAuthBusy(true);
    try {
      const res = await window.api.auth.signUp(emailInput.trim(), pwInput);
      if (!res.ok) setAuthError(res.error ?? t('auth.errorSignupFailed'));
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    await window.api.auth.signOut();
    setAuthBusy(false);
  };

  const updateCloud = async (patch: Partial<CloudSyncSettings>) => {
    const next = await window.api.cloudSync.set(patch);
    setCloud(next);
  };

  const updateLocalSave = async (patch: Partial<LocalSaveSettings>) => {
    const next = await window.api.localSave.set(patch);
    setLocalSaveState(next);
  };

  // 계정 다이얼로그가 열릴 때마다 기기 목록 새로고침.
  useEffect(() => {
    if (!accountOpen || authState.status !== 'signed-in') return;
    setDevices(null);
    void window.api.devices.list().then(setDevices);
  }, [accountOpen, authState.status]);

  const revokeDevice = async (d: DeviceInfo) => {
    const msg = d.isCurrent
      ? t('dock.deviceRevokeSelfConfirm')
      : t('dock.deviceRevokeConfirm');
    if (!confirm(msg)) return;
    setDeviceBusy(d.id);
    try {
      await window.api.devices.revoke(d.id);
      setDevices(await window.api.devices.list());
    } finally {
      setDeviceBusy(null);
    }
  };

  /**
   * 한도 초과 화면에서 기기 하나를 내리고 이 기기를 등록한다 (S5).
   * 해지와 재등록은 main 에서 한 호출로 묶여 있다 -- 사이가 벌어지면 그 틈에
   * 다른 기기가 들어와 다시 한도에 걸린다.
   */
  const releaseDevice = async (d: DeviceInfo) => {
    setDeviceBusy(d.id);
    setDeviceLimitError(null);
    try {
      const res = await window.api.devices.releaseAndRegister(d.id);
      if (res.ok) {
        setDeviceLimit(null);
        setDevices(null);
      } else {
        setDeviceLimitError(res.error ?? t('dock.deviceLimitFailed'));
      }
    } finally {
      setDeviceBusy(null);
    }
  };

  // 언어가 provider 를 결정. UI 에서 manual 선택은 노출하지 않음.
  // const chooseProvider = async (id: TranscribeProviderId) => {
  //   const next = await window.api.setTranscribeProvider(id);
  //   setProvider(next);
  // };

  const pickLanguage = (l: Language) => {
    void window.api.language.set(l);
  };

  const stateOf = (key: string) => states.find((s) => s.key === key);
  const mainStates = ORDER.map((k) => stateOf(k)).filter(
    (s): s is WindowState => !!s
  );
  const allMinimized =
    mainStates.length > 0 && mainStates.every((s) => s.minimized || !s.visible);

  const applyLayout = async (name: string) => {
    await window.api.applyLayout(name);
  };

  const saveCurrentAs = async () => {
    const name = window.prompt('저장할 레이아웃 이름');
    if (!name?.trim()) return;
    const list = await window.api.saveCurrentLayout(name.trim());
    setLayouts(list);
  };

  const deleteCustom = async (name: string) => {
    if (!confirm(`'${name}' 레이아웃을 삭제하시겠어요?`)) return;
    const list = await window.api.deleteLayout(name);
    setLayouts(list);
  };

  const setAsDefault = async (name: string | null) => {
    const list = await window.api.setDefaultLayout(name);
    setLayouts(list);
    setDefaultLayoutName(name ?? '');
  };

  const builtins = layouts.filter((l) => l.builtin);
  const customs = layouts.filter((l) => !l.builtin);
  const bannerKey = subBannerKey(sub);
  const subLabel = sub ? t(SUB_STATUS_TKEY[sub.status]) : t('common.loading');
  // 남은 일수는 체험/구독 모두에 의미가 있으므로 상태와 함께 붙인다.
  const subDays =
    sub && sub.entitled && sub.daysRemaining !== null
      ? sub.daysRemaining <= 0
        ? t('sub.lastDay')
        : `${sub.daysRemaining}${t('sub.daysLeftSuffix')}`
      : null;

  // IPC 응답 전(undefined)에만 빈 화면. 첫 실행에도 언어를 묻지 않고 바로 dock 을
  // 띄운다 (main 이 기본값 'ko' 를 보장).
  if (language === undefined) {
    return <OverlayShell title="Dock" hideOpacity hideMinimize><div /></OverlayShell>;
  }
  // 안전망: main 이 어떤 이유로든 언어를 못 돌려주면(null) 선택 화면을 띄운다.
  // 정상 동작에서는 도달하지 않으며, 도달하더라도 언어를 고르면 바로 진행된다.
  if (language === null) {
    return (
      <OverlayShell title="Dock" hideOpacity hideMinimize>
        <LanguagePicker onPick={pickLanguage} />
      </OverlayShell>
    );
  }

  return (
    <OverlayShell
      title="Dock"
      shortcutId="toggleAll"
      className={popoverOpen ? '!h-fit !shadow-none' : undefined}
    >
      {/* 구독 배너 — D-7 / 만료 / 결제실패 / 차단 안내. 정상 구독 중엔 없다. */}
      {(bannerKey || blockedMsg) && (
        <div
          className={cn(
            'flex items-center gap-2 border-b px-3 py-2 text-[11px]',
            sub?.entitled
              ? 'border-amber-400/30 bg-amber-500/15 text-amber-100'
              : 'border-rose-400/30 bg-rose-500/15 text-rose-100'
          )}
        >
          <span className="flex-1 leading-snug">
            {blockedMsg ?? (bannerKey ? t(bannerKey) : '')}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => void window.api.subscription.openBilling()}
          >
            {t('sub.subscribe')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => window.api.toggleAllWindows()}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
                // 개별 창 버튼(emerald 시안 계열)과 의미가 다르므로 amber/주황 톤으로 구분.
                // amber = "전체 보기" 액션, emerald = "개별 창 활성".
                allMinimized
                  ? 'border-white/10 bg-white/5 text-foreground/50 hover:bg-white/10'
                  : 'border-amber-400/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
              )}
            >
              {allMinimized ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span>{t('dock.toggleAll')}</span>
              <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">
                {formatAccelerator(shortcuts.toggleAll)}
              </kbd>
            </div>
          </TooltipContent>
        </Tooltip>

        <div className="flex flex-wrap items-center justify-center gap-1">
          {ORDER.map((k) => {
            const s = stateOf(k);
            if (!s) return null;
            const m = META[k];
            const Icon = m.Icon;
            const minimized = s.minimized || !s.visible;
            const isFocused = focusedKey === k;
            const accel = shortcuts[TOGGLE_ID[k]];
            return (
              <Tooltip key={k}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => window.api.toggleWindow(k)}
                    className={cn(
                      'dock-button flex h-9 w-9 items-center justify-center rounded-md border transition-all',
                      minimized
                        ? 'border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10'
                        : 'dock-button-visible',
                      isFocused && 'dock-button-focused'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span>{t(m.tkey)}</span>
                    <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">
                      {formatAccelerator(accel)}
                    </kbd>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* 방문 코드 발급 (L1). 접수처가 하루에 수십 번 누르는 버튼이라
            설정 안쪽이 아니라 dock 표면에 둔다 — 두 번 클릭이 되는 순간
            "그냥 슬러그로 열어두자" 가 이긴다. */}
        <VisitCodeDialog onPopoverOpenChange={onPopoverOpenChange} />

        {/* 월간 행위 기록 (B4). 누를 때만 열린다 — 진료를 끊지 않는다. */}
        <CareActivityReportDialog onPopoverOpenChange={onPopoverOpenChange} />

        {/* 임상 검토 (B5). 여기서 내린 결정은 이 계정에만 적용된다. */}
        <CareActivityReviewDialog onPopoverOpenChange={onPopoverOpenChange} />

        {/* 구독 상태 다이얼로그 */}
        <Dialog
          open={subOpen}
          onOpenChange={(next) => {
            onPopoverOpenChange(next);
            setSubOpen(next);
            if (next) void window.api.subscription.get().then(setSub).catch(() => {});
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className={cn(
                'h-9 shrink-0 gap-1.5 px-2 text-[11px]',
                sub && !sub.entitled && 'border-rose-400/40 text-rose-200'
              )}
              title={t('sub.title')}
            >
              <CreditCard className="h-4 w-4" />
              <span>{subLabel}</span>
              {subDays && <span className="opacity-70">· {subDays}</span>}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('sub.title')}</DialogTitle>
              <DialogDescription>
                {t('sub.price')} · {t('sub.priceCharged')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('sub.title')}</span>
                <span>
                  {subLabel}
                  {subDays ? ` · ${subDays}` : ''}
                </span>
              </div>
              {sub?.trialEndsAt && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('sub.trialEnd')}</span>
                  <span>{new Date(sub.trialEndsAt).toLocaleDateString()}</span>
                </div>
              )}
              {sub?.periodEnd && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('sub.periodEnd')}</span>
                  <span>{new Date(sub.periodEnd).toLocaleDateString()}</span>
                </div>
              )}
              {sub && sub.deviceLimit > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('sub.deviceLimit')}</span>
                  <span>
                    {sub.deviceLimit}
                    {t('sub.deviceLimitUnit')}
                  </span>
                </div>
              )}
              {sub?.offline && (
                <p className="text-amber-200/80">{t('sub.offlineNotice')}</p>
              )}
              {/* 안전 관련 문구 — 잠금이 기록 열람까지 막지 않는다는 점을 명시. */}
              <p className="text-muted-foreground">{t('sub.readingAlwaysAllowed')}</p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1"
                onClick={() => void window.api.subscription.openBilling()}
              >
                {t('sub.subscribe')}
              </Button>
              <Button
                variant="outline"
                disabled={subBusy}
                onClick={() => {
                  setSubBusy(true);
                  void window.api.subscription
                    .refresh()
                    .then(setSub)
                    .catch(() => {})
                    .finally(() => setSubBusy(false));
                }}
              >
                {subBusy ? t('auth.processing') : t('sub.refresh')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 계정·동기화 다이얼로그 */}
        <Dialog
          open={accountOpen}
          onOpenChange={(next) => {
            onPopoverOpenChange(next);
            // 미로그인 상태에서 X 를 눌러도 그냥 닫는다. 언어 선택이 더 이상
            // 필수 단계가 아니므로 dock 의 일반 컨트롤로 돌아가는 것이 맞다.
            setAccountOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              title={t('dock.account')}
            >
              <UserRound className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {authState.status === 'signed-in'
                  ? t('dock.accountTitleSignedIn')
                  : authMode === 'login'
                    ? t('dock.signIn')
                    : t('dock.signUp')}
              </DialogTitle>
              <DialogDescription>
                {authState.status === 'signed-in'
                  ? t('dock.accountDescSignedIn')
                  : t('dock.accountDescSignedOut')}
              </DialogDescription>
            </DialogHeader>

            {authState.status === 'signed-out' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (authMode === 'login') void handleSignIn();
                  else void handleSignUp();
                }}
              >
                <div className="flex gap-1 rounded-md bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError(null);
                    }}
                    className={cn(
                      'flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                      authMode === 'login'
                        ? 'bg-primary/30 text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('dock.signIn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError(null);
                    }}
                    className={cn(
                      'flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                      authMode === 'signup'
                        ? 'bg-primary/30 text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('dock.signUp')}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('dock.email')}
                  </label>
                  <Input
                    type="email"
                    autoComplete="email"
                    autoFocus
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('dock.password')}
                  </label>
                  <div className="relative">
                    <Input
                      type={showPw ? 'text' : 'password'}
                      autoComplete={
                        authMode === 'signup' ? 'new-password' : 'current-password'
                      }
                      value={pwInput}
                      onChange={(e) => setPwInput(e.target.value)}
                      placeholder={t('dock.passwordPlaceholderSignup')}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={
                        showPw ? t('auth.hidePassword') : t('auth.showPassword')
                      }
                    >
                      {showPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {authMode === 'signup' && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('dock.passwordConfirm')}
                    </label>
                    <div className="relative">
                      <Input
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={pwConfirm}
                        onChange={(e) => setPwConfirm(e.target.value)}
                        placeholder={t('dock.passwordPlaceholderConfirm')}
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                        aria-label={
                          showPw ? t('auth.hidePassword') : t('auth.showPassword')
                        }
                      >
                        {showPw ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {authError && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                    {authError}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={authBusy}>
                  {authBusy
                    ? t('auth.processing')
                    : authMode === 'login'
                      ? t('dock.signIn')
                      : t('dock.signUp')}
                </Button>
              </form>
            )}

            {authState.status === 'signed-in' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 truncate text-sm">
                    {authState.user.email || authState.user.id}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSignOut}
                    disabled={authBusy}
                    title={t('dock.signOutTooltip')}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-3 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{t('dock.cloudSyncTitle')}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('dock.cloudSyncDesc')}
                      </div>
                    </div>
                    <Switch
                      checked={cloud.enabled}
                      onCheckedChange={(v) => updateCloud({ enabled: v })}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div
                        className={cn(
                          'text-sm font-medium',
                          !cloud.enabled && 'text-muted-foreground'
                        )}
                      >
                        {t('dock.saveTranscriptsTitle')}
                      </div>
                      <div className="text-[11px] text-yellow-300">
                        {t('dock.saveTranscriptsDesc')}
                      </div>
                    </div>
                    <Switch
                      checked={cloud.saveTranscripts}
                      disabled={!cloud.enabled}
                      onCheckedChange={(v) => updateCloud({ saveTranscripts: v })}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div
                        className={cn(
                          'text-sm font-medium',
                          !cloud.enabled && 'text-muted-foreground'
                        )}
                      >
                        {t('dock.saveAudioTitle')}
                      </div>
                      <div className="text-[11px] text-yellow-300">
                        {t('dock.saveAudioDesc')}
                      </div>
                    </div>
                    <Switch
                      checked={cloud.saveAudio}
                      disabled={!cloud.enabled}
                      onCheckedChange={(v) => updateCloud({ saveAudio: v })}
                    />
                  </div>
                </div>

                {/* 로컬 저장 */}
                <div className="space-y-3 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">
                        {t('dock.localSaveTitle')}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('dock.localSaveDesc')}
                      </div>
                    </div>
                    <Switch
                      checked={localSave.enabled}
                      onCheckedChange={(v) => updateLocalSave({ enabled: v })}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div
                        className={cn(
                          'text-sm font-medium',
                          !localSave.enabled && 'text-muted-foreground'
                        )}
                      >
                        {t('dock.localSaveAudioTitle')}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('dock.localSaveAudioDesc')}
                      </div>
                    </div>
                    <Switch
                      checked={localSave.saveAudio}
                      disabled={!localSave.enabled}
                      onCheckedChange={(v) => updateLocalSave({ saveAudio: v })}
                    />
                  </div>
                </div>

                {/* 등록된 기기 */}
                <div className="space-y-2 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <MonitorSmartphone className="h-3.5 w-3.5" />
                      {t('dock.devicesTitle')}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('dock.devicesDesc')}
                    </div>
                  </div>
                  {devices === null && (
                    <p className="text-[11px] text-muted-foreground">
                      {t('common.loading')}
                    </p>
                  )}
                  {devices && devices.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {t('dock.devicesEmpty')}
                    </p>
                  )}
                  {devices?.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="truncate font-medium">
                            {d.name || d.device_id.slice(0, 8)}
                          </span>
                          {d.isCurrent && (
                            <span className="shrink-0 rounded bg-emerald-500/25 px-1 py-0.5 text-[9px] font-semibold text-emerald-100">
                              {t('dock.deviceCurrent')}
                            </span>
                          )}
                          {d.status === 'revoked' && (
                            <span className="shrink-0 rounded bg-red-500/25 px-1 py-0.5 text-[9px] font-semibold text-red-200">
                              {t('dock.deviceRevoked')}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {d.platform} · v{d.app_version} ·{' '}
                          {new Date(d.last_seen_at).toLocaleString()}
                        </div>
                      </div>
                      {d.status === 'active' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/20 hover:text-destructive"
                          disabled={deviceBusy === d.id}
                          onClick={() => void revokeDevice(d)}
                        >
                          {t('dock.deviceRevoke')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/*
          기기 수 한도 초과 (S5).

          [HARD] 여기서 아무 기기도 자동으로 내리지 않는다. 가장 오래된 기기를
          자동 해제하면, 집에서 잠깐 로그인한 탓에 진료실 데스크톱이 조용히
          끊기고 다음 날 아침 진료 직전에 그 사실을 알게 된다. 취소하면 새
          기기만 등록되지 않고 기존 환경은 그대로 남는다.
        */}
        <Dialog
          open={!!deviceLimit}
          onOpenChange={(open) => {
            if (!open) setDeviceLimit(null);
          }}
        >
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('dock.deviceLimitTitle')}</DialogTitle>
              <DialogDescription>
                {t('dock.deviceLimitDesc')} ({deviceLimit?.limit ?? 0}
                {t('sub.deviceLimitUnit')})
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {deviceLimit?.devices.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {d.name || d.device_id.slice(0, 8)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {d.platform} · v{d.app_version} ·{' '}
                      {new Date(d.last_seen_at).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={deviceBusy !== null}
                    onClick={() => void releaseDevice(d)}
                  >
                    {t('dock.deviceRelease')}
                  </Button>
                </div>
              ))}
              {deviceLimitError && (
                <p className="text-[11px] text-destructive">{deviceLimitError}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {t('dock.deviceLimitHint')}
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* 언어 토글 — Korean ↔ English. 언어 선택이 transcribeProvider 자동 결정. */}
        <DropdownMenu onOpenChange={onPopoverOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 gap-1.5 px-3"
              disabled={authState.status === 'signed-out'}
              title={t('dock.languageTitle')}
            >
              <Globe className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase">{language}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{t('dock.languageTitle')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => pickLanguage('ko')}>
              <span className="flex-1">🇰🇷 한국어</span>
              {language === 'ko' && <Star className="h-3 w-3 text-yellow-400" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => pickLanguage('en')}>
              <span className="flex-1">🇺🇸 English</span>
              {language === 'en' && <Star className="h-3 w-3 text-yellow-400" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 디버깅/관리자용 — UI 에는 노출하지 않음. 언어가 provider 를 결정.
        <Dialog
          open={providerDialogOpen}
          onOpenChange={setProviderDialogOpen}
        >
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              title="Transcribe Provider"
              disabled={authState.status === 'signed-out'}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Transcribe Provider</DialogTitle>
              <DialogDescription>
                전사(STT) 공급자를 선택합니다. 변경은 다음 "시작"부터 적용됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {providers.map((p) => {
                const selected = p.id === provider;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!p.available && !selected}
                    onClick={() => p.available && chooseProvider(p.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'border-primary/60 bg-primary/15'
                        : 'border-white/10 bg-white/5 hover:bg-white/10',
                      !p.available && !selected && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <div className="mt-0.5">
                      <div
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-white/30'
                        )}
                      >
                        {selected && <Check className="h-2.5 w-2.5" />}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{p.label}</span>
                        <span
                          className={cn(
                            'rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                            p.mode === 'stream'
                              ? 'bg-emerald-500/30 text-emerald-50'
                              : 'bg-sky-500/30 text-sky-50'
                          )}
                        >
                          {p.mode === 'stream' ? '실시간' : '청크'}
                        </span>
                      </div>
                      {p.notes && (
                        <div className="text-[11px] text-muted-foreground">
                          {p.notes}
                        </div>
                      )}
                      {!p.available && (
                        <div className="mt-0.5 text-[11px] text-yellow-300">
                          {p.id === 'clova-stream'
                            ? 'CLOVA_SPEECH_SECRET이 필요합니다 (장문 인식 도메인).'
                            : 'API 키가 .env에 없어 사용할 수 없습니다.'}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
        */}

        {/* 단축키 설정 다이얼로그 */}
        <Dialog
          open={shortcutsOpen}
          onOpenChange={(next) => {
            onPopoverOpenChange(next);
            setShortcutsOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              title="단축키 설정"
              disabled={authState.status === 'signed-out'}
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>단축키 설정</DialogTitle>
              <DialogDescription>
                전역 단축키 — 앱이 백그라운드여도 동작합니다. 행을 클릭하여
                키 조합을 다시 누르세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              {SHORTCUT_IDS.map((id) => (
                <ShortcutRow
                  key={id}
                  label={t(`shortcut.${id}`)}
                  accel={shortcuts[id]}
                  onChange={(next) => void window.api.shortcuts.set(id, next)}
                />
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void window.api.shortcuts.reset()}
              >
                기본값으로
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <DropdownMenu onOpenChange={onPopoverOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              title="레이아웃"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>적용</DropdownMenuLabel>
            {builtins.map((l) => (
              <DropdownMenuItem key={l.name} onSelect={() => applyLayout(l.name)}>
                <span className="flex-1">{layoutLabel(l.name)}</span>
                {l.isDefault && <Star className="h-3 w-3 text-yellow-400" />}
              </DropdownMenuItem>
            ))}
            {customs.length > 0 && <DropdownMenuSeparator />}
            {customs.map((l) => (
              <DropdownMenuItem
                key={l.name}
                onSelect={(e) => {
                  e.preventDefault();
                  applyLayout(l.name);
                }}
              >
                <span className="flex-1">{l.name}</span>
                {l.isDefault && <Star className="h-3 w-3 text-yellow-400" />}
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    deleteCustom(l.name);
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  title="삭제"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={saveCurrentAs}>
              <Save className="h-3 w-3" />
              현재 위치를 저장…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Star className="h-3 w-3" />
                기본 레이아웃 지정
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setAsDefault(null)}>
                  <StarOff className="h-3 w-3" />
                  기본값 사용 안 함
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {layouts.map((l) => (
                  <DropdownMenuItem
                    key={l.name}
                    onSelect={() => setAsDefault(l.name)}
                  >
                    <span className="flex-1">
                      {l.builtin ? layoutLabel(l.name) : l.name}
                    </span>
                    {defaultLayout === l.name && (
                      <Star className="h-3 w-3 text-yellow-400" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/20 hover:text-destructive"
              onClick={() => {
                if (confirm('Realtime Doctor를 종료할까요?\n진행 중인 전사·분석이 모두 사라집니다.')) {
                  window.api.quitApp();
                }
              }}
            >
              <Power className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">프로그램 종료</TooltipContent>
        </Tooltip>
      </div>
    </OverlayShell>
  );
}

function LanguagePicker({ onPick }: { onPick: (l: Language) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dock 창(기본 380x130)은 이 화면을 담기엔 너무 낮아서 제목/버튼이 잘린다.
  // 팝오버용 임시 확장 메커니즘을 그대로 재사용하되, 크기는 매직넘버가 아니라
  // 실제 렌더된 레이아웃에서 잰다. 언어를 고르면(=언마운트) 원래 크기로 복귀.
  useEffect(() => {
    let entered = false;
    let cancelled = false;

    const measureAndEnter = () => {
      if (cancelled) return;
      const el = rootRef.current;
      if (!el) return;
      // 타이틀바까지 포함한 셸 전체가 필요한 높이. 창이 작으면 스크롤되므로
      // scrollHeight 가 "잘리지 않으려면 필요한 높이" 그 자체다.
      const shell = el.closest('.overlay-shell') as HTMLElement | null;
      const needed = Math.ceil(
        shell ? shell.scrollHeight : el.scrollHeight
      );
      // 프레임리스라 보통 0 이지만, 창 테두리가 있으면 그만큼 더한다.
      const chrome = Math.max(0, window.outerHeight - window.innerHeight);
      window.api.popoverEnter({
        width: window.outerWidth,
        height: needed + chrome
      });
      entered = true;
    };

    // 폰트 로드 후 한 프레임 뒤에 재야 실제 줄바꿈이 반영된 높이가 나온다.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const ready = fonts?.ready ?? Promise.resolve();
    void ready.then(() => {
      requestAnimationFrame(measureAndEnter);
    });

    return () => {
      cancelled = true;
      if (entered) window.api.popoverLeave();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-[260px] flex-col items-center justify-center gap-5 bg-background p-6 text-center"
    >
      <h1 className="text-xl font-semibold">언어를 선택하세요 / Choose language</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        진료 대화에 사용할 언어를 선택하세요. 나중에 Dock 에서 변경할 수 있습니다.
      </p>
      <div className="flex gap-3">
        <Button size="lg" onClick={() => onPick('ko')}>
          🇰🇷 한국어
        </Button>
        <Button size="lg" variant="outline" onClick={() => onPick('en')}>
          🇺🇸 English
        </Button>
      </div>
    </div>
  );
}

function ShortcutRow({
  label,
  accel,
  onChange
}: {
  label: string;
  accel: string;
  onChange: (next: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setCapturing(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const next = accelFromEvent(e);
      if (!next) return;
      onChange(next);
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onChange]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {capturing ? (
          <span className="text-[11px] text-accent">키 입력 대기… (Esc 취소)</span>
        ) : (
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">
            {formatAccelerator(accel)}
          </kbd>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCapturing((v) => !v)}
        >
          {capturing ? '취소' : '변경'}
        </Button>
      </div>
    </div>
  );
}
