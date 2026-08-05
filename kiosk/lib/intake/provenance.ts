/**
 * 문진 해석의 출처 (E3).
 *
 * 키오스크가 만드는 것은 두 종류다: 환자가 **말한 것**(`soap_json.transcript`,
 * 구조화된 S 필드 — 기록)과 모델이 **결론 내린 것**(감별진단, SOAP 의 A/P,
 * 추천검사 — 의견). 이 파일은 뒤의 것에만 붙는다.
 *
 * 데스크톱 앱의 `src/shared/provenance.ts` 와 같은 모양이다. 두 앱이 별도
 * 패키지라 타입을 공유할 수 없어 정의가 두 벌이고, 그것을 주석으로 덮지 않고
 * `scripts/probe-provenance.mjs` 가 **양쪽이 실제로 DB 에 쓴 행**의 키 집합을
 * 대조해서 묶는다.
 *
 * [HARD] 프롬프트를 고치면 PROMPT_VERSION 을 올린다. 같은 모델도 프롬프트가
 * 다르면 다른 판단을 낸다 — 모델명만 남기면 재현이 불가능하고, 재현할 수 없는
 * 출처는 출처가 아니다.
 */

/**
 * 문진 결과 시스템 프롬프트(`RESULT_SYSTEM_PROMPT`)의 버전.
 *
 * 1 = E1(supporting_findings 도입) 이후의 현재 프롬프트.
 */
export const INTAKE_PROMPT_VERSION = 1;

/**
 * 저장 스키마(`intakeResultRowSchema`)의 버전.
 *
 * 1 = supporting_findings 를 포함하는 현재 형태. `intake_results.version`
 * 컬럼과는 다른 것이다 — 그 컬럼은 이 진료의 몇 번째 해석인지이고, 이것은
 * 그 해석이 어떤 모양으로 쓰였는지다.
 */
export const INTAKE_SCHEMA_VERSION = 1;

export interface IntakeInterpretationProvenance {
  engine: 'kiosk-intake';
  provider: string;
  model: string;
  promptVersion: number;
  schemaVersion: number;
  generatedAt: string;
}

/** 지금 이 호출의 출처. 저장 직전에 만든다 — generatedAt 이 생성 시각이도록. */
export function buildIntakeProvenance(params: {
  provider: string;
  model: string;
  generatedAt?: Date;
}): IntakeInterpretationProvenance {
  return {
    engine: 'kiosk-intake',
    provider: params.provider,
    model: params.model,
    promptVersion: INTAKE_PROMPT_VERSION,
    schemaVersion: INTAKE_SCHEMA_VERSION,
    generatedAt: (params.generatedAt ?? new Date()).toISOString()
  };
}
