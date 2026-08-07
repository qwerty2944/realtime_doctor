/**
 * 프로버의 스케줄 상수. 프로버와 헬스체크가 **같은 값**을 봐야 하므로 한 곳에 둔다.
 *
 * ── 왜 하루에 한 번인가 (설계가 아니라 요금제 제약이다)
 *
 * doctor-web 이 올라가 있는 Vercel 계정은 Hobby 플랜이고, Hobby 의 Cron 은
 * **하루 한 번**까지만 실행된다. 진료 중에 쓰이는 제품을 하루 한 번 확인하는
 * 것은 충분하지 않다. 이건 타협이고, 다음 두 가지 중 하나로 해소된다:
 *
 *   1. Vercel Pro 로 올린 뒤 `doctor-web/vercel.json` 의 schedule 을
 *      `*​/5 * * * *` 로 바꾸고 아래 상수를 5 로 바꾼다. 코드 변경은 없다.
 *   2. 외부 스케줄러(cron-job.org 등 무료)로 같은 URL 을
 *      `Authorization: Bearer $CRON_SECRET` 과 함께 5분마다 친다. 이쪽은
 *      **감시자가 Vercel 밖에 있다**는 추가 이점이 있다 -- Vercel 자체가 죽으면
 *      Vercel 위의 크론도 같이 죽으므로, 지금 구성은 그 경우를 볼 수 없다.
 *
 * 어느 쪽이든 `OPS_PROBE_INTERVAL_MINUTES` 만 맞춰 주면 되고, 그 값이
 * `ops_probe_runs.expected_next_run_at` 로 DB 에 기록되어 모든 판독자가 같은
 * 기대치를 쓴다.
 */

/** Hobby 플랜의 Cron 상한. vercel.json 의 `0 18 * * *` 과 같은 뜻이다. */
export const DEFAULT_INTERVAL_MINUTES = 1440;

export function probeIntervalMinutes(): number {
  const raw = process.env.OPS_PROBE_INTERVAL_MINUTES?.trim();
  if (!raw) return DEFAULT_INTERVAL_MINUTES;
  const parsed = Number(raw);
  // 잘못된 값을 조용히 기본값으로 흘리면 기대치와 실제 스케줄이 어긋난 채
  // "지연 아님"이 계속 보고된다. 양수가 아니면 기본값으로 되돌리되, 그 사실이
  // 로그에 남게 한다.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[ops] OPS_PROBE_INTERVAL_MINUTES="${raw}" 는 양수가 아니라 무시하고 ${DEFAULT_INTERVAL_MINUTES}분을 씁니다.`,
    );
    return DEFAULT_INTERVAL_MINUTES;
  }
  return parsed;
}

/**
 * 프로버가 죽었다고 판정하는 기준.
 *
 * 예정 시각을 한 주기 더 넘겼을 때. 한 번 거른 것은 콜드 스타트나 배포일 수
 * 있고, 두 번은 멈춘 것이다. `ops_probe_status` 뷰의 `prober_stale` 과 같은
 * 규칙이며, 뷰 쪽 정의가 원본이다(0017 §3).
 */
export function staleAfterMinutes(): number {
  return probeIntervalMinutes() * 2;
}
