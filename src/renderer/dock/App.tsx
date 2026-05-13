import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
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
  NotebookPen,
  Power,
  Save,
  // SlidersHorizontal, // (주석 처리된 provider 다이얼로그용)
  Star,
  StarOff,
  Trash2,
  UserRound
} from 'lucide-react';
import {
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  SHORTCUT_LABELS,
  type Language,
  type ShortcutId
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
import { cn } from '@/lib/utils';
import type { AuthState, CloudSyncSettings } from '../../shared/types';

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

const ORDER = ['transcript', 'diagnosis', 'terms', 'questions', 'summary', 'dictation'];

const META: Record<
  string,
  { tkey: import('../shared/i18n').TKey; Icon: React.ComponentType<{ className?: string }> }
> = {
  transcript: { tkey: 'window.transcript', Icon: Mic },
  diagnosis: { tkey: 'window.diagnosis', Icon: Activity },
  terms: { tkey: 'window.terms', Icon: BookOpen },
  questions: { tkey: 'window.questions', Icon: HelpCircle },
  summary: { tkey: 'window.summary', Icon: FileText },
  dictation: { tkey: 'window.dictation', Icon: NotebookPen }
};

const TOGGLE_ID: Record<string, ShortcutId> = {
  transcript: 'toggleTranscript',
  diagnosis: 'toggleDiagnosis',
  terms: 'toggleTerms',
  questions: 'toggleQuestions',
  summary: 'toggleSummary',
  dictation: 'toggleDictation'
};

const BUILTIN_LABELS: Record<string, string> = {
  'right-stack': '우측 스택 (기본)',
  'left-stack': '좌측 스택',
  'wide-grid': '상단 2x3 격자',
  'corner-compact': '컴팩트 코너'
};

function layoutLabel(name: string): string {
  return BUILTIN_LABELS[name] ?? name;
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
  const [shortcuts, setShortcuts] = useState<Record<ShortcutId, string>>(
    SHORTCUT_DEFAULTS
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [s, l, d, a, c, sc, lang] = await Promise.all([
      window.api.listWindowStates(),
      window.api.listLayouts(),
      window.api.getDefaultLayout(),
      window.api.auth.getState(),
      window.api.cloudSync.get(),
      window.api.shortcuts.get(),
      window.api.language.get()
    ]);
    setStates(s);
    setLayouts(l);
    setDefaultLayoutName(d);
    setAuthState(a);
    setCloud(c);
    setShortcuts(sc);
    setLanguageState(lang);
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
    return () => {
      offWindows();
      offAuth();
      offShortcuts();
      offLang();
    };
  }, [refresh]);

  // Force-open account dialog while signed out (login gate).
  useEffect(() => {
    if (authState.status === 'signed-out') {
      setAccountOpen(true);
    }
  }, [authState.status]);

  const handleSignIn = async () => {
    setAuthError(null);
    if (!emailInput.trim()) {
      setAuthError('이메일을 입력하세요.');
      return;
    }
    if (!pwInput) {
      setAuthError('비밀번호를 입력하세요.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await window.api.auth.signIn(emailInput.trim(), pwInput);
      if (!res.ok) setAuthError(res.error ?? '로그인 실패');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignUp = async () => {
    setAuthError(null);
    if (!emailInput.trim()) {
      setAuthError('이메일을 입력하세요.');
      return;
    }
    if (pwInput.length < 6) {
      setAuthError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (pwInput !== pwConfirm) {
      setAuthError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await window.api.auth.signUp(emailInput.trim(), pwInput);
      if (!res.ok) setAuthError(res.error ?? '회원가입 실패');
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

  // 첫 실행 — 언어 미선택. IPC 응답 전 (undefined) 빈 화면, null 이면 picker.
  if (language === undefined) {
    return <OverlayShell title="Dock" hideOpacity hideMinimize><div /></OverlayShell>;
  }
  if (language === null) {
    return (
      <OverlayShell title="Dock" hideOpacity hideMinimize>
        <LanguagePicker onPick={pickLanguage} />
      </OverlayShell>
    );
  }

  return (
    <OverlayShell title="Dock">
      <div className="flex flex-wrap items-center justify-center gap-2 p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => window.api.toggleAllWindows()}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 transition-colors',
                allMinimized
                  ? 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                  : 'bg-primary/20 text-primary-foreground hover:bg-primary/30'
              )}
            >
              {allMinimized ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
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
            const accel = shortcuts[TOGGLE_ID[k]];
            return (
              <Tooltip key={k}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => window.api.toggleWindow(k)}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                      minimized
                        ? 'border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10'
                        : 'border-primary/40 bg-primary/30 text-primary-foreground hover:bg-primary/40'
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

        {/* 계정·동기화 다이얼로그 */}
        <Dialog
          open={accountOpen}
          onOpenChange={(next) => {
            // 미로그인일 때는 로그인 게이트라 닫지 못함.
            if (!next && authState.status === 'signed-out') return;
            setAccountOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              title="계정"
            >
              <UserRound className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {authState.status === 'signed-in'
                  ? '계정'
                  : authMode === 'login'
                    ? '로그인'
                    : '회원가입'}
              </DialogTitle>
              <DialogDescription>
                {authState.status === 'signed-in'
                  ? '계정 정보와 클라우드 동기화 설정.'
                  : '로그인하면 진료 기록을 DB에 저장합니다.'}
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
                    로그인
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
                    회원가입
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    이메일
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
                    비밀번호
                  </label>
                  <div className="relative">
                    <Input
                      type={showPw ? 'text' : 'password'}
                      autoComplete={
                        authMode === 'signup' ? 'new-password' : 'current-password'
                      }
                      value={pwInput}
                      onChange={(e) => setPwInput(e.target.value)}
                      placeholder="6자 이상"
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
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
                      비밀번호 확인
                    </label>
                    <div className="relative">
                      <Input
                        type={showPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={pwConfirm}
                        onChange={(e) => setPwConfirm(e.target.value)}
                        placeholder="다시 입력"
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                        aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
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
                    ? '처리 중…'
                    : authMode === 'login'
                      ? '로그인'
                      : '회원가입'}
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
                    title="로그아웃"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-3 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">클라우드 동기화</div>
                      <div className="text-[11px] text-muted-foreground">
                        세션·분석·요약·딕테이션을 DB에 저장합니다. 기본 켜짐.
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
                        전사 원문 저장
                      </div>
                      <div className="text-[11px] text-yellow-300">
                        원본 대화가 DB에 저장됩니다. 환자 식별 정보(PHI) 포함 가능.
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
                        음성 파일 업로드
                      </div>
                      <div className="text-[11px] text-yellow-300">
                        진료 중 녹음된 음성 원본이 Supabase Storage에 저장됩니다.
                      </div>
                    </div>
                    <Switch
                      checked={cloud.saveAudio}
                      disabled={!cloud.enabled}
                      onCheckedChange={(v) => updateCloud({ saveAudio: v })}
                    />
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* 언어 토글 — Korean ↔ English. 언어 선택이 transcribeProvider 자동 결정. */}
        <DropdownMenu>
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
              <span className="flex-1">🇰🇷 한국어 (CLOVA)</span>
              {language === 'ko' && <Star className="h-3 w-3 text-yellow-400" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => pickLanguage('en')}>
              <span className="flex-1">🇺🇸 English (OpenAI Realtime)</span>
              {language === 'en' && <Star className="h-3 w-3 text-yellow-400" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              {t('dock.languageFallback')}
            </div>
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
        <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
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
                  label={SHORTCUT_LABELS[id]}
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

        <DropdownMenu>
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
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-5 bg-background p-6 text-center">
      <h1 className="text-xl font-semibold">언어를 선택하세요 / Choose language</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        한국어 → CLOVA, 영어 → OpenAI Realtime 실시간 전사.
        <br />
        Gemini 는 실패 시 자동 폴백으로만 사용됩니다.
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
