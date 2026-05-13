'use client';

import { ClipboardCopy, Download } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import {
  copyMarkdown,
  downloadMarkdown,
  sessionToMarkdown,
  type AnalysisLike,
  type ChunkLike,
  type DictationLike,
  type SummaryLike
} from '@/lib/exports';
import { AnalysisView } from './AnalysisView';

export function OverviewTab({
  analysis,
  summaries,
  dictations,
  chunks,
  session
}: {
  analysis: AnalysisLike | null;
  summaries: Array<SummaryLike & { id: string }>;
  dictations: Array<DictationLike & { id: string }>;
  chunks: ChunkLike[];
  session: {
    id: string;
    started_at: string;
    ended_at: string | null;
    transcribe_provider: string | null;
  };
}) {
  const fullMd = sessionToMarkdown({ session, analysis, summaries, dictations, chunks });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-1">
        <span className="mr-2 text-[11px] text-foreground/40">전체 세션</span>
        <button
          onClick={() => void copyMarkdown(fullMd)}
          title="전체 세션 마크다운 복사"
          className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => downloadMarkdown(`session-${session.id.slice(0, 8)}.md`, fullMd)}
          title="전체 세션 마크다운 다운로드"
          className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {analysis ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">분석</div>
            <span className="text-[11px] text-foreground/40">
              업데이트 {fmtDate(analysis.updated_at)}
            </span>
          </div>
          <AnalysisView a={analysis} />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-foreground/60">
          아직 생성된 분석이 없습니다.
        </div>
      )}
    </div>
  );
}
