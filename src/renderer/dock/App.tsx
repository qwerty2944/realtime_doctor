import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  Check,
  Eye,
  EyeOff,
  FileText,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Mic,
  NotebookPen,
  Power,
  Save,
  Settings2,
  Star,
  StarOff,
  Trash2,
  UserRound
} from 'lucide-react';

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
import type {
  AuthState,
  CloudSyncSettings,
  TranscribeProviderId,
  TranscribeProviderInfo
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

const ORDER = ['transcript', 'diagnosis', 'terms', 'questions', 'summary', 'dictation'];

const META: Record<
  string,
  { label: string; short: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  transcript: { label: 'Transcript', short: 'T', Icon: Mic },
  diagnosis: { label: '감별진단', short: 'D', Icon: Activity },
  terms: { label: '의학용어', short: 'M', Icon: BookOpen },
  questions: { label: '다음 질문', short: 'Q', Icon: HelpCircle },
  summary: { label: '요약', short: 'S', Icon: FileText },
  dictation: { label: 'Dictation', short: 'K', Icon: NotebookPen }
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
  const [states, setStates] = useState<WindowState[]>([]);
  const [layouts, setLayouts] = useState<LayoutInfo[]>([]);
  const [defaultLayout, setDefaultLayoutName] = useState<string>('');
  const [providers, setProviders] = useState<TranscribeProviderInfo[]>([]);
  const [provider, setProvider] = useState<TranscribeProviderId>('gemini');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    saveTranscripts: false
  });

  const refresh = useCallback(async () => {
    const [s, l, d, p, cur, a, c] = await Promise.all([
      window.api.listWindowStates(),
      window.api.listLayouts(),
      window.api.getDefaultLayout(),
      window.api.listTranscribeProviders(),
      window.api.getTranscribeProvider(),
      window.api.auth.getState(),
      window.api.cloudSync.get()
    ]);
    setStates(s);
    setLayouts(l);
    setDefaultLayoutName(d);
    setProviders(p);
    setProvider(cur);
    setAuthState(a);
    setCloud(c);
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
    return () => {
      offWindows();
      offAuth();
    };
  }, [refresh]);

  // Force-open dialog while signed out (login gate).
  useEffect(() => {
    if (authState.status === 'signed-out') {
      setSettingsOpen(true);
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

  const chooseProvider = async (id: TranscribeProviderId) => {
    const next = await window.api.setTranscribeProvider(id);
    setProvider(next);
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

  return (
    <OverlayShell title="Dock">
      <div className="flex flex-wrap items-center justify-center gap-2 p-3">
        <button
          type="button"
          onClick={() => window.api.toggleAllWindows()}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 transition-colors',
            allMinimized
              ? 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
              : 'bg-primary/20 text-primary-foreground hover:bg-primary/30'
          )}
          title={allMinimized ? '모두 표시' : '모두 숨김'}
        >
          {allMinimized ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </button>

        <div className="flex flex-wrap items-center justify-center gap-1">
          {ORDER.map((k) => {
            const s = stateOf(k);
            if (!s) return null;
            const m = META[k];
            const Icon = m.Icon;
            const minimized = s.minimized || !s.visible;
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
                    <span>{m.label}</span>
                    <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">
                      {m.short}
                    </kbd>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <Dialog
          open={settingsOpen}
          onOpenChange={(next) => {
            // While signed-out the dialog acts as a login gate — block close.
            if (!next && authState.status === 'signed-out') return;
            setSettingsOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              title="설정"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
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
                        세션·분석·요약·딕테이션을 DB에 저장합니다. 기본 꺼짐.
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
                </div>

                <div className="space-y-2 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Transcribe Provider
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      변경은 다음 "시작"부터 적용
                    </div>
                  </div>
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
              </div>
            )}
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
