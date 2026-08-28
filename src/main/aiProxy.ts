import { getSupabase, supabaseUrl } from './supabaseClient.js';

/**
 * AI 프록시 이음매 (A1).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 왜 프록시인가
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A1 이전에는 GEMINI_API_KEY / OPENAI_API_KEY 가 빌드 시점에 main 번들로
 * 인라인됐다. 그 구조에서 구독 게이트는 장식이다 -- 게이트는 Electron 안에
 * 있고 키도 Electron 안에 있으니, 게이트를 지나지 않고 키만 꺼내면 된다.
 * 게다가 키가 새면 전 설치본을 다시 빌드해 배포하기 전까지 회수할 수 없고,
 * 사용량은 클라이언트가 자진 신고하므로 고객당 원가를 알 수 없다.
 *
 * 이제 키는 Edge Function 시크릿에만 있다. 앱은 자기 로그인 토큰을 들고
 * 프록시에 물어보고, 프록시가 자격을 확인한 뒤에만 provider 를 부른다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 왜 여기서 세션을 매번 다시 읽는가
 * ══════════════════════════════════════════════════════════════════════════
 *
 * access token 은 한 시간이면 만료된다. 한 번 읽어 캐시해 두면 진료 중간에
 * 조용히 401 이 나기 시작한다. `getSession()` 은 supabase-js 가 필요할 때만
 * 갱신하므로 매 요청마다 불러도 네트워크 왕복이 생기지 않는다.
 */

export class NotSignedInError extends Error {
  constructor() {
    super('로그인이 필요합니다. AI 기능은 로그인한 계정으로만 사용할 수 있습니다.');
    this.name = 'NotSignedInError';
  }
}

function functionsBase(): string {
  const explicit = process.env.AI_PROXY_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  return `${supabaseUrl().replace(/\/+$/, '')}/functions/v1`;
}

export function geminiProxyUrl(): string {
  return `${functionsBase()}/ai-gemini`;
}

export function realtimeMintUrl(): string {
  return `${functionsBase()}/ai-realtime`;
}

/**
 * 현재 로그인 세션의 access token. 없으면 던진다.
 *
 * [HARD] 토큰 없이 프록시를 부르지 않는다. 서버도 401 로 막지만, 여기서 먼저
 * 끊는 편이 사용자에게 "로그인하세요"라는 정확한 메시지를 준다 -- 서버의
 * 401 은 앱 입장에서 네트워크 오류와 구분이 안 되는 모양으로 도착한다.
 */
export async function aiAccessToken(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new NotSignedInError();
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new NotSignedInError();
  return token;
}

/**
 * 프록시가 설정돼 있는가. provider 목록의 `available` 판정에 쓴다.
 *
 * 예전에는 `!!process.env.GEMINI_API_KEY` 였다 -- 키가 번들에 있었으니 그게
 * 곧 "쓸 수 있는가"였다. 이제 키는 서버에만 있으므로 앱이 확인할 수 있는 것은
 * "물어볼 주소를 아는가"뿐이고, 실제 가부는 서버가 정한다.
 */
export function aiProxyConfigured(): boolean {
  return functionsBase().length > 0;
}
