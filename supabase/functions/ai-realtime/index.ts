// realtime_doctor -- ai-realtime Edge Function (A1).
//
// OpenAI Realtime 전사 세션의 ephemeral client secret 을 서버에서 발급한다.
//
// ══════════════════════════════════════════════════════════════════════════
// 무엇이 바뀌었나
// ══════════════════════════════════════════════════════════════════════════
//
// 구조는 원래부터 옳았다. `src/main/openaiStream.ts` 는 이미 OpenAI 의
// `/realtime/client_secrets` 를 불러 **단기 임시 키**를 받고, 렌더러의 WebRTC 는
// 그 임시 키로만 붙는다. 진짜 키는 렌더러에 간 적이 없다.
//
// 틀린 것은 위치였다. 그 호출을 하려면 OPENAI_API_KEY 가 필요하고, 그 키가
// Electron 번들 안에 있었다. 그래서 이 함수는 새 아키텍처가 아니라 **같은 호출을
// 옮긴 것**이다 -- 호출 주체가 "빌드를 가진 아무나"에서 "자격이 확인된 로그인
// 사용자"로 바뀌었을 뿐이다.
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] 앱이 보낸 값 중 무엇을 믿는가
// ══════════════════════════════════════════════════════════════════════════
//
// language 하나뿐이고, 그것도 'en' 인지 아닌지만 본다. model 은 앱이 정하지
// 않는다 -- 앱이 model 을 고를 수 있으면 아무 OpenAI 모델이나 소유자 계정으로
// 지목할 수 있고, 그건 비용 통제가 없다는 뜻이다. 프롬프트도 서버에 있다.
// (앱 쪽 상수와 글자 그대로 같아야 한다: src/main/openaiStream.ts)

import { openGate, recordUsage, json, CORS } from '../_shared/gate.ts';
import { aiProxyHealth, isHealthRequest } from '../_shared/health.ts';

const PROMPT_KO =
  '한국 의료 진료 대화를 들리는 그대로 충실히 받아 적습니다. 한국어로 말한 부분은 한국어, 영어로 말한 부분(MRI, BP, amoxicillin 등)은 그 영어 그대로. 음차/병기/의역 금지. 숫자와 단위는 아라비아 숫자로.';

const PROMPT_EN =
  'Transcribe a clinical encounter. The output MUST be in English only, using Latin characters. If the speaker uses Korean or any non-English language, render the closest English equivalent — never emit Hangul or other non-Latin scripts. Keep medical terms (e.g. MRI, BP, amoxicillin) exactly as spoken. Do not translate doses or numeric values. Write numbers and units as Arabic numerals.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // [HARD] 헬스체크는 게이트보다 **먼저**이고, provider 를 부르지 않는다.
  // 게이트 뒤에 두면 감시자가 유효한 구독을 들고 있어야 하고, 구독이 만료되는
  // 날 감시도 같이 조용히 멈춘다. 확인 항목과 그 한계는 _shared/health.ts 의
  // aiProxyHealth 주석에 있다.
  if (isHealthRequest(req)) return await aiProxyHealth('edge:ai-realtime', 'OPENAI_API_KEY');
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // [HARD] 게이트가 먼저다. 아래 OpenAI fetch 는 이 분기를 통과해야만 도달한다.
  const gate = await openGate(req);
  if (!gate.ok) return gate.response;

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('[ai-realtime] OPENAI_API_KEY is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* 본문 없음도 허용. 기본값(ko)으로 간다. */
  }
  const lang = body.language === 'en' ? 'en' : 'ko';
  const model = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-4o-transcribe';

  // `OPENAI_UPSTREAM_BASE` 는 Edge Function 환경변수이지 클라이언트 입력이
  // 아니다. 프로브가 provider 호출 횟수를 세기 위해서만 쓴다
  // (scripts/probe-ai-proxy.mjs) -- 거절이 호출 **이전에** 일어난다는 주장은
  // 세어보지 않으면 증명이 아니다.
  const base = Deno.env.get('OPENAI_UPSTREAM_BASE') ?? 'https://api.openai.com/v1';

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${base}/realtime/client_secrets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: {
            input: {
              transcription: {
                model,
                language: lang,
                prompt: lang === 'en' ? PROMPT_EN : PROMPT_KO
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
              }
            }
          }
        }
      })
    });
  } catch (err) {
    console.error('[ai-realtime] upstream fetch failed', err);
    return json({ error: 'upstream_unavailable' }, 502);
  }

  const text = await res.text();
  if (!res.ok) {
    // 업스트림 본문을 그대로 흘리지 않는다. OpenAI 의 에러 본문에는 조직·키
    // 접두사 같은 계정 정보가 섞여 나올 수 있다. 상태 코드만 전달한다.
    console.error(`[ai-realtime] upstream ${res.status}: ${text.slice(0, 500)}`);
    return json({ error: 'upstream_error', status: res.status }, 502);
  }

  let data: { value?: string; expires_at?: number };
  try {
    data = JSON.parse(text) as { value?: string; expires_at?: number };
  } catch {
    console.error('[ai-realtime] upstream returned non-JSON');
    return json({ error: 'upstream_bad_response' }, 502);
  }
  if (!data?.value) {
    console.error('[ai-realtime] upstream response missing client_secret value');
    return json({ error: 'upstream_bad_response' }, 502);
  }

  // 발급 자체를 계량한다. 실제 스트리밍 길이는 이 함수가 볼 수 없다 -- 오디오는
  // 렌더러와 OpenAI 사이에서 직접 흐른다. 그래서 세션 길이는 여전히 클라이언트
  // 신고(source='client')로만 남는다. 이 행은 "몇 번 발급받았는가"이고, 그건
  // 서버만 셀 수 있다.
  await recordUsage(gate, {
    provider: 'openai-realtime',
    task: 'mint',
    model,
    duration_ms: Date.now() - startedAt
  });

  return json(
    {
      client_secret: { value: data.value, expires_at: data.expires_at },
      model
    },
    200
  );
});
