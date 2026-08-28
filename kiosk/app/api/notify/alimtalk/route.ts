/**
 * POST /api/notify/alimtalk
 *
 * 접수처(데스크톱 앱)가 방금 발급한 **환자 개인 링크**를 알림톡으로 보낸다.
 *
 * 요청자는 환자가 아니라 로그인한 의사다. 그래서 이 라우트만 문진 라우트들과
 * 다르게 Authorization 헤더를 요구한다.
 *
 * [HARD] 검증 순서
 * ---------------
 *   1. 설정 확인 — 없으면 `{ configured: false }` 로 **정직하게** 돌려준다.
 *      자리표시자로 보내는 시늉을 하면 설정 누락이 원장에게 "환자에게 안내가
 *      갔다" 로 도착한다.
 *   2. JWT → 사람. service client 의 `auth.getUser(jwt)` 로 서버가 확인한다.
 *      클라이언트가 주장하는 user id 는 받지 않는다.
 *   3. 코드 행 소유 확인. `visit_access_codes.user_id = 그 사람` 이 아니면
 *      거절. 이게 없으면 로그인한 아무나 남의 코드 id 를 넣어 남의 환자에게
 *      메시지를 보낼 수 있다.
 *   4. 링크 검증. 링크는 클라이언트가 보낸다 — **평문 코드는 어디에도 저장되지
 *      않으므로**(0009) 서버가 재구성할 방법이 없다. 대신 호스트와 경로가 이
 *      배포 자신의 `/intake` 인지 확인한다. 그러지 않으면 이 라우트는 우리
 *      발신번호로 아무 주소나 뿌리는 스팸 게이트가 된다.
 *   5. 번호는 **DB 에서 읽는다.** 클라이언트가 보낸 번호로 보내면 3번의 소유
 *      확인이 아무것도 지키지 못한다.
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import { BASE_PATH } from '@/lib/basePath';
import { loadAlimtalkConfig, sendAlimtalk } from '@/lib/notify/solapi';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const requestSchema = z.object({
  codeId: z.uuid(),
  /** 데스크톱이 조립한 문진 링크. 아래에서 이 배포의 주소인지 검증한다. */
  link: z.string().trim().min(1).max(500)
});

export interface AlimtalkNotifyResponse {
  ok: true;
}

/** 미설정 응답. 실패(4xx/5xx)가 아니라 상태 보고다. */
function notConfigured(): Response {
  return Response.json({ ok: false, configured: false }, { status: 200 });
}

/**
 * 링크가 이 배포의 문진 주소인지 확인한다.
 *
 * 호스트는 요청이 도착한 호스트와 같아야 하고, 경로는 base path 아래의
 * `/intake` 여야 한다. 둘 중 하나라도 어긋나면 보내지 않는다.
 */
function isOwnIntakeLink(link: string, request: Request): boolean {
  let url: URL;
  let self: URL;
  try {
    url = new URL(link);
    self = new URL(request.url);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  // 프록시(doctor-web rewrite) 뒤에 있으므로 원래 호스트도 인정한다.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const allowedHosts = new Set([self.host, forwardedHost].filter(Boolean) as string[]);
  if (!allowedHosts.has(url.host)) return false;

  return url.pathname === `${BASE_PATH}/intake`;
}

export async function POST(request: Request): Promise<Response> {
  const config = loadAlimtalkConfig();
  if (!config) return notConfigured();

  const parsed = await parseJsonBody(request, requestSchema, '요청 형식이 올바르지 않습니다.');
  if (!parsed.ok) return parsed.response;
  const { codeId, link } = parsed.data;

  const authorization = request.headers.get('authorization') ?? '';
  const jwt = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (jwt === '') return jsonError(401, '로그인 후에 발송할 수 있습니다.');

  if (!isOwnIntakeLink(link, request)) {
    console.warn('[POST /api/notify/alimtalk] Refused a link that is not this deployment’s intake URL.');
    return jsonError(400, '보낼 수 있는 링크가 아닙니다.');
  }

  try {
    const supabase = createSupabaseAdminClient();

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id;
    if (userError || !userId) {
      console.warn('[POST /api/notify/alimtalk] Rejected an unusable access token.');
      return jsonError(401, '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.');
    }

    const { data: code, error: codeError } = await supabase
      .from('visit_access_codes')
      .select('id, user_id, patient_name, patient_phone, expires_at, consumed_at')
      .eq('id', codeId)
      .maybeSingle();

    if (codeError) {
      throw new Error(`Failed to read the visit code: ${codeError.message}`);
    }

    const row = code as {
      user_id: string;
      patient_name: string | null;
      patient_phone: string | null;
      expires_at: string;
      consumed_at: string | null;
    } | null;

    // 남의 코드와 없는 코드를 같은 문장으로 거절한다. 구분해 주면 코드 id 를
    // 넣어보는 것만으로 다른 의원의 발급 현황을 알아낼 수 있다.
    if (!row || row.user_id !== userId) {
      console.warn(
        `[POST /api/notify/alimtalk] Refused code=${codeId}: not owned by the caller.`
      );
      return jsonError(403, '이 코드를 보낼 권한이 없습니다.');
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return jsonError(400, '이미 만료된 링크입니다. 새로 발급해 주세요.');
    }
    if (row.consumed_at !== null) {
      return jsonError(400, '이미 사용된 링크입니다. 새로 발급해 주세요.');
    }

    if (!row.patient_phone) {
      return Response.json(
        { ok: false, reason: 'no-phone', error: '이 환자에게는 휴대폰 번호가 없습니다.' },
        { status: 400 }
      );
    }

    const result = await sendAlimtalk(config, {
      to: row.patient_phone,
      patientName: row.patient_name ?? '환자',
      link
    });

    if (!result.ok) {
      return jsonError(502, result.message);
    }

    // 발송 사실만 남긴다. 번호도 링크도 로그에 넣지 않는다.
    console.info(`[POST /api/notify/alimtalk] Sent an invitation for code=${codeId}.`);

    return Response.json({ ok: true } satisfies AlimtalkNotifyResponse);
  } catch (error) {
    console.error('[POST /api/notify/alimtalk] Failed to send the invitation.', error);
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
