// Pricing constants — 갱신이 필요하면 이 파일을 수정 후 redeploy.
// 모든 금액은 USD.
//
// [HARD] 단가를 모르는 모델은 0 이 아니라 **미산정**이다.
// -------------------------------------------------------------------------
// 이 파일의 이전 판은 `costForRow` 가 표에 없는 모델에 대해 그냥 0 을 돌려줬다.
// 그 결과 제품이 gemini-3.5-flash-lite 로 갈아탄 순간, 어드민의 비용 열 전체가
// ₩0 으로 읽혔다 — 원가를 보이게 만들려고 만든 화면이 조용한 기본값 하나에
// 무력화된 것이다. 월 70,000원을 받는 제품이 자기 매출원가를 0 으로 본다.
//
// 그래서 두 겹으로 막는다.
//
//   1) 컴파일 타임 — {@link ACTIVE_GEMINI_MODELS}
//      배포가 실제로 쓰는 모델 id 목록이고, `satisfies` 로 PRICING.gemini 의
//      키여야 함을 강제한다. 목록에 새 모델을 넣으면서 표에 항목을 만들지
//      않으면 `npm run typecheck` 가 깨진다. 즉 모델 교체가 가격표를
//      **말없이** 지나갈 수 없다.
//
//   2) 런타임 — {@link UNPRICED} 와 {@link Cost}
//      컴파일 타임 가드만으로는 부족하다. 모델은 코드가 아니라 환경변수
//      (`GEMINI_*_MODEL`, Edge Function 의 `GEMINI_ALLOWED_MODELS`)로도 바뀌고,
//      그 경로는 타입 검사를 지나지 않는다. 그래서 표에 항목이 있더라도
//      단가를 아직 모르면 {@link UNPRICED} 로 **명시**하고, 화면은 그 행을
//      0 이 아니라 "미산정" 으로 그리며 합계에서 빼고 몇 건이 빠졌는지 말한다.
//      합계가 미산정 행을 조용히 누락하면 같은 버그가 한 층 위에서 반복된다.
//
// 요약: 표에 없으면 타입 검사가 깨지고, 표에 있는데 단가가 없으면 화면이
// 미산정이라고 말한다. 어느 쪽도 0 으로 보이지 않는다.

/**
 * "이 모델은 안다. 단가는 아직 모른다" 를 나타내는 표식.
 *
 * 항목을 아예 빼는 것과 다르다. 빠진 항목은 실수지만, 이 값은 결정이다 —
 * 그리고 화면에 미산정으로 드러난다.
 */
export const UNPRICED = { unpriced: true } as const;
export type Unpriced = typeof UNPRICED;

export type TokenRate = { input_per_1m: number; output_per_1m: number };

export function isUnpriced(rate: unknown): rate is Unpriced {
  return typeof rate === 'object' && rate !== null && 'unpriced' in rate;
}

export const PRICING = {
  gemini: {
    'gemini-2.5-flash': { input_per_1m: 0.075, output_per_1m: 0.3 },
    'gemini-2.5-pro': { input_per_1m: 1.25, output_per_1m: 10.0 },
    'gemini-2.0-flash': { input_per_1m: 0.1, output_per_1m: 0.4 },

    // ── TODO(pricing): 실제 단가를 여기에 채운다 ──────────────────────────
    // gemini-3.5-flash-lite 는 현재 제품이 다섯 개 Gemini task 전부에 쓰는
    // 모델이다(커밋 0b137d9). 공식 단가를 확인하기 전에는 값을 지어내지
    // 않는다 — 틀린 숫자는 0 보다 나쁘다. 0 은 "모른다" 로 읽힐 여지라도
    // 있지만 그럴듯한 오답은 그대로 믿긴다.
    //
    // 확인처: https://ai.google.dev/gemini-api/docs/pricing
    // 채우는 법: UNPRICED 를 { input_per_1m: X, output_per_1m: Y } 로 교체.
    // 그 순간 어드민의 "미산정" 배지와 경고 배너가 저절로 사라진다.
    'gemini-3.5-flash-lite': UNPRICED
    // ─────────────────────────────────────────────────────────────────────
  },
  'openai-realtime': {
    'gpt-4o-transcribe': { audio_per_minute_usd: 0.006 }
  },
  clova: {
    'clova-csr': { per_chunk_usd: 0.001 },
    'clova-stream': { per_minute_usd: 0.02, approx_chars_per_minute: 600 }
  }
} as const;

/**
 * 이 배포가 실제로 호출하는 Gemini 모델 id.
 *
 * [HARD] `.env.example` 의 다섯 `GEMINI_*_MODEL` 과 ai-gemini Edge Function 의
 * `GEMINI_ALLOWED_MODELS` 시크릿에 맞춰 유지한다. 셋이 어긋나면 프록시가
 * 400 model_not_allowed 로 거절하거나(무해·즉시 발견), 여기 목록만 뒤처져
 * 비용이 미산정으로 새어 나간다(유해·조용함).
 *
 * `satisfies` 가 컴파일 타임 가드다: 여기 적힌 id 는 반드시 PRICING.gemini 의
 * 키여야 한다. 값을 바꾸면서 표를 안 건드리면 typecheck 가 깨진다.
 */
export const ACTIVE_GEMINI_MODELS = [
  'gemini-3.5-flash-lite'
] as const satisfies readonly (keyof (typeof PRICING)['gemini'])[];

/**
 * 임의의 문자열로 조회하기 위한 넓힌 뷰.
 *
 * `PRICING` 자체는 `as const` 라 리터럴 키를 유지한다 — 그래야
 * {@link ACTIVE_GEMINI_MODELS} 의 `satisfies` 가 실제로 무언가를 검사한다.
 * (여기서 `Record<string, …>` 로 캐스팅해 버리면 키 타입이 `string` 이 되어
 * 컴파일 타임 가드가 아무것도 막지 못한다.) 조회는 DB 에서 온 문자열로
 * 하므로, 넓히는 일은 이 한 줄에 가둔다.
 */
const GEMINI_RATES: Readonly<Record<string, TokenRate | Unpriced | undefined>> =
  PRICING.gemini;

export type UsageRow = {
  provider: 'gemini' | 'openai-realtime' | 'clova-csr' | 'clova-stream' | string;
  task: string;
  model: string;
  prompt_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  chars: number | null;
  duration_ms: number | null;
};

/**
 * 한 행의 비용.
 *
 * `usd` 는 미산정일 때도 0 이지만, 그 0 은 `priced: false` 와 함께만 나온다.
 * 호출자가 `.usd` 만 더하면 옛 동작 그대로이고, 미산정을 표시하고 싶으면
 * `priced` 를 보면 된다 — 그리고 화면들은 전부 본다.
 */
export type Cost =
  | { priced: true; usd: number }
  | {
      priced: false;
      usd: 0;
      /** 왜 산정하지 못했는지. 로그·툴팁용. */
      reason: 'unpriced_model' | 'unknown_model' | 'unknown_provider';
      /** 사람이 읽을 식별자. "gemini / gemini-3.5-flash-lite" 형태. */
      label: string;
    };

const priced = (usd: number): Cost => ({ priced: true, usd });

function unpriced(
  reason: 'unpriced_model' | 'unknown_model' | 'unknown_provider',
  provider: string,
  model: string
): Cost {
  return {
    priced: false,
    usd: 0,
    reason,
    label: model ? `${provider} / ${model}` : provider
  };
}

/**
 * 행 하나의 비용을 계산한다.
 *
 * 단가를 모르면 0 을 돌려주지 않고 `priced: false` 를 돌려준다. 이 함수가
 * 조용히 0 을 말하지 않는 것이 이 파일 전체의 요점이다.
 */
export function costForRow(r: UsageRow): Cost {
  if (r.provider === 'gemini') {
    const tier = GEMINI_RATES[r.model];
    if (!tier) return unpriced('unknown_model', r.provider, r.model);
    if (isUnpriced(tier)) return unpriced('unpriced_model', r.provider, r.model);
    const input = ((r.prompt_tokens ?? 0) * tier.input_per_1m) / 1_000_000;
    const output = ((r.output_tokens ?? 0) * tier.output_per_1m) / 1_000_000;
    return priced(input + output);
  }
  if (r.provider === 'openai-realtime') {
    const tier =
      PRICING['openai-realtime'][r.model as keyof (typeof PRICING)['openai-realtime']];
    if (!tier) return unpriced('unknown_model', r.provider, r.model);
    const minutes = (r.duration_ms ?? 0) / 60_000;
    return priced(minutes * tier.audio_per_minute_usd);
  }
  if (r.provider === 'clova-csr') {
    return priced(PRICING.clova['clova-csr'].per_chunk_usd);
  }
  if (r.provider === 'clova-stream') {
    const cps = PRICING.clova['clova-stream'].approx_chars_per_minute;
    const minutes = (r.chars ?? 0) / cps;
    return priced(minutes * PRICING.clova['clova-stream'].per_minute_usd);
  }
  return unpriced('unknown_provider', r.provider, r.model);
}

/** 산정된 금액만. 합계를 낼 때는 {@link sumCosts} 를 쓴다 — 미산정 건수가 함께 필요하다. */
export function usdForRow(r: UsageRow): number {
  return costForRow(r).usd;
}

/** 미산정 행 요약. 0 이면 화면에 아무것도 뜨지 않는다. */
export interface UnpricedSummary {
  /** 미산정 행 수. */
  count: number;
  /** 미산정 식별자 목록(중복 제거, 정렬). */
  labels: string[];
}

export interface CostTotal {
  /** 산정 가능한 행들의 합계. 미산정 행은 **들어 있지 않다**. */
  usd: number;
  unpriced: UnpricedSummary;
}

/**
 * 합계 + 미산정 요약.
 *
 * 합계만 돌려주지 않는 이유: 미산정 행을 말없이 빼면 "합계가 0 이다" 대신
 * "합계가 낮다" 가 되는데, 그건 더 알아채기 어려운 같은 버그다. 호출자가
 * 몇 건이 빠졌는지 보고 화면에 말하도록 강제한다.
 */
export function sumCosts(rows: readonly UsageRow[]): CostTotal {
  let usd = 0;
  let count = 0;
  const labels = new Set<string>();

  for (const r of rows) {
    const c = costForRow(r);
    if (c.priced) {
      usd += c.usd;
    } else {
      count += 1;
      labels.add(c.label);
    }
  }

  return { usd, unpriced: { count, labels: [...labels].sort() } };
}

/** 두 요약을 합친다(30일 / 누적처럼 여러 집계를 한 배너로 묶을 때). */
export function mergeUnpriced(...parts: readonly UnpricedSummary[]): UnpricedSummary {
  const labels = new Set<string>();
  let count = 0;
  for (const p of parts) {
    count += p.count;
    for (const l of p.labels) labels.add(l);
  }
  return { count, labels: [...labels].sort() };
}
