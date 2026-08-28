/**
 * 문진 대화의 red flag 감지.
 *
 * 두 개의 독립 신호를 합친다:
 *   1. 지금까지 환자가 말한 모든 것에 대한 키워드 매칭(이 모듈), 그리고
 *   2. 매 턴 모델이 스스로 세우는 danger 플래그.
 *
 * 둘 다 쓰는 이유는 실패하는 방식이 다르기 때문이다. 정규식은 모델이 대충
 * 넘긴 표현을 잡고, 모델은 규칙 작성자가 상상하지 못한 표현을 잡는다.
 *
 * righthand 원본은 규칙을 `red_flags` 테이블에서 읽고 의사별 설정으로 걸러냈다.
 * realtime_doctor 스키마에는 그 테이블이 없고, 이번 라운드에 추가하지도 않는다.
 * 대신 아래 상수 목록을 쓴다 — 의사가 규칙을 편집할 수단이 아직 없는 상태에서
 * 테이블만 먼저 만들면 영원히 비어 있는 테이블이 되고, 그건 규칙이 하나도 없는
 * 것과 같다. 규칙 편집 UI 가 생기면 그때 테이블로 옮긴다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { stripNegatedClauses } from '@/lib/intake/negation';

/**
 * 키워드 규칙이 발화하는 데 대화의 어느 범위가 필요했는지.
 *
 * `utterance` — 패턴 전체가 한 답변 안에서 매치됐다. 강한 신호.
 * `transcript` — 여러 답변을 함께 읽어야 패턴이 완성됐다. 그래도 올린다
 *   (다증상 응급은 실제로 여러 답변에 걸쳐 서술된다) — 다만 의사가 "환자가
 *   한 호흡에 말했다" 고 오해하지 않도록 그렇다고 표시한다.
 */
export type RedFlagScope = 'utterance' | 'transcript';

export interface RedFlagRule {
  id: string;
  label: string;
  /** JavaScript RegExp 소스. `i`, `s` 플래그로 컴파일된다. */
  pattern: string;
}

export interface RedFlagMatch {
  label: string;
  source: 'keyword' | 'model';
  scope?: RedFlagScope;
  /** 키워드 매치를 일으킨 환자의 실제 발언. 표시용으로 잘린다. */
  evidence?: string;
}

/**
 * 안과 응급의 내장 규칙 집합.
 *
 * 각 패턴은 증상 + 성질/시간 이 함께 있을 때만 발화하도록 lookahead 로
 * 짰다. "눈이 아파요" 하나로 급성 폐쇄각 녹내장 배너를 띄우면 배너가
 * 무의미해진다.
 */
export const BUILTIN_RED_FLAGS: readonly RedFlagRule[] = [
  {
    id: 'sudden-vision-loss',
    label: '급성 시력 저하',
    pattern: '(?=.*(안\\s*보|시력|침침|흐리))(?=.*(갑자기|갑작|급격|어제부터|오늘|방금|순식간))'
  },
  {
    id: 'curtain-field-defect',
    label: '커튼 모양 시야 결손 (망막박리 의심)',
    pattern: '(커튼|장막|가림막|검은\\s*막).{0,20}(가리|덮|내려)|시야.{0,10}(가려|결손|반쪽)'
  },
  {
    id: 'photopsia-floaters',
    label: '광시증·비문증 급증 (망막열공 의심)',
    pattern: '(?=.*(번쩍|섬광|빛이\\s*보|날파리|벌레\\s*같|점이\\s*떠))(?=.*(갑자기|많아|늘어|심해|急|급))'
  },
  {
    id: 'acute-angle-closure',
    label: '급성 안통 + 두통/구토 (급성 폐쇄각 녹내장 의심)',
    pattern: '(?=.*(눈|안구|안).{0,6}(아프|통증|쑤시|아파))(?=.*(두통|머리.{0,4}아프|구역|구토|메스))'
  },
  {
    id: 'chemical-exposure',
    label: '화학물질 눈 노출',
    pattern: '(락스|세제|산성|알칼리|화학|약품|본드|시멘트|石灰|석회).{0,15}(눈|들어|튀|묻)|눈.{0,10}(락스|세제|화학|약품).{0,10}(들어|튀)'
  },
  {
    id: 'trauma-vision-loss',
    label: '외상 후 시력 저하',
    pattern: '(?=.*(부딪|맞았|찔렸|다쳤|다친|외상|박혔|긁혔))(?=.*(안\\s*보|시력|피가|출혈))'
  },
  {
    id: 'contact-lens-pain',
    label: '콘택트렌즈 착용 중 통증·충혈 (각막궤양 의심)',
    pattern: '(?=.*(렌즈|콘택트))(?=.*(아프|통증|충혈|빨갛|고름|분비물))'
  }
] as const;

/** `red_flag_reason` 에 넣을 근거 발췌의 최대 길이. */
const EVIDENCE_MAX_LENGTH = 40;

function compileRule(rule: RedFlagRule): RegExp | null {
  try {
    // `i` 는 대소문자 무시, `s` 는 답변 사이 이음매를 `.` 가 넘도록.
    return new RegExp(rule.pattern, 'is');
  } catch (cause) {
    // 규칙 하나가 잘못됐다고 진행 중인 문진이 죽으면 안 된다. 그렇다고
    // 조용히 사라져서도 안 된다.
    console.error(
      `[red-flags] Skipping rule ${rule.id} ("${rule.label}"): pattern is not a valid JavaScript regular expression.`,
      cause
    );
    return null;
  }
}

function toEvidence(utterance: string): string {
  const collapsed = utterance.replace(/\s+/g, ' ').trim();
  return collapsed.length <= EVIDENCE_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, EVIDENCE_MAX_LENGTH)}…`;
}

/**
 * 환자 답변을 규칙과 대조한다. 한 번에 한 답변씩.
 *
 * 대화를 하나의 덩어리로 붙여서 매칭하는 것과 두 가지가 다르다:
 *
 *   1. 매칭 전에 각 답변에서 부정된 절을 제거한다. 이게 없으면
 *      "다친 적은 없습니다" 에 외상 규칙이 발화하고, 환자가 명시적으로 부정한
 *      부상에 대해 의사가 red flag 를 보게 된다.
 *   2. 각 답변을 먼저 단독으로 시험한다. 조각들이 한 답변에 모인 패턴은
 *      두 번째 답변의 발병 시점과 아홉 번째 답변의 증상을 조립한 것보다 훨씬
 *      강한 신호이고, 호출자는 그 둘을 구별해서 말할 수 있어야 한다.
 *
 * 어떤 답변에도 매치되지 않은 규칙은 그다음 전체 답변을 이어붙여 시험한다.
 * 이 두 번째 패스는 일부러 남긴다: 급성 폐쇄각 녹내장은 실제로 통증이 한
 * 답변에, 구역감이 다른 답변에 서술된다.
 */
export function matchRedFlagKeywords(
  rules: readonly RedFlagRule[],
  patientUtterances: readonly string[]
): RedFlagMatch[] {
  const utterances = patientUtterances
    .map((utterance) => ({ raw: utterance, searchable: stripNegatedClauses(utterance) }))
    .filter((entry) => entry.searchable !== '');

  if (utterances.length === 0) return [];

  const combined = utterances.map((entry) => entry.searchable).join('\n');
  const matches: RedFlagMatch[] = [];

  for (const rule of rules) {
    const pattern = compileRule(rule);
    if (pattern === null) continue;

    const hit = utterances.find((entry) => pattern.test(entry.searchable));

    if (hit) {
      matches.push({
        label: rule.label,
        source: 'keyword',
        scope: 'utterance',
        evidence: toEvidence(hit.raw)
      });
      continue;
    }

    if (pattern.test(combined)) {
      matches.push({ label: rule.label, source: 'keyword', scope: 'transcript' });
    }
  }

  return matches;
}

/**
 * 매치들을 `encounters.red_flag_reason` 한 문자열로 접는다.
 *
 * 이유 문자열은 자기 출처를 함께 실어야 한다. 맨 라벨만 있으면 환자가 그
 * 증후군을 서술했다고 주장하는 셈인데, 실제로는 키워드 규칙이 조각에
 * 발화한 것이고, 환자가 말한 적 없는 증상을 이름 붙인 라벨은 의사에게
 * 배너를 무시하도록 가르친다.
 */
export function formatRedFlagReason(matches: readonly RedFlagMatch[]): string {
  const labels = matches.map((match) => {
    if (match.source === 'model') return `AI 감지: ${match.label}`;
    if (match.scope === 'transcript') return `${match.label} (여러 답변 종합)`;
    return match.evidence ? `${match.label} — "${match.evidence}"` : match.label;
  });

  return Array.from(new Set(labels)).join(' / ');
}

/**
 * 두 신호를 평가하고, 하나라도 발화하면 진료 행에 기록한다.
 *
 * 한번 올라간 플래그는 이후 턴이 내리지 않는다: 응급을 언급했다가 번복한
 * 경우도 의사가 봐야 한다.
 */
export async function applyRedFlagDetection(
  supabase: SupabaseClient,
  params: {
    /** 환자 답변 하나당 한 항목, 순서대로. 매칭은 덩어리가 아니라 답변 단위다. */
    patientUtterances: readonly string[];
    encounterId: string;
    modelDanger: boolean;
    modelDangerReason: string;
  }
): Promise<RedFlagMatch[]> {
  const matches = matchRedFlagKeywords(BUILTIN_RED_FLAGS, params.patientUtterances);

  if (params.modelDanger) {
    const reason = params.modelDangerReason.trim();
    matches.push({ label: reason === '' ? '응급 가능성 있음' : reason, source: 'model' });
  }

  if (matches.length === 0) return [];

  const { error } = await supabase
    .from('encounters')
    .update({ red_flag: true, red_flag_reason: formatRedFlagReason(matches) })
    .eq('id', params.encounterId);

  if (error) {
    throw new Error(
      `Failed to set the red flag on encounter ${params.encounterId}: ${error.message}`
    );
  }

  return matches;
}
