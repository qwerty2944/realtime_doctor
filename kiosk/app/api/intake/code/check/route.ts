/**
 * POST /api/intake/code/check
 *
 * 접수처가 발급한 방문 코드가 지금 쓸 수 있는 코드인지만 확인한다.
 *
 * [HARD] 이 라우트는 **아무것도 만들지 않고 아무것도 소모하지 않는다.**
 * `patients`/`encounters` 를 건드리지 않고, 모델을 부르지 않고, 코드를
 * 사용 처리하지도 않는다. 실제 소모는 `/api/intake/start` 에서 한 번만
 * 일어난다.
 *
 * 왜 확인 단계를 따로 두는가: 코드는 환자가 처음 보는 화면에서 입력된다.
 * 여기서 걸러내지 않으면 이름·생년월일을 다 적은 뒤 마지막에 "코드가
 * 틀렸습니다" 를 보게 되고, 그건 M6 이 키오스크 해석을 첫 화면으로 올린
 * 이유와 같은 실패다.
 *
 * 보안상 이 라우트가 새로 여는 문은 없다. 판정도, 슬러그 규칙도, 속도 제한도
 * 전부 `/start` 와 **같은 DB 함수의 같은 경로**를 쓴다(마지막 UPDATE 만
 * 건너뛴다). 틀린 코드는 여기서도 분당 실패 카운터를 소진한다.
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import { resolveKiosk } from '@/lib/intake/kiosk';
import { intakeCodeCheckRequestSchema } from '@/lib/intake/schemas';
import { redeemVisitCode, visitCodeMessage } from '@/lib/intake/visitCodeServer';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface IntakeCodeCheckResponse {
  ok: true;
  /** `resumed` = 중단된 문진이 있어서 이어서 진행하게 된다. */
  mode: 'created' | 'resumed';
}

const KIOSK_ERROR =
  '이 태블릿이 담당 의사와 연결되어 있지 않습니다. 접수처에 알려 주세요.';

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(
    request,
    intakeCodeCheckRequestSchema,
    '코드를 다시 확인해 주세요.'
  );
  if (!parsed.ok) return parsed.response;

  const { kiosk, code } = parsed.data;

  const resolution = resolveKiosk(kiosk);
  if (!resolution.ok) {
    console.error(
      `[POST /api/intake/code/check] kiosk="${kiosk ?? ''}" ${resolution.reason}.`
    );
    return jsonError(400, KIOSK_ERROR);
  }

  try {
    const verdict = await redeemVisitCode(createSupabaseAdminClient(), {
      clinicianId: resolution.clinicianId,
      code,
      kioskSlug: resolution.slug,
      consume: false
    });

    if (!verdict.ok) {
      console.warn(
        `[POST /api/intake/code/check] Rejected a code at kiosk=${resolution.slug}: ${verdict.reason}.`
      );
      // 401 이 아니라 400 이다. 아직 세션이 없고, 이건 인증 실패가 아니라
      // 입력 검증 실패다.
      return jsonError(400, visitCodeMessage(verdict.reason));
    }

    return Response.json({
      ok: true,
      mode: verdict.mode
    } satisfies IntakeCodeCheckResponse);
  } catch (error) {
    console.error('[POST /api/intake/code/check] Failed to check the visit code.', error);
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
