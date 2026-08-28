import type { PatientDetail } from '../shared/types.js';
import { describeProvenance } from '../shared/provenance.js';
import { getCurrentUser } from './auth.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 결정 감사 추적 (tasks/architecture-and-liability.md 6장).
 *
 * Lam et al., Nature 655:1129-1132 이 지적한 실무적 공백: *"임상의가 기계의
 * 권고에 얼마나 휘둘렸는지 판단할 쉬운 방법이 없다."* 법원이 "그 의존이
 * 합리적이었는가" 를 물을 때 우리에겐 답할 자료가 없다.
 *
 * 우리 배포 구조가 그 지점을 오히려 선명하게 만든다 — 키오스크가 임상의 없이
 * 해석을 만들고, 데스크톱이 임상의가 그것을 **처음 보는 자리**다. 기계의
 * 의견이 사람에게 넘어가는 순간이 코드 상의 한 지점에 있다. 여기서 그 인계를
 * 기록한다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * [HARD] 무엇을 기록하지 않는가
 * ─────────────────────────────────────────────────────────────────────────
 * 여기 있는 모든 이벤트는 앱이 **실제로 관측한** 동작이다. 주의·집중·체류
 * 시간에서 유추한 것은 하나도 없다.
 *
 *  - **채택 / 무시 / 수정 플래그를 만들지 않는다.** 앱은 의사가 실제로 내린
 *    진단을 전달받지 않는다. 그러므로 그런 라벨은 전부 추론이고, 특히
 *    "이벤트가 없었으니 무시했다" 는 최악이다 — 책임 기록 안에, 법원이 바로
 *    그것에 기대게 될 주장을 우리가 지어내 넣는 것이 된다. 없는 것은 없는
 *    대로 남긴다. 이 추적은 일어난 일을 말하고, 일어나지 않은 일을 설명하지
 *    않는다.
 *  - **체류 시간·스크롤·포커스 지속·마우스 데이터를 남기지 않는다.** 창이 앞에
 *    있는 것은 주의가 아니다. 책임 기록 안의 조작된 주의 신호는 신호가 없는
 *    것보다 나쁘다.
 *  - **횟수를 세지 않는다.** 각 이벤트는 dedupe 키를 갖고, 0012 의 부분 유니크
 *    인덱스가 (진료, 종류, 키)당 한 줄만 남긴다. 그래서 이 표는 "일어났다,
 *    처음은 이 시각이다" 에는 답하고 "몇 번" 에는 답할 수 없다. 반복 횟수는
 *    의사를 향한 engagement 지표이고, 이 표는 의존이 합리적이었는지에 답하려고
 *    있는 것이지 의사를 채점하려고 있는 것이 아니다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 실패해도 진료를 막지 않는다
 * ─────────────────────────────────────────────────────────────────────────
 * B5 의 진료행위 저장과 같은 규칙이다: await 하지 않고, 예외를 밖으로 던지지
 * 않고, 아무것도 띄우지 않는다. 기록이 진료 흐름에 끼어드는 순간 그 기록은
 * 꺼진다. 실패는 콘솔에만 남긴다.
 */

/** 0012 의 event_type CHECK 와 같은 집합. */
export type DecisionEventType =
  | 'interpretation_presented'
  | 'patient_detail_opened'
  | 'differential_expanded'
  | 'evidence_requested'
  | 'finding_source_opened'
  | 'summary_generated';

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[decision-trail:${scope}]`, msg);
}

/**
 * RPC 한 번. 실패는 삼키지 않고 콘솔에 남기되 호출자에게 던지지 않는다.
 *
 * `record_clinical_decision_event` 는 이미 기록된 이벤트를 에러가 아니라
 * `recorded: false` 로 돌려준다 — 의사가 카드를 몇 번 접었다 펴도 여기서
 * 에러 로그가 쏟아지지 않아야 한다.
 */
async function record(params: {
  encounterId: string;
  eventType: DecisionEventType;
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
  intakeResultId?: string | null;
  sessionId?: string | null;
}): Promise<void> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  if (!params.encounterId) return;
  try {
    const { error } = await supabase.rpc('record_clinical_decision_event', {
      p_encounter_id: params.encounterId,
      p_event_type: params.eventType,
      p_dedupe_key: params.dedupeKey ?? null,
      p_payload: params.payload ?? {},
      p_intake_result_id: params.intakeResultId ?? null,
      p_session_id: params.sessionId ?? null
    });
    if (error) warn(params.eventType, error.message);
  } catch (err) {
    warn(params.eventType, err);
  }
}

/** 던지지 않는 fire-and-forget 래퍼. 호출부가 await 를 잊어도 안전하도록. */
function fire(promise: Promise<void>): void {
  void promise.catch((err) => warn('fire', err));
}

// ── 페이로드 조립 ───────────────────────────────────────────────────────
// 문진 JSON 의 스키마는 키오스크가 소유하므로 여기서도 방어적으로 읽는다
// (renderer 의 patientMode.ts 와 같은 규칙). 읽을 수 없는 항목은 지어내지 않고
// 버린다 — 화면에 뜨지 않은 것을 "보여줬다" 고 기록하면 그게 위증이다.

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pick(row: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const text = asText(row[key]);
    if (text) return text;
  }
  return null;
}

/**
 * "무엇을 보여줬는가" 스냅샷.
 *
 * 조인이 아니라 **복사**다. 나중에 해석이 다시 뽑히면(0011 의 재해석) 그때의
 * 목록이 달라지는데, 조인으로 그려두면 감사 추적이 과거를 소급해서 다르게
 * 말하게 된다. 기록은 그날 화면에 있던 것을 말해야 한다.
 */
function presentationPayload(detail: PatientDetail): Record<string, unknown> {
  const result = detail.intakeResult;
  const differentials: Array<{ rank: number; name: string }> = [];
  for (const raw of result?.differentials ?? []) {
    const row = asRecord(raw);
    const name = pick(row, 'name_kr', 'nameKr', 'name', 'name_en', 'nameEn');
    if (!name) continue;
    differentials.push({ rank: differentials.length + 1, name });
  }

  const recommendedTests: string[] = [];
  for (const raw of result?.recommendedTests ?? []) {
    const row = asRecord(raw);
    const name = pick(row, 'name_kr', 'nameKr', 'name', 'code');
    if (name) recommendedTests.push(name);
  }

  return {
    differentials,
    recommendedTests,
    redFlag: detail.encounter.redFlag,
    redFlagReason: detail.encounter.redFlagReason,
    intakeVersion: result?.version ?? null,
    // 출처는 객체 그대로와 사람이 읽는 한 줄을 둘 다 남긴다. 앞의 것은 기계가
    // 대조하기 위한 것이고, 뒤의 것은 이 행을 사람이 읽게 될 때를 위한 것이다.
    provenance: result?.provenance ?? { engine: 'unrecorded' },
    provenanceLabel: describeProvenance(
      result?.provenance ?? { engine: 'unrecorded' }
    ),
    factsFingerprint: result?.factsFingerprint ?? null
  };
}

// ── 이벤트 ─────────────────────────────────────────────────────────────

/**
 * 기계의 해석이 임상의 화면으로 넘어갔다.
 *
 * 증명하는 것: 이 내용이, 이 모델·프롬프트에서 나와, 이 임상의 앞에 놓였다.
 * 증명하지 않는 것: 누군가 그것을 읽었다는 것.
 *
 * dedupe 키가 문진 결과 id 라서 같은 해석은 한 번만 기록된다. 다시 열어본
 * 사실은 `patient_detail_opened` 가 따로 남긴다. 해석이 재생성되면 id 가
 * 달라지므로 새 줄이 생긴다 — 그게 정확하다. 다른 내용을 보여준 것이니까.
 */
export function recordInterpretationPresented(detail: PatientDetail): void {
  const resultId = detail.intakeResult?.id;
  if (!resultId) return;
  fire(
    record({
      encounterId: detail.encounter.id,
      eventType: 'interpretation_presented',
      dedupeKey: resultId,
      intakeResultId: resultId,
      payload: presentationPayload(detail)
    })
  );
}

/**
 * 임상의가 대기목록에서 이 환자를 골랐고, 앱의 모든 창이 그 환자 기록으로
 * 전환됐다.
 *
 * 증명하는 것: 이 시각에 이 환자를 지목한 의도적 행위. 이 진료의 가장 이른
 * 행이 "환자 상세를 처음 연 시각" 이다.
 * 증명하지 않는 것: 화면의 어떤 항목을 읽었는지.
 *
 * dedupe 키가 없다 — 다시 여는 것은 같은 일의 반복이 아니라 별개의 사건이고,
 * 진료 중에 한두 번 일어나는 사람의 동작이라 양이 문제되지 않는다.
 */
export function recordPatientDetailOpened(detail: PatientDetail): void {
  fire(
    record({
      encounterId: detail.encounter.id,
      eventType: 'patient_detail_opened',
      dedupeKey: null,
      intakeResultId: detail.intakeResult?.id ?? null,
      payload: {
        encounterStatus: detail.encounter.status,
        hasInterpretation: detail.intakeResult !== null
      }
    })
  );
}

/**
 * 감별진단 카드를 펼쳤다.
 *
 * 증명하는 것: 그 진단을 의도적으로 열었다는 것 (카드를 펼쳐야 상세가 로드된다).
 * 증명하지 않는 것: 동의·채택, 또는 근거 문장을 읽었다는 것.
 */
export function recordDifferentialExpanded(params: {
  encounterId: string;
  intakeResultId: string | null;
  diagnosis: string;
}): void {
  const diagnosis = params.diagnosis.trim();
  if (!diagnosis) return;
  fire(
    record({
      encounterId: params.encounterId,
      eventType: 'differential_expanded',
      dedupeKey: diagnosis,
      intakeResultId: params.intakeResultId,
      payload: { diagnosis }
    })
  );
}

/**
 * 그 진단에 대해 문헌근거(PubMed) 조회를 요청했다.
 *
 * 증명하는 것: 임상의가 그 진단에 **독립적인 확인**을 구했다는 것. 우리가 가진
 * 신호 중 "맹목적 의존이 아니었다" 에 가장 가깝다.
 * 증명하지 않는 것: 문헌을 읽었는지, 그것이 판단을 바꿨는지.
 */
export function recordEvidenceRequested(params: {
  encounterId: string;
  intakeResultId: string | null;
  diagnosis: string;
}): void {
  const diagnosis = params.diagnosis.trim();
  if (!diagnosis) return;
  fire(
    record({
      encounterId: params.encounterId,
      eventType: 'evidence_requested',
      dedupeKey: diagnosis,
      intakeResultId: params.intakeResultId,
      payload: { diagnosis }
    })
  );
}

/**
 * 근거를 눌러 기계가 인용한 발화로 이동했다 (E1 의 경로).
 *
 * 증명하는 것: 기계가 댄 인용을 원문과 대조했다는 것.
 * 증명하지 않는 것: 대조 결과가 무엇이었는지, 무엇을 결론지었는지.
 */
export function recordFindingSourceOpened(params: {
  encounterId: string;
  intakeResultId: string | null;
  utteranceId: string;
}): void {
  const utteranceId = params.utteranceId.trim();
  if (!utteranceId) return;
  fire(
    record({
      encounterId: params.encounterId,
      eventType: 'finding_source_opened',
      dedupeKey: utteranceId,
      intakeResultId: params.intakeResultId,
      payload: { utteranceId }
    })
  );
}

/**
 * 이 해석이 화면에 있는 상태에서 진료 요약이 생성됐다.
 *
 * 증명하는 것: 해석이 놓인 채로 진료가 문서화 단계까지 갔다는 것.
 * 증명하지 않는 것: 요약이 채택됐는지, 사용됐는지.
 */
export function recordSummaryGenerated(params: {
  encounterId: string;
  intakeResultId: string | null;
  sessionId: string | null;
}): void {
  fire(
    record({
      encounterId: params.encounterId,
      eventType: 'summary_generated',
      dedupeKey: params.sessionId,
      intakeResultId: params.intakeResultId,
      sessionId: params.sessionId,
      payload: {}
    })
  );
}
