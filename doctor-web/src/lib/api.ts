/**
 * Small helpers shared by the intake API routes.
 *
 * Error bodies are deliberately plain: the patient sees a Korean sentence, while the
 * diagnostic detail goes to the server log. Internal messages must never reach the
 * browser because they name tables, sessions and model output.
 */

import type { ZodType } from 'zod';

export interface ApiErrorBody {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiErrorBody, { status });
}

/** Generic 500 used by every route's catch-all. */
export const GENERIC_SERVER_ERROR =
  '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주시고, 계속되면 접수처에 알려 주세요.';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Read and validate a JSON request body.
 *
 * Returns a ready-made 400 response instead of throwing so route handlers stay flat.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  invalidMessage: string,
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
    return {
      ok: false,
      response: jsonError(400, first?.message ?? invalidMessage),
    };
  }

  return { ok: true, data: parsed.data };
}
