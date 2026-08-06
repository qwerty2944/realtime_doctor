import axios, { type AxiosInstance } from 'axios';
import { aiAccessToken, geminiProxyUrl } from './aiProxy.js';
import { currentCloudSessionId, type UsageTask } from './sessions.js';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: { task?: UsageTask };
  }
  interface AxiosRequestConfig {
    metadata?: { task?: UsageTask };
  }
}

let cached: AxiosInstance | null = null;

/**
 * Gemini 호출용 클라이언트 (A1 이후: 프록시 경유).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 호출자는 아무것도 바뀌지 않았다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * analyzer / summarizer / dictator / diarizer / geminiTranscriber 는 전부
 * `POST /models/<model>:generateContent` 를 그대로 부른다. 바뀐 것은 이 인스턴스의
 * baseURL 과 인증 헤더뿐이다:
 *
 *   before:  https://generativelanguage.googleapis.com/v1beta  + x-goog-api-key
 *   after:   <supabase>/functions/v1/ai-gemini                 + Bearer <세션 토큰>
 *
 * 프록시는 경로도 본문도 응답도 바꾸지 않으므로 요청/응답 스키마는 그대로다.
 * E1 의 근거 검증(`supporting_findings`)이 이 불변에 기대고 있다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * GEMINI_API_BASE 는 왜 아직 살아 있는가
 * ══════════════════════════════════════════════════════════════════════════
 *
 * probe-provenance / probe-visit-code 가 실제 analyzer 경로를 태우면서 호출을
 * 세기 위해 가짜 모델 서버로 보낸다 (L1/E3 검증). 이 탈출구가 게이트를 뚫지는
 * 않는다 -- 여기에 다른 주소를 넣는다는 것은 **자기 서버**로 보낸다는 뜻이고,
 * 소유자의 키는 그 주소에 없다. 게이트는 앱이 아니라 서버에 있다.
 */
export function getGeminiClient(): AxiosInstance {
  if (cached) return cached;

  cached = axios.create({
    baseURL: process.env.GEMINI_API_BASE ?? geminiProxyUrl(),
    timeout: 60_000,
    headers: { 'Content-Type': 'application/json' }
  });

  // [HARD] 토큰은 요청마다 새로 읽는다. access token 은 한 시간이면 만료되고,
  // 인스턴스 생성 시점에 한 번 박아두면 진료 중간에 조용히 401 이 시작된다.
  cached.interceptors.request.use(async (config) => {
    config.headers.set('Authorization', `Bearer ${await aiAccessToken()}`);
    // 계량 라벨. 서버가 usage_events 에 적는다. 판정에는 쓰이지 않는다.
    const task = config.metadata?.task;
    if (task) config.headers.set('x-rd-task', task);
    const sessionId = await currentCloudSessionId();
    if (sessionId) config.headers.set('x-rd-session-id', sessionId);
    return config;
  });

  // 사용량 기록 인터셉터는 없다. A1 에서 서버로 옮겼다 --
  // 클라이언트가 건너뛸 수 있는 계량은 계량이 아니다 (supabase/functions/_shared/gate.ts).

  return cached;
}

export function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    // 게이트가 거절한 경우는 원인을 정확히 말해준다. "Gemini API error (402)"
    // 는 사용자가 무엇을 해야 하는지 알려주지 못한다.
    const code =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: unknown }).error)
        : '';
    if (status === 401) return 'AI 프록시 인증 실패: 다시 로그인해 주세요.';
    if (status === 402 || code === 'not_entitled') {
      return '구독이 만료되었거나 자격이 없습니다. 결제 상태를 확인해 주세요.';
    }
    const detail =
      typeof data === 'string'
        ? data
        : data && typeof data === 'object'
          ? JSON.stringify(data)
          : err.message;
    return `Gemini API error${status ? ` (${status})` : ''}: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// 파싱은 `src/shared/gemini.ts` 로 옮겼다 (A1). 기존 호출부가 그대로 쓰도록
// 여기서 다시 내보낸다 -- import 경로를 다섯 파일에서 고칠 이유가 없다.
export { extractText, type GeminiTextResponse } from '../shared/gemini.js';
