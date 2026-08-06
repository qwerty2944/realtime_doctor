// realtime_doctor -- 자격 판정 규칙 (S2 에서 확정, A1 에서 추출).
//
// 원래 이 코드는 entitlement 함수 안에만 있었다. A1 에서 AI 프록시
// (`ai-gemini`, `ai-realtime`)가 같은 판정을 해야 하게 되면서 여기로 뺐다.
//
// [HARD] 판정 구현은 하나뿐이어야 한다. 프록시가 자기 나름의 판정을 갖는 순간
// 두 판정이 갈라지고, 갈라진 날 "화면엔 만료인데 API 는 계속 나간다"(= 만료된
// 계정이 소유자 크레딧을 계속 쓴다) 또는 "결제했는데 분석이 안 된다"가 된다.
// S5 의 크론이 만료 전환 조건을 entitlement 와 글자 그대로 맞춘 것과 같은 이유다.

export type Row = {
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  grace_until: string | null;
};

export const SUBSCRIPTION_COLUMNS =
  'plan_code, status, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, grace_until';

export type EffectiveStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'canceled'
  | 'none';

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * 날짜 우선순위 규칙 (S2 에서 확정).
 *
 * status 를 그대로 믿지 않는다. 크론이 한 번 실패하면 current_period_end 가
 * 과거인 채로 status='active' 인 행이 남는데, 그걸 믿으면 결제가 끊긴 계정이
 * 영원히 열린다. 반대로 날짜만 보면 canceled 계정이 기간 안이라고 열린다.
 * 그래서 둘 다 본다:
 *
 *   1. 행 없음                  -> 자격 없음 (fail-closed).
 *   2. status 가 종결 상태
 *      (canceled | expired)     -> 날짜와 무관하게 자격 없음.
 *   3. 그 외에는 status 가 "어떤 날짜가 유효한지"만 정하고,
 *      실제 판정은 그 날짜가 한다:
 *        trialing -> trial_ends_at
 *        active   -> current_period_end
 *        past_due -> max(current_period_end, grace_until)
 *                    (유예 중에는 막지 않는다 -- 계획서 4장)
 *   4. 해당 날짜가 없음(null)   -> 자격 없음. "언제까지인지 모르는 자격"은
 *                                 데이터 오류이고, 오류는 닫는 쪽으로 푼다.
 *   5. entitled = now < coverageEnd.
 *
 * 만료로 판정되면 실효 status 를 'expired' 로 내려 적는다 -- 앱은 DB 가 뭐라고
 * 적어놨든 화면에 "만료"를 보여줘야 한다.
 */
export function derive(
  row: Row | null,
  nowMs: number
): {
  entitled: boolean;
  status: EffectiveStatus;
  coverageEnd: string | null;
  reason: string;
} {
  if (!row) {
    return {
      entitled: false,
      status: 'none',
      coverageEnd: null,
      reason: 'no_subscription_row'
    };
  }

  const raw = (row.status ?? '').trim();

  if (raw === 'canceled' || raw === 'expired') {
    return { entitled: false, status: raw, coverageEnd: null, reason: `status_${raw}` };
  }

  let coverage: number | null = null;
  let basis = '';
  if (raw === 'trialing') {
    coverage = ms(row.trial_ends_at);
    basis = 'trial_ends_at';
  } else if (raw === 'active') {
    coverage = ms(row.current_period_end);
    basis = 'current_period_end';
  } else if (raw === 'past_due') {
    const a = ms(row.current_period_end);
    const b = ms(row.grace_until);
    coverage = a === null ? b : b === null ? a : Math.max(a, b);
    basis = 'max(current_period_end,grace_until)';
  } else {
    return {
      entitled: false,
      status: 'none',
      coverageEnd: null,
      reason: `unknown_status_${raw || 'empty'}`
    };
  }

  if (coverage === null) {
    return {
      entitled: false,
      status: 'expired',
      coverageEnd: null,
      reason: `missing_${basis}`
    };
  }

  const iso = new Date(coverage).toISOString();
  if (nowMs >= coverage) {
    return { entitled: false, status: 'expired', coverageEnd: iso, reason: `lapsed_${basis}` };
  }
  return {
    entitled: true,
    status: raw as EffectiveStatus,
    coverageEnd: iso,
    reason: `covered_by_${basis}`
  };
}
