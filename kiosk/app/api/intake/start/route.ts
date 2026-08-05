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
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import { runInterviewTurn } from '@/lib/intake/interview';
import { resolveKiosk } from '@/lib/intake/kiosk';
import { intakeStartRequestSchema } from '@/lib/intake/schemas';
import { mintIntakeToken } from '@/lib/intake/token';
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

  const { kiosk, name, birthDate, registrationNo, consents } = parsed.data;

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
