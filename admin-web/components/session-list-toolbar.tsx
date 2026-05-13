'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

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

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParam('q', q.trim());
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <form onSubmit={onSearchSubmit} className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="주호소·첫 발화 검색…"
          className="w-full rounded-md border border-border bg-muted/40 py-1.5 pl-7 pr-2 text-sm outline-none focus:border-accent"
        />
      </form>
      <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/70">
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
