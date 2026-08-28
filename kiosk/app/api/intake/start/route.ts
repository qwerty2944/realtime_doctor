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
 *
 * [HARD] 무코드(walk-in) 경로 (0019)
 * ---------------------------------
 * 원내에 붙인 고정 QR 에는 코드가 없다. 접수처가 바쁘거나 링크가 만료됐을 때
 * 문진을 시작할 방법이 아예 없으면, 의원은 폴백이 아니라 **제품을 안 쓰는 쪽**
 * 으로 폴백한다. 그래서 이 문을 열되 좁게 연다:
 *
 *   - 3 단계가 코드 소모 대신 **속도 제한**(출처 주소 + 의사 단위, DB 카운터)
 *     이 된다. 그 자리에 그대로 있고, insert 와 모델 호출보다 여전히 앞이다.
 *   - 만들어지는 진료에 `intake_source = 'walk_in'` 이 박힌다. 아무도 보증하지
 *     않은 문진이 보증된 문진과 같은 모습으로 대기목록에 앉으면 안 된다.
 *   - 담당 의사는 여전히 슬러그로만 정해진다. 클라이언트는 의사를 지목할 수 없다.
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
import {
  hashClientAddress,
  recordWalkInStart,
  walkInMessage
} from '@/lib/intake/walkIn';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { UsageCollector } from '@/lib/usage';

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

  const { kiosk, mode, code, name, birthDate, registrationNo, consents } = parsed.data;

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
    // 이 아래로 내려가려면 (a) 접수처가 발급한 유효한 코드가 있거나
    // (b) 무코드 경로의 속도 제한을 통과해야 한다. 어느 쪽이 실패해도
    // patients 도 encounters 도 만들어지지 않고 모델도 부르지 않는다.
    // 이 return 들이 그 보장의 전부다.
    let codeId: string | null = null;
    // 접수처가 미리 등록해 둔 환자(0019). 있으면 새 환자 행을 만들지 않는다 —
    // 만들면 같은 사람이 차트에 둘이 되고, 그 중복은 대기목록에서 보인다.
    let registeredPatientId: string | null = null;

    if (mode === 'walk_in') {
      const verdict = await recordWalkInStart(supabase, {
        clinicianId,
        ipHash: hashClientAddress(request)
      });
      if (!verdict.allowed) {
        console.warn(
          `[POST /api/intake/start] Refused a walk-in intake at kiosk=${resolution.slug}: ${verdict.reason}.`
        );
        return jsonError(
          verdict.reason === 'unavailable' ? 503 : 429,
          walkInMessage(verdict.reason)
        );
      }
    } else {
      const redemption = await redeemVisitCode(supabase, {
        clinicianId,
        // 스키마가 `mode: 'code'` 에서 코드를 이미 강제한다. 빈 문자열로
        // 떨어져도 DB 가 거절하므로 이 폴백이 문을 열지는 않는다.
        code: code ?? '',
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
        const usage = new UsageCollector(supabase, clinicianId, encounterId);
        const turn = await runInterviewTurn([], { onUsage: usage.collect });
        await usage.flush('kiosk-interview');
        return Response.json({
          encounterId,
          question: turn.message,
          token
        } satisfies IntakeStartResponse);
      }

      codeId = redemption.codeId;
      registeredPatientId = redemption.patientId;
    }

    let patientId: string;

    if (registeredPatientId) {
      // 접수처가 만든 행에 환자가 입력한 값을 채운다. 이름도 환자가 고친 값을
      // 쓴다 — 화면에 미리 채워진 이름을 고쳤다는 것은 접수 입력이 틀렸다는
      // 뜻이고, 본인이 더 정확하다.
      patientId = registeredPatientId;
      const { error: updateError } = await supabase
        .from('patients')
        .update({
          name,
          birth_date: birthDate,
          registration_no: registrationNo?.trim() ? registrationNo.trim() : null
        })
        .eq('id', patientId)
        // 소유자 조건을 한 번 더 건다. 코드가 이미 의사에 묶여 있으므로
        // 중복이지만, service_role 은 RLS 를 지나지 않는다.
        .eq('user_id', clinicianId);

      if (updateError) {
        throw new Error(`Failed to update the registered patient: ${updateError.message}`);
      }
    } else {
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

      patientId = (patient as { id: string }).id;
    }

    const { data: encounter, error: encounterError } = await supabase
      .from('encounters')
      .insert({
        patient_id: patientId,
        user_id: clinicianId,
        status: 'intake_in_progress',
        // 어느 문으로 들어왔는지 (0019). 보증된 문진과 아닌 문진이 대기목록에서
        // 같은 모습이면 안 된다.
        intake_source: mode === 'walk_in' ? 'walk_in' : 'invite',
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
    if (codeId) {
      await bindVisitCodeToEncounter(supabase, codeId, encounterId);
    }

    // 동의는 encounters 행에 저장됐다. 로그는 운영 중 추적용 보조 기록이다.
    // 식별정보는 넣지 않는다.
    console.info(
      `[POST /api/intake/start] encounter=${encounterId} kiosk=${resolution.slug} source=${mode} consents=` +
        `privacy:${consents.privacy},recording:${consents.recording},ai:${consents.ai}`
    );

    // 모델 호출 전에 발급한다. 느리거나 실패한 생성이 "이어갈 방법이 없는
    // 진료" 를 남기지 않도록.
    const token = mintIntakeToken({ encounterId, clinicianId });

    // 아직 대화가 없으므로 모델이 여는 질문을 만든다.
    const usage = new UsageCollector(supabase, clinicianId, encounterId);
    const turn = await runInterviewTurn([], { onUsage: usage.collect });
    await usage.flush('kiosk-interview');

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
