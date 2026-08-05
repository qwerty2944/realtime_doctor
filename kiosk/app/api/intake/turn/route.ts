/**
 * POST /api/intake/turn
 *
 * 환자의 답변을 받아 다음 질문을 만들고, red flag 를 판정하고, 문진이 끝나면
 * 결과를 생성·저장한다.
 *
 * 전부 서버에서 돈다: LLM API 키와 Supabase 서비스 롤 키는 여기서 읽히고
 * 프로세스 밖으로 나가지 않는다.
 *
 * 대화는 클라이언트가 실어 보낸다(`lib/intake/interview.ts` 의 근거 참고).
 * 담당 의사 uuid 는 클라이언트가 아니라 DB 의 encounter 행에서 읽어서 토큰
 * 검증에 쓴다 — 그래야 토큰이 자기가 발급된 진료·의사 조합을 벗어나지 못한다.
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import {
  collectPatientUtterances,
  runInterviewTurn,
  type DialogueTurn
} from '@/lib/intake/interview';
import { applyRedFlagDetection } from '@/lib/intake/redFlags';
import { generateAndStoreIntakeResult } from '@/lib/intake/result';
import { intakeTurnRequestSchema } from '@/lib/intake/schemas';
import { verifyIntakeToken } from '@/lib/intake/token';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type IntakeTurnResponse =
  | { done: false; question: string }
  | { done: true; message: string };

const RESULT_FAILURE_MESSAGE =
  '문진 내용을 정리하는 중 문제가 발생했습니다. 접수처에 알려 주세요.';

const BAD_TOKEN_MESSAGE =
  '문진 세션 정보가 올바르지 않습니다. 처음부터 다시 시작해 주세요.';
const EXPIRED_TOKEN_MESSAGE =
  '문진 시간이 만료되었습니다. 접수처에 알려 주시고 처음부터 다시 시작해 주세요.';

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(
    request,
    intakeTurnRequestSchema,
    '답변을 다시 확인해 주세요.'
  );
  if (!parsed.ok) return parsed.response;

  const { encounterId, token, turns, text } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    const { data: encounter, error: encounterError } = await supabase
      .from('encounters')
      .select('id, status, user_id')
      .eq('id', encounterId)
      .maybeSingle();

    if (encounterError) {
      throw new Error(`Failed to load encounter ${encounterId}: ${encounterError.message}`);
    }
    if (!encounter) {
      // 존재하지 않는 진료에 대해서도 토큰 검증과 같은 문장을 쓴다. 진료 id 가
      // 실재하는지 알려주지 않기 위해서다.
      console.warn(`[POST /api/intake/turn] Unknown encounter ${encounterId}.`);
      return jsonError(404, BAD_TOKEN_MESSAGE);
    }

    const row = encounter as { status: string; user_id: string };

    // 인가 먼저. 담당 의사 uuid 는 DB 행에서 읽은 값을 쓴다 — 호출자가 주장한
    // 값이 아니다. 이유는 로그에만 남기고 응답에는 넣지 않는다: "만료" 와
    // "위조" 를 구별해 주면 진료 id 가 실재한다는 사실을 확인시켜 준다.
    const verification = verifyIntakeToken(token, {
      encounterId,
      clinicianId: row.user_id
    });
    if (!verification.ok) {
      console.warn(
        `[POST /api/intake/turn] Rejected a turn on encounter ${encounterId}: token ${verification.reason}.`
      );
      return jsonError(
        401,
        verification.reason === 'expired' ? EXPIRED_TOKEN_MESSAGE : BAD_TOKEN_MESSAGE
      );
    }

    if (row.status !== 'intake_in_progress') {
      return jsonError(409, '이미 완료된 문진입니다.');
    }

    // 클라이언트가 보낸 기록에 이번 답변을 얹은 것이 현재 대화다.
    const dialogue: DialogueTurn[] = [...turns, { role: 'patient', text }];

    const turn = await runInterviewTurn(dialogue);

    // red flag 는 매 턴 지금까지의 모든 답변에 대해 평가한다. 두 답변에 걸쳐야
    // 완성되는 패턴도 잡히도록. 다만 답변은 따로따로 넘기므로, 한 답변 안의
    // 매치와 여러 답변에서 조립된 매치를 구별할 수 있고, 한 답변 안의 부정이
    // 규칙을 발화시키지 않는다.
    await applyRedFlagDetection(supabase, {
      encounterId,
      patientUtterances: collectPatientUtterances(dialogue),
      modelDanger: turn.danger,
      modelDangerReason: turn.danger_reason
    });

    if (!turn.done) {
      return Response.json({
        done: false,
        question: turn.message
      } satisfies IntakeTurnResponse);
    }

    try {
      await generateAndStoreIntakeResult(supabase, {
        encounterId,
        turns: [...dialogue, { role: 'agent', text: turn.message }]
      });
    } catch (error) {
      // 진료는 intake_in_progress 로 남아 있으므로 접수처에서 다시 시도할 수 있다.
      console.error(
        `[POST /api/intake/turn] Result generation failed for encounter ${encounterId}.`,
        error
      );
      return jsonError(500, RESULT_FAILURE_MESSAGE);
    }

    return Response.json({ done: true, message: turn.message } satisfies IntakeTurnResponse);
  } catch (error) {
    console.error('[POST /api/intake/turn] Failed to process the intake turn.', error);
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
