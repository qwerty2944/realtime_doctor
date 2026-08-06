/**
 * Period resolution for the statistics tab.
 *
 * Shared by the server route and the browser, so this module stays free of any
 * server-only import.
 *
 * Every date here is a plain `YYYY-MM-DD` string in Asia/Seoul, matching the
 * `day` column produced by `f_web_stats_daily`. Working in strings rather than
 * Date objects is deliberate: a `Date` carries an instant, and "이번 주" for a clinic
 * in Seoul is a range of calendar days, not a range of instants. Converting between
 * the two is where off-by-one-day bugs live.
 */

export const TIME_ZONE = 'Asia/Seoul';

export const PERIOD_PRESETS = ['today', 'week', 'month', 'custom'] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: '오늘',
  week: '이번 주',
  month: '이번 달',
  custom: '사용자 지정',
};

export interface DateRange {
  /** Inclusive start, YYYY-MM-DD. */
  from: string;
  /** Inclusive end, YYYY-MM-DD. */
  to: string;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in Seoul. `en-CA` formats as YYYY-MM-DD. */
export function seoulToday(now: Date = new Date()): string {
  return isoDateFormatter.format(now);
}

/**
 * Treat a YYYY-MM-DD string as a UTC instant so day arithmetic is exact.
 *
 * Safe because the value never leaves this module as an instant: it is converted
 * straight back to a date string by {@link fromUtcDate}.
 */
function toUtcDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const shifted = toUtcDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return fromUtcDate(shifted);
}

/** Days between two dates, inclusive of both ends. */
export function dayCount(range: DateRange): number {
  const diff = toUtcDate(range.to).getTime() - toUtcDate(range.from).getTime();
  return Math.floor(diff / 86_400_000) + 1;
}

/** Monday of the week containing `date`. Korean clinics read the week as Mon-Sun. */
function startOfWeek(date: string): string {
  const weekday = toUtcDate(date).getUTCDay(); // 0 = Sunday
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(date, -offset);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Resolve a preset into a concrete range.
 *
 * `custom` falls back to today when a bound is missing or malformed, so a hand-typed
 * URL cannot produce a range the query functions would reject.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  custom?: Partial<DateRange>,
  now: Date = new Date(),
): DateRange {
  const today = seoulToday(now);

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: startOfWeek(today), to: today };
    case 'month':
      return { from: startOfMonth(today), to: today };
    case 'custom': {
      const from = isValidDate(custom?.from) ? custom!.from! : today;
      const to = isValidDate(custom?.to) ? custom!.to! : today;
      // Swap rather than error: a physician who picked the bounds in the other
      // order meant the range between them.
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  // Rejects 2026-02-31: the round trip only survives a real calendar date.
  const parsed = toUtcDate(value);
  return !Number.isNaN(parsed.getTime()) && fromUtcDate(parsed) === value;
}

/** Korean label for the resolved range, shown above the charts and in the CSV. */
export function formatRange(range: DateRange): string {
  return range.from === range.to ? range.from : `${range.from} ~ ${range.to}`;
}
