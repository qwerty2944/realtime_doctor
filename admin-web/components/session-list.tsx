'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { SessionCard, type SessionCardData } from './session-card';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

interface Group {
  key: string;
  label: string;
  icon?: React.ReactNode;
  items: SessionCardData[];
}

function startOfKstDay(date: Date): number {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  kst.setUTCHours(0, 0, 0, 0);
  return kst.getTime() - KST_OFFSET_MS;
}
function startOfKstWeek(date: Date): number {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const day = kst.getUTCDay();
  const daysSinceMon = (day + 6) % 7;
  kst.setUTCHours(0, 0, 0, 0);
  kst.setUTCDate(kst.getUTCDate() - daysSinceMon);
  return kst.getTime() - KST_OFFSET_MS;
}
function startOfKstMonth(date: Date): number {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  kst.setUTCDate(1);
  kst.setUTCHours(0, 0, 0, 0);
  return kst.getTime() - KST_OFFSET_MS;
}

export function SessionList({
  cards,
  hrefPrefix
}: {
  cards: SessionCardData[];
  // e.g. "/admin/users/abc/sessions" — `/${id}` appended per card
  hrefPrefix: string;
}) {
  const now = new Date();
  const startToday = startOfKstDay(now);
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const startWeek = startOfKstWeek(now);
  const startMonth = startOfKstMonth(now);

  const pinned: SessionCardData[] = [];
  const today: SessionCardData[] = [];
  const yesterday: SessionCardData[] = [];
  const thisWeek: SessionCardData[] = [];
  const thisMonth: SessionCardData[] = [];
  const older: SessionCardData[] = [];

  for (const c of cards) {
    if (c.pinned) {
      pinned.push(c);
      continue;
    }
    const t = new Date(c.started_at).getTime();
    if (t >= startToday) today.push(c);
    else if (t >= startYesterday) yesterday.push(c);
    else if (t >= startWeek) thisWeek.push(c);
    else if (t >= startMonth) thisMonth.push(c);
    else older.push(c);
  }

  const groups: Group[] = [
    {
      key: 'pinned',
      label: '고정',
      icon: <Pin className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />,
      items: pinned
    },
    { key: 'today', label: '오늘', items: today },
    { key: 'yesterday', label: '어제', items: yesterday },
    { key: 'week', label: '이번 주', items: thisWeek },
    { key: 'month', label: '이번 달', items: thisMonth },
    { key: 'older', label: '더 이전', items: older }
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <GroupSection key={g.key} group={g} hrefPrefix={hrefPrefix} />
      ))}
    </div>
  );
}

function GroupSection({
  group,
  hrefPrefix
}: {
  group: Group;
  hrefPrefix: string;
}) {
  const storageKey = `sessionListGroup:${group.key}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(storageKey);
    if (v === '0') setOpen(false);
  }, [storageKey]);
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      }
      return next;
    });
  };

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        className="mb-2 flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider text-foreground/50 hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {group.icon}
        <span>{group.label}</span>
        <span className="ml-1 text-foreground/30">{group.items.length}</span>
      </button>
      {open && (
        <ul className="space-y-3">
          {group.items.map((c) => (
            <li key={c.id}>
              <SessionCard s={c} href={`${hrefPrefix}/${c.id}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
