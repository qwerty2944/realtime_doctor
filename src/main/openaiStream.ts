import type { EphemeralSession } from '../shared/types.js';
import { aiAccessToken, realtimeMintUrl } from './aiProxy.js';
import { currentCloudSessionId } from './sessions.js';
import { getLanguage } from './store.js';

/**
 * OpenAI Realtime 전사 세션 발급 (A1 이후: 서버 경유).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 구조는 원래 옳았고, 위치만 틀렸다
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 이 함수는 예전에도 **단기 임시 키**를 받아 렌더러에 넘겼다. 렌더러의 WebRTC 는
 * 그 임시 키로만 붙고, 진짜 OPENAI_API_KEY 는 렌더러에 간 적이 없다. 문제는
 * 임시 키를 발급받는 그 호출이 진짜 키를 요구했고, 그 키가 이 번들 안에
 * 있었다는 점이다. 이제 그 호출은 `ai-realtime` Edge Function 이 한다.
 *
 * 모델도 프롬프트도 서버가 정한다. 앱이 보내는 것은 언어 하나뿐이다 -- 앱이
 * 모델을 고를 수 있으면 비용 상한이 없어진다.
 *
 * 발급 실패는 던진다. 호출부(index.ts StreamMint)가 이걸 받아 gemini 청크
 * 전사로 fallback 하는데, 그 경로도 같은 프록시를 지나므로 자격 없는 사용자가
 * 우회로로 새지 않는다.
 */

/** 발급은 진료 시작 순간이다. 오래 매달려 있으면 안 된다. */
const TIMEOUT_MS = 20_000;

export async function mintOpenAIRealtimeSession(): Promise<EphemeralSession> {
  const lang = getLanguage() ?? 'ko';
  const token = await aiAccessToken();
  const sessionId = await currentCloudSessionId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(realtimeMintUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-rd-task': 'realtime-session',
        ...(sessionId ? { 'x-rd-session-id': sessionId } : {})
      },
      body: JSON.stringify({ language: lang }),
      signal: controller.signal
    });
  } catch (err) {
    throw new Error(
      `실시간 전사 세션 발급 실패(네트워크): ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }

  let body: {
    client_secret?: { value?: string; expires_at?: number };
    model?: string;
    error?: string;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new Error(`실시간 전사 세션 발급 실패 (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('실시간 전사 세션 발급 실패: 로그인이 필요합니다.');
    }
    if (res.status === 402 || body.error === 'not_entitled') {
      throw new Error(
        '구독이 만료되었거나 자격이 없습니다. 결제 상태를 확인해 주세요.'
      );
    }
    throw new Error(
      `실시간 전사 세션 발급 실패 (HTTP ${res.status}${body.error ? `, ${body.error}` : ''}).`
    );
  }

  const value = body.client_secret?.value;
  if (!value || !body.model) {
    throw new Error('실시간 전사 세션 응답에 client_secret 이 없습니다.');
  }

  return {
    client_secret: { value, expires_at: body.client_secret?.expires_at },
    model: body.model
  };
}
