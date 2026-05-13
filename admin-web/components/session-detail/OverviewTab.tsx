'use client';

import { useTransition } from 'react';
import { ClipboardCopy, Download, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { Spinner } from '../spinner';
import { regenerateAnalysisAction } from '@/app/admin/users/[id]/sessions/[sessionId]/actions';

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
  const router = useRouter();
  const [regenerating, startRegen] = useTransition();
  const hasChunks = chunks.length > 0;

  const regenerate = () => {
    if (!hasChunks) {
      alert('전사 청크가 없어 분석을 다시 생성할 수 없습니다.');
      return;
    }
    if (analysis && !confirm('기존 감별진단·용어·질문을 새로 생성한 결과로 덮어씁니다. 진행할까요?')) {
      return;
    }
    startRegen(async () => {
      const res = await regenerateAnalysisAction({ sessionId: session.id });
      if (!res.ok) {
        alert(`분석 재생성 실패: ${res.error ?? '알 수 없는 오류'}`);
        return;
      }
      router.refresh();
    });
  };

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
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">분석</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-foreground/40">
                업데이트 {fmtDate(analysis.updated_at)}
              </span>
              <button
                onClick={regenerate}
                disabled={regenerating || !hasChunks}
                title="감별진단·용어·질문 다시 생성"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground/70 hover:text-foreground disabled:opacity-50"
              >
                {regenerating ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
                {regenerating ? '생성 중…' : '다시 생성'}
              </button>
            </div>
          </div>
          <AnalysisView a={analysis} />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-foreground/60">
          <div>아직 생성된 분석이 없습니다.</div>
          {hasChunks && (
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground/80 hover:text-foreground disabled:opacity-50"
            >
              {regenerating ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
              {regenerating ? '분석 생성 중…' : '지금 생성'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
