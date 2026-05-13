'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Mic,
  MoreHorizontal,
  Pencil,
  Pin,
  Tag
} from 'lucide-react';
import { fmtDate, fmtDuration } from '@/lib/format';
import {
  COLOR_LABEL,
  COLOR_TOKEN,
  SESSION_COLORS,
  type SessionColor
} from '@/lib/session-colors';
import { updateSessionMeta } from '@/app/admin/users/[id]/sessions/[sessionId]/actions';
import { AnalysisView } from './AnalysisView';
import { NotesView } from './NotesView';
import { TranscriptPanel } from './TranscriptPanel';
import { OverviewTab } from './OverviewTab';

export type TabKey = 'overview' | 'transcript' | 'notes' | 'dictation';

export interface SessionDetailProps {
  backHref: string;
  session: {
    id: string;
    started_at: string;
    ended_at: string | null;
    transcribe_provider: string | null;
    alias: string | null;
    color: SessionColor | null;
    pinned: boolean;
  };
  audioUrl: string | null;
  analysis: import('@/lib/exports').AnalysisLike | null;
  summaries: Array<import('@/lib/exports').SummaryLike & { id: string }>;
  dictations: Array<import('@/lib/exports').DictationLike & { id: string }>;
  chunks: Array<
    import('@/lib/exports').ChunkLike & {
      id: string;
      audio_path: string | null;
    }
  >;
  chunkAudioUrls: Record<string, string>;
  truncated: boolean;
}

export function SessionDetailClient(props: SessionDetailProps) {
  const { backHref, session: initialSession, audioUrl, analysis, summaries, dictations, chunks, chunkAudioUrls, truncated } =
    props;
  const [session, setSession] = useState(initialSession);

  const audioRef = useRef<HTMLAudioElement>(null);
  const startedAtMs = useMemo(() => new Date(session.started_at).getTime(), [session.started_at]);
  const durationMs = session.ended_at ? new Date(session.ended_at).getTime() - startedAtMs : null;

  const patchMeta = async (p: { alias?: string | null; color?: SessionColor | null; pinned?: boolean; ended_at?: string | null }) => {
    const prev = session;
    setSession((s) => ({ ...s, ...p }));
    const res = await updateSessionMeta({ sessionId: session.id, ...p });
    if (!res.ok) {
      setSession(prev);
      alert(`저장 실패: ${res.error ?? ''}`);
    }
  };

  const doctorCount = chunks.filter((c) => c.speaker === 'doctor').length;
  const patientCount = chunks.filter((c) => c.speaker === 'patient').length;
  const unknownCount = chunks.length - doctorCount - patientCount;

  const redFlags = Array.isArray(analysis?.red_flags) ? (analysis!.red_flags as string[]) : [];

  const [tab, setTab] = useState<TabKey>('overview');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (['overview', 'transcript', 'notes', 'dictation'].includes(hash)) {
      setTab(hash as TabKey);
    }
  }, []);

  const setTabAndHash = (next: TabKey) => {
    setTab(next);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${next}`);
    }
  };

  const seekTo = (timestampMs: number) => {
    if (!audioRef.current) return;
    const seconds = Math.max(0, (timestampMs - startedAtMs) / 1000);
    audioRef.current.currentTime = seconds;
    void audioRef.current.play().catch(() => undefined);
  };

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'overview', label: '개요' },
    { key: 'transcript', label: '전사', count: chunks.length },
    { key: 'notes', label: '임상 노트', count: summaries.length },
    { key: 'dictation', label: '받아쓰기', count: dictations.length }
  ];

  return (
    <div className="space-y-4">
      <div>
        <Link href={backHref} className="text-xs text-foreground/50 hover:text-foreground">
          ← 사용자
        </Link>
      </div>

      {/* Sticky meta header */}
      <div className="sticky top-0 z-10 -mx-1 overflow-hidden rounded-2xl border border-border bg-card/95 shadow-sm backdrop-blur">
        {session.color && (
          <div className={`absolute inset-y-0 left-0 w-1 ${COLOR_TOKEN[session.color].bar}`} />
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4 pl-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {session.pinned && (
                <Pin className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" />
              )}
              <AliasHeader
                alias={session.alias}
                fallback={fmtDate(session.started_at)}
                onCommit={(v) => patchMeta({ alias: v })}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-foreground/50">
              {session.alias && <span>{fmtDate(session.started_at)} · </span>}
              {durationMs ? fmtDuration(durationMs) : '진행 중'} ·{' '}
              <span className="font-mono">{session.id.slice(0, 8)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground/70">
            {session.color && (
              <Pill className={COLOR_TOKEN[session.color].chip}>
                <span className={`h-1.5 w-1.5 rounded-full ${COLOR_TOKEN[session.color].dot}`} />
                {COLOR_LABEL[session.color]}
              </Pill>
            )}
            <Pill className="bg-sky-500/15 text-sky-200">의사 {doctorCount}</Pill>
            <Pill className="bg-emerald-500/15 text-emerald-200">환자 {patientCount}</Pill>
            {unknownCount > 0 && <Pill className="bg-white/10">미확인 {unknownCount}</Pill>}
            {analysis && <Pill className="bg-purple-500/15 text-purple-200">분석</Pill>}
            {summaries.length > 0 && (
              <Pill className="bg-amber-500/15 text-amber-200">요약 {summaries.length}</Pill>
            )}
            {dictations.length > 0 && (
              <Pill className="bg-cyan-500/15 text-cyan-200">받아쓰기 {dictations.length}</Pill>
            )}
            {audioUrl && (
              <Pill className="gap-1 bg-rose-500/15 text-rose-200">
                <Mic className="h-3 w-3" /> 음성
              </Pill>
            )}
            <MetaActions
              pinned={session.pinned}
              color={session.color}
              inProgress={!session.ended_at}
              onTogglePin={() => patchMeta({ pinned: !session.pinned })}
              onSetColor={(c) => patchMeta({ color: c })}
              onToggleInProgress={() =>
                patchMeta({ ended_at: session.ended_at ? null : new Date().toISOString() })
              }
            />
          </div>
        </div>
      </div>

      {redFlags.length > 0 && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-200">
            <AlertTriangle className="h-4 w-4" /> Red flag
          </div>
          <ul className="ml-5 list-disc space-y-1 text-sm text-red-100/90">
            {redFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {audioUrl && (
        <div className="rounded-2xl border border-border bg-card p-3">
          <audio ref={audioRef} controls src={audioUrl} className="w-full" preload="metadata" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTabAndHash(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? 'border-accent text-foreground'
                : 'border-transparent text-foreground/60 hover:text-foreground'
            }`}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className="ml-1 text-[11px] text-foreground/40">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      <div className="pt-1">
        {tab === 'overview' && (
          <OverviewTab
            analysis={analysis}
            summaries={summaries}
            dictations={dictations}
            chunks={chunks}
            session={session}
          />
        )}
        {tab === 'transcript' && (
          <TranscriptPanel
            sessionId={session.id}
            chunks={chunks}
            chunkAudioUrls={chunkAudioUrls}
            onSeek={audioUrl ? seekTo : null}
            truncated={truncated}
          />
        )}
        {tab === 'notes' && <NotesView summaries={summaries} />}
        {tab === 'dictation' && (
          <NotesView sessionId={session.id} dictations={dictations} />
        )}
      </div>
    </div>
  );
}

function Pill({
  className = '',
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${className}`}
    >
      {children}
    </span>
  );
}

function AliasHeader({
  alias,
  fallback,
  onCommit
}: {
  alias: string | null;
  fallback: string;
  onCommit: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    setDraft(alias ?? '');
  }, [alias]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if ((next || null) === (alias ?? null)) return;
    onCommit(next || null);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(alias ?? '');
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="별명 입력…"
        className="min-w-0 flex-1 rounded border border-accent/60 bg-background px-2 py-0.5 text-base font-semibold outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-2 text-left hover:text-accent"
      title={alias ? '별명 수정' : '별명 추가'}
    >
      <span className="text-base font-semibold">{alias || fallback}</span>
      <Pencil className="h-3 w-3 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function MetaActions({
  pinned,
  color,
  inProgress,
  onTogglePin,
  onSetColor,
  onToggleInProgress
}: {
  pinned: boolean;
  color: SessionColor | null;
  inProgress: boolean;
  onTogglePin: () => void;
  onSetColor: (c: SessionColor | null) => void;
  onToggleInProgress: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-foreground/60 hover:bg-muted hover:text-foreground"
        title="더 보기"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-card p-1.5 shadow-2xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onTogglePin();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
          >
            <Pin className={`h-3.5 w-3.5 ${pinned ? 'fill-amber-400 text-amber-400' : ''}`} />
            {pinned ? '핀 해제' : '상단 고정'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onToggleInProgress();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                inProgress ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            />
            {inProgress ? '완료됨으로 표시' : '진행 중으로 표시'}
          </button>
          <div className="my-1 border-t border-border/60" />
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
            <Tag className="mr-1 inline h-3 w-3" />
            색상 라벨
          </div>
          <div className="grid grid-cols-4 gap-1 px-2 pb-1">
            {SESSION_COLORS.map((c) => {
              const active = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onSetColor(active ? null : c)}
                  aria-pressed={active}
                  title={active ? `${COLOR_LABEL[c]} — 다시 누르면 해제` : COLOR_LABEL[c]}
                  className={`relative flex h-7 items-center justify-center rounded-md transition-all ${
                    active ? `ring-2 ring-white/70 ${COLOR_TOKEN[c].chip}` : COLOR_TOKEN[c].chip
                  }`}
                >
                  <span className={`h-3 w-3 rounded-full ${COLOR_TOKEN[c].dot}`} />
                  {active && (
                    <Check className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-white" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="px-2 pb-1 text-[10px] text-foreground/40">
            {color ? '선택된 색을 다시 누르면 해제됩니다' : '색을 골라 라벨링하세요'}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export for convenience
export { AnalysisView } from './AnalysisView';
