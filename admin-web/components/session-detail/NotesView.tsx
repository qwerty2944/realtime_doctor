'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, ClipboardCopy, Download, Pencil, X } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { Spinner } from '../spinner';
import {
  copyMarkdown,
  dictationToMarkdown,
  downloadMarkdown,
  summaryToMarkdown,
  type DictationLike,
  type SummaryLike
} from '@/lib/exports';
import { updateDictationSectionsAction } from '@/app/admin/users/[id]/sessions/[sessionId]/actions';

interface SummaryRow extends SummaryLike {
  id: string;
}
interface DictationRow extends DictationLike {
  id: string;
}

export function NotesView({
  sessionId,
  summaries,
  dictations
}: {
  sessionId?: string;
  summaries?: SummaryRow[];
  dictations?: DictationRow[];
}) {
  if (summaries) return <SummaryCards rows={summaries} />;
  if (dictations) return <DictationCards sessionId={sessionId ?? ''} rows={dictations} />;
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
    ['주호소', s.chief_complaint],
    ['현병력', s.history_of_present_illness],
    ['관련 소견', s.pertinent_findings],
    ['검사·약물 언급', s.investigations_mentioned],
    ['임상 인상', s.clinical_impression],
    ['계획', s.plan]
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

function DictationCards({
  sessionId,
  rows
}: {
  sessionId: string;
  rows: DictationRow[];
}) {
  if (rows.length === 0) {
    return <Empty>아직 생성된 받아쓰기가 없습니다.</Empty>;
  }
  return (
    <div className="space-y-4">
      {rows.map((d) => (
        <DictationCard key={d.id} sessionId={sessionId} initial={d} />
      ))}
    </div>
  );
}

type Section = { heading: string; body: string };

function normalizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const obj = (s as { heading?: unknown; body?: unknown }) ?? {};
    return {
      heading: typeof obj.heading === 'string' ? obj.heading : '',
      body: typeof obj.body === 'string' ? obj.body : ''
    };
  });
}

function DictationCard({
  sessionId,
  initial
}: {
  sessionId: string;
  initial: DictationRow;
}) {
  const [sections, setSections] = useState<Section[]>(() => normalizeSections(initial.sections));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Section[]>(sections);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!editing) setDraft(sections);
  }, [editing, sections]);

  const startEdit = () => {
    setDraft(sections);
    setEditing(true);
  };
  const cancel = () => {
    setDraft(sections);
    setEditing(false);
  };
  const save = () => {
    const cleaned = draft.map((s) => ({ heading: s.heading, body: s.body }));
    if (
      cleaned.length === sections.length &&
      cleaned.every(
        (s, i) =>
          s.heading === sections[i]?.heading && s.body === sections[i]?.body
      )
    ) {
      setEditing(false);
      return;
    }
    if (!sessionId) {
      alert('세션 정보를 찾을 수 없습니다.');
      return;
    }
    const prev = sections;
    setSections(cleaned);
    setEditing(false);
    startSaving(async () => {
      const res = await updateDictationSectionsAction({
        sessionId,
        dictationId: initial.id,
        sections: cleaned
      });
      if (!res.ok) {
        setSections(prev);
        setDraft(prev);
        setEditing(true);
        alert(`저장 실패: ${res.error ?? '알 수 없는 오류'}`);
      }
    });
  };

  const md = dictationToMarkdown({ ...initial, sections });

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Toolbar
        left={
          <span className="flex items-center gap-2 text-[11px] text-foreground/50">
            <span className="rounded bg-white/10 px-1 py-0.5 font-mono uppercase">
              {initial.template}
            </span>
            생성 {fmtDate(initial.generated_at)}
            {saving && <Spinner className="h-3 w-3" />}
          </span>
        }
        md={md}
        filename={`dictation-${initial.id}.md`}
        extra={
          editing ? (
            <>
              <button
                onClick={save}
                disabled={saving}
                title="저장"
                className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-1.5 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={cancel}
                disabled={saving}
                title="취소"
                className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={startEdit}
              title="수정"
              className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )
        }
      />
      <div className="mt-3 space-y-3 text-sm">
        {editing
          ? draft.map((sec, i) => (
              <SectionEditor
                key={i}
                section={sec}
                onChange={(next) =>
                  setDraft((d) => d.map((s, j) => (j === i ? next : s)))
                }
              />
            ))
          : sections.map((sec, i) => (
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
}

function SectionEditor({
  section,
  onChange
}: {
  section: Section;
  onChange: (next: Section) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [section.body]);
  return (
    <div>
      <input
        type="text"
        value={section.heading}
        onChange={(e) => onChange({ ...section, heading: e.target.value })}
        placeholder="섹션 제목"
        className="w-full rounded border border-border bg-background/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/70 outline-none focus:border-accent"
      />
      <textarea
        ref={ref}
        value={section.body}
        onChange={(e) => onChange({ ...section, body: e.target.value })}
        placeholder="내용"
        rows={3}
        className="mt-1 w-full resize-none rounded border border-border bg-background/60 px-2 py-1.5 text-sm text-foreground/90 outline-none focus:border-accent"
      />
    </div>
  );
}

function Toolbar({
  left,
  md,
  filename,
  extra
}: {
  left: React.ReactNode;
  md: string;
  filename: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>{left}</div>
      <div className="flex items-center gap-1">
        {extra}
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
