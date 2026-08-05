import 'server-only';

/**
 * Google Gemini 프로바이더. SERVER ONLY — API 키는 절대 브라우저에 닿으면 안 된다.
 *
 * 벤더 SDK 대신 Generative Language REST API 를 직접 호출한다. 이 앱은 요청
 * 형태 하나짜리 엔드포인트 하나만 있으면 되고, 생짜 `fetch` 는 의존성 표면과
 * (의료 도구로서의) 감사 스토리를 작게 유지한다.
 *
 * Anthropic 형태와 다른 세 가지는 여기서 흡수하고 위로 흘리지 않는다:
 *   1. 시스템 프롬프트가 메시지 옆 파라미터가 아니라 별도 `systemInstruction` 필드
 *   2. 역할이 `user`/`model` — `assistant` 가 없다
 *   3. 숨은 추론 토큰이 `maxOutputTokens` 에 과금된다 ({@link THINKING_HEADROOM})
 */

import { requireEnv, optionalEnv } from '@/lib/env';
import { toGeminiSchema, zodToJsonSchema } from '@/lib/llm/schema';
import type {
  LlmMessage,
  LlmProvider,
  ToolCallOutcome,
  ToolCallRequest
} from '@/lib/llm/types';

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * 엔드포인트. 기본값은 Google 이고, `GEMINI_API_BASE` 로 바꿀 수 있다.
 *
 * 왜 열어두는가: 이 라우트에서 **모델이 불렸는지 안 불렸는지**가 검증 대상이
 * 됐기 때문이다(L1 — 발급되지 않은 접근은 모델 호출도 만들지 않는다). 프로브가
 * 그것을 단언하려면 호출을 셀 수 있는 곳으로 보낼 수 있어야 한다.
 * 부수적으로 사내 프록시·게이트웨이를 쓰는 배포도 가능해진다.
 *
 * 운영 배포에서는 설정하지 않는다. 설정하지 않으면 값이 바뀌지 않는다.
 */
function apiBase(): string {
  return optionalEnv('GEMINI_API_BASE') ?? DEFAULT_API_BASE;
}

/**
 * 기본 모델. 강제 도구 호출(`functionCallingConfig.mode = "ANY"`)을 지키는
 * 모델이어야 한다 — 문진 흐름 전체가 그 위에 서 있으므로, 그걸 제안 정도로
 * 취급하는 모델은 산문 품질과 무관하게 탈락이다.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash';

/**
 * 모델의 내부 추론용으로 따로 잡아두는 출력 예산.
 *
 * Gemini 3 는 thinking 토큰을 `maxOutputTokens` 에 센다. 호출자의 답변 예산을
 * 그대로 넘기면 `finishReason: MAX_TOKENS` 와 잘린(혹은 없는) function call 이
 * 나온다. thinking 은 일부러 켜 둔다 — 감별진단이야말로 그게 도움이 되는
 * 작업이다. 그래서 추론을 끄는 대신 예산을 올린다.
 */
const THINKING_HEADROOM = 8192;

/** 이 배포가 쓸 모델: `GEMINI_MODEL`, 없으면 기본값. */
export function geminiModel(): string {
  return optionalEnv('GEMINI_MODEL') ?? DEFAULT_MODEL;
}

/**
 * API 키.
 *
 * `GEMINI_API_KEY` 가 문서화된 이름이지만 Google CLI/SDK 는 `GOOGLE_API_KEY` 를
 * 설정한다. 둘 다 요구하는 건 설치 과정의 함정일 뿐이니, 구체적인 쪽을
 * 선호하고 일반적인 쪽도 받는다.
 */
export function geminiApiKey(): string {
  if (typeof window !== 'undefined') {
    throw new Error(
      'The Gemini provider was used in the browser. GEMINI_API_KEY must stay server-side.'
    );
  }

  return optionalEnv('GEMINI_API_KEY') ?? optionalEnv('GOOGLE_API_KEY') ?? requireEnv('GEMINI_API_KEY');
}

/** Gemini 는 assistant 를 "model" 이라 부르고 그 밖의 비-user 역할이 없다. */
function toContents(messages: readonly LlmMessage[]) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: message.content }]
  }));
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * 버려진 스키마 키워드를 호출마다가 아니라 도구마다 한 번만 로그한다.
 * 문진 루프는 환자 한 명당 같은 도구를 여러 번 부른다.
 */
const warnedTools = new Set<string>();

function buildFunctionDeclaration(request: ToolCallRequest) {
  const { schema, dropped } = toGeminiSchema(zodToJsonSchema(request.schema));

  if (dropped.length > 0 && !warnedTools.has(request.toolName)) {
    warnedTools.add(request.toolName);
    console.warn(
      `[llm:gemini] Tool "${request.toolName}": ${dropped.length} JSON Schema keyword(s) are not supported by Gemini and were dropped from the declaration ` +
        `(${dropped.join(', ')}). These constraints are still enforced by zod after the response, so an unsupported value is rejected rather than stored.`
    );
  }

  return {
    name: request.toolName,
    description: request.toolDescription,
    parameters: schema
  };
}

export const geminiProvider: LlmProvider = {
  name: 'gemini',

  model: geminiModel,

  async callTool(request: ToolCallRequest): Promise<ToolCallOutcome> {
    const model = geminiModel();
    const key = geminiApiKey();

    const response = await fetch(
      `${apiBase()}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: toContents(request.messages),
          tools: [{ functionDeclarations: [buildFunctionDeclaration(request)] }],
          // Anthropic 의 `tool_choice` 에 해당한다. ANY + 명시적 허용 목록으로
          // 이 함수 하나를 강제하고 자유 텍스트 답변을 금지한다.
          toolConfig: {
            functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [request.toolName] }
          },
          generationConfig: { maxOutputTokens: request.maxTokens + THINKING_HEADROOM }
        })
      }
    );

    const body = (await response.json().catch(() => null)) as GeminiResponse | null;

    // 전송/API 에러는 돌려주지 않고 던진다: 401 이나 429 는 잘못된 도구 호출이
    // 받는 즉시 재질의가 아니라 백오프 정책이 필요하다.
    if (!response.ok) {
      throw new Error(
        `[llm:gemini] ${model} returned HTTP ${response.status}: ${body?.error?.message ?? 'no error body'}`
      );
    }

    const candidate = body?.candidates?.[0];

    if (!candidate) {
      const blockReason = body?.promptFeedback?.blockReason;
      return {
        ok: false,
        reason: blockReason
          ? `the request was blocked by a safety filter (${blockReason})`
          : 'the response contained no candidates',
        raw: body
      };
    }

    const parts = candidate.content?.parts ?? [];
    const call = parts.find((part) => part.functionCall?.name === request.toolName);

    if (!call?.functionCall) {
      const truncated = candidate.finishReason === 'MAX_TOKENS';
      return {
        ok: false,
        reason: truncated
          ? `the response hit the output token limit before completing a call to "${request.toolName}"`
          : `the model did not call "${request.toolName}" (finishReason=${candidate.finishReason ?? 'unknown'})`,
        raw: parts
      };
    }

    return { ok: true, input: call.functionCall.args ?? {} };
  }
};
