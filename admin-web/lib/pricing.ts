// Pricing constants — 갱신이 필요하면 이 파일을 수정 후 redeploy.
// 모든 금액은 USD.

export const PRICING = {
  gemini: {
    'gemini-2.5-flash': { input_per_1m: 0.075, output_per_1m: 0.3 },
    'gemini-2.5-pro': { input_per_1m: 1.25, output_per_1m: 10.0 },
    'gemini-2.0-flash': { input_per_1m: 0.1, output_per_1m: 0.4 }
  },
  'openai-realtime': {
    'gpt-4o-transcribe': { audio_per_minute_usd: 0.006 }
  },
  clova: {
    'clova-csr': { per_chunk_usd: 0.001 },
    'clova-stream': { per_minute_usd: 0.02, approx_chars_per_minute: 600 }
  }
} as const;

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

export function costForRow(r: UsageRow): number {
  if (r.provider === 'gemini') {
    const tier = PRICING.gemini[r.model as keyof typeof PRICING.gemini];
    if (!tier) return 0;
    const input = (r.prompt_tokens ?? 0) * tier.input_per_1m / 1_000_000;
    const output = (r.output_tokens ?? 0) * tier.output_per_1m / 1_000_000;
    return input + output;
  }
  if (r.provider === 'openai-realtime') {
    const tier =
      PRICING['openai-realtime'][r.model as keyof typeof PRICING['openai-realtime']];
    if (!tier) return 0;
    const minutes = (r.duration_ms ?? 0) / 60_000;
    return minutes * tier.audio_per_minute_usd;
  }
  if (r.provider === 'clova-csr') {
    return PRICING.clova['clova-csr'].per_chunk_usd;
  }
  if (r.provider === 'clova-stream') {
    const cps = PRICING.clova['clova-stream'].approx_chars_per_minute;
    const minutes = (r.chars ?? 0) / cps;
    return minutes * PRICING.clova['clova-stream'].per_minute_usd;
  }
  return 0;
}
