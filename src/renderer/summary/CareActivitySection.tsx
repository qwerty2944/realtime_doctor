import { useEffect, useState } from 'react';
import { ClipboardList, CornerDownRight, Quote } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { useT } from '../shared/i18n';
import type { TKey } from '../shared/i18n';
import {
  formatTimeRange,
  type CareActivityDisplayPayload,
  type CareActivityEmptyReason,
  type ReleasedCareActivityCandidate
} from '../../shared/careActivities';

/**
 * 이번 진료에서 기록된 행위 (B3).
 *
 * **왜 요약 창인가.** 이 목록은 진료가 끝난 뒤 한 번 훑는 것이고, 요약 창이
 * 이미 그 자리를 차지하고 있다 — 의사가 "이번 진료 정리"를 보려고 여는 창이
 * 하나뿐이어야 진료 중에 시선이 흩어지지 않는다. 감별진단 창은 진료 중에
 * 보는 창이라 여기에 붙이면 이 목록이 진료 흐름 한복판을 끊는다.
 * 확인요청 큐(questions)는 E2 가 아직 정의되지 않았고, 지금 붙이면 "답하면
 * 사라지는 항목"이라는 큐의 의미를 이 목록이 먼저 규정해버린다.
 *
 * **끼어들지 않는다.** 모달도 알림도 없고, 스스로 창을 띄우지도 않는다.
 * 요약 창이 열려 있을 때만 조회하고, 언제 볼지는 의사가 정한다.
 *
 * [HARD] 여기 오는 항목은 전부 `releaseForDisplay()` 를 통과한 것이다 —
 * 타입(`ReleasedCareActivityCandidate`)이 그것을 보장한다. 이 컴포넌트는
 * 어떤 필터도 판정도 하지 않으며, 문장을 만들어내지도 않는다.
 */

const EMPTY_TKEY: Record<CareActivityEmptyReason, TKey> = {
  'none-reviewed': 'care.emptyNoneReviewed',
  'no-evidence': 'care.emptyNoEvidence',
  'no-session': 'care.emptyNoSession',
  'intake-no-timestamps': 'care.emptyIntake'
};

function CandidateCard({ item }: { item: ReleasedCareActivityCandidate }) {
  const t = useT();
  const seconds = item.timeRange.durationSeconds;
  const duration =
    seconds >= 60
      ? `${Math.round(seconds / 60)}${t('care.durationMinutes')}`
      : `${seconds}${t('care.durationSeconds')}`;

  return (
    <div className="rounded border border-emerald-400/25 bg-emerald-500/[0.07] p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-emerald-50/95">
          {item.label}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-emerald-200/80">
          {formatTimeRange(item.timeRange)} · {duration}
        </span>
      </div>
      {item.description && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
          {item.description}
        </p>
      )}
      <ul className="mt-1.5 space-y-0.5">
        {item.quotes.map((q) => (
          <li key={q.utteranceId}>
            {/* 근거 클릭 = E1 이 이미 만든 경로. 새 메커니즘을 만들지 않는다:
                main 이 전사 창을 앞으로 꺼낸 뒤 발화 id 를 broadcast 한다. */}
            <button
              type="button"
              title={`"${q.quote}"\n${t('care.quoteHint')}`}
              onClick={() => window.api.focusUtterance(q.utteranceId)}
              className="w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-emerald-400/15"
            >
              <span className="flex items-start gap-1">
                <CornerDownRight className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-300/70" />
                <span className="flex-1">
                  {/* 원문 그대로. 엔진도 이 화면도 문장을 만들지 않는다. */}
                  <span className="block text-[11px] italic leading-snug text-emerald-100/90">
                    “{q.quote}”
                  </span>
                  <span className="block font-mono text-[9px] text-emerald-200/50">
                    {q.utteranceId}
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {/* 어떤 규칙이 만든 것인지 화면에서도 답할 수 있어야 한다 (provenance). */}
      <div className="mt-1 font-mono text-[9px] text-muted-foreground/70">
        {item.provenance.engineVersion} · {t('care.ruleVersion')}
        {item.provenance.ruleVersion}
      </div>
    </div>
  );
}

export function CareActivitySection() {
  const t = useT();
  const [payload, setPayload] = useState<CareActivityDisplayPayload | null>(null);

  // 요약 창이 떠 있는 동안에만, 요청할 때만 계산한다. 진료 중에 스스로
  // 튀어나오는 경로는 만들지 않는다.
  useEffect(() => {
    let cancelled = false;
    window.api.careActivities
      .scan()
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!payload) return null;

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/85">
        <ClipboardList className="h-2.5 w-2.5" />
        {t('care.title')}
        {payload.items.length > 0 && <span>· {payload.items.length}</span>}
      </div>
      <Separator />
      <p className="text-[10px] leading-snug text-muted-foreground">
        {t('care.subtitle')}
      </p>

      {payload.items.length === 0 && payload.emptyReason && (
        // 빈 화면이 고장처럼 보이지 않게 한다: 제목이 상태를 말하고 본문이
        // 이유를 말한다.
        <div className="rounded border border-dashed border-border/70 bg-muted/20 p-2">
          <div className="flex items-center gap-1 text-[11px] text-foreground/75">
            <Quote className="h-2.5 w-2.5 text-muted-foreground" />
            {t('care.emptyTitle')}
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            {t(EMPTY_TKEY[payload.emptyReason])}
          </p>
        </div>
      )}

      {payload.items.map((item) => (
        <CandidateCard key={item.activityCode} item={item} />
      ))}
    </div>
  );
}

export default CareActivitySection;
