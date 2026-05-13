import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  FolderOpen,
  Mic,
  MicOff,
  RotateCcw,
  Stethoscope,
  User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { DictationTemplate, SessionSummary, Speaker } from '../../shared/types';
import { OverlayShell } from '../shared/OverlayShell';
import { useLang, useT } from '../shared/i18n';
import { useRealtime } from './useRealtime';

function nextSpeaker(s: Speaker): Speaker {
  if (s === 'doctor') return 'patient';
  if (s === 'patient') return 'doctor';
  return 'doctor';
}

function speakerStyle(speaker: Speaker, t: ReturnType<typeof useT>) {
  switch (speaker) {
    case 'doctor':
      return {
        bubble: 'bg-sky-500/15 border border-sky-400/30',
        chip: 'bg-sky-500/30 text-sky-50',
        Icon: Stethoscope,
        label: t('transcript.speakerDoctor')
      };
    case 'patient':
      return {
        bubble: 'bg-emerald-500/15 border border-emerald-400/30',
        chip: 'bg-emerald-500/30 text-emerald-50',
        Icon: User,
        label: t('transcript.speakerPatient')
      };
    default:
      return {
        bubble: 'bg-white/5 border border-white/10',
        chip: 'bg-muted text-muted-foreground',
        Icon: User,
        label: t('transcript.speakerUnknown')
      };
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function TranscriptApp() {
  const t = useT();
  const lang = useLang();
  const {
    active,
    finishing,
    pendingCount,
    partial,
    utterances,
    error,
    fallbackBanner,
    dismissFallbackBanner,
    isPending,
    start,
    stop,
    reset,
    relabel,
    swapAll
  } = useRealtime();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [sessionList, setSessionList] = useState<SessionSummary[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // 정지 시 자동으로 분석 / 요약 / 받아쓰기 트리거 — 각자 pending 브로드캐스트로
  // 모든 창의 spinner 가 즉시 돌도록.
  const stopAndAnalyzeAll = async () => {
    stop();
    if (utterances.length === 0) return;
    try {
      const template: DictationTemplate =
        (await window.api.getLastDictationTemplate()) ?? 'soap';
      // fire-and-await in parallel. 각 IPC 핸들러가 pending 을 먼저 브로드캐스트해서
      // 각 윈도우의 spinner 가 즉시 돈다.
      await Promise.allSettled([
        window.api.requestAnalysis(),
        window.api.requestSummary(),
        window.api.requestDictation(template)
      ]);
    } catch {
      // 개별 실패는 각 창의 상태 머신이 처리.
    }
  };

  const openLoadDialog = async () => {
    setLoadOpen(true);
    setSessionList(null);
    const list = await window.api.listMySessions();
    setSessionList(list);
  };

  const pickSession = async (sessionId: string) => {
    setLoadingId(sessionId);
    try {
      await window.api.loadSession(sessionId);
      setLoadOpen(false);
    } finally {
      setLoadingId(null);
    }
  };

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [utterances.length, partial]);

  return (
    <OverlayShell
      title={t('window.transcript')}
      shortcutId="toggleTranscript"
      actions={
        <div className="flex items-center gap-1" data-no-drag>
          <Button
            size="sm"
            variant={active ? 'destructive' : 'default'}
            disabled={isPending}
            onClick={() => (active ? void stopAndAnalyzeAll() : start())}
          >
            {active ? <MicOff /> : <Mic />}
            {active ? t('common.stop') : t('common.start')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={isPending || utterances.length === 0}
            onClick={swapAll}
            title={lang === 'en' ? 'Swap Doctor ↔ Patient' : '의사↔환자 전체 교체'}
          >
            <ArrowLeftRight />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={reset}
            title={
              lang === 'en'
                ? 'End the current session and start a new one'
                : '현재 세션을 종료하고 새 세션을 시작합니다'
            }
          >
            <RotateCcw />
            {lang === 'en' ? 'New session' : '새 세션'}
          </Button>
          <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
            <DialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                disabled={isPending || active}
                onClick={openLoadDialog}
                title="이전 세션 불러오기"
              >
                <FolderOpen />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>세션 불러오기</DialogTitle>
                <DialogDescription>
                  이전 세션을 선택하면 transcript 와 분석/요약/딕테이션이 복원되고
                  이후 새 발화는 그 세션에 이어집니다. 클라우드 동기화가 켜져
                  있어야 합니다.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {sessionList === null && (
                  <p className="text-xs text-muted-foreground">불러오는 중…</p>
                )}
                {sessionList && sessionList.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    저장된 세션이 없습니다.
                  </p>
                )}
                {sessionList?.map((s) => {
                  const started = new Date(s.started_at).toLocaleString('ko-KR', {
                    dateStyle: 'short',
                    timeStyle: 'short'
                  });
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => pickSession(s.id)}
                      disabled={loadingId === s.id}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm transition-colors',
                        'hover:border-primary/60 hover:bg-white/10',
                        loadingId === s.id && 'opacity-60'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{started}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {s.chunk_count}
                          {lang === 'en' ? ' utterances' : ' 발화'}
                        </span>
                      </div>
                      {s.preview && (
                        <div className="line-clamp-1 text-xs text-foreground/60">
                          {s.preview}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {fallbackBanner && (
        <div className="flex items-center justify-between gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-[11px] text-yellow-100">
          <span>{t('transcript.fallbackBanner')}</span>
          <button
            type="button"
            onClick={dismissFallbackBanner}
            className="text-yellow-200/70 hover:text-yellow-50"
          >
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="px-3 pt-2 text-xs text-destructive">{error}</div>
      )}

      <ScrollArea className="flex-1" viewportRef={viewportRef}>
        <div className="space-y-2 px-3 py-2 text-sm leading-relaxed">
          {utterances.length === 0 && !partial && (
            <p className="text-xs text-muted-foreground">
              {t('transcript.empty')}
            </p>
          )}
          {utterances.map((u) => {
            const style = speakerStyle(u.speaker, t);
            const { Icon } = style;
            return (
              <div
                key={u.id}
                className={cn('rounded-md px-2 py-1.5', style.bubble)}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => relabel(u.id, nextSpeaker(u.speaker))}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                      style.chip
                    )}
                    title="화자 토글"
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {style.label}
                  </button>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {formatTime(u.timestamp)}
                  </span>
                </div>
                <div>{u.text}</div>
              </div>
            );
          })}
          {partial && (
            <div className="rounded-md bg-primary/10 px-2 py-1.5 italic text-foreground/80">
              {partial}
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>
          {active
            ? lang === 'en'
              ? '● Listening'
              : '● 듣는 중'
            : finishing
              ? lang === 'en'
                ? `⌛ Finalizing… (${pendingCount} utterance${pendingCount === 1 ? '' : 's'} transcribing)`
                : `⌛ 정리 중… (${pendingCount} 발화 전사 중)`
              : lang === 'en'
                ? '○ Stopped'
                : '○ 정지'}
        </span>
        <span>
          {lang === 'en'
            ? `${utterances.length} utterance${utterances.length === 1 ? '' : 's'}`
            : `${utterances.length} 발화`}
        </span>
      </div>
    </OverlayShell>
  );
}
