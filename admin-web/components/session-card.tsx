import Link from 'next/link';
import { ArrowRight, FileText, Mic, NotebookPen, Sparkles } from 'lucide-react';
import { fmtDate, fmtDuration } from '@/lib/format';

export interface SessionCardData {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  transcribe_provider: string | null;
  audio_path: string | null;
  chunk_count: number;
  doctor_count: number;
  patient_count: number;
  first_text: string;
  chief_complaint: string | null;
  has_analysis: boolean;
  has_summary: boolean;
  has_dictation: boolean;
}

function providerTone(p: string | null): string {
  switch (p) {
    case 'gemini':
      return 'bg-violet-500/20 text-violet-100 border-violet-500/40';
    case 'openai':
      return 'bg-emerald-500/20 text-emerald-100 border-emerald-500/40';
    case 'clova-csr':
      return 'bg-sky-500/20 text-sky-100 border-sky-500/40';
    case 'clova-stream':
      return 'bg-cyan-500/20 text-cyan-100 border-cyan-500/40';
    default:
      return 'bg-white/10 text-foreground/70 border-white/20';
  }
}

export function SessionCard({
  s,
  href
}: {
  s: SessionCardData;
  href: string;
}) {
  const durationMs = s.ended_at ? new Date(s.ended_at).getTime() - new Date(s.started_at).getTime() : null;
  const total = s.doctor_count + s.patient_count;
  const drPct = total > 0 ? (s.doctor_count / total) * 100 : 0;
  const preview = (s.chief_complaint?.trim() || s.first_text || '').slice(0, 140);

  return (
    <Link
      href={href}
      className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/60"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-sm font-semibold">{fmtDate(s.started_at)}</div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {s.transcribe_provider && (
            <span
              className={`rounded-full border px-2 py-0.5 font-mono ${providerTone(
                s.transcribe_provider
              )}`}
            >
              {s.transcribe_provider}
            </span>
          )}
          <span className="text-foreground/60">{fmtDuration(durationMs)}</span>
          <span className="text-foreground/60">발화 {s.chunk_count}</span>
        </div>
      </div>

      {preview && (
        <div className="mt-2 line-clamp-2 text-sm text-foreground/80">
          {s.chief_complaint ? (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
                CC ·{' '}
              </span>
              {preview}
            </>
          ) : (
            preview
          )}
        </div>
      )}

      {total > 0 && (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-emerald-500/30">
            <div className="h-full bg-sky-500/80" style={{ width: `${drPct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-foreground/40">
            <span>의사 {s.doctor_count}</span>
            <span>환자 {s.patient_count}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground/50">
        <div className="flex flex-wrap items-center gap-1.5">
          {s.has_analysis && <Chip icon={<Sparkles className="h-3 w-3" />}>분석</Chip>}
          {s.has_summary && <Chip icon={<FileText className="h-3 w-3" />}>요약</Chip>}
          {s.has_dictation && <Chip icon={<NotebookPen className="h-3 w-3" />}>받아쓰기</Chip>}
          {s.audio_path && <Chip icon={<Mic className="h-3 w-3" />}>음성</Chip>}
          {!s.ended_at && <Chip className="border-amber-500/40 text-amber-200">진행 중</Chip>}
        </div>
        <span className="font-mono text-foreground/30">
          {s.id.slice(0, 8)} <ArrowRight className="inline h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

function Chip({
  children,
  icon,
  className = 'border-border bg-muted/40'
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
