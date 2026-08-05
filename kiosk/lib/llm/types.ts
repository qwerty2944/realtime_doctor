/**
 * LLM 프로바이더 인터페이스. SERVER ONLY.
 *
 * 이 앱이 모델에게 요구하는 것은 딱 하나다 — "이 도구를 호출해서 답해라.
 * 도구의 입력 스키마는 zod 스키마에서 기계적으로 뽑았다." 그래서 위쪽 코드는
 * 벤더 SDK 가 아니라 {@link LlmProvider} 하고만 이야기한다.
 *
 * 프로바이더는 *전송 계층*이다. 요청 하나를 보내고 무엇이 돌아왔는지 —
 * 도구 호출이었는지, 아니면 왜 아니었는지 — 를 보고할 뿐이다. zod 검증과
 * 재시도 루프는 index.ts 에 한 번만 있다.
 */

import type { z } from 'zod';

/** LLM_PROVIDER 환경변수가 받는 값. */
export const LLM_PROVIDERS = ['gemini'] as const;

export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/**
 * 대화 한 턴.
 *
 * 역할 이름은 Anthropic/OpenAI 관례를 따른다(호출자들이 이미 그렇게 말한다).
 * Gemini 의 `user`/`model` 명명은 어댑터 안에서 변환되고 위로 새지 않는다.
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 강제된 도구 호출 한 번. */
export interface ToolCallRequest {
  system: string;
  messages: readonly LlmMessage[];
  toolName: string;
  toolDescription: string;
  /** 도구 입력 형태의 단일 진실. 프로바이더별로 변환된다. */
  schema: z.ZodType;
  /**
   * 답변 자체에 대한 예산. 숨은 추론에 토큰을 쓰는 프로바이더는 이 값을
   * 깎아먹는 대신 자기 여유분을 위에 얹는다.
   */
  maxTokens: number;
}

/**
 * 시도 한 번의 결과.
 *
 * `ok: false` 는 "모델이 응답은 했는데 쓸 만한 도구 호출이 아니었다" — 재시도
 * 가능한 상황이다. 전송 실패(401, 429, 네트워크)는 돌려주지 않고 던진다:
 * 그건 즉시 재질의가 아니라 백오프 정책이 필요한 사건이다.
 */
export type ToolCallOutcome =
  | { ok: true; input: unknown }
  | { ok: false; reason: string; raw: unknown };

export interface LlmProvider {
  readonly name: LlmProviderName;
  /** 실제로 호출할 모델 id. 로그용. */
  model(): string;
  callTool(request: ToolCallRequest): Promise<ToolCallOutcome>;
}

/**
 * 모델이 스키마가 거부하는 것을 돌려줬을 때 던진다.
 *
 * 원본 도구 입력을 들고 다닌다 — 무엇이 잘못됐는지에 대한 유일한 증거를
 * 버리지 않고 실패 기록과 함께 남길 수 있도록.
 */
export class ModelOutputError extends Error {
  readonly rawOutput: unknown;

  constructor(message: string, rawOutput: unknown) {
    super(message);
    this.name = 'ModelOutputError';
    this.rawOutput = rawOutput;
  }
}
