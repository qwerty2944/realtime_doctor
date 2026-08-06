import type { UnpricedSummary } from '@/lib/pricing';
import { fmtInt } from '@/lib/format';

/**
 * 합계에서 빠진 미산정 행을 화면에 말한다.
 *
 * 왜 필요한가: 단가를 모르는 모델을 합계에서 빼는 것 자체는 옳다(모르는 값을
 * 0 으로 더하면 합계가 거짓말이 된다). 하지만 **빠졌다는 사실을 말하지 않으면**
 * 합계는 여전히 거짓말이다 — "0 원" 대신 "실제보다 낮은 금액" 이라는, 더
 * 알아채기 어려운 형태로. 그래서 미산정이 한 건이라도 있으면 이 배너가 뜬다.
 *
 * 미산정이 0 건이면 아무것도 렌더링하지 않는다. 단가를 채우는 순간
 * (`admin-web/lib/pricing.ts` 의 UNPRICED 를 실제 값으로 교체) 저절로 사라진다.
 */
export function UnpricedNotice({
  summary,
  scope
}: {
  summary: UnpricedSummary;
  /** "최근 30일", "누적" 처럼 어떤 집계에 대한 경고인지. */
  scope?: string;
}) {
  if (summary.count === 0) return null;

  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      <div className="font-semibold">
        비용 미산정 {fmtInt(summary.count)}건{scope ? ` (${scope})` : ''} — 아래 합계에
        포함되지 않았습니다.
      </div>
      <div className="mt-1 text-xs text-amber-200/80">
        단가를 모르는 공급자·모델:{' '}
        <span className="font-mono">{summary.labels.join(', ')}</span>
        {' · '}
        <code className="font-mono">admin-web/lib/pricing.ts</code> 에 단가를 채우면
        합계에 반영됩니다.
      </div>
    </div>
  );
}
