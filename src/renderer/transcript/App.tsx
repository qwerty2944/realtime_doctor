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
import type {
  SessionSummary,
  Speaker,
  TranscribeProviderId,
  TranscribeProviderInfo
} from '../../shared/types';
import { OverlayShell } from '../shared/OverlayShell';
import { useRealtime } from './useRealtime';

function nextSpeaker(s: Speaker): Speaker {
  if (s === 'doctor') return 'patient';
  if (s === 'patient') return 'doctor';
  return 'doctor';
}

function speakerStyle(speaker: Speaker) {
  switch (speaker) {
    case 'doctor':
      return {
        bubble: 'bg-sky-500/15 border border-sky-400/30',
        chip: 'bg-sky-500/30 text-sky-50',
        Icon: Stethoscope,
        label: '의사'
      };
    case 'patient':
      return {
        bubble: 'bg-emerald-500/15 border border-emerald-400/30',
        chip: 'bg-emerald-500/30 text-emerald-50',
        Icon: User,
        label: '환자'
      };
    default:
      return {
        bubble: 'bg-white/5 border border-white/10',
        chip: 'bg-muted text-muted-foreground',
        Icon: User,
        label: '분류 중…'
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
  const {
    active,
    finishing,
    pendingCount,
    partial,
    utterances,
    error,
    isPending,
    start,
    stop,
    reset,
    relabel,
    swapAll
  } = useRealtime();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [providerId, setProviderId] = useState<TranscribeProviderId | null>(null);
  const [providerInfos, setProviderInfos] = useState<TranscribeProviderInfo[]>([]);
  const [loadOpen, setLoadOpen] = useState(false);
  const [sessionList, setSessionList] = useState<SessionSummary[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [id, list] = await Promise.all([
        window.api.getTranscribeProvider(),
        window.api.listTranscribeProviders()
      ]);
      if (cancelled) return;
      setProviderId(id);
      setProviderInfos(list);
    })();
    const off = window.api.onTranscribeProviderChange((id) => {
      setProviderId(id);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const currentProvider = providerInfos.find((p) => p.id === providerId);

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
      title="Transcript"
      badge={
        currentProvider ? (
          <span
            className="rounded bg-white/10 px-1 py-px text-[8px] font-medium text-foreground/60"
            title={`${currentProvider.label} · ${currentProvider.mode === 'stream' ? '실시간' : '청크'}`}
          >
            {currentProvider.label.split(' ')[0]}
          </span>
        ) : null
      }
      actions={
        <div className="flex items-center gap-1" data-no-drag>
          <Button
            size="sm"
            variant={active ? 'destructive' : 'default'}
            disabled={isPending}
            onClick={() => (active ? stop() : start())}
          >
            {active ? <MicOff /> : <Mic />}
            {active ? '정지' : '시작'}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={isPending || utterances.length === 0}
            onClick={swapAll}
            title="의사↔환자 전체 교체"
          >
            <ArrowLeftRight />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={reset}
            title="현재 세션을 종료하고 새 세션을 시작합니다"
          >
            <RotateCcw />
            새 세션
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
                          {s.chunk_count} 발화 ·{' '}
                          {s.transcribe_provider ?? '—'}
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
      {error && (
        <div className="px-3 pt-2 text-xs text-destructive">{error}</div>
      )}

      <ScrollArea className="flex-1" viewportRef={viewportRef}>
        <div className="space-y-2 px-3 py-2 text-sm leading-relaxed">
          {utterances.length === 0 && !partial && (
            <p className="text-xs text-muted-foreground">
              "시작"을 눌러 마이크를 켜세요. 발화가 끝나면 화자를 자동 분류하고
              감별진단을 갱신합니다. 화자 칩을 누르면 수동으로 바꿀 수 있습니다.
            </p>
          )}
          {utterances.map((u) => {
            const style = speakerStyle(u.speaker);
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
            ? '● 듣는 중'
            : finishing
              ? `⌛ 정리 중… (${pendingCount} 발화 전사 중)`
              : '○ 정지'}
        </span>
        <span>{utterances.length} 발화</span>
      </div>
    </OverlayShell>
  );
}
