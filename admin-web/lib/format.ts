const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});

const USD2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

const INT = new Intl.NumberFormat('en-US');

export function fmtUsd(n: number): string {
  if (n >= 1) return USD2.format(n);
  return USD.format(n);
}

export function fmtInt(n: number | null | undefined): string {
  return INT.format(n ?? 0);
}

const KST = 'Asia/Seoul';

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: KST
  });
}

export function fmtTime(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleTimeString('ko-KR', { timeZone: KST });
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}
