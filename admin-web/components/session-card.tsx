'use client';

import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  MoreHorizontal,
  Mic,
  NotebookPen,
  Pin,
  Sparkles,
  Tag
} from 'lucide-react';
import { fmtDate, fmtDuration } from '@/lib/format';
import { COLOR_LABEL, COLOR_TOKEN, SESSION_COLORS, type SessionColor } from '@/lib/session-colors';
import { updateSessionMeta } from '@/app/admin/users/[id]/sessions/[sessionId]/actions';
import { Spinner } from './spinner';

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
  alias: string | null;
  color: SessionColor | null;
  pinned: boolean;
}

export function SessionCard({
  s: initialS,
  href
}: {
  s: SessionCardData;
  href: string;
}) {
  const [s, setS] = useState(initialS);
  const router = useRouter();
  const durationMs = s.ended_at
    ? new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()
    : null;
  const total = s.doctor_count + s.patient_count;
  const drPct = total > 0 ? (s.doctor_count / total) * 100 : 0;
  const preview = (s.chief_complaint?.trim() || s.first_text || '').slice(0, 140);

  const patch = async (p: { alias?: string | null; color?: SessionColor | null; pinned?: boolean; ended_at?: string | null }) => {
    const prev = s;
    setS((c) => ({ ...c, ...p }));
    const res = await updateSessionMeta({ sessionId: s.id, ...p });
    if (!res.ok) {
      setS(prev);
      alert(`저장 실패: ${res.error ?? ''}`);
      return;
    }
    router.refresh();
  };

  const colorBar = s.color ? COLOR_TOKEN[s.color].bar : 'bg-transparent';

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label="세션 상세 열기"
      onClick={(e) => {
        // 카드 내부의 버튼/링크/입력 등 기존 인터랙티브 요소 클릭은 그대로 둔다
        if ((e.target as HTMLElement).closest('a, button, input')) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        if ((e.target as HTMLElement).closest('a, button, input')) return;
        e.preventDefault();
        router.push(href);
      }}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-accent/50 hover:shadow-lg ${
        s.color ? COLOR_TOKEN[s.color].tint : 'hover:bg-muted/20'
      }`}
    >
      {/* 좌측 컬러 바 */}
      <div className={`absolute inset-y-0 left-0 w-1 ${colorBar}`} />

      <div className="flex items-start gap-3 p-5 pl-6">
        <div className="min-w-0 flex-1">
          {/* 헤더: 핀 + 알리아스 (편집 가능) */}
          <div className="flex items-center gap-2">
            {s.pinned && (
              <Pin className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" />
            )}
            <AliasInline
              alias={s.alias}
              onCommit={(v) => patch({ alias: v })}
              fallback={fmtDate(s.started_at)}
            />
          </div>

          {/* 메타 라인 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/55">
            {s.color && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${COLOR_TOKEN[s.color].chip}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${COLOR_TOKEN[s.color].dot}`} />
                {COLOR_LABEL[s.color]}
              </span>
            )}
            {s.alias && <span>{fmtDate(s.started_at)}</span>}
            <span>{fmtDuration(durationMs)}</span>
            <span>발화 {s.chunk_count}</span>
          </div>

          {/* 주호소 / 첫 발화 preview */}
          {preview && (
            <div className="mt-2 line-clamp-2 text-sm text-foreground/80">
              {s.chief_complaint && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
                  주호소 ·{' '}
                </span>
              )}
              {preview}
            </div>
          )}

          {/* 화자 비율 */}
          {total > 0 && (
            <div className="mt-3 max-w-md">
              <div className="h-1 overflow-hidden rounded-full bg-emerald-500/30">
                <div className="h-full bg-sky-500/80" style={{ width: `${drPct}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-foreground/40">
                <span>의사 {s.doctor_count}</span>
                <span>환자 {s.patient_count}</span>
              </div>
            </div>
          )}

          {/* 상태 chips + 진입 링크 */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground/50">
            <div className="flex flex-wrap items-center gap-1.5">
              {s.has_analysis && <Chip icon={<Sparkles className="h-3 w-3" />}>분석</Chip>}
              {s.has_summary && <Chip icon={<FileText className="h-3 w-3" />}>요약</Chip>}
              {s.has_dictation && <Chip icon={<NotebookPen className="h-3 w-3" />}>받아쓰기</Chip>}
              {s.audio_path && <Chip icon={<Mic className="h-3 w-3" />}>음성</Chip>}
              {!s.ended_at && (
                <Chip className="border-amber-500/40 bg-amber-500/10 text-amber-200">진행 중</Chip>
              )}
            </div>
            <Link
              href={href}
              prefetch
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <OpenLinkLabel />
            </Link>
          </div>
        </div>

        {/* 우상단 액션 메뉴 — 드롭다운 내부 클릭이 카드 네비게이션으로 번지지 않게 차단 */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative flex-shrink-0 opacity-60 group-hover:opacity-100"
        >
          <ActionsMenu
            pinned={s.pinned}
            color={s.color}
            inProgress={!s.ended_at}
            onTogglePin={() => patch({ pinned: !s.pinned })}
            onSetColor={(c) => patch({ color: c })}
            onToggleInProgress={() =>
              patch({ ended_at: s.ended_at ? null : new Date().toISOString() })
            }
          />
        </div>
      </div>
    </div>
  );
}

function OpenLinkLabel() {
  const { pending } = useLinkStatus();
  return pending ? (
    <>
      여는 중 <Spinner className="h-3 w-3" />
    </>
  ) : (
    <>
      열기 <ArrowRight className="h-3 w-3" />
    </>
  );
}

function AliasInline({
  alias,
  onCommit,
  fallback
}: {
  alias: string | null;
  onCommit: (next: string | null) => void;
  fallback: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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

  if (alias) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(alias);
          setEditing(true);
        }}
        className="truncate text-left text-base font-semibold hover:text-accent"
        title="클릭해서 별명 수정"
      >
        {alias}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 text-left"
      title="별명 추가"
    >
      <span className="text-base font-semibold text-foreground/90">{fallback}</span>
      <span className="rounded border border-dashed border-foreground/20 px-1.5 py-0.5 text-[10px] text-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
        + 별명
      </span>
    </button>
  );
}

function ActionsMenu({
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
