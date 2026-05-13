'use client';

import { AlertTriangle } from 'lucide-react';
import type { AnalysisLike } from '@/lib/exports';

interface DiagRow {
  name?: string;
  nameEn?: string;
  icd10?: string;
  confidence?: number;
  reasoning?: string;
}
interface TermRow {
  term?: string;
  termEn?: string;
  definition?: string;
  contextQuote?: string;
}
interface QRow {
  question?: string;
  rationale?: string;
}

export function AnalysisView({
  a,
  showRedFlags = false
}: {
  a: AnalysisLike;
  showRedFlags?: boolean;
}) {
  const dd = Array.isArray(a.differential_diagnoses)
    ? ([...a.differential_diagnoses] as DiagRow[]).sort(
        (x, y) => (y.confidence ?? 0) - (x.confidence ?? 0)
      )
    : [];
  const terms = Array.isArray(a.medical_terms) ? (a.medical_terms as TermRow[]) : [];
  const qs = Array.isArray(a.suggested_questions) ? (a.suggested_questions as QRow[]) : [];
  const flags = Array.isArray(a.red_flags) ? (a.red_flags as string[]) : [];

  return (
    <div className="space-y-5 text-sm">
      {showRedFlags && flags.length > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-200">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider">
            <AlertTriangle className="h-3 w-3" /> Red flag
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {dd.length > 0 && (
        <Block title={`감별진단 (${dd.length})`}>
          <ul className="space-y-2">
            {dd.map((d, i) => (
              <DiagRowView key={i} d={d} />
            ))}
          </ul>
        </Block>
      )}

      {terms.length > 0 && (
        <Block title={`의학용어 (${terms.length})`}>
          <ul className="space-y-2">
            {terms.map((t, i) => (
              <li key={i} className="rounded-md border border-border/40 bg-muted/30 p-2">
                <div className="text-sm font-medium">
                  {t.term}
                  {t.termEn && (
                    <span className="ml-1 text-foreground/50">({t.termEn})</span>
                  )}
                </div>
                {t.definition && (
                  <div className="mt-0.5 text-[12px] leading-relaxed text-foreground/80">
                    {t.definition}
                  </div>
                )}
                {t.contextQuote && (
                  <div className="mt-1 border-l-2 border-white/15 pl-2 text-[11px] italic text-foreground/50">
                    "{t.contextQuote}"
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {qs.length > 0 && (
        <Block title={`다음 질문 (${qs.length})`}>
          <ul className="space-y-2">
            {qs.map((q, i) => (
              <li key={i} className="rounded-md border border-border/40 bg-muted/30 p-2">
                <div className="text-sm">{q.question}</div>
                {q.rationale && (
                  <div className="mt-0.5 text-[11px] text-foreground/50">{q.rationale}</div>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function DiagRowView({ d }: { d: DiagRow }) {
  const c = d.confidence ?? 0;
  const pct = Math.round(c * 100);
  const tone =
    c >= 0.7
      ? { bar: 'bg-emerald-500', text: 'text-emerald-200', label: '높음' }
      : c >= 0.4
        ? { bar: 'bg-amber-400', text: 'text-amber-200', label: '중간' }
        : { bar: 'bg-foreground/30', text: 'text-foreground/60', label: '낮음' };
  return (
    <li className="rounded-md border border-border/40 bg-muted/30 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium">{d.name ?? '—'}</span>
          {d.nameEn && (
            <span className="ml-1 text-foreground/50">({d.nameEn})</span>
          )}
          {d.icd10 && (
            <span className="ml-1 rounded bg-white/10 px-1 font-mono text-[10px]">
              {d.icd10}
            </span>
          )}
        </div>
        <span className={`text-[11px] font-mono ${tone.text}`}>
          {tone.label} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
        <div className={`h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      {d.reasoning && (
        <div className="mt-1.5 text-[12px] leading-relaxed text-foreground/70">
          {d.reasoning}
        </div>
      )}
    </li>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/50">
        {title}
      </div>
      {children}
    </div>
  );
}
