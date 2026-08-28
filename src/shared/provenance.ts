/**
 * 해석의 출처 (E3).
 *
 * 이 앱이 만드는 임상 산출물은 두 종류다: 환자가 **말한 것**(기록)과 기계가
 * **결론 내린 것**(의견). 앞의 것은 사실이라 출처가 필요 없고, 뒤의 것은
 * 의견이라 출처가 없으면 나중에 아무것도 답할 수 없다 — 어느 모델이, 어느
 * 프롬프트로, 언제 만든 판단인지.
 *
 * 그래서 **해석에만** 붙는다. transcript 나 구조화된 S 필드에는 붙이지 않는다.
 *
 * 이 파일은 electron 도 react 도 모른다. `src/shared/findings.ts` 와 같은
 * 이유다 — main(실시간 분석)과 renderer(문진 결과 표시)가 같은 정의를 써야
 * 하고, 두 벌이 되면 한쪽만 갱신되는 날 화면과 DB 가 다른 모델명을 말한다.
 *
 * 키오스크(별도 Next.js 앱, 별도 패키지)는 이 파일을 import 할 수 없어
 * `kiosk/lib/intake/provenance.ts` 에 같은 모양을 따로 둔다. 두 벌인 것을
 * 감추지 않고 `scripts/probe-provenance.mjs` 가 **양쪽이 실제로 저장한 행**의
 * 키 집합을 대조한다 — 타입으로는 못 묶으므로 검증으로 묶는다.
 */

/** 해석을 만든 실행 경로. 어느 코드가 돌았는지이지, 어느 모델인지가 아니다. */
export type InterpretationEngine =
  /** 키오스크 문진 결과 생성 (kiosk/lib/intake/result.ts). */
  | 'kiosk-intake'
  /** 데스크톱 실시간 감별 분석 (src/main/analyzer.ts). */
  | 'desktop-live-analysis';

export interface InterpretationProvenance {
  engine: InterpretationEngine;
  /** 모델 벤더. 'gemini' 등. */
  provider: string;
  /** 실제로 호출한 모델 id. 'gemini-2.5-flash' 등. */
  model: string;
  /**
   * 시스템 프롬프트 버전. 프롬프트를 고치면 같은 모델도 다른 판단을 낸다 —
   * 모델명만으로는 재현이 불가능하다.
   */
  promptVersion: number;
  /** 출력 스키마 버전. 필드가 바뀌면 읽는 쪽이 알아야 한다. */
  schemaVersion: number;
  /** 해석이 생성된 시각 (ISO 8601). 저장 시각이 아니라 생성 시각. */
  generatedAt: string;
}

/**
 * 출처가 기록되지 않은 해석 (0011 이전 행, 또는 값이 깨진 행).
 *
 * `null` 로 두지 않고 값으로 만든 이유: 화면과 감사 추적이 "출처 미기록"을
 * **말할 수 있어야** 하기 때문이다. undefined 를 만나면 아무 말도 하지 않게
 * 되고, 그러면 출처 없는 해석이 출처 있는 해석과 같은 모양으로 보인다.
 */
export interface UnrecordedProvenance {
  engine: 'unrecorded';
}

export type ProvenanceOrUnrecorded =
  | InterpretationProvenance
  | UnrecordedProvenance;

export function isRecordedProvenance(
  value: ProvenanceOrUnrecorded
): value is InterpretationProvenance {
  return value.engine !== 'unrecorded';
}

export const UNRECORDED_PROVENANCE: UnrecordedProvenance = {
  engine: 'unrecorded'
};

const ENGINES: readonly string[] = ['kiosk-intake', 'desktop-live-analysis'];

/**
 * DB/IPC 에서 온 값을 방어적으로 읽는다.
 *
 * 하나라도 빠지면 통째로 "미기록"으로 떨어뜨린다. 반쯤 채워진 출처는 출처가
 * 아니라 추측이고, 화면에 모델명만 뜨고 프롬프트 버전이 비어 있으면 읽는
 * 사람은 그것을 완전한 출처로 읽는다.
 */
export function parseProvenance(raw: unknown): ProvenanceOrUnrecorded {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return UNRECORDED_PROVENANCE;
  }
  const row = raw as Record<string, unknown>;
  const engine = row.engine;
  const provider = row.provider;
  const model = row.model;
  const promptVersion = row.promptVersion;
  const schemaVersion = row.schemaVersion;
  const generatedAt = row.generatedAt;

  if (
    typeof engine !== 'string' ||
    !ENGINES.includes(engine) ||
    typeof provider !== 'string' ||
    provider.trim() === '' ||
    typeof model !== 'string' ||
    model.trim() === '' ||
    typeof promptVersion !== 'number' ||
    !Number.isInteger(promptVersion) ||
    typeof schemaVersion !== 'number' ||
    !Number.isInteger(schemaVersion) ||
    typeof generatedAt !== 'string' ||
    Number.isNaN(Date.parse(generatedAt))
  ) {
    return UNRECORDED_PROVENANCE;
  }

  return {
    engine: engine as InterpretationEngine,
    provider,
    model,
    promptVersion,
    schemaVersion,
    generatedAt
  };
}

/**
 * 사람이 읽는 한 줄. 화면과 감사 추적이 같은 문자열을 쓴다.
 *
 * 미기록은 빈 문자열이 아니라 그렇게 말한다 — 빈 문자열은 화면에서 사라지고,
 * 사라진 출처는 없는 문제처럼 보인다.
 */
export function describeProvenance(value: ProvenanceOrUnrecorded): string {
  if (!isRecordedProvenance(value)) return '출처 미기록';
  return `${value.provider}/${value.model} · 프롬프트 v${value.promptVersion} · 스키마 v${value.schemaVersion}`;
}
