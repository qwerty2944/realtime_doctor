/**
 * `intake_results.differentials_json` 의 정규 형태 — 단일 기준점.
 *
 * 왜 이 파일이 있는가
 * -------------------
 * 감별진단 이름이 누가 썼느냐에 따라 다른 키로 저장돼 있었다. 키오스크는
 * `name_kr`/`name_en`, 데스크톱 분석기는 `name`/`nameEn`, 그리고 읽는 쪽
 * (`src/renderer/shared/patientMode.ts`)은 다섯 가지 철자를 차례로 더듬었다.
 * 더듬는 코드는 갈래가 있다는 증거이지 갈래를 없앤 것이 아니다.
 *
 * 정규형은 **컬럼 단위**로 정한다. 앱 단위가 아니다.
 *
 *   intake_results.differentials_json  → snake_case (아래 INTAKE_*)
 *   analyses.differential_diagnoses    → camelCase  (아래 LIVE_*)
 *
 * 둘을 통일하지 않은 이유는 `LIVE_ANALYSIS_DIFFERENTIAL_KEYS` 주석에 적었다.
 * 통일해야 하는 것은 두 테이블이 아니라 **한 컬럼에 쓰는 모든 writer** 다.
 */

// ---------------------------------------------------------------------------
// 1. intake_results.differentials_json — 정규형
// ---------------------------------------------------------------------------

/**
 * 저장되는 감별진단 한 건의 정규 키.
 *
 * snake_case 인 이유: 이 프로젝트의 저장 JSON 은 전부 snake_case 다
 * (`soap_json` 의 `follow_up_questions`·`medical_terms`,
 * `recommended_tests_json` 의 `name_kr`/`name_en`). 그리고 운영에 있는
 * 24건 전부가 이미 이 철자다 — 정규형을 다른 쪽으로 정하면 맞는 데이터를
 * 틀리게 만드는 마이그레이션을 스스로 만들어야 한다.
 *
 * [HARD] 이 배열을 고치면 아래 셋이 함께 움직여야 하고, 움직이지 않으면
 * `scripts/probe-differentials-shape.mjs` 가 빌드를 세운다:
 *   - `kiosk/lib/intake/schemas.ts` 의 `differentialsJsonSchema`
 *   - `supabase/migrations/0018_differentials_canonical_shape.sql`
 *   - `supabase/migrations/0014_web_statistics.sql` 의 집계 키
 */
export const INTAKE_DIFFERENTIAL_KEYS = [
  'rank',
  'name_kr',
  'name_en',
  'rationale',
  'supporting_findings'
] as const;

/** 통계·표시가 진단명으로 읽는 키. 0014 의 `f_web_stats_diagnosis` 와 같아야 한다. */
export const INTAKE_DIFFERENTIAL_NAME_KEY = 'name_kr';
export const INTAKE_DIFFERENTIAL_NAME_EN_KEY = 'name_en';

/**
 * 정규형 이전에 돌아다니던 진단명 철자들.
 *
 * 운영 데이터에는 **한 건도 없다** (0018 적용 전 실측: 24/24 가 `name_kr`).
 * 그래도 목록을 남기는 이유는 두 가지다: (1) 읽는 쪽의 레거시 분기가 무엇을
 * 받아주는지 명시적으로 적어두기 위해, (2) 가드가 "이 철자를 새로 쓰는 코드"를
 * 이름으로 지목할 수 있게 하기 위해.
 */
export const LEGACY_INTAKE_DIFFERENTIAL_NAME_KEYS = [
  'nameKr',
  'name',
  'nameEn'
] as const;

/** 저장된 감별진단 한 건 (정규형). */
export interface IntakeDifferential {
  rank: number;
  name_kr: string;
  name_en: string;
  rationale: string;
  supporting_findings: Array<{ finding: string; source: string }>;
}

// ---------------------------------------------------------------------------
// 2. analyses.differential_diagnoses — 일부러 다른 형태
// ---------------------------------------------------------------------------

/**
 * 데스크톱 실시간 분석이 세션마다 upsert 하는 감별진단의 키.
 *
 * [의도적으로 정규형과 다르다] 같은 이름의 개념이지만 같은 산출물이 아니다:
 *
 *   - `rank` 가 없다. 순서는 배열 위치이고 2.5초마다 통째로 다시 매겨진다.
 *     저장된 문진 결과의 `rank` 는 그 시점에 고정된 값이라 의미가 다르다.
 *   - `icd10` 이 있다. 문진 쪽에는 없다.
 *   - `name` 은 진료 언어를 따른다. 영어 진료에서는 한국어 진단명이
 *     **존재하지 않는다** — 이 컬럼에 `name_kr` 을 두면 없는 것을 있다고
 *     주장하게 된다.
 *   - 이 컬럼은 `f_web_stats_diagnosis` 가 집계하지 않고
 *     `patientMode.ts` 가 읽지도 않는다. 통일해서 이득을 보는 reader 가 0 이다.
 *
 * 그래서 두 컬럼은 통일하지 않는다. 대신 둘 사이를 건널 때는 반드시
 * `toIntakeDifferentials()` 를 지난다.
 */
export const LIVE_ANALYSIS_DIFFERENTIAL_KEYS = [
  'name',
  'nameEn',
  'icd10',
  'reasoning',
  'supportingFindings'
] as const;

// ---------------------------------------------------------------------------
// 3. 읽기 — 정규 키 하나, 그리고 눈에 보이는 레거시 분기
// ---------------------------------------------------------------------------

export interface IntakeDifferentialName {
  name: string;
  nameEn: string | null;
  /**
   * 정규 키가 아니라 구 표기에서 읽었다면 그 키 이름. 정규 행이면 null.
   * 호출부가 "레거시 경로를 탔다"를 로그로 남길 수 있게 값으로 돌려준다 —
   * 조용히 흡수하면 구 표기 행이 몇 건 남아 있는지 영원히 알 수 없다.
   */
  legacyKey: string | null;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * 저장된 감별진단 한 건에서 진단명을 읽는다.
 *
 * 정상 경로는 `name_kr` 하나다. 나머지는 전부 레거시 분기이고, 탄 사실이
 * `legacyKey` 로 드러난다. 이 함수 밖에서 다른 철자를 더듬지 않는다.
 */
export function readIntakeDifferentialName(
  row: Record<string, unknown> | null
): IntakeDifferentialName | null {
  if (!row) return null;

  const nameEn = trimmed(row[INTAKE_DIFFERENTIAL_NAME_EN_KEY]);
  const canonical = trimmed(row[INTAKE_DIFFERENTIAL_NAME_KEY]);
  if (canonical) return { name: canonical, nameEn, legacyKey: null };

  // ── 레거시 경로 ─────────────────────────────────────────────────────────
  // 0018 이전에 저장됐을 수 있는 행만을 위한 것이다. 0018 의 CHECK 제약
  // 이후로는 이 분기로 들어오는 새 행이 존재할 수 없다. 지우지 않는 이유는
  // 백필 없이 정규화했기 때문이다 — 지우는 순간, 만약 어딘가에 구 표기 행이
  // 남아 있었다면 진단명이 화면에서 사라진다.
  for (const key of LEGACY_INTAKE_DIFFERENTIAL_NAME_KEYS) {
    const value = trimmed(row[key]);
    if (value) return { name: value, nameEn: nameEn ?? trimmed(row.nameEn), legacyKey: key };
  }
  // 영문명밖에 없는 행도 이름 없는 카드보다는 낫다.
  if (nameEn) return { name: nameEn, nameEn, legacyKey: INTAKE_DIFFERENTIAL_NAME_EN_KEY };
  return null;
}

// ---------------------------------------------------------------------------
// 4. 쓰기 — 데스크톱 분석 결과를 정규형으로 건너보내는 유일한 다리
// ---------------------------------------------------------------------------

/** `toIntakeDifferentials` 가 받는 최소 형태. `AnalysisResult` 의 항목이 이것을 만족한다. */
export interface LiveAnalysisDifferentialLike {
  name: string;
  nameEn?: string;
  reasoning?: string;
  supportingFindings?: Array<{ finding: string; source: string }>;
}

/**
 * 데스크톱 실시간 분석 결과 → `intake_results.differentials_json` 정규형.
 *
 * 왜 미리 만들어 두는가: `rederive_intake_interpretation`(0011)은 아직 호출부가
 * 없다. 그것이 데스크톱 분석기 출력에 연결되는 날, 아무 변환 없이 camelCase 를
 * 그대로 넘기면 `intake_results` 행이 **대량으로** 다른 철자로 다시 쓰인다.
 * 그 시점에 이 함수가 이미 존재하고 있어야 한다 — 없으면 그때 만들어야 하고,
 * 급할 때 만들어지지 않는 것이 바로 이런 변환이다.
 *
 * 0018 의 CHECK 제약이 이 함수를 건너뛴 쓰기를 DB 에서 거절하므로, 이 다리는
 * 규율이 아니라 유일한 통로다.
 */
export function toIntakeDifferentials(
  items: readonly LiveAnalysisDifferentialLike[]
): IntakeDifferential[] {
  const out: IntakeDifferential[] = [];
  for (const item of items) {
    const name = trimmed(item.name);
    if (!name) continue;
    out.push({
      rank: out.length + 1,
      name_kr: name,
      // 영문명이 없으면 한국어명을 그대로 둔다. `name_en` 은 정규형에서
      // 필수이고(PubMed 조회어로 쓰인다), 빈 문자열을 넣으면 제약에 걸린다.
      name_en: trimmed(item.nameEn) ?? name,
      rationale: trimmed(item.reasoning) ?? name,
      supporting_findings: (item.supportingFindings ?? []).map((f) => ({
        finding: f.finding,
        source: f.source
      }))
    });
  }
  return out;
}
