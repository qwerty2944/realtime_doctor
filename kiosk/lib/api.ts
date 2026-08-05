/**
 * 문진 API 라우트가 공유하는 작은 헬퍼들.
 *
 * 에러 본문은 일부러 밋밋하다: 환자는 한국어 한 문장만 보고, 진단에 필요한
 * 내용은 서버 로그로 간다. 내부 메시지는 테이블명·진료 id·모델 출력을 담고
 * 있으므로 브라우저에 절대 내보내지 않는다.
 */

import type { ZodType } from 'zod';

export interface ApiErrorBody {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiErrorBody, { status });
}

/** 모든 라우트의 catch-all 이 쓰는 일반 500. */
export const GENERIC_SERVER_ERROR =
  '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주시고, 계속되면 접수처에 알려 주세요.';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * JSON 요청 본문을 읽고 검증한다.
 *
 * 던지는 대신 완성된 400 응답을 돌려주므로 라우트 핸들러가 평평하게 유지된다.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  invalidMessage: string
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, '요청 형식이 올바르지 않습니다.') };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, response: jsonError(400, first?.message ?? invalidMessage) };
  }

  return { ok: true, data: parsed.data };
}
