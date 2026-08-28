// realtime_doctor -- ai-gemini Edge Function (A1).
//
// Gemini 의 요청/응답형 호출(analysis / summary / dictation / transcribe /
// diarize)을 대신 보낸다. GEMINI_API_KEY 는 이제 여기에만 있다.
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] 응답을 가공하지 않는다
// ══════════════════════════════════════════════════════════════════════════
//
// 업스트림 JSON 을 그대로 돌려준다. 이 함수가 응답 모양을 조금이라도 다듬으면
// 그 순간 스키마가 두 곳에서 정의된다. 특히 E1 의 근거 검증
// (`src/shared/findings.ts` 의 partitionDifferentials)은 모델이 돌려준
// `supporting_findings` 의 `source` 번호를 이번 요청에 실제로 보낸 발화 목록과
// 대조하는 코드다 -- 중간에서 필드를 하나 떨어뜨리면 근거가 통째로 미검증으로
// 분류되거나, 더 나쁘게는 엉뚱한 발화를 가리키게 된다.
//
// 그래서 여기서 하는 일은 세 가지뿐이다: (1) 게이트, (2) 키를 붙여 전달,
// (3) usageMetadata 를 읽어 계량. 본문은 요청도 응답도 손대지 않는다.
//
// ══════════════════════════════════════════════════════════════════════════
// [HARD] 경로 allowlist
// ══════════════════════════════════════════════════════════════════════════
//
// "받은 경로를 그대로 google 에 붙여 보낸다"는 열린 프록시다. 그러면 이 함수는
// 소유자 키로 아무 Google API 나 부를 수 있는 창구가 된다 -- 자격 게이트를
// 통과한 사용자 한 명이면 충분하다. 앱이 실제로 쓰는 모양 하나만 통과시킨다:
//
//     POST /ai-gemini/models/<model>:generateContent
//
// 모델 이름도 검사한다. 모델을 앱이 자유롭게 고를 수 있으면 비용 상한이
// 없어진다(flash 대신 pro 를 지목하면 그만이다).

import { openGate, recordUsage, json, CORS } from '../_shared/gate.ts';
import { aiProxyHealth, isHealthRequest } from '../_shared/health.ts';

/**
 * 업스트림 주소.
 *
 * `GEMINI_UPSTREAM_BASE` 로 덮어쓸 수 있다. 이건 **Edge Function 환경변수**이지
 * 클라이언트가 보내는 값이 아니다 -- 앱은 이 값을 정할 수 없다. 검증 프로브가
 * "거절이 provider 호출 **이전에** 일어나는가"를 확인하려면 호출을 셀 수
 * 있어야 하고, 세려면 받아줄 곳으로 보낼 수 있어야 한다.
 * (`scripts/probe-ai-proxy.mjs`)
 */
function upstream(): string {
  return (
    Deno.env.get('GEMINI_UPSTREAM_BASE') ??
    'https://generativelanguage.googleapis.com/v1beta'
  );
}

/** base64 오디오가 실려 오므로 넉넉하되 무제한은 아니다. */
const MAX_BODY_BYTES = 24 * 1024 * 1024;

/**
 * 허용 모델. 기본값은 `gemini-` 접두 + 안전한 문자만.
 * `GEMINI_ALLOWED_MODELS` (쉼표 구분) 로 더 좁힐 수 있다.
 */
function modelAllowed(model: string): boolean {
  if (!/^gemini-[A-Za-z0-9._-]+$/.test(model)) return false;
  const list = (Deno.env.get('GEMINI_ALLOWED_MODELS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 0 || list.includes(model);
}

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // [HARD] 헬스체크는 게이트보다 **먼저**이고, provider 를 부르지 않는다.
  // 게이트 뒤에 두면 감시자가 유효한 구독을 들고 있어야 하고, 구독이 만료되는
  // 날 감시도 같이 조용히 멈춘다. 확인 항목과 그 한계는 _shared/health.ts 의
  // aiProxyHealth 주석에 있다.
  if (isHealthRequest(req)) return await aiProxyHealth('edge:ai-gemini', 'GEMINI_API_KEY');
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // [HARD] 게이트가 먼저다. 아래 Google fetch 는 이 분기를 통과해야만 도달한다.
  const gate = await openGate(req);
  if (!gate.ok) return gate.response;

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('[ai-gemini] GEMINI_API_KEY is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }

  // `/functions/v1/ai-gemini/models/<model>:generateContent` 에서 뒷부분만.
  const path = new URL(req.url).pathname;
  const marker = '/ai-gemini/';
  const idx = path.indexOf(marker);
  const suffix = idx >= 0 ? path.slice(idx + marker.length) : '';
  const m = /^models\/([^/]+):generateContent$/.exec(decodeURI(suffix));
  if (!m) return json({ error: 'unsupported_path' }, 404);

  const model = decodeURIComponent(m[1]);
  if (!modelAllowed(model)) {
    console.warn(`[ai-gemini] rejected model "${model}" for user ${gate.userId}`);
    return json({ error: 'model_not_allowed' }, 400);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(
      `${upstream()}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: raw
      }
    );
  } catch (err) {
    console.error('[ai-gemini] upstream fetch failed', err);
    return json({ error: 'upstream_unavailable' }, 502);
  }

  const text = await res.text();
  if (!res.ok) {
    // 업스트림 에러 본문은 흘리지 않는다. Google 의 에러 메시지에는 프로젝트
    // 번호와 키 일부가 섞여 나오는 경우가 있다.
    console.error(`[ai-gemini] upstream ${res.status}: ${text.slice(0, 500)}`);
    return json({ error: 'upstream_error', status: res.status }, 502);
  }

  // 계량은 응답을 읽어야 하지만, 응답 **본문은 원문 그대로** 돌려준다.
  let usage: UsageMetadata | undefined;
  try {
    usage = (JSON.parse(text) as { usageMetadata?: UsageMetadata }).usageMetadata;
  } catch {
    console.warn('[ai-gemini] upstream response was not JSON; usage not recorded');
  }
  await recordUsage(gate, {
    provider: 'gemini',
    // 작업 이름은 앱이 알려준다(analyze/summary/...). 라벨일 뿐이고 판정에는
    // 쓰이지 않으므로, 빠졌으면 경로에서 유추 가능한 이름으로 대체한다.
    task: gate.task || 'generate',
    model,
    prompt_tokens: usage?.promptTokenCount ?? null,
    output_tokens: usage?.candidatesTokenCount ?? null,
    total_tokens: usage?.totalTokenCount ?? null,
    duration_ms: Date.now() - startedAt
  });

  return new Response(text, {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
});
