/**
 * POST /api/intake/start
 *
 * 환자와 진료(encounter)를 만들고, 담당 의사에게 귀속시키고, AI 의 여는
 * 질문을 돌려준다.
 *
 * 전부 서버에서 돈다: LLM API 키와 Supabase 서비스 롤 키는 여기서 읽히고
 * 프로세스 밖으로 나가지 않는다.
 *
 * 귀속(attribution)이 이 라우트의 핵심이다. `encounters.user_id` 는 NOT NULL
 * 이고 RLS 가 `user_id = auth.uid()` 이므로, 여기서 담당 의사를 잘못 넣거나
 * 넣지 않으면 그 문진은 아무에게도 보이지 않는다. 자세한 근거는
 * `lib/intake/kiosk.ts`.
 *
 * [HARD] 접근 통제 순서 (L1)
 * -------------------------
 * 이 라우트는 공개 주소에 있다. 슬러그(`?k=`)는 여전히 **라우팅 키일 뿐**이고,
 * 문진을 시작할 수 있게 하는 것은 접수처가 이 방문을 위해 발급한 방문 코드다.
 *
 * 아래 순서는 지켜져야 하는 순서다:
 *   1. 본문 검증 (zod)
 *   2. 슬러그 → 담당 의사
 *   3. **방문 코드 소모** — 여기서 실패하면 즉시 반환한다
 *   4. patients / encounters insert
 *   5. 토큰 발급
 *   6. 모델 호출
 *
 * 3 이 4 보다 먼저인 이유: 발급되지 않은 접근이 진료 행을 만들면 안 된다.
 * 3 이 6 보다 먼저인 이유: 모델 호출은 돈이고, 공개 주소에서 무료로 태울 수
 * 있는 모델 호출은 그 자체로 취약점이다.
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import { runInterviewTurn } from '@/lib/intake/interview';
import { resolveKiosk } from '@/lib/intake/kiosk';
import { intakeStartRequestSchema } from '@/lib/intake/schemas';
import { mintIntakeToken } from '@/lib/intake/token';
import {
  bindVisitCodeToEncounter,
  redeemVisitCode,
  visitCodeMessage
} from '@/lib/intake/visitCodeServer';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface IntakeStartResponse {
  encounterId: string;
  question: string;
  /** 매 턴 되돌려 보내야 하는, 진료에 묶인 서명 자격증명. */
  token: string;
}

const KIOSK_ERROR =
  '이 태블릿이 담당 의사와 연결되어 있지 않습니다. 접수처에 알려 주세요.';

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(
    request,
    intakeStartRequestSchema,
    '입력한 정보를 다시 확인해 주세요.'
  );
  if (!parsed.ok) return parsed.response;

  const { kiosk, code, name, birthDate, registrationNo, consents } = parsed.data;

  // 담당 의사부터 정한다. 이게 안 되면 DB 를 건드릴 이유가 없다 — 소유자
  // 없는 환자 행만 남기고 끝나기 때문이다.
  const resolution = resolveKiosk(kiosk);
  if (!resolution.ok) {
    console.error(
      `[POST /api/intake/start] Refused to start intake: kiosk="${kiosk ?? ''}" ${resolution.reason}.`
    );
    return jsonError(400, KIOSK_ERROR);
  }
  const clinicianId = resolution.clinicianId;

  try {
    const supabase = createSupabaseAdminClient();

    // ── [HARD] 여기가 문이다 ────────────────────────────────────────────
    // 이 아래로 내려가려면 접수처가 발급한 유효한 코드가 있어야 한다.
    // 실패하면 patients 도 encounters 도 만들어지지 않고 모델도 부르지
    // 않는다. 이 return 이 그 보장의 전부다.
    const redemption = await redeemVisitCode(supabase, {
      clinicianId,
      code,
      kioskSlug: resolution.slug,
      consume: true
    });

    if (!redemption.ok) {
      console.warn(
        `[POST /api/intake/start] Refused to start intake at kiosk=${resolution.slug}: visit code ${redemption.reason}.`
      );
      return jsonError(
        redemption.reason === 'rate_limited' ? 429 : 401,
        visitCodeMessage(redemption.reason)
      );
    }

    // 중단된 문진의 재개. 새 진료 행을 만들지 않고, 같은 진료의 토큰을 다시
    // 발급한다 — 태블릿이 새로고침됐거나 환자가 잠시 자리를 떴을 때 한 방문에
    // 진료 행이 둘 생기는 것을 막기 위해서다(근거는 0009 마이그레이션).
    if (redemption.mode === 'resumed' && redemption.encounterId) {
      const encounterId = redemption.encounterId;
      console.info(
        `[POST /api/intake/start] Resuming encounter=${encounterId} kiosk=${resolution.slug} redeem=${redemption.redeemCount}`
      );
      const token = mintIntakeToken({ encounterId, clinicianId });
      const turn = await runInterviewTurn([]);
      return Response.json({
        encounterId,
        question: turn.message,
        token
      } satisfies IntakeStartResponse);
    }

    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .insert({
        user_id: clinicianId,
        name,
        birth_date: birthDate,
        // 비어 있다는 것은 "환자가 모른다" 는 뜻이고, 접수처가 나중에 채운다.
        registration_no: registrationNo?.trim() ? registrationNo.trim() : null
      })
      .select('id')
      .single();

    if (patientError || !patient) {
      throw new Error(
        `Failed to create the patient: ${patientError?.message ?? 'no row returned'}`
      );
    }

    const patientId = (patient as { id: string }).id;

    const { data: encounter, error: encounterError } = await supabase
      .from('encounters')
      .insert({
        patient_id: patientId,
        user_id: clinicianId,
        status: 'intake_in_progress',
        // 동의는 진료 행에 함께 남긴다. 여기서 저장에 실패하면 진료 자체가
        // 만들어지지 않는다 — 동의 없는 문진 기록을 남기지 않기 위해서다.
        consent_privacy: consents.privacy,
        consent_recording: consents.recording,
        consent_ai: consents.ai,
        consented_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (encounterError || !encounter) {
      throw new Error(
        `Failed to create the encounter: ${encounterError?.message ?? 'no row returned'}`
      );
    }

    const encounterId = (encounter as { id: string }).id;

    // 코드를 이 진료에 묶는다. write-once 이고, 실패해도 진료는 이미
    // 만들어졌으므로 되돌리지 않는다 — 다만 묶이지 않은 코드는 재개에 쓸 수
    // 없으므로 조용히 넘기지 않고 로그에 남긴다(모듈 안에서).
    if (redemption.codeId) {
      await bindVisitCodeToEncounter(supabase, redemption.codeId, encounterId);
    }

    // 동의는 encounters 행에 저장됐다. 로그는 운영 중 추적용 보조 기록이다.
    // 식별정보는 넣지 않는다.
    console.info(
      `[POST /api/intake/start] encounter=${encounterId} kiosk=${resolution.slug} consents=` +
        `privacy:${consents.privacy},recording:${consents.recording},ai:${consents.ai}`
    );

    // 모델 호출 전에 발급한다. 느리거나 실패한 생성이 "이어갈 방법이 없는
    // 진료" 를 남기지 않도록.
    const token = mintIntakeToken({ encounterId, clinicianId });

    // 아직 대화가 없으므로 모델이 여는 질문을 만든다.
    const turn = await runInterviewTurn([]);

    return Response.json({
      encounterId,
      question: turn.message,
      token
    } satisfies IntakeStartResponse);
  } catch (error) {
    console.error('[POST /api/intake/start] Failed to start the intake.', error);
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
