'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pin, Search, X } from 'lucide-react';
import {
  COLOR_LABEL,
  COLOR_TOKEN,
  SESSION_COLORS,
  type SessionColor
} from '@/lib/session-colors';

const SORTS = [
  { value: 'recent', label: '최신순' },
  { value: 'oldest', label: '오래된 순' },
  { value: 'duration', label: '진료 시간 긴 순' },
  { value: 'chunks', label: '발화 많은 순' }
] as const;

const RANGES = [
  { value: 'all', label: '전체' },
  { value: '7', label: '7일' },
  { value: '30', label: '30일' }
] as const;

export type SortKey = (typeof SORTS)[number]['value'];
export type RangeKey = (typeof RANGES)[number]['value'];

export function SessionListToolbar({ total, shown }: { total: number; shown: number }) {
  const router = useRouter();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get('q') ?? '');
  const sort = (params.get('sort') as SortKey) ?? 'recent';
  const range = (params.get('range') as RangeKey) ?? 'all';
  const pinned = params.get('pinned') === '1';
  const colors = ((params.get('colors') ?? '').split(',').filter(Boolean) as SessionColor[]).filter(
    (c) => (SESSION_COLORS as readonly string[]).includes(c)
  );

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const toggleColor = (c: SessionColor) => {
    const has = colors.includes(c);
    const next = has ? colors.filter((x) => x !== c) : [...colors, c];
    setParam('colors', next.join(','));
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParam('q', q.trim());
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={onSearchSubmit} className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="별명·주호소·첫 발화 검색…"
            className="w-full rounded-md border border-border bg-muted/40 py-1.5 pl-7 pr-2 text-sm outline-none focus:border-accent"
          />
        </form>
        <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/70">
          <button
            type="button"
            onClick={() => setParam('pinned', pinned ? '' : '1')}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 transition-colors ${
              pinned
                ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                : 'border-border text-foreground/60 hover:text-foreground'
            }`}
          >
            <Pin
              className={`h-3 w-3 ${pinned ? 'fill-amber-400 text-amber-400' : ''}`}
            />
            핀
          </button>
          <Select
            value={sort}
            onChange={(v) => setParam('sort', v === 'recent' ? '' : v)}
            options={SORTS}
          />
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setParam('range', r.value === 'all' ? '' : r.value)}
                className={`rounded-full border px-2 py-1 transition-colors ${
                  range === r.value
                    ? 'border-accent bg-accent/15 text-foreground'
                    : 'border-border text-foreground/60 hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-foreground/40">
            {shown}/{total}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-foreground/40">색상</span>
        {SESSION_COLORS.map((c) => {
          const active = colors.includes(c);
          return (
            <button
              key={c}
              onClick={() => toggleColor(c)}
              title={COLOR_LABEL[c]}
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                active ? 'border-foreground/60' : 'border-transparent'
              } ${COLOR_TOKEN[c].chip}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${COLOR_TOKEN[c].dot}`} />
            </button>
          );
        })}
        {colors.length > 0 && (
          <button
            onClick={() => setParam('colors', '')}
            className="ml-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-foreground/60 hover:text-foreground"
            title="색상 필터 초기화"
          >
            <X className="h-3 w-3" /> 초기화
          </button>
        )}
      </div>
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
