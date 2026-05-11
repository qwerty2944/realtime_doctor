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

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}
