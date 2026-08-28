import 'server-only';

/**
 * 키오스크 문진의 모델 사용량 계량. SERVER ONLY.
 *
 * 왜 여기에 있는가
 * ----------------
 * 데스크톱의 Gemini 호출은 A1 이후 `ai-gemini` Edge Function 을 지나고, 그
 * 함수가 돈을 쓴 바로 그 요청에서 `usage_events` 를 직접 적는다
 * (`supabase/functions/_shared/gate.ts` 의 recordUsage). 키오스크는 그 경로에
 * 있지 않다 — 자기 서버측 `GEMINI_API_KEY` 로 Google 을 직접 부른다. 그 자체는
 * 문제가 아니다(서버 전용 키이므로 유출이 아니다). 문제는 **그렇게 쓴 돈이
 * 어디에도 기록되지 않는다**는 것이었다. 어드민의 원가 화면에 문진 비용이
 * 통째로 빠져 있었다.
 *
 * 이 모듈은 Edge Function 과 같은 일을 키오스크 쪽에서 한다.
 *
 * `source = 'server'` 인 이유
 * --------------------------
 * 0016 의 정의: 'server' 는 **프로바이더 호출을 스스로 한 서버가 적은 행**이고
 * 과금 근거로 삼아도 되는 값이다. 키오스크 API 라우트가 정확히 그렇다 —
 * 환자 브라우저는 토큰 수를 보지도, 이 행을 쓰지도 못한다. 서비스 롤 키로
 * 쓰므로 RLS 의 'client' 제한(0016 RESTRICTIVE 정책)에도 걸리지 않는다.
 *
 * `user_id` 는 담당 의사
 * ---------------------
 * `usage_events.user_id` 는 NOT NULL 이고 `auth.users` 를 참조한다. 환자는
 * 계정이 없다. 이 문진에 돈을 쓰게 한 주체이자 그 결과를 보는 사람은 담당
 * 의사이므로, 진료 행(`encounters.user_id`)에서 읽은 그 uuid 를 쓴다. 원가를
 * 의사별로 보는 어드민 화면의 귀속과도 일치한다.
 *
 * `session_id` 는 항상 null
 * ------------------------
 * `sessions` 는 데스크톱의 녹음 세션이다. 문진에는 대응물이 없고, 컬럼은
 * 처음부터 nullable 이다(0000 의 주석 참고).
 *
 * [HARD] 계량은 절대 문진을 깨뜨리지 않는다
 * ----------------------------------------
 * 모든 실패를 삼키고 `console.error` 로만 남긴다. 환자가 태블릿 앞에 서 있고,
 * 회계 행을 못 썼다는 이유로 문진을 500 으로 끝내는 것은 손해가 훨씬 크다.
 * 다만 **조용히** 삼키지는 않는다 — 로그가 없으면 "계량되고 있다" 는 착각이
 * 생기고, 그건 계량이 아예 없는 것보다 나쁘다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { LlmUsage } from '@/lib/llm';

/**
 * 계량 라벨. 어드민의 task별 비용 표에서 문진 비용이 데스크톱 task
 * (analyze/summarize/…)와 섞이지 않도록 접두사를 붙인다.
 */
export type KioskUsageTask = 'kiosk-interview' | 'kiosk-result';

/** `usage_events.platform`. 이 행이 어느 앱에서 왔는지. */
const PLATFORM = 'kiosk';

/**
 * 모델 호출 한 번을 `usage_events` 에 적는다.
 *
 * 던지지 않는다. 반환값도 없다 — 호출자가 결과에 따라 할 일이 없기 때문이다.
 */
export async function recordKioskUsage(
  supabase: SupabaseClient,
  params: {
    /** 담당 의사 auth user id. `encounters.user_id` 에서 읽은 값이어야 한다. */
    clinicianId: string;
    task: KioskUsageTask;
    usage: LlmUsage;
    /** 로그에만 쓴다. 행에는 넣지 않는다(문진 id 는 회계 정보가 아니다). */
    encounterId?: string;
  }
): Promise<void> {
  const { clinicianId, task, usage, encounterId } = params;

  try {
    const { error } = await supabase.from('usage_events').insert({
      user_id: clinicianId,
      session_id: null,
      provider: usage.provider,
      task,
      model: usage.model,
      prompt_tokens: usage.prompt_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      chars: null,
      duration_ms: usage.duration_ms,
      platform: PLATFORM,
      source: 'server'
    });

    if (error) {
      console.error(
        `[usage] Failed to record ${task} usage${
          encounterId ? ` for encounter ${encounterId}` : ''
        }: ${error.message}`
      );
    }
  } catch (error) {
    console.error(
      `[usage] Unexpected failure recording ${task} usage${
        encounterId ? ` for encounter ${encounterId}` : ''
      }.`,
      error
    );
  }
}

/**
 * `callStructuredTool({ onUsage })` 에 그대로 넘길 수 있는 수집기.
 *
 * `onUsage` 는 동기 콜백이고 라우트는 응답을 빨리 돌려줘야 하므로, 콜백은
 * 모으기만 하고 실제 INSERT 는 {@link UsageCollector.flush} 가 한 번에 한다.
 * 문진 한 턴은 보통 호출 1회, 재시도가 있으면 2~3회다.
 */
export class UsageCollector {
  private readonly collected: LlmUsage[] = [];

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly clinicianId: string,
    private readonly encounterId?: string
  ) {}

  /** `onUsage` 로 넘길 콜백. 절대 던지지 않는다. */
  readonly collect = (usage: LlmUsage): void => {
    this.collected.push(usage);
  };

  /** 모아둔 사용량을 기록한다. 응답을 보낸 뒤에 불러도 된다. */
  async flush(task: KioskUsageTask): Promise<void> {
    const pending = this.collected.splice(0, this.collected.length);
    await Promise.all(
      pending.map((usage) =>
        recordKioskUsage(this.supabase, {
          clinicianId: this.clinicianId,
          task,
          usage,
          encounterId: this.encounterId
        })
      )
    );
  }
}
