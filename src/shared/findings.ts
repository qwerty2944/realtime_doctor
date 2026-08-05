/**
 * 근거 검증 (E1).
 *
 * 모델이 감별진단마다 `supporting_findings[]` 를 내놓고, 각 항목의 `source` 는
 * 실제로 존재하는 발화를 가리켜야 한다. 모델은 존재하지 않는 발화를 가끔
 * 가리킨다 — 프롬프트로는 못 막는다. 그래서 화면에 닿기 전에 여기서 대조한다.
 *
 * 이 파일은 electron 도, react 도 모른다. 실시간 분석(main 프로세스)과 문진
 * 결과 매핑(renderer)이 **같은 함수**를 쓰기 위해서다. 검증기가 두 벌이 되면
 * 한쪽만 고쳐지는 날 한쪽 경로에서 지어낸 근거가 그대로 뜬다.
 */

import type {
  DifferentialDiagnosis,
  SupportingFinding,
  UnverifiedDifferential
} from './types.js';

/** 근거가 가리킬 수 있는 원문 한 줄. 실시간 발화와 문진 대화가 같은 모양이다. */
export interface SourceUtterance {
  /** 전사 창이 이 발화를 찾을 때 쓰는 id. */
  id: string;
  text: string;
}

/** 모델에게 보여줄 발화 라벨. 프롬프트와 파서가 같은 문자열을 써야 한다. */
export function sourceRefFor(index: number): string {
  return `#${index}`;
}

/**
 * 참조 문자열에서 발화 번호를 뽑는다.
 *
 * 프롬프트는 `#3` 하나만 가르치지만 모델은 `utterance 3`, `[#3]`, `3` 처럼
 * 흔들린다. 표기 흔들림은 받아주되 **번호가 없으면 해석하지 않는다** — 근거를
 * 문장으로 적어 보내는 것(= 지어내는 것)이 통과하면 안 되기 때문이다.
 */
export function parseSourceIndex(source: unknown): number | null {
  if (typeof source !== 'string') return null;
  const matched = source.match(/-?\d+/);
  if (!matched) return null;
  const index = Number.parseInt(matched[0], 10);
  return Number.isInteger(index) ? index : null;
}

/** 모델이 내놓은 검증 전 근거. 어떤 필드도 믿지 않는다. */
export interface RawFinding {
  finding?: unknown;
  source?: unknown;
}

export interface ResolveResult {
  resolved: SupportingFinding[];
  /** 원문에서 찾지 못해 버린 참조들. 왜 내려갔는지 설명하는 데 쓴다. */
  rejectedSources: string[];
}

/**
 * 근거 목록을 원문과 대조한다.
 *
 * `quote` 는 모델이 준 문장이 아니라 **원문에서 직접 꺼낸 텍스트**다. 모델이
 * 발화를 옮겨 적으면서 슬쩍 바꾸는 것까지 화면에 올리지 않기 위해서다.
 */
export function resolveFindings(
  raw: unknown,
  utterances: readonly SourceUtterance[]
): ResolveResult {
  const resolved: SupportingFinding[] = [];
  const rejectedSources: string[] = [];
  if (!Array.isArray(raw)) return { resolved, rejectedSources };

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { finding, source } = entry as RawFinding;
    const text = typeof finding === 'string' ? finding.trim() : '';
    const ref = typeof source === 'string' ? source.trim() : '';
    // 근거 문장이 비어 있으면 화면에 올릴 것이 없다.
    if (!text) continue;
    if (!ref) {
      rejectedSources.push('(빈 참조)');
      continue;
    }
    const index = parseSourceIndex(ref);
    const target =
      index !== null && index >= 0 && index < utterances.length
        ? utterances[index]
        : null;
    // 빈 텍스트는 자리만 채운 항목(읽을 수 없던 원문 줄)이다 — 인용할 것이 없다.
    if (!target || target.text.trim().length === 0) {
      rejectedSources.push(ref);
      continue;
    }
    resolved.push({
      finding: text,
      source: ref,
      utteranceId: target.id,
      quote: target.text
    });
  }
  return { resolved, rejectedSources };
}

export interface PartitionResult {
  /** 검증된 근거를 최소 1개 가진 진단. 이것만 정상 렌더링한다. */
  supported: DifferentialDiagnosis[];
  /** 근거가 하나도 안 남은 진단. 버리지 않고 따로 표시한다. */
  unverified: UnverifiedDifferential[];
}

/** 검증 전 감별진단 한 건 — 근거만 아직 원시 상태다. */
export interface DifferentialWithRawFindings extends DifferentialDiagnosis {
  rawFindings?: unknown;
}

/**
 * 감별진단 목록을 "근거 있음 / 근거 미확인" 으로 가른다.
 *
 * 근거 미확인을 조용히 버리지 않는다 — 내려간 감별진단은 그 자체로 임상
 * 정보이고, 화면에서 사라지면 의사는 그 진단이 검토조차 안 됐다고 오해한다.
 */
export function partitionDifferentials(
  items: readonly DifferentialWithRawFindings[],
  utterances: readonly SourceUtterance[]
): PartitionResult {
  const supported: DifferentialDiagnosis[] = [];
  const unverified: UnverifiedDifferential[] = [];

  for (const item of items) {
    const { rawFindings, ...diagnosis } = item;
    const { resolved, rejectedSources } = resolveFindings(rawFindings, utterances);
    if (resolved.length > 0) {
      supported.push({ ...diagnosis, supportingFindings: resolved });
      continue;
    }
    unverified.push({
      diagnosis,
      reason: rejectedSources.length > 0 ? 'unresolved-source' : 'no-findings',
      rejectedSources
    });
  }
  return { supported, unverified };
}
