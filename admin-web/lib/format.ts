import type { Cost } from '@/lib/pricing';

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

/**
 * 비용 셀 한 칸. 단가를 모르는 행은 금액 대신 "미산정" 이다.
 *
 * `fmtUsd(cost.usd)` 로 쓰면 $0.0000 이 찍히고 그건 "공짜로 썼다" 로 읽힌다.
 * 미산정과 진짜 0 원은 화면에서 구별되어야 한다.
 */
export function fmtCost(cost: Cost): string {
  return cost.priced ? fmtUsd(cost.usd) : '미산정';
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
