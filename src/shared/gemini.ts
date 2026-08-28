/**
 * Gemini 응답 파서 (A1 에서 geminiClient.ts 에서 분리).
 *
 * 전송(어디로 어떻게 보내는가)과 파싱(응답을 어떻게 읽는가)은 다른 관심사다.
 * A1 에서 전송이 프록시 경유로 바뀌면서 `geminiClient.ts` 가 electron 의
 * supabase 클라이언트에 의존하게 됐는데, 파싱은 그런 것을 알 필요가 없다.
 *
 * 분리해 두는 실질적 이유: 검증 프로브(`scripts/probe-ai-proxy.mjs`)가 응답이
 * 여전히 앱이 기대하는 모양인지 확인하려면 **앱이 실제로 쓰는 파서**를 그대로
 * 불러야 한다. 프로브가 자기 파서를 따로 들고 있으면, 앱에서 깨진 날에도
 * 프로브는 통과한다 -- E1 의 "검증기는 한 벌" 원칙과 같은 이유다.
 */

export interface GeminiTextResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function extractText(data: GeminiTextResponse): string {
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) return '';
  return parts.map((p) => p.text ?? '').join('');
}
