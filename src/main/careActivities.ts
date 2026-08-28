import {
  detectCareActivities,
  foldMonthlyReport,
  intakeTranscriptUtterances,
  releaseForDisplay,
  resolveReviewStatus,
  toDisplayPayload,
  type CareActivityAdoption,
  type CareActivityBackfillResult,
  type CareActivityDef,
  type CareActivityDefinitionView,
  type CareActivityDisplayPayload,
  type ClinicalReviewStatus,
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
function toDef(
  row: DefRow,
  adoption: CareActivityAdoption | null
): CareActivityDef | null {
  const cueTerms = (row.cue_terms ?? []).filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0
  );
  // 단서가 없는 정의는 "무엇이든 걸리는" 정의다. DB CHECK 도 막지만 여기서도 버린다.
  if (cueTerms.length === 0) return null;
  const speaker = row.required_speaker;
  const ruleVersion = Math.max(1, row.rule_version ?? 1);
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
    // [HARD] 검토 여부는 **이 사람의 채택 기록**으로 정한다. 공용 행의
    // 'reviewed' 는 여기서 아무 힘이 없다 (0008). 판정 함수는 shared 한 벌뿐.
    reviewStatus: resolveReviewStatus({
      templateStatus: templateStatusOf(row),
      defRuleVersion: ruleVersion,
      adoption
    }),
    ruleVersion
  };
}

function templateStatusOf(row: DefRow): ClinicalReviewStatus {
  return row.clinical_review_status === 'reviewed'
    ? 'reviewed'
    : row.clinical_review_status === 'retired'
      ? 'retired'
      : 'unreviewed';
}

interface AdoptionRow {
  activity_code: string;
  reviewed_rule_version: number;
  reviewed_at: string;
  reviewed_by: string;
  review_note: string | null;
  revoked_at: string | null;
}

/**
 * 지금 로그인한 사람의 채택 기록.
 *
 * RLS 가 자기 행만 돌려주지만, 여기서도 user_id 로 한 번 더 좁힌다 — 조회
 * 조건이 정책 하나에만 기대면 정책이 느슨해지는 날 조용히 남의 행을 읽는다.
 */
export async function loadMyAdoptions(): Promise<Map<string, CareActivityAdoption>> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  const map = new Map<string, CareActivityAdoption>();
  if (!user || !supabase) return map;
  try {
    const { data, error } = await supabase
      .from('care_activity_adoptions')
      .select(
        'activity_code, reviewed_rule_version, reviewed_at, reviewed_by, review_note, revoked_at'
      )
      .eq('user_id', user.id);
    if (error) {
      warn('loadMyAdoptions', error.message);
      return map;
    }
    for (const row of (data ?? []) as AdoptionRow[]) {
      map.set(row.activity_code, {
        activityCode: row.activity_code,
        reviewedRuleVersion: row.reviewed_rule_version,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewed_by,
        reviewNote: row.review_note,
        revokedAt: row.revoked_at
      });
    }
    return map;
  } catch (err) {
    warn('loadMyAdoptions', err);
    return map;
  }
}

async function loadDefRows(): Promise<DefRow[]> {
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
    return (data ?? []) as unknown as DefRow[];
  } catch (err) {
    warn('loadCareActivityDefs', err);
    return [];
  }
}

/**
 * 활성 정의 전부. 미검토 정의도 포함한다 — 걸러내는 곳은 화면 직전이다.
 *
 * 각 정의의 `reviewStatus` 는 **지금 로그인한 사람 기준**이다. 같은 정의가
 * 사람마다 다른 상태로 나오는 것이 이 함수의 요점이다.
 */
export async function loadCareActivityDefs(): Promise<CareActivityDef[]> {
  const [rows, adoptions] = await Promise.all([loadDefRows(), loadMyAdoptions()]);
  return rows
    .map((row) => toDef(row, adoptions.get(row.code) ?? null))
    .filter((d): d is CareActivityDef => d !== null);
}

/**
 * 검토 화면이 받는 목록 (B5).
 *
 * 규칙 전문을 그대로 담는다. 검토자는 임상 책임을 지는 사람이고, 이름과
 * 스위치만으로는 무엇을 승인하는지 알 수 없다.
 */
export async function listCareActivityDefinitions(): Promise<CareActivityDefinitionView[]> {
  const [rows, adoptions] = await Promise.all([loadDefRows(), loadMyAdoptions()]);
  const views: CareActivityDefinitionView[] = [];
  for (const row of rows) {
    const adoption = adoptions.get(row.code) ?? null;
    const def = toDef(row, adoption);
    if (!def) continue;
    views.push({
      def,
      templateStatus: templateStatusOf(row),
      adoption,
      adoptionStale:
        adoption !== null &&
        adoption.revokedAt === null &&
        adoption.reviewedRuleVersion !== def.ruleVersion
    });
  }
  return views;
}

/**
 * 검토 표시 · 철회 (B5).
 *
 * 쓰기는 `set_care_activity_adoption` RPC 하나뿐이고, RPC 안에서 소유자를
 * `auth.uid()` 로 다시 뽑는다 — 클라이언트는 남의 이름으로 승인할 수 없고
 * 테이블에 직접 쓸 권한도 없다.
 *
 * `ruleVersion` 은 검토자가 화면에서 실제로 읽은 규칙 버전이다. 그 사이
 * 규칙이 바뀌었으면 RPC 가 거절한다 — 읽지 않은 규칙을 승인하는 경로를
 * 만들지 않기 위해서다.
 */
export async function setCareActivityReview(input: {
  activityCode: string;
  ruleVersion: number;
  reviewed: boolean;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'no-client' };
  try {
    const { error } = await supabase.rpc('set_care_activity_adoption', {
      p_activity_code: input.activityCode,
      p_rule_version: input.ruleVersion,
      p_reviewed: input.reviewed,
      p_note: input.note ?? null
    });
    if (error) {
      warn('setCareActivityReview', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    warn('setCareActivityReview', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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

/**
 * 진료 한 건을 스캔해서 저장만 한다 (B5, 결함 1).
 *
 * **화면에 아무것도 올리지 않는다.** 저장은 끼어드는 일이 아니지만 표시는
 * 끼어드는 일이다 — B3 이 정한 "끼어들지 않는다"는 표시에 대한 규칙이지
 * 기록에 대한 규칙이 아니다.
 *
 * 이 경로가 필요한 이유: B4 까지는 요약 창을 연 진료만 저장됐다. 요약 창을
 * 한 번도 열지 않은 진료는 월 집계에서 통째로 빠졌고, 그러면 리포트가 실제보다
 * 조용히 적게 센다 — 파일럿에서 우리 숫자를 만들겠다는 B4 의 목적이 무너진다.
 *
 * 엔진은 규칙 기반이라 LLM 호출도 API 비용도 없다. 그래도 세션 종료를 막지
 * 않게 호출부에서 await 하지 않으며, 여기서 예외를 밖으로 던지지 않는다.
 */
export async function recordCareActivitiesForSession(
  sessionId: string,
  options: { encounterId?: string | null } = {}
): Promise<{ released: number; stored: boolean }> {
  try {
    const scan = await scanSessionForCareActivities(sessionId, options);
    if (scan.released.length === 0) return { released: 0, stored: false };
    const result = await persistReleasedCandidates(sessionId, scan.released);
    return { released: scan.released.length, stored: result !== null };
  } catch (err) {
    // 파생 산출물이다. 실패해도 진료 기록에는 영향이 없고, 다음 스캔(요약 창
    // 열기, 또는 아래 재스캔)이 같은 결과를 다시 만든다.
    warn('recordCareActivitiesForSession', err);
    return { released: 0, stored: false };
  }
}

/**
 * 지난 진료 재스캔 (B5, 결함 1의 나머지 절반).
 *
 * 정의가 검토를 통과하는 순간, 그 이전의 모든 진료에는 후보가 하나도 없다.
 * 검토를 마친 사람에게 "이제부터만 셉니다"라고 말하면 첫 달 리포트가 반쪽이 된다.
 *
 * 새 규칙을 만들지 않는다 — 세션마다 평소와 같은 스캔을 돌리고 같은 RPC 로
 * 저장한다. 그래서 0007 의 대체(supersede) 규칙이 그대로 적용된다: 이미 있는
 * 행과 결과가 같으면 아무것도 하지 않고(중복 없음), 다르면 옛 행을 지우지 않고
 * 새 행으로 대체한다. 여러 번 돌려도 숫자가 늘지 않는다.
 */
export async function backfillCareActivities(
  options: { months?: number; limit?: number } = {}
): Promise<CareActivityBackfillResult> {
  const empty: CareActivityBackfillResult = {
    scannedSessions: 0,
    sessionsWithRecords: 0,
    inserted: 0,
    superseded: 0,
    unchanged: 0
  };
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return empty;

  const months = Math.min(24, Math.max(1, options.months ?? 3));
  const limit = Math.min(500, Math.max(1, options.limit ?? 200));
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, encounter_id')
      .eq('user_id', user.id)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) {
      warn('backfillCareActivities', error.message);
      return empty;
    }
    const result = { ...empty };
    // 순차로 돈다. 파일럿 규모에서 충분히 빠르고, 한꺼번에 던지면 로컬
    // 스택이든 운영이든 다른 요청을 굶긴다.
    for (const row of (data ?? []) as Array<{ id: string; encounter_id: string | null }>) {
      const scan = await scanSessionForCareActivities(row.id, {
        encounterId: row.encounter_id
      });
      result.scannedSessions += 1;
      if (scan.released.length === 0) continue;
      const stored = await persistReleasedCandidates(row.id, scan.released);
      if (!stored) continue;
      result.sessionsWithRecords += 1;
      result.inserted += stored.inserted;
      result.superseded += stored.superseded;
      result.unchanged += stored.unchanged;
    }
    return result;
  } catch (err) {
    warn('backfillCareActivities', err);
    return empty;
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
