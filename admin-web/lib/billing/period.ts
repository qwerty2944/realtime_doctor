/**
 * 구독 주기 산술 (S4에서 확정).
 *
 * 두 가지를 명시적으로 정한다. 둘 다 "정하지 않으면 조용히 돈이 새는" 종류다.
 *
 * ── 규칙 1. 다음 주기는 `current_period_end` 에서 이어붙인다. `now()` 가 아니다.
 *
 *   결제가 예약 시각보다 늦게 잡히는 일은 흔하다(PG 지연, 재시도, 웹훅 지연).
 *   그때마다 now() 를 기준으로 다음 주기를 잡으면 늦어진 만큼이 매달 공짜로
 *   나간다. 1년이면 며칠 단위로 누적되고, 어디에도 에러가 남지 않는다.
 *   그래서 새 주기의 시작은 **직전 주기의 끝**이고, 끝은 거기서 앵커일 기준
 *   한 달 뒤다. 결제가 언제 실제로 성사됐는지와 무관하다.
 *
 *   예외 하나: `current_period_end` 가 너무 오래 지났으면(STALE_PERIOD_DAYS)
 *   이어붙이기를 포기하고 now() 를 기준으로 다시 잡는다. 1년 잠들어 있던
 *   구독을 이어붙이면 계산된 다음 결제일이 여전히 과거라 즉시 또 밀린다.
 *   이 경우는 정상 흐름이 아니므로 호출부가 로그를 남긴다.
 *
 * ── 규칙 2. 말일은 클램프하되 앵커는 침식되지 않는다.
 *
 *   1월 31일에 가입한 구독의 앵커일은 31이다.
 *     1/31 → 2/28 → 3/31 → 4/30 → 5/31 ...
 *   각 달의 결제일은 min(앵커일, 그 달의 마지막 날) 이다. 2월에 28일로 잘렸다고
 *   해서 앵커가 28로 바뀌지는 않는다 -- 바뀌면 3월부터 영원히 28일이 되고,
 *   의사는 자기 결제일이 옮겨간 걸 모른 채로 산다. 그래서 앵커일은
 *   `subscriptions.billing_anchor_day` 에 따로 저장하고(0004), 직전 주기의
 *   날짜에서 유추하지 않는다.
 *
 *   그 결과 주기 길이는 28~31일 사이를 오간다. 월 정액제이므로 의도된 동작이다.
 *
 * 모든 계산은 UTC 기준이다. 저장도 timestamptz 이고 앵커일도 UTC 일자다.
 * KST 로 계산하면 UTC 자정 근처 결제가 하루 밀리거나 당겨진다.
 */

/** 이 일수 이상 밀린 주기는 이어붙이지 않고 now() 기준으로 다시 잡는다. */
export const STALE_PERIOD_DAYS = 60;

/** 그 달의 마지막 날(UTC). */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** UTC 기준 일자. 앵커일 산출에 쓴다. */
export function anchorDayOf(date: Date): number {
  return date.getUTCDate();
}

/**
 * `from` 으로부터 앵커일 기준 한 달 뒤.
 *
 * 시:분:초는 `from` 것을 그대로 유지한다. 결제 시각이 매달 조금씩 이동하면
 * 예약 시각과 실제 결제 시각의 관계를 추적하기 어려워진다.
 */
export function addMonthOnAnchor(from: Date, anchorDay: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const day = Math.min(Math.max(anchorDay, 1), lastDayOfMonth(y, m + 1));
  return new Date(
    Date.UTC(
      y,
      m + 1,
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );
}

export interface AdvanceInput {
  /** 직전 주기의 끝. null 이면 이어붙일 것이 없다. */
  currentPeriodEnd: Date | null;
  /** 저장된 앵커일. null 이면 기준 날짜에서 새로 정한다. */
  anchorDay: number | null;
  /** 현재 시각. 테스트에서 주입한다. */
  now: Date;
}

export interface AdvanceResult {
  periodStart: Date;
  periodEnd: Date;
  anchorDay: number;
  /**
   * 'continuous'  -- 직전 주기 끝에서 이어붙였다 (정상).
   * 'rebased'     -- 주기가 없거나 너무 오래 밀려 now() 기준으로 다시 잡았다.
   *                  호출부는 이 값을 보면 로그를 남겨야 한다. 정상 반복에서는
   *                  절대 나오지 않는 값이다.
   */
  basis: 'continuous' | 'rebased';
}

/**
 * 다음 결제 주기를 계산한다.
 *
 * 순수 함수다. DB 도 시계도 만지지 않는다 -- 주기 산술은 구독 시스템에서 가장
 * 조용하게 틀리는 부분이라, 테스트 가능한 형태로 떼어 둔다.
 */
export function advancePeriod(input: AdvanceInput): AdvanceResult {
  const { currentPeriodEnd, anchorDay, now } = input;

  const staleBefore = now.getTime() - STALE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const usable =
    currentPeriodEnd !== null &&
    Number.isFinite(currentPeriodEnd.getTime()) &&
    currentPeriodEnd.getTime() >= staleBefore;

  const periodStart = usable ? new Date(currentPeriodEnd.getTime()) : new Date(now.getTime());
  // 이어붙일 때만 저장된 앵커를 쓴다. 재기준(rebase) 은 이미 정상 흐름이 아니고,
  // 그 상태에서 옛 앵커를 유지하면 주기가 최대 두 달 가까이 벌어질 수 있다
  // (5일에 재기준 + 앵커 31 → 56일짜리 주기). 재기준하는 순간 앵커도 다시 잡는다.
  const effectiveAnchor = usable ? (anchorDay ?? anchorDayOf(periodStart)) : anchorDayOf(periodStart);

  return {
    periodStart,
    periodEnd: addMonthOnAnchor(periodStart, effectiveAnchor),
    anchorDay: effectiveAnchor,
    basis: usable ? 'continuous' : 'rebased'
  };
}
