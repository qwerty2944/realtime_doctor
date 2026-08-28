/**
 * POST /api/demo-turn   (JSON)
 *
 * 데모 문진(7항목)의 모델 호출. **데모 전용이며 DB 에 아무것도 쓰지 않는다** —
 * patients/encounters 행을 만들지 않고 Supabase 를 아예 건드리지 않는다.
 *
 * 운영 문진(`/api/intake/turn`)과 달리 방문코드 게이트가 없다. 공개 URL 이므로
 * 인가 대신 값싼 남용 방어(턴 수·길이 상한 + IP 레이트리밋)로 모델 쿼터를
 * 지킨다. 검증은 벤더에 1바이트가 닿기 전에 끝난다.
 *
 * API 키는 `lib/llm/gemini.ts` 의 헬퍼로만 읽는다. 서버 밖으로 나가지 않는다.
 */

import { z } from 'zod';

import { jsonError, parseJsonBody } from '@/lib/api';
import {
  buildIntakeSummaryBody,
  buildIntakeTurnBody,
  fallbackReply,
  isIntakeField,
  parseIntakeText,
  parseIntakeTurn,
  recordField,
  type IntakeFieldCall,
  type IntakeRecord
} from '@/lib/demo/intake';
import { optionalEnv } from '@/lib/env';
import { geminiApiKey, geminiModel } from '@/lib/llm/gemini';

/**
 * 남용 방어 한계값.
 *
 * 데모는 로그인이 없으므로 이것이 유일한 방어선이다. 값은 정상 문진(보통 7~10턴,
 * 한 답변 몇 문장)보다 넉넉하되, 자동화된 호출이 쿼터를 태우기엔 좁게 잡았다.
 */
const MAX_TURNS = 40;
const MAX_MESSAGE_LENGTH = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const RATE_LIMITED_MESSAGE = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
const MODEL_FAILURE_MESSAGE =
  '문진 도우미가 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export interface DemoTurnResponse {
  /** 환자에게 보여줄 한국어 한 마디. 200 일 때는 절대 비어 있지 않다. */
  reply: string;
  /** 이번 턴에 모델이 기록한 항목들. 없으면 빈 배열. */
  calls: IntakeFieldCall[];
}

export interface DemoSummaryResponse {
  summary: string;
}

const messageSchema = z.object({
  role: z.enum(['assistant', 'patient']),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH, {
    message: `한 번에 ${MAX_MESSAGE_LENGTH}자까지 입력할 수 있습니다.`
  })
});

/** 항목 값도 모델이 만든 문자열이라 길이를 묶어둔다. */
const recordSchema = z.record(z.string(), z.string().trim().min(1).max(MAX_MESSAGE_LENGTH));

const bodySchema = z.discriminatedUnion(
  'mode',
  [
    z.object({
      mode: z.literal('turn'),
      history: z.array(messageSchema).min(1).max(MAX_TURNS, {
        message: '대화가 너무 길어졌습니다. 처음부터 다시 시작해 주세요.'
      }),
      record: recordSchema.optional()
    }),
    z.object({
      mode: z.literal('summary'),
      record: recordSchema.optional()
    })
  ],
  // 환자에게 나가는 문구는 한국어로 유지한다. zod 기본 메시지는 영어다.
  { error: '요청 형식이 올바르지 않습니다.' }
);

/**
 * IP 당 요청 카운터.
 *
 * 프로세스 메모리라 서버리스 인스턴스마다 따로 세고 재시작하면 사라진다.
 * 데모에 맞는 트레이드오프다 — 목적은 완벽한 제한이 아니라, 실수로 열린 루프나
 * 장난스러운 반복 호출이 모델 쿼터를 통째로 태우지 못하게 막는 것이다.
 */
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });

    // 만료된 버킷을 걷어낸다. 맵이 무한히 자라면 그것 자체가 사고다.
    if (rateLimitBuckets.size > 1000) {
      for (const [key, value] of rateLimitBuckets) {
        if (now >= value.resetAt) rateLimitBuckets.delete(key);
      }
    }
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** 신뢰할 수 없는 body 의 record 를 알려진 7개 키로만 좁힌다. */
function sanitizeRecord(raw: Record<string, string> | undefined): IntakeRecord {
  const record: IntakeRecord = {};
  if (!raw) return record;
  for (const [key, value] of Object.entries(raw)) {
    if (isIntakeField(key)) record[key] = value;
  }
  return record;
}

/**
 * generateContent 한 번. 전송 실패는 던진다 — 호출부가 하나의 한국어 메시지로
 * 바꾸고, 진단에 필요한 내용은 서버 로그에만 남긴다.
 */
async function callGemini(body: unknown): Promise<unknown> {
  const model = geminiModel();
  const base = optionalEnv('GEMINI_API_BASE') ?? DEFAULT_API_BASE;

  const response = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiApiKey() },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `[demo-turn] ${model} returned HTTP ${response.status}: ${detail.slice(0, 500)}`
    );
  }

  return response.json();
}

export async function POST(request: Request): Promise<Response> {
  if (isRateLimited(clientIp(request))) {
    return jsonError(429, RATE_LIMITED_MESSAGE);
  }

  const parsed = await parseJsonBody(request, bodySchema, '요청 형식이 올바르지 않습니다.');
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const record = sanitizeRecord(body.record);

  try {
    if (body.mode === 'summary') {
      const summary = parseIntakeText(await callGemini(buildIntakeSummaryBody(record)));
      return Response.json({ summary } satisfies DemoSummaryResponse);
    }

    const turn = parseIntakeTurn(await callGemini(buildIntakeTurnBody(body.history, record)));

    let updated = record;
    for (const call of turn.calls) {
      updated = recordField(updated, call.field, call.value);
    }

    // 모델이 도구만 부르고 말은 하지 않는 턴이 흔하다. 그대로 두면 화면에 다음
    // 질문이 안 떠서 대화가 조용히 멈춘다. 방금 기록한 항목을 상태 블록에
    // 반영한 뒤 도구 없이 한 번 더 부른다 — 도구를 빼야 모델이 말로 답한다.
    if (turn.reply === '' && turn.calls.length > 0) {
      turn.reply = parseIntakeText(
        await callGemini(buildIntakeTurnBody(body.history, updated, { allowTools: false }))
      );
    }

    // 재시도까지 비면(Gemini 3 는 추론만 담긴 part 를 돌려주는 경우가 있다)
    // 미수집 항목의 기본 질문으로 대체한다. 빈 응답은 내보내지 않는다.
    if (turn.reply === '') turn.reply = fallbackReply(updated);

    return Response.json({ reply: turn.reply, calls: turn.calls } satisfies DemoTurnResponse);
  } catch (error) {
    // 모델·네트워크 실패는 서버 버그가 아니다. 상세는 로그로만 보낸다
    // (프롬프트와 키 관련 문자열이 섞여 나올 수 있다).
    console.error('[POST /api/demo-turn] Model call failed.', error);
    return jsonError(502, MODEL_FAILURE_MESSAGE);
  }
}
