import 'server-only';

/**
 * 끝난 문진 대화를 저장되는 초안 기록으로 바꾼다. SERVER ONLY.
 *
 * `intake_results` 행 하나를 만든다: SOAP 초안, 순위가 매겨진 감별진단,
 * 추천 검사, 그리고 Electron 오버레이가 읽는 의사용 추가 질문 / 의학용어.
 *
 * `intakeResultRowSchema` 를 통과하기 전에는 아무것도 테이블에 닿지 않는다.
 * 검증에 실패하면 실패 내용을 되돌려주며 모델에 한 번 더 묻고, 두 번째도
 * 실패하면 던진다. 형태가 깨진 행은 절대 insert 하지 않는다 — Electron 쪽
 * 파서가 고정된 JSON 경로를 읽으므로, 반쯤 쓰인 행은 스스로를 알리는 대신
 * 창을 조용히 비워놓는다.
 *
 * 마지막으로 encounter 를 `intake_done` 으로 올린다. 그 UPDATE 가 Realtime
 * 이벤트를 쏘고, 그게 Electron 대기목록에 환자가 나타나는 유일한 경로다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { ModelOutputError, callStructuredTool, type LlmMessage } from '@/lib/llm';
import type { DialogueTurn } from '@/lib/intake/interview';
import {
  ASSESSMENT_DRAFT_CAVEAT,
  RESULT_SYSTEM_PROMPT,
  SOAP_OBJECTIVE_PLACEHOLDER,
  buildResultUserMessage
} from '@/lib/intake/prompts';
import {
  intakeResultRowSchema,
  modelIntakeResultSchema,
  type IntakeResultRow,
  type ModelIntakeResult
} from '@/lib/intake/schemas';

const RESULT_MAX_TOKENS = 4096;

/** 스키마 거부 후 한 번 재시도, 그다음은 크게 실패. */
const MAX_GENERATION_ATTEMPTS = 2;

/**
 * 감별진단 근거의 발화 참조를 실제 대화와 대조한다 (E1).
 *
 * 모델은 프롬프트로 아무리 못 박아도 가끔 존재하지 않는 번호를 댄다. 지어낸
 * 참조가 DB 에 들어가면 그 뒤로는 진짜와 구별할 수 없으므로 **저장 전에**
 * 떨어낸다. 하나도 안 남으면 빈 배열로 저장하고, Electron 감별진단 창이 그
 * 진단을 "근거 미확인" 으로 따로 표시한다 (`src/shared/findings.ts`).
 *
 * 번호는 `buildResultUserMessage` 가 붙인 [#N] 이고, 그것은 저장되는
 * `soap_json.transcript` 의 배열 인덱스와 같다.
 */
function resolveSupportingFindings(
  findings: readonly { finding: string; source: string }[],
  turns: readonly DialogueTurn[]
): { finding: string; source: string }[] {
  const resolved: { finding: string; source: string }[] = [];
  for (const item of findings) {
    const matched = item.source.match(/-?\d+/);
    if (!matched) continue;
    const index = Number.parseInt(matched[0], 10);
    if (!Number.isInteger(index) || index < 0 || index >= turns.length) continue;
    // source 는 정규화해서 저장한다 — 읽는 쪽이 표기 변주를 다시 풀지 않도록.
    resolved.push({ finding: item.finding, source: `#${index}` });
  }
  return resolved;
}

/**
 * 모델 출력을 행 페이로드로 조립한다.
 *
 * 모델에 맡기지 않고 여기서 결정하는 것 세 가지:
 *   - O 는 언제나 고정 문구,
 *   - assessment 에는 언제나 "확정 진단 아님" 단서가 붙는다,
 *   - 감별진단 근거는 실제 대화와 대조해 통과한 것만 남긴다 (E1).
 */
// export 인 이유: 검증 프로브(`scripts/probe-findings.mjs`)가 OpenAI 를 태우지
// 않고 이 조립·검증 경로를 그대로 부른다. 앱 코드에서는 아래에서만 쓴다.
export function assembleRow(
  model: ModelIntakeResult,
  turns: readonly DialogueTurn[]
): IntakeResultRow {
  // 모델이 어떤 rank 를 냈든 index 0 이 항상 최우선이 되도록 다시 매긴다.
  const differentials = [...model.differentials]
    .sort((a, b) => a.rank - b.rank)
    .map((item, index) => ({
      rank: index + 1,
      name_kr: item.name_kr,
      name_en: item.name_en,
      rationale: item.rationale,
      supporting_findings: resolveSupportingFindings(item.supporting_findings, turns)
    }));

  const assessment = model.soap.a.includes('확정')
    ? model.soap.a
    : `${model.soap.a}\n\n${ASSESSMENT_DRAFT_CAVEAT}`;

  const candidate = {
    soap_json: {
      s: model.soap.s,
      o: SOAP_OBJECTIVE_PLACEHOLDER,
      a: assessment,
      p: model.soap.p,
      follow_up_questions: model.follow_up_questions,
      medical_terms: model.medical_terms,
      transcript: turns.map((turn) => ({ role: turn.role, text: turn.text }))
    },
    differentials_json: differentials,
    recommended_tests_json: model.recommended_tests
  };

  const parsed = intakeResultRowSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ModelOutputError(
      `Assembled intake result failed validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
      model
    );
  }

  return parsed.data;
}

/** 진료의 다음 버전 번호. 재생성이 (encounter_id, version) 유니크를 깨지 않도록. */
async function nextVersion(
  supabase: SupabaseClient,
  encounterId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('intake_results')
    .select('version')
    .eq('encounter_id', encounterId)
    .order('version', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to read existing result versions: ${error.message}`);
  }

  const rows = (data ?? []) as { version: number }[];
  return (rows[0]?.version ?? 0) + 1;
}

export interface GeneratedIntakeResult {
  intakeResultId: string;
  version: number;
  chiefComplaint: string;
}

/**
 * 결과를 생성·검증·저장하고, 진료를 `intake_done` 으로 옮긴다.
 *
 * `chief_complaint` 는 `encounters` 에도 비정규화해서 넣는다 — 대기목록이
 * intake_results 를 조인하지 않고도 주소를 그릴 수 있어야 하기 때문이다
 * (0001 마이그레이션의 컬럼 주석 참고).
 */
export async function generateAndStoreIntakeResult(
  supabase: SupabaseClient,
  params: { encounterId: string; turns: readonly DialogueTurn[] }
): Promise<GeneratedIntakeResult> {
  const userMessage = buildResultUserMessage(params.turns);

  let lastError: ModelOutputError | null = null;
  let row: IntakeResultRow | null = null;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const messages: LlmMessage[] = [{ role: 'user', content: userMessage }];

    if (lastError) {
      messages.push({
        role: 'user',
        content: `(시스템: 직전 출력이 형식 검증을 통과하지 못했습니다. 아래 문제를 고쳐 다시 작성해 주세요.)\n${lastError.message}`
      });
    }

    try {
      const model = await callStructuredTool({
        system: RESULT_SYSTEM_PROMPT,
        messages,
        toolName: 'record_intake_result',
        toolDescription:
          'Record the SOAP draft, the 3-5 prioritized differential diagnoses, the recommended examinations, the follow-up questions for the physician and the medical term explanations.',
        schema: modelIntakeResultSchema,
        maxTokens: RESULT_MAX_TOKENS
      });

      row = assembleRow(model, params.turns);
      break;
    } catch (error) {
      if (!(error instanceof ModelOutputError)) throw error;
      lastError = error;
      console.error(
        `[intake-result] Attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} failed for encounter ${params.encounterId}: ${error.message}`
      );
    }
  }

  if (!row) {
    throw lastError ?? new Error('Intake result generation produced no output.');
  }

  const version = await nextVersion(supabase, params.encounterId);

  const { data: inserted, error: insertError } = await supabase
    .from('intake_results')
    .insert({
      encounter_id: params.encounterId,
      soap_json: row.soap_json,
      differentials_json: row.differentials_json,
      recommended_tests_json: row.recommended_tests_json,
      version
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `Failed to insert the intake result for encounter ${params.encounterId}: ${insertError?.message ?? 'no row returned'}`
    );
  }

  const intakeResultId = (inserted as { id: string }).id;
  const chiefComplaint = row.soap_json.s.chief_complaint;

  // 이 UPDATE 가 Realtime 이벤트를 만든다 → Electron 대기목록에 환자가 뜬다.
  // 결과 행은 이미 들어갔으므로, 여기서 실패하면 "문진은 끝났는데 아무도
  // 모르는" 상태다. 조용히 넘기지 않고 던진다.
  const { error: statusError } = await supabase
    .from('encounters')
    .update({ status: 'intake_done', chief_complaint: chiefComplaint })
    .eq('id', params.encounterId);

  if (statusError) {
    throw new Error(
      `Intake result ${intakeResultId} was stored but encounter ${params.encounterId} could not be moved to intake_done: ${statusError.message}`
    );
  }

  return { intakeResultId, version, chiefComplaint };
}
