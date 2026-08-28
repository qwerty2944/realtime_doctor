/**
 * 진료행위 기록 탐지 (B2).
 *
 * 진료실에서 **실제로 이루어진 행위**가 녹취에 남아 있는지를 찾는다. 한국
 * 의원에서 새는 지점은 대체로 "안 한 것"이 아니라 "하고도 안 적은 것"이고,
 * 우리는 EMR 의 구조화 필드가 아니라 대화 전문을 갖고 있다.
 *
 * [HARD] 이 파일이 지키는 선
 *   1. **증거만 보여준다.** "이런 행위 기록이 있습니다"까지다. 무엇을
 *      청구할 수 있는지는 한 글자도 말하지 않는다 — 그 순간 부당청구 방조가
 *      되고 삭감·현지실사의 책임은 의사가 진다.
 *   2. **확신 점수 없음.** E1 과 같은 이유다. 몇 퍼센트가 아니라 시각 구간과
 *      원문 인용을 보여주고 판단은 의사가 한다.
 *   3. **근거 없으면 후보를 만들지 않는다.** `quotes` 는 비어 있을 수 없는
 *      배열이고 `timeRange` 는 optional 이 아니다 — 인용과 시각이 없는 후보는
 *      **값으로 존재할 수 없다**(E1 의 `SupportingFinding.quote` 와 같은 수법).
 *   4. **인용문은 원문에서 꺼낸다.** 어디에서도 문자열을 지어내지 않는다.
 *      정의(`cue_terms`)는 "어디를 볼지"만 정하고, 화면에 올라가는 문장은
 *      항상 발화 원문이다.
 *   5. **시각은 실제 타임스탬프에서만 온다.** 추정 시각은 만들지 않는다.
 *
 * electron 도 react 도 모른다. main(실시간 녹취)과 renderer(문진 대화)가 같은
 * 함수를 쓰기 위해서다 — 검증기가 두 벌이 되면 한쪽만 고쳐지는 날 한쪽
 * 경로에서 지어낸 근거가 그대로 뜬다(E1 에서 이미 겪은 실패 모드).
 */

import type { Speaker } from './types.js';

/** 규칙 엔진 버전. 후보의 provenance 에 박혀 나간다. */
export const CARE_DETECTION_ENGINE_VERSION = 'rules-1';

/*
 * 문구 검사 목록("청구", "수가" …)은 여기에 두지 않는다. 이 엔진은 화면 문구를
 * 만들지 않는다 — 라벨과 설명은 전부 DB 정의에서 온다. 그래서 검사는 값이
 * 들어오는 지점, 즉 CSV 로더 한 곳에서만 한다(scripts/care-wording.mjs).
 * 두 벌로 두면 한쪽만 고쳐지는 날 검사가 조용히 헐거워진다.
 */

export type ClinicalReviewStatus = 'unreviewed' | 'reviewed' | 'retired';

/** 탐지 정의 한 건. 전부 DB(care_activity_defs)의 값이고 코드 상수가 아니다. */
export interface CareActivityDef {
  code: string;
  labelKo: string;
  descriptionKo: string;
  category: string | null;
  specialty: string | null;
  /** 어디를 볼지 정하는 단서. 화면에 올라가는 문장은 여기서 오지 않는다. */
  cueTerms: string[];
  /** 같은 발화 안에 있으면 그 단서 적중을 취소하는 낱말. */
  negationTerms: string[];
  requiredSpeaker: 'doctor' | 'patient' | 'any';
  minDistinctCues: number;
  minUtterances: number;
  minDurationSeconds: number;
  reviewStatus: ClinicalReviewStatus;
  ruleVersion: number;
}

/**
 * 한 의사가 한 정의를 검토한 기록 (B5).
 *
 * 정의는 모든 계정이 같이 읽는 **공용 템플릿**이라, 검토 상태를 정의 행에
 * 두면 한 사람의 판단이 다른 의원의 탐지까지 켠다. 그래서 검토는 정의가
 * 아니라 (사람, 정의) 쌍에 붙는다(`care_activity_adoptions`).
 */
export interface CareActivityAdoption {
  activityCode: string;
  /** 검토 당시 규칙 버전. 규칙이 그 뒤로 바뀌면 이 검토는 더 이상 맞지 않는다. */
  reviewedRuleVersion: number;
  reviewedAt: string;
  reviewedBy: string;
  reviewNote: string | null;
  /** 철회 시각. 값이 있으면 이후 탐지는 멈추고 이미 저장된 기록은 남는다. */
  revokedAt: string | null;
}

/**
 * 이 의사에게 이 정의가 실제로 어떤 상태인가.
 *
 * [HARD] 공용 행의 `'reviewed'` 는 아무에게도 아무것도 열어주지 않는다.
 * 전역으로 힘을 갖는 값은 `'retired'` 하나뿐이다 — 거두는 것은 전역이어도
 * 되지만 켜는 것은 전역이면 안 된다.
 *
 * 판정을 여기 한 곳에만 둔다. main 과 renderer 가 각자 계산하면 언젠가
 * 한쪽만 고쳐지고, 그 순간 게이트가 한쪽 경로에서 조용히 열린다.
 */
export function resolveReviewStatus(input: {
  templateStatus: ClinicalReviewStatus;
  defRuleVersion: number;
  adoption: CareActivityAdoption | null;
}): ClinicalReviewStatus {
  if (input.templateStatus === 'retired') return 'retired';
  const a = input.adoption;
  if (!a) return 'unreviewed';
  if (a.revokedAt !== null) return 'unreviewed';
  // 검토한 규칙과 지금 도는 규칙이 다르면 검토가 아니다.
  if (a.reviewedRuleVersion !== input.defRuleVersion) return 'unreviewed';
  return 'reviewed';
}

/**
 * 검토 화면이 받는 정의 한 건.
 *
 * 검토자는 임상 책임을 지는 사람이라 **규칙 전문**을 봐야 한다 — 이름과
 * 스위치만 보여주면 무엇을 승인했는지 모르는 채로 승인하게 된다. `def` 에
 * 단서어·부정어·화자 조건·문턱 세 개가 그대로 들어 있다.
 */
export interface CareActivityDefinitionView {
  /** 규칙 전문. `reviewStatus` 는 이 사람 기준으로 계산된 값이다. */
  def: CareActivityDef;
  /** 공용 행의 값. 화면에는 참고로만 보이고 판정에는 쓰이지 않는다. */
  templateStatus: ClinicalReviewStatus;
  adoption: CareActivityAdoption | null;
  /** 검토는 했는데 그 뒤 규칙이 바뀐 상태. 다시 읽어야 한다는 뜻이다. */
  adoptionStale: boolean;
}

/** 지난 진료 재스캔 결과 (B5). 화면은 이 숫자만 보고 결과를 말한다. */
export interface CareActivityBackfillResult {
  scannedSessions: number;
  sessionsWithRecords: number;
  /** 새로 저장된 행. */
  inserted: number;
  /** 규칙이 바뀌어 대체된 행. 옛 행은 지워지지 않는다. */
  superseded: number;
  /** 이미 같은 내용으로 저장돼 있던 행. 재스캔이 멱등이라는 증거다. */
  unchanged: number;
}

/**
 * 탐지 입력 발화 한 줄.
 *
 * `timestampMs` 는 `transcript_chunks.timestamp_ms` 값이다. 없으면 null 이고,
 * null 이 섞인 구간에서는 후보가 만들어지지 않는다 — 시각을 추정해서 채우는
 * 것보다 후보를 포기하는 쪽이 옳다.
 */
export interface DetectionUtterance {
  id: string;
  text: string;
  speaker: Speaker;
  timestampMs: number | null;
}

/** 후보가 들고 다니는 원문 인용 한 건. `quote` 는 언제나 발화 원문 그대로다. */
export interface EvidenceQuote {
  utteranceId: string;
  /** 발화 원문. 모델도 규칙도 이 문자열을 만들지 않는다. */
  quote: string;
  /** 이 발화에서 걸린 단서들. 왜 걸렸는지 설명하는 용도. */
  matchedCues: string[];
  timestampMs: number;
}

/** 최소 1건을 타입으로 강제한다. 근거 0건인 후보는 값으로 존재할 수 없다. */
export type NonEmpty<T> = [T, ...T[]];

/** 후보가 어떤 규칙·언제 만들어졌는지. 해석은 재생성 가능해야 한다(E3). */
export interface CandidateProvenance {
  engineVersion: string;
  ruleVersion: number;
  generatedAt: string;
}

/** 탐지된 행위 기록 후보 한 건. */
export interface CareActivityCandidate {
  activityCode: string;
  /** 화면 문구. "…기록이 있습니다" 쪽 어휘만 쓴다. */
  label: string;
  description: string;
  category: string | null;
  reviewStatus: ClinicalReviewStatus;
  quotes: NonEmpty<EvidenceQuote>;
  utteranceIds: NonEmpty<string>;
  timeRange: { startMs: number; endMs: number; durationSeconds: number };
  provenance: CandidateProvenance;
}

/**
 * 임상 검토를 마친 정의에서 나온 후보.
 *
 * `reviewStatus` 가 리터럴 `'reviewed'` 라서, 미검토 정의에서 나온 후보는
 * **이 타입이 될 수 없다.** 화면 쪽 함수는 이 타입만 받는다.
 */
export type ReleasedCareActivityCandidate = CareActivityCandidate & {
  reviewStatus: 'reviewed';
};

/** 후보를 만들지 않은 이유. 진단용 내부 정보이며 의사 화면에 올리지 않는다. */
export type SkipReason =
  | 'no-cue-match'
  | 'speaker-mismatch'
  | 'negated'
  | 'too-few-distinct-cues'
  | 'too-few-utterances'
  | 'too-short'
  | 'missing-timestamp';

export interface DetectionSkip {
  activityCode: string;
  reason: SkipReason;
  /** 사람이 규칙을 조율할 때 보는 값. 애매함을 "가능성"으로 승격하지 않는다. */
  detail: string;
}

export interface DetectionResult {
  candidates: CareActivityCandidate[];
  /** 화면용이 아니다. 규칙 조율과 프로브 전용. */
  skipped: DetectionSkip[];
}

// ── 정규화 ─────────────────────────────────────────────────────────────

/**
 * 대조용 정규화. 공백을 지우고 소문자로 만든다.
 *
 * 한국어 발화는 "안 했" / "안했" 처럼 띄어쓰기가 흔들린다. 단서와 발화에
 * 같은 정규화를 걸어야 규칙 작성자가 띄어쓰기를 신경 쓰지 않는다.
 * **인용문에는 이 함수를 쓰지 않는다** — 화면에는 원문이 나가야 한다.
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

// ── 엔진 ───────────────────────────────────────────────────────────────

interface Hit {
  utterance: DetectionUtterance;
  cues: string[];
}

function matchDef(def: CareActivityDef, utterances: readonly DetectionUtterance[]) {
  const hits: Hit[] = [];
  let sawCueButWrongSpeaker = false;
  let negatedCount = 0;

  const cues = def.cueTerms
    .map((c) => ({ raw: c, norm: normalizeForMatch(c) }))
    .filter((c) => c.norm.length > 0);
  const negations = def.negationTerms
    .map(normalizeForMatch)
    .filter((n) => n.length > 0);

  for (const utterance of utterances) {
    const text = typeof utterance.text === 'string' ? utterance.text : '';
    if (text.trim().length === 0) continue;
    const norm = normalizeForMatch(text);
    const matched = cues.filter((c) => norm.includes(c.norm)).map((c) => c.raw);
    if (matched.length === 0) continue;

    if (def.requiredSpeaker !== 'any' && utterance.speaker !== def.requiredSpeaker) {
      // 의사가 수행한 행위를 환자가 물어본 것만으로 인정하지 않는다.
      sawCueButWrongSpeaker = true;
      continue;
    }
    if (negations.some((n) => norm.includes(n))) {
      // "다음에 설명드릴게요" 는 설명한 기록이 아니다.
      negatedCount += 1;
      continue;
    }
    hits.push({ utterance, cues: matched });
  }
  return { hits, sawCueButWrongSpeaker, negatedCount };
}

/**
 * 한 진료의 발화 목록에서 행위 기록 후보를 찾는다.
 *
 * **거짓양성보다 거짓음성을 택한다.** 문턱은 셋이고 전부 정의(데이터)에 있다:
 * 서로 다른 단서 수, 단서가 걸린 발화 수, 첫 단서와 마지막 단서 사이의
 * 실제 경과 시간. 하나라도 못 넘으면 후보를 만들지 않고 `skipped` 로만 남긴다
 * — `skipped` 는 화면에 올리지 않는다. 애매한 것을 "가능성 있음"으로
 * 보여주는 순간 그것이 곧 권유가 된다.
 */
export function detectCareActivities(
  utterances: readonly DetectionUtterance[],
  defs: readonly CareActivityDef[],
  options: { generatedAt?: string } = {}
): DetectionResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const candidates: CareActivityCandidate[] = [];
  const skipped: DetectionSkip[] = [];

  for (const def of defs) {
    if (def.reviewStatus === 'retired') continue;
    const { hits, sawCueButWrongSpeaker, negatedCount } = matchDef(def, utterances);

    if (hits.length === 0) {
      skipped.push({
        activityCode: def.code,
        reason: negatedCount > 0 ? 'negated' : sawCueButWrongSpeaker ? 'speaker-mismatch' : 'no-cue-match',
        detail:
          negatedCount > 0
            ? `단서가 ${negatedCount}건 걸렸으나 같은 발화의 부정 표현으로 취소됨`
            : sawCueButWrongSpeaker
              ? `단서는 있었으나 화자가 ${def.requiredSpeaker} 가 아님`
              : '단서 없음'
      });
      continue;
    }

    const distinctCues = new Set(hits.flatMap((h) => h.cues));
    if (distinctCues.size < def.minDistinctCues) {
      skipped.push({
        activityCode: def.code,
        reason: 'too-few-distinct-cues',
        detail: `서로 다른 단서 ${distinctCues.size}종 (필요 ${def.minDistinctCues}종): ${[...distinctCues].join(', ')}`
      });
      continue;
    }
    if (hits.length < def.minUtterances) {
      skipped.push({
        activityCode: def.code,
        reason: 'too-few-utterances',
        detail: `단서가 걸린 발화 ${hits.length}건 (필요 ${def.minUtterances}건)`
      });
      continue;
    }

    // [HARD] 시각은 실제 타임스탬프에서만 온다. 하나라도 없으면 후보를 버린다
    // — 시각 없는 후보를 만드는 것보다 놓치는 쪽이 낫다.
    const missing = hits.filter((h) => typeof h.utterance.timestampMs !== 'number');
    if (missing.length > 0) {
      skipped.push({
        activityCode: def.code,
        reason: 'missing-timestamp',
        detail: `타임스탬프 없는 발화 ${missing.length}건 — 시각 구간을 만들 수 없어 후보를 만들지 않음`
      });
      continue;
    }

    const times = hits.map((h) => h.utterance.timestampMs as number);
    const startMs = Math.min(...times);
    const endMs = Math.max(...times);
    const durationSeconds = Math.round((endMs - startMs) / 1000);
    if (durationSeconds < def.minDurationSeconds) {
      skipped.push({
        activityCode: def.code,
        reason: 'too-short',
        detail: `경과 ${durationSeconds}초 (필요 ${def.minDurationSeconds}초)`
      });
      continue;
    }

    const quotes = hits.map((h) => ({
      utteranceId: h.utterance.id,
      // 원문 그대로. 정규화한 문자열도, 단서 목록도 여기 들어가지 않는다.
      quote: h.utterance.text,
      matchedCues: h.cues,
      timestampMs: h.utterance.timestampMs as number
    }));
    // hits.length >= minUtterances >= 1 이므로 비어 있을 수 없다.
    candidates.push({
      activityCode: def.code,
      label: def.labelKo,
      description: def.descriptionKo,
      category: def.category,
      reviewStatus: def.reviewStatus,
      quotes: quotes as NonEmpty<EvidenceQuote>,
      utteranceIds: quotes.map((q) => q.utteranceId) as NonEmpty<string>,
      timeRange: { startMs, endMs, durationSeconds },
      provenance: {
        engineVersion: CARE_DETECTION_ENGINE_VERSION,
        ruleVersion: def.ruleVersion,
        generatedAt
      }
    });
  }

  return { candidates, skipped };
}

// ── 검증 (지어낸 후보가 화면에 닿지 않게) ────────────────────────────────

export interface CandidateProblem {
  activityCode: string;
  problem:
    | 'unknown-utterance'
    | 'quote-mismatch'
    | 'no-quotes'
    | 'timestamp-mismatch'
    | 'time-range-mismatch';
  detail: string;
}

/**
 * 후보를 원문과 다시 대조한다.
 *
 * 엔진이 만든 후보는 정의상 통과하지만, 후보가 저장·전송되었다가 다시 읽히는
 * 경로(구버전 행, 손으로 고친 행, 언젠가 붙을지 모를 LLM 경로)에서는 원문과
 * 어긋난 후보가 들어올 수 있다. 여기서 다시 대조하지 않으면 지어낸 인용이
 * 그대로 뜬다 — 감별진단의 지어낸 인용보다 나쁘다. 그쪽은 잘못된 임상 근거고
 * 이쪽은 하지 않은 행위의 기록이다.
 */
export function verifyCandidate(
  candidate: CareActivityCandidate,
  utterances: readonly DetectionUtterance[]
): CandidateProblem[] {
  const problems: CandidateProblem[] = [];
  const byId = new Map(utterances.map((u) => [u.id, u]));
  const code = candidate.activityCode;

  if (!Array.isArray(candidate.quotes) || candidate.quotes.length === 0) {
    problems.push({ activityCode: code, problem: 'no-quotes', detail: '인용이 없다' });
    return problems;
  }

  for (const quote of candidate.quotes) {
    const source = byId.get(quote.utteranceId);
    if (!source) {
      problems.push({
        activityCode: code,
        problem: 'unknown-utterance',
        detail: `원문에 없는 발화 id: ${quote.utteranceId}`
      });
      continue;
    }
    if (source.text !== quote.quote) {
      problems.push({
        activityCode: code,
        problem: 'quote-mismatch',
        detail: `발화 ${quote.utteranceId} 의 원문과 인용이 다르다`
      });
    }
    if (source.timestampMs !== quote.timestampMs) {
      problems.push({
        activityCode: code,
        problem: 'timestamp-mismatch',
        detail: `발화 ${quote.utteranceId} 의 시각이 원문과 다르다`
      });
    }
  }

  const times = candidate.quotes
    .map((q) => byId.get(q.utteranceId)?.timestampMs)
    .filter((t): t is number => typeof t === 'number');
  if (times.length === candidate.quotes.length) {
    const start = Math.min(...times);
    const end = Math.max(...times);
    if (candidate.timeRange.startMs !== start || candidate.timeRange.endMs !== end) {
      problems.push({
        activityCode: code,
        problem: 'time-range-mismatch',
        detail: `시각 구간이 인용된 발화들과 맞지 않는다 (원문 기준 ${start}–${end})`
      });
    }
  }
  return problems;
}

export interface WithheldCandidate {
  candidate: CareActivityCandidate;
  reason: 'unreviewed-definition' | 'retired-definition' | 'source-mismatch';
  detail: string;
}

export interface ReleaseResult {
  /** 화면에 올려도 되는 후보. 임상 검토를 마쳤고 원문 대조를 통과했다. */
  released: ReleasedCareActivityCandidate[];
  /** 올리지 않은 후보. 조용히 버리지 않고 이유와 함께 남긴다. */
  withheld: WithheldCandidate[];
}

/**
 * [HARD] 사용자 화면으로 나가는 유일한 문. 두 관문을 동시에 통과해야 한다.
 *
 *   1. 정의가 임상 검토를 마쳤을 것(`reviewStatus === 'reviewed'`).
 *      씨드된 정의는 전부 'unreviewed' 라 여기서 전량 걸린다.
 *   2. 후보의 인용·시각이 원문과 일치할 것.
 *
 * 반환 타입이 `ReleasedCareActivityCandidate`(리터럴 'reviewed')라서 화면
 * 코드가 실수로 원래 후보 배열을 받아 그릴 수 없다 — 타입이 맞지 않는다.
 */
export function releaseForDisplay(
  candidates: readonly CareActivityCandidate[],
  utterances: readonly DetectionUtterance[]
): ReleaseResult {
  const released: ReleasedCareActivityCandidate[] = [];
  const withheld: WithheldCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.reviewStatus !== 'reviewed') {
      withheld.push({
        candidate,
        reason:
          candidate.reviewStatus === 'retired'
            ? 'retired-definition'
            : 'unreviewed-definition',
        detail: `정의 ${candidate.activityCode} 는 임상 검토 전이다`
      });
      continue;
    }
    const problems = verifyCandidate(candidate, utterances);
    if (problems.length > 0) {
      withheld.push({
        candidate,
        reason: 'source-mismatch',
        detail: problems.map((p) => `${p.problem}: ${p.detail}`).join(' / ')
      });
      continue;
    }
    released.push(candidate as ReleasedCareActivityCandidate);
  }
  return { released, withheld };
}

// ── 화면 payload (B3) ──────────────────────────────────────────────────

/**
 * 화면이 비어 있는 이유.
 *
 * "빈 화면"과 "고장난 화면"은 사용자에게 같은 모습이다. 지금 씨드된 정의는
 * 전부 임상 검토 전이라 **아무것도 뜨지 않는 것이 올바른 동작**인데, 이유를
 * 말하지 않으면 그것이 버그로 읽힌다. 그래서 비어 있음도 값으로 만든다.
 */
export type CareActivityEmptyReason =
  /** 아직 녹취가 시작되지 않았다. */
  | 'no-session'
  /** 발화는 있는데 후보가 하나도 만들어지지 않았다. */
  | 'no-evidence'
  /** 후보는 있었지만 정의가 아직 임상 검토 전이라 화면에 올리지 않았다. */
  | 'none-reviewed'
  /** 문진 대화만 있다 — 타임스탬프가 없어 시각 구간을 만들 수 없다. */
  | 'intake-no-timestamps';

/** 어느 대화를 본 결과인지. 문진 대화만 본 경우 빈 이유가 달라진다. */
export type CareActivitySource = 'live' | 'intake';

/**
 * 화면으로 나가는 payload.
 *
 * `items` 의 타입이 `ReleasedCareActivityCandidate` 라서 `releaseForDisplay()`
 * 를 통과하지 않은 후보는 여기 담길 수 없다 — 화면으로 가는 문은 여전히
 * 하나뿐이다. `withheld` 와 `skipped` 는 담지 않는다: 화면에 올리는 순간
 * 애매한 것이 "가능성"이 되고 그것이 곧 권유가 된다.
 */
export interface CareActivityDisplayPayload {
  items: ReleasedCareActivityCandidate[];
  emptyReason: CareActivityEmptyReason | null;
  source: CareActivitySource;
  /** 이 진료의 세션 id. 없으면 아직 녹취 전. */
  sessionId: string | null;
}

/**
 * 릴리스 결과를 화면 payload 로 만든다.
 *
 * 비어 있는 이유를 **여기 한 곳에서만** 정한다. 렌더러가 자기 나름대로
 * 추측하면 같은 상황에 창마다 다른 설명이 붙는다.
 */
export function toDisplayPayload(input: {
  sessionId: string | null;
  source: CareActivitySource;
  utterances: readonly DetectionUtterance[];
  release: ReleaseResult;
}): CareActivityDisplayPayload {
  const { sessionId, source, utterances, release } = input;
  const base = { items: release.released, source, sessionId };
  if (release.released.length > 0) return { ...base, emptyReason: null };
  if (release.withheld.length > 0) return { ...base, emptyReason: 'none-reviewed' };
  if (source === 'intake' || utterances.every((u) => u.timestampMs === null)) {
    // 발화가 아예 없을 때도 문진 경로에서는 이 설명이 맞다 — 문진 대화에는
    // 시각이 없어서 애초에 후보가 만들어질 수 없다.
    return { ...base, emptyReason: 'intake-no-timestamps' };
  }
  if (sessionId === null) return { ...base, emptyReason: 'no-session' };
  return { ...base, emptyReason: 'no-evidence' };
}

// ── 월 리포트 (B4) ─────────────────────────────────────────────────────

/**
 * 저장된 후보 한 행(월 집계 입력).
 *
 * `ruleVersion`/`engineVersion` 이 값에 들어 있는 것이 핵심이다. 규칙이
 * 바뀌어도 지난달 줄을 고쳐 쓰지 않고 **다른 줄**로 나타난다.
 */
export interface StoredCandidateRow {
  activityCode: string;
  label: string;
  category: string | null;
  engineVersion: string;
  ruleVersion: number;
  sessionId: string;
  occurredOn: string;
  generatedAt: string;
}

/** 월 리포트 한 줄. 금액은 없다 — 건수만 센다. */
export interface MonthlyReportRow {
  activityCode: string;
  label: string;
  category: string | null;
  engineVersion: string;
  ruleVersion: number;
  /** 기록된 행위 건수. */
  count: number;
  /** 그 건수가 걸쳐 있는 진료 건수. */
  sessionCount: number;
}

export interface MonthlyCareActivityReport {
  /** 'YYYY-MM'. */
  month: string;
  rows: MonthlyReportRow[];
  totalCount: number;
  sessionCount: number;
  generatedAt: string;
}

/**
 * 저장된 행을 월 리포트로 접는다.
 *
 * [HARD] 묶음 키에 `ruleVersion`/`engineVersion` 이 들어간다. 규칙이 바뀌면
 * 지난달 숫자가 조용히 달라지는 대신 줄이 하나 늘어난다 — 어떤 규칙이 만든
 * 숫자인지 답할 수 없는 리포트는 파일럿 근거로 쓸 수 없다.
 *
 * [HARD] 금액·추정 수익·환산치를 계산하지 않는다. 이 리포트가 세는 것은
 * "녹취가 증거하는 행위 기록 건수"뿐이다.
 */
export function foldMonthlyReport(
  month: string,
  rows: readonly StoredCandidateRow[],
  options: { generatedAt?: string } = {}
): MonthlyCareActivityReport {
  const buckets = new Map<string, MonthlyReportRow & { sessions: Set<string> }>();
  for (const row of rows) {
    const key = `${row.activityCode} ${row.engineVersion} ${row.ruleVersion}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        activityCode: row.activityCode,
        label: row.label,
        category: row.category,
        engineVersion: row.engineVersion,
        ruleVersion: row.ruleVersion,
        count: 0,
        sessionCount: 0,
        sessions: new Set<string>()
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.sessions.add(row.sessionId);
  }
  const folded = [...buckets.values()]
    .map(({ sessions, ...rest }) => ({ ...rest, sessionCount: sessions.size }))
    .sort((a, b) => b.count - a.count || a.activityCode.localeCompare(b.activityCode));
  return {
    month,
    rows: folded,
    totalCount: folded.reduce((sum, r) => sum + r.count, 0),
    sessionCount: new Set(rows.map((r) => r.sessionId)).size,
    generatedAt: options.generatedAt ?? new Date().toISOString()
  };
}

/**
 * 리포트를 CSV 로. 세는 것이 목적이라 옮겨 담을 수 있어야 한다.
 *
 * 설득용 문장을 넣지 않는다 — 열은 전부 사실(항목, 규칙 버전, 건수)이다.
 */
export function monthlyReportToCsv(report: MonthlyCareActivityReport): string {
  const escape = (v: string): string =>
    /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  const lines = [
    ['month', 'activity_code', 'label', 'category', 'engine_version', 'rule_version', 'record_count', 'consultation_count']
      .join(',')
  ];
  for (const row of report.rows) {
    lines.push(
      [
        report.month,
        row.activityCode,
        escape(row.label),
        escape(row.category ?? ''),
        row.engineVersion,
        String(row.ruleVersion),
        String(row.count),
        String(row.sessionCount)
      ].join(',')
    );
  }
  return lines.join('\n');
}

// ── 입력 어댑터 ────────────────────────────────────────────────────────

/**
 * 키오스크 문진 대화(`soap_json.transcript`)를 탐지 입력으로 바꾼다.
 *
 * 발화 id 는 E1 의 `patientTranscriptSources` 와 **같은 규칙**(`intake-{원본
 * 인덱스}`)이다. 두 곳이 다른 id 를 쓰면 근거를 눌렀을 때 전사 창이 다른
 * 발화로 간다. 읽을 수 없는 줄도 인덱스를 소비하되 빈 텍스트로 남겨 단서가
 * 걸리지 않게 한다.
 *
 * 문진 대화에는 보통 타임스탬프가 없다. 그 경우 `timestampMs` 는 null 이고,
 * 엔진이 시각 구간을 만들 수 없어 후보를 만들지 않는다 — 의도된 손실이다.
 */
export function intakeTranscriptUtterances(raw: unknown): DetectionUtterance[] {
  if (!Array.isArray(raw)) return [];
  const patientRoles = new Set(['patient', 'user', 'human']);
  return raw.map((entry, index) => {
    const id = `intake-${index}`;
    if (typeof entry === 'string') {
      return { id, text: entry, speaker: 'unknown' as Speaker, timestampMs: null };
    }
    const row =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const text = ['text', 'content', 'message', 'utterance']
      .map((k) => row?.[k])
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const role = String(
      ['role', 'speaker', 'author'].map((k) => row?.[k]).find((v) => typeof v === 'string') ?? ''
    ).toLowerCase();
    const rawTime = ['timestamp_ms', 'timestampMs', 'offset_ms']
      .map((k) => row?.[k])
      .find((v) => typeof v === 'number');
    return {
      id,
      text: text ?? '',
      // 문진 진행자는 키오스크 AI 지만, 의사가 수행해야 하는 행위의 화자
      // 조건과 섞이지 않도록 환자 외에는 전부 unknown 으로 둔다.
      speaker: (patientRoles.has(role) ? 'patient' : 'unknown') as Speaker,
      timestampMs: typeof rawTime === 'number' ? rawTime : null
    };
  });
}

/** 시각 구간 표시용 `mm:ss–mm:ss`. 녹음 시작 기준 경과 시간이다. */
export function formatTimeRange(range: {
  startMs: number;
  endMs: number;
}): string {
  const fmt = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  return `${fmt(range.startMs)}–${fmt(range.endMs)}`;
}
