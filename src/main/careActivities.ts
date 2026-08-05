import {
  detectCareActivities,
  intakeTranscriptUtterances,
  releaseForDisplay,
  type CareActivityDef,
  type DetectionUtterance,
  type ReleaseResult,
  type DetectionResult
} from '../shared/careActivities.js';
import type { Speaker } from '../shared/types.js';
import { getCurrentUser } from './auth.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 진료행위 기록 탐지 — 데이터 계층 (B1/B2).
 *
 * 정의는 DB(`care_activity_defs`)에서 읽고, 발화는 `transcript_chunks`(실시간
 * 녹취)와 `intake_results.soap_json.transcript`(문진 대화)에서 읽는다. 판정
 * 로직은 여기에 한 줄도 없다 — 전부 `src/shared/careActivities.ts` 에 있고
 * main 과 renderer 가 같은 함수를 쓴다.
 *
 * 여기서 만든 후보는 **환자 기록에 쓰지 않는다.** 파생 산출물이고, 어떤
 * 규칙·언제 만들어졌는지(provenance)를 달고 다닌다(E3 방향).
 */

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[careActivities:${scope}]`, msg);
}

interface DefRow {
  code: string;
  label_ko: string;
  description_ko: string | null;
  category: string | null;
  specialty: string | null;
  cue_terms: string[] | null;
  negation_terms: string[] | null;
  required_speaker: string | null;
  min_distinct_cues: number | null;
  min_utterances: number | null;
  min_duration_seconds: number | null;
  clinical_review_status: string | null;
  rule_version: number | null;
}

const DEF_COLUMNS =
  'code, label_ko, description_ko, category, specialty, cue_terms, negation_terms, ' +
  'required_speaker, min_distinct_cues, min_utterances, min_duration_seconds, ' +
  'clinical_review_status, rule_version';

/**
 * DB row → 정의.
 *
 * 값이 이상하면 **더 보수적인 쪽으로** 채운다. 기본값을 느슨하게 잡으면
 * 잘못 입력된 행 하나가 조용히 후보를 쏟아낸다.
 */
function toDef(row: DefRow): CareActivityDef | null {
  const cueTerms = (row.cue_terms ?? []).filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0
  );
  // 단서가 없는 정의는 "무엇이든 걸리는" 정의다. DB CHECK 도 막지만 여기서도 버린다.
  if (cueTerms.length === 0) return null;
  const speaker = row.required_speaker;
  return {
    code: row.code,
    labelKo: row.label_ko,
    descriptionKo: row.description_ko ?? '',
    category: row.category,
    specialty: row.specialty,
    cueTerms,
    negationTerms: (row.negation_terms ?? []).filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0
    ),
    requiredSpeaker:
      speaker === 'doctor' || speaker === 'patient' ? speaker : 'any',
    minDistinctCues: Math.max(1, row.min_distinct_cues ?? 2),
    minUtterances: Math.max(1, row.min_utterances ?? 2),
    minDurationSeconds: Math.max(0, row.min_duration_seconds ?? 0),
    reviewStatus:
      row.clinical_review_status === 'reviewed'
        ? 'reviewed'
        : row.clinical_review_status === 'retired'
          ? 'retired'
          : 'unreviewed',
    ruleVersion: Math.max(1, row.rule_version ?? 1)
  };
}

/** 활성 정의 전부. 미검토 정의도 포함한다 — 걸러내는 곳은 화면 직전이다. */
export async function loadCareActivityDefs(): Promise<CareActivityDef[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('care_activity_defs')
      .select(DEF_COLUMNS)
      .eq('enabled', true)
      .order('code', { ascending: true });
    if (error) {
      warn('loadCareActivityDefs', error.message);
      return [];
    }
    return ((data ?? []) as unknown as DefRow[])
      .map(toDef)
      .filter((d): d is CareActivityDef => d !== null);
  } catch (err) {
    warn('loadCareActivityDefs', err);
    return [];
  }
}

function toSpeaker(value: unknown): Speaker {
  return value === 'doctor' || value === 'patient' ? value : 'unknown';
}

/**
 * 녹취 세션의 발화 목록.
 *
 * 발화 id 는 `chunk_id` 다 — 전사 창이 이미 그 id 로 발화를 찾는다(E1 과 동일).
 * `timestamp_ms` 는 녹음 시작 기준 경과 밀리초이며, 시각 구간은 오직 이
 * 값에서만 나온다.
 */
export async function loadSessionUtterances(
  sessionId: string
): Promise<DetectionUtterance[]> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('transcript_chunks')
      .select('chunk_id, speaker, text, timestamp_ms')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .order('timestamp_ms', { ascending: true });
    if (error) {
      warn('loadSessionUtterances', error.message);
      return [];
    }
    return ((data ?? []) as Array<{
      chunk_id: string;
      speaker: string | null;
      text: string | null;
      timestamp_ms: number | null;
    }>).map((row) => ({
      id: row.chunk_id,
      text: row.text ?? '',
      speaker: toSpeaker(row.speaker),
      timestampMs: typeof row.timestamp_ms === 'number' ? row.timestamp_ms : null
    }));
  } catch (err) {
    warn('loadSessionUtterances', err);
    return [];
  }
}

/** 진료 한 건의 문진 대화 발화 목록. 최신 버전 문진 결과 하나만 본다. */
export async function loadIntakeUtterances(
  encounterId: string
): Promise<DetectionUtterance[]> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('intake_results')
      .select('soap_json, version')
      .eq('encounter_id', encounterId)
      .order('version', { ascending: false })
      .limit(1);
    if (error) {
      warn('loadIntakeUtterances', error.message);
      return [];
    }
    const soap = ((data ?? []) as Array<{ soap_json: Record<string, unknown> | null }>)[0]
      ?.soap_json;
    if (!soap) return [];
    return intakeTranscriptUtterances(
      soap.transcript ?? soap.dialogue ?? soap.turns
    );
  } catch (err) {
    warn('loadIntakeUtterances', err);
    return [];
  }
}

export interface CareActivityScan extends ReleaseResult {
  /** 검증 전 원 후보. 진단·프로브용이며 화면은 `released` 만 본다. */
  detection: DetectionResult;
  utterances: DetectionUtterance[];
}

/**
 * 세션(+선택적으로 그 진료의 문진 대화)에서 행위 기록 후보를 찾는다.
 *
 * 반환의 `released` 만 화면에 올릴 수 있다. `withheld` 와
 * `detection.skipped` 는 왜 안 올라갔는지를 설명하기 위한 내부 정보다 —
 * 애매한 것을 "가능성"으로 보여주면 그것이 곧 권유가 된다.
 */
export async function scanSessionForCareActivities(
  sessionId: string,
  options: { encounterId?: string | null } = {}
): Promise<CareActivityScan> {
  const [defs, sessionUtterances, intake] = await Promise.all([
    loadCareActivityDefs(),
    loadSessionUtterances(sessionId),
    options.encounterId ? loadIntakeUtterances(options.encounterId) : Promise.resolve([])
  ]);
  const utterances = [...sessionUtterances, ...intake];
  const detection = detectCareActivities(utterances, defs);
  const { released, withheld } = releaseForDisplay(detection.candidates, utterances);
  return { detection, utterances, released, withheld };
}
