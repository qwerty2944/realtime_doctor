import {
  detectCareActivities,
  foldMonthlyReport,
  intakeTranscriptUtterances,
  releaseForDisplay,
  toDisplayPayload,
  type CareActivityDef,
  type CareActivityDisplayPayload,
  type DetectionUtterance,
  type MonthlyCareActivityReport,
  type ReleaseResult,
  type ReleasedCareActivityCandidate,
  type StoredCandidateRow,
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

/**
 * 문진 대화만으로 스캔한다 (환자 모드).
 *
 * 녹취가 아직 없고 환자만 선택한 상태에서 쓴다. 문진 대화에는 타임스탬프가
 * 없어 후보가 만들어지지 않는 것이 정상이며, 화면은 그 사실을 그대로 말한다
 * (`intake-no-timestamps`).
 */
export async function scanIntakeForCareActivities(
  encounterId: string
): Promise<CareActivityScan> {
  const [defs, utterances] = await Promise.all([
    loadCareActivityDefs(),
    loadIntakeUtterances(encounterId)
  ]);
  const detection = detectCareActivities(utterances, defs);
  const { released, withheld } = releaseForDisplay(detection.candidates, utterances);
  return { detection, utterances, released, withheld };
}

// ── 화면 payload (B3) ──────────────────────────────────────────────────

/**
 * 요약 창이 받을 payload 를 만든다.
 *
 * 세션이 있으면 녹취를, 없고 환자만 선택돼 있으면 문진 대화를 본다. 어느
 * 쪽이든 화면으로 나가는 것은 `released` 뿐이고, 비어 있을 때는 왜 비었는지가
 * 함께 나간다 — "검토된 항목 없음"과 "고장"이 같은 모습이 되면 안 된다.
 */
export async function buildCareActivityDisplay(input: {
  sessionId: string | null;
  encounterId: string | null;
}): Promise<CareActivityDisplayPayload> {
  const { sessionId, encounterId } = input;
  if (sessionId) {
    const scan = await scanSessionForCareActivities(sessionId, { encounterId });
    const payload = toDisplayPayload({
      sessionId,
      source: 'live',
      utterances: scan.utterances,
      release: scan
    });
    // 화면에 올린 것과 리포트에 세는 것이 어긋나면 안 된다 — 저장은 화면용
    // payload 를 만든 바로 그 결과로만 한다.
    if (payload.items.length > 0) await persistReleasedCandidates(sessionId, payload.items);
    return payload;
  }
  if (encounterId) {
    const scan = await scanIntakeForCareActivities(encounterId);
    return toDisplayPayload({
      sessionId: null,
      source: 'intake',
      utterances: scan.utterances,
      release: scan
    });
  }
  return { items: [], emptyReason: 'no-session', source: 'live', sessionId: null };
}

// ── 저장 · 월 리포트 (B4) ──────────────────────────────────────────────

/**
 * 화면에 올린 후보를 저장한다.
 *
 * 쓰기는 전부 `record_care_activity_candidates` RPC 를 지난다 — 그 함수가
 * "고쳐 쓰지 않고 새 행으로 대체(supersede)" 규칙을 강제하고, 클라이언트에는
 * INSERT/UPDATE 권한 자체가 없다. 실패해도 진료를 막지 않고 경고만 남긴다
 * (리포트는 파생 산출물이고 환자 기록이 아니다).
 */
export async function persistReleasedCandidates(
  sessionId: string,
  items: readonly ReleasedCareActivityCandidate[]
): Promise<{ inserted: number; superseded: number; unchanged: number } | null> {
  const supabase = getSupabase();
  if (!supabase || items.length === 0) return null;
  const payload = items.map((c) => ({
    activityCode: c.activityCode,
    label: c.label,
    category: c.category,
    engineVersion: c.provenance.engineVersion,
    ruleVersion: c.provenance.ruleVersion,
    generatedAt: c.provenance.generatedAt,
    quotes: c.quotes,
    utteranceIds: c.utteranceIds,
    startMs: c.timeRange.startMs,
    endMs: c.timeRange.endMs,
    durationSeconds: c.timeRange.durationSeconds
  }));
  try {
    const { data, error } = await supabase.rpc('record_care_activity_candidates', {
      p_session_id: sessionId,
      p_candidates: payload
    });
    if (error) {
      warn('persistReleasedCandidates', error.message);
      return null;
    }
    return (data ?? null) as { inserted: number; superseded: number; unchanged: number } | null;
  } catch (err) {
    warn('persistReleasedCandidates', err);
    return null;
  }
}

/** 'YYYY-MM' → 그 달의 [첫날, 다음 달 첫날) (KST 기준 날짜 문자열). */
function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const pad = (n: number): string => String(n).padStart(2, '0');
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  return { from: `${year}-${pad(mon)}-01`, to: `${nextYear}-${pad(nextMon)}-01` };
}

/**
 * 월 리포트.
 *
 * 현재 유효한 행(superseded 되지 않은 행)만 센다. 대체된 행은 지우지 않고
 * 남아 있으므로 "그때 무엇을 보여줬는가"는 DB 에서 여전히 답할 수 있다.
 * 집계는 규칙 버전별로 나뉜다 — 규칙이 바뀌면 숫자가 조용히 달라지는 대신
 * 줄이 하나 늘어난다.
 */
export async function loadMonthlyCareActivityReport(
  month: string
): Promise<MonthlyCareActivityReport> {
  const empty = foldMonthlyReport(month, []);
  const bounds = monthBounds(month);
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!bounds || !user || !supabase) return empty;
  try {
    const { data, error } = await supabase
      .from('care_activity_candidates')
      .select(
        'activity_code, label_ko, category, engine_version, rule_version, session_id, occurred_on, generated_at'
      )
      .eq('user_id', user.id)
      .is('superseded_at', null)
      .gte('occurred_on', bounds.from)
      .lt('occurred_on', bounds.to);
    if (error) {
      warn('loadMonthlyCareActivityReport', error.message);
      return empty;
    }
    const rows: StoredCandidateRow[] = ((data ?? []) as Array<{
      activity_code: string;
      label_ko: string;
      category: string | null;
      engine_version: string;
      rule_version: number;
      session_id: string;
      occurred_on: string;
      generated_at: string;
    }>).map((r) => ({
      activityCode: r.activity_code,
      label: r.label_ko,
      category: r.category,
      engineVersion: r.engine_version,
      ruleVersion: r.rule_version,
      sessionId: r.session_id,
      occurredOn: r.occurred_on,
      generatedAt: r.generated_at
    }));
    return foldMonthlyReport(month, rows);
  } catch (err) {
    warn('loadMonthlyCareActivityReport', err);
    return empty;
  }
}
