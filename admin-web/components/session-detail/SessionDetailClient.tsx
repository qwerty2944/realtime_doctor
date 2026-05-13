'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Mic } from 'lucide-react';
import { fmtDate, fmtDuration } from '@/lib/format';
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
  const { backHref, session, audioUrl, analysis, summaries, dictations, chunks, chunkAudioUrls, truncated } =
    props;

  const audioRef = useRef<HTMLAudioElement>(null);
  const startedAtMs = useMemo(() => new Date(session.started_at).getTime(), [session.started_at]);
  const durationMs = session.ended_at ? new Date(session.ended_at).getTime() - startedAtMs : null;

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
      <div className="sticky top-0 z-10 -mx-1 rounded-2xl border border-border bg-card/95 px-5 py-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div>
            <h1 className="text-base font-semibold">{fmtDate(session.started_at)}</h1>
            <p className="mt-0.5 text-[11px] text-foreground/50">
              {durationMs ? fmtDuration(durationMs) : '진행 중'} ·{' '}
              {session.transcribe_provider ?? '—'} ·{' '}
              <span className="font-mono">{session.id.slice(0, 8)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground/70">
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
            chunks={chunks}
            chunkAudioUrls={chunkAudioUrls}
            onSeek={audioUrl ? seekTo : null}
            truncated={truncated}
          />
        )}
        {tab === 'notes' && <NotesView summaries={summaries} />}
        {tab === 'dictation' && <NotesView dictations={dictations} />}
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

// Re-export for convenience
export { AnalysisView } from './AnalysisView';
