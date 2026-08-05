import 'server-only';

/**
 * LLM 프로바이더 선택과 공용 강제-도구-호출. SERVER ONLY.
 *
 * 앱의 모든 모델 호출은 벤더 SDK 가 아니라 {@link callStructuredTool} 을 지난다.
 * 모델에는 도구 하나만 주어지고, 그 입력 스키마는 나중에 결과를 검증하는 바로
 * 그 zod 스키마에서 뽑았으며, 프로바이더가 그 도구를 쓰도록 강제한다. 이렇게
 * 하면 "JSON처럼 보이는 산문을 파싱한다" 는 실패 모드가 통째로 사라진다 —
 * 남는 것은 평범한 객체이고, 그것도 DB 에 닿기 전에 다시 검증한다.
 *
 * `LLM_PROVIDER` 가 없거나 모르는 값이면 하드 에러다. 환자의 증상을 병원이
 * 고르지 않은 모델로 조용히 보내는 것은 동의서가 딸린 개인정보 처리 결정이다
 * (`lib/intake/consent.ts` 가 처리자 이름을 적는다). 안전한 기본값이란 게
 * 없으므로 고르지 않는다. (현재 지원 프로바이더는 gemini 하나다.)
 */

import { z } from 'zod';

import { geminiProvider } from '@/lib/llm/gemini';
import {
  LLM_PROVIDERS,
  ModelOutputError,
  type LlmMessage,
  type LlmProvider,
  type LlmProviderName
} from '@/lib/llm/types';

const PROVIDERS: Record<LlmProviderName, LlmProvider> = {
  gemini: geminiProvider
};

function isProviderName(value: string): value is LlmProviderName {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

/**
 * 원시 `LLM_PROVIDER` 값을 프로바이더 이름으로 해석한다.
 *
 * 순수 함수라 환경변수를 건드리지 않고 규칙만 테스트할 수 있다.
 * 값이 비어 있으면 유일한 프로바이더로 떨어진다 — 선택지가 하나뿐인 동안에는
 * "명시적으로 고르라" 는 요구가 설정 부담만 늘리고 동의서 정확성에는 아무런
 * 차이를 만들지 않기 때문이다. 프로바이더가 둘 이상이 되면 이 기본값을 없애고
 * 다시 강제 선택으로 돌려야 한다.
 */
export function selectLlmProvider(raw: string | undefined): LlmProviderName {
  const normalized = (raw ?? '').trim().toLowerCase();

  if (normalized === '') return 'gemini';

  if (!isProviderName(normalized)) {
    throw new Error(
      `LLM_PROVIDER="${raw}" is not a known provider. Expected one of: ${LLM_PROVIDERS.join(', ')}.`
    );
  }

  return normalized;
}

/** 이름으로 프로바이더를 찾는다. 테스트와 명시적 오버라이드용. */
export function getLlmProviderByName(name: LlmProviderName): LlmProvider {
  return PROVIDERS[name];
}

/** 이 배포에 설정된 프로바이더. */
export function getLlmProvider(): LlmProvider {
  return getLlmProviderByName(selectLlmProvider(process.env.LLM_PROVIDER));
}

export interface StructuredCallOptions<T> {
  system: string;
  messages: readonly LlmMessage[];
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  /**
   * 포기하기 전까지 몇 번 물어볼지. 기본 1(재시도 없음)이라 자체 재시도 루프를
   * 가진 호출자(`generateAndStoreIntakeResult`)의 동작이 유지된다.
   */
  maxAttempts?: number;
  /** `LLM_PROVIDER` 를 덮어쓴다. 테스트와 일회성 스크립트용. */
  provider?: LlmProvider;
}

/**
 * 직전 응답이 무엇이 잘못됐는지 모델에게 알린다.
 *
 * 새 메시지로 밀어넣지 않고 마지막 user 턴에 합친다 — 대화가 엄격히 교대하도록
 * 유지하기 위해서다. assistant 턴으로도 넣지 않는다: 교정 대상이 된 응답은
 * 거부된 응답이므로, 되돌려 재생하면 틀린 형태를 강화할 뿐이다.
 */
function appendRetryNudge(
  conversation: LlmMessage[],
  toolName: string,
  failure: string
): void {
  const nudge =
    `(시스템: 직전 응답이 형식 요구사항을 충족하지 못했습니다: ${failure}\n` +
    `일반 텍스트로 답하지 말고 반드시 "${toolName}" 도구를 호출해 같은 내용을 다시 제출해 주세요.)`;

  const last = conversation[conversation.length - 1];
  if (last?.role === 'user') {
    conversation[conversation.length - 1] = {
      role: 'user',
      content: `${last.content}\n\n${nudge}`
    };
    return;
  }

  conversation.push({ role: 'user', content: nudge });
}

/**
 * `toolName` 호출로만 답해야 하는 모델 턴을 한 번 돌리고, 검증된 도구 입력을
 * 돌려준다.
 *
 * 강제 도구 호출은 Gemini 에서 `functionCallingConfig.mode = "ANY"` 로 대체로
 * 지켜지므로 아래 재시도는 거의 도달하지 않는다. 그래도 두는 이유는 긴 추론
 * 패스가 호출을 내보내기 전에 출력 예산을 소진할 수 있기 때문이다. 재시도가
 * 없으면 비순응 응답 한 번이 500 이 되고, 환자는 문진 도중에 접수처로 가라는
 * 말을 듣는다. 왕복 한 번이 훨씬 싼 거래다.
 *
 * 모든 시도가 도구를 건너뛰었거나 스키마가 거부하는 입력을 냈을 때
 * {@link ModelOutputError} 를 던진다. 전송/API 에러는 그대로 전파된다.
 */
export async function callStructuredTool<T>({
  system,
  messages,
  toolName,
  toolDescription,
  schema,
  maxTokens,
  maxAttempts = 1,
  provider
}: StructuredCallOptions<T>): Promise<T> {
  const llm = provider ?? getLlmProvider();
  const attempts = Math.max(1, maxAttempts);

  // 실패한 시도마다 nudge 하나씩 자라서, 모델이 자기가 뭘 틀렸는지 본다.
  const conversation: LlmMessage[] = [...messages];
  let lastError: ModelOutputError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outcome = await llm.callTool({
      system,
      messages: conversation,
      toolName,
      toolDescription,
      schema,
      maxTokens
    });

    if (!outcome.ok) {
      lastError = new ModelOutputError(
        `Model did not produce a usable call to "${toolName}": ${outcome.reason}.`,
        outcome.raw
      );
    } else {
      const parsed = schema.safeParse(outcome.input);
      if (parsed.success) return parsed.data;

      lastError = new ModelOutputError(
        `Tool "${toolName}" input failed validation: ${z.prettifyError(parsed.error)}`,
        outcome.input
      );
    }

    if (attempt < attempts) {
      console.warn(
        `[llm:${llm.name}] Attempt ${attempt}/${attempts} for tool "${toolName}" was not usable: ${lastError.message}`
      );
      appendRetryNudge(conversation, toolName, lastError.message);
    }
  }

  throw lastError ?? new Error(`Tool "${toolName}" produced no output.`);
}

export { ModelOutputError, LLM_PROVIDERS } from '@/lib/llm/types';
export type { LlmMessage, LlmProvider, LlmProviderName } from '@/lib/llm/types';
