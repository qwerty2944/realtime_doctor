'use client';

import { ClipboardCopy, Download } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import {
  copyMarkdown,
  dictationToMarkdown,
  downloadMarkdown,
  summaryToMarkdown,
  type DictationLike,
  type SummaryLike
} from '@/lib/exports';

interface SummaryRow extends SummaryLike {
  id: string;
}
interface DictationRow extends DictationLike {
  id: string;
}

export function NotesView({
  summaries,
  dictations
}: {
  summaries?: SummaryRow[];
  dictations?: DictationRow[];
}) {
  if (summaries) return <SummaryCards rows={summaries} />;
  if (dictations) return <DictationCards rows={dictations} />;
  return null;
}

function SummaryCards({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) {
    return <Empty>아직 생성된 임상 노트가 없습니다.</Empty>;
  }
  return (
    <div className="space-y-4">
      {rows.map((s) => {
        const md = summaryToMarkdown(s);
        return (
          <div key={s.id} className="rounded-2xl border border-border bg-card p-4">
            <Toolbar
              left={
                <span className="text-[11px] text-foreground/50">
                  생성 {fmtDate(s.generated_at)}
                </span>
              }
              md={md}
              filename={`summary-${s.id}.md`}
            />
            <SummaryGrid s={s} />
          </div>
        );
      })}
    </div>
  );
}

function SummaryGrid({ s }: { s: SummaryRow }) {
  const rows: [string, string][] = [
    ['주호소 (CC)', s.chief_complaint],
    ['현병력 (HPI)', s.history_of_present_illness],
    ['관련 소견', s.pertinent_findings],
    ['검사·약물 언급', s.investigations_mentioned],
    ['임상 인상 (Impression)', s.clinical_impression],
    ['계획 (Plan)', s.plan]
  ];
  return (
    <div className="mt-3 space-y-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
            {k}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
            {v || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function DictationCards({ rows }: { rows: DictationRow[] }) {
  if (rows.length === 0) {
    return <Empty>아직 생성된 받아쓰기가 없습니다.</Empty>;
  }
  return (
    <div className="space-y-4">
      {rows.map((d) => {
        const md = dictationToMarkdown(d);
        const sections = Array.isArray(d.sections)
          ? (d.sections as Array<{ heading?: string; body?: string }>)
          : [];
        return (
          <div key={d.id} className="rounded-2xl border border-border bg-card p-4">
            <Toolbar
              left={
                <span className="flex items-center gap-2 text-[11px] text-foreground/50">
                  <span className="rounded bg-white/10 px-1 py-0.5 font-mono uppercase">
                    {d.template}
                  </span>
                  생성 {fmtDate(d.generated_at)}
                </span>
              }
              md={md}
              filename={`dictation-${d.id}.md`}
            />
            <div className="mt-3 space-y-3 text-sm">
              {sections.map((sec, i) => (
                <div key={i}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
                    {sec.heading}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                    {sec.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Toolbar({
  left,
  md,
  filename
}: {
  left: React.ReactNode;
  md: string;
  filename: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>{left}</div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => void copyMarkdown(md)}
          className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
          title="마크다운 복사"
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => downloadMarkdown(filename, md)}
          className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
          title="마크다운 다운로드"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-foreground/60">
      {children}
    </div>
  );
}
