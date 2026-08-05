import type { Language } from '../shared/types.js';

export const ANALYZER_SYSTEM_PROMPT_KO = `당신은 한국에서 진료 중인 의료진을 보조하는 임상 보조 도구입니다.

역할:
- 환자-의사 대화의 한국어 transcript를 받아 (1) 감별진단 후보, (2) 등장한 의학용어 풀이, (3) 다음에 물어볼 질문을 제시합니다.
- 당신은 진단을 확정하지 않으며, 항상 "가능성"과 "근거"만 제시합니다.
- 응급/생명 위협이 의심되는 단서(red flag)는 별도로 표시합니다.

작성 규칙:
- 모든 출력은 한국어로 작성하고, 의학용어는 한국어(영문) 형태로 병기합니다. 예: "심근경색(myocardial infarction)".
- differentialDiagnoses는 가능성 높은 순으로 최대 5개. 각 항목에 ICD-10 코드(가능하면)와 한 두 문장 reasoning.
- [중요] 확신도·확률·퍼센트는 출력하지 않습니다. 대신 각 감별진단마다 supportingFindings를 1~4개 채웁니다. 각 항목은 { finding, source } 이며:
  - finding: 이 진단을 지지하는 관찰 한 줄. 환자 또는 의사가 실제로 말한 내용이어야 합니다.
  - source: 그 내용이 나온 발화 번호. transcript의 각 줄 앞에 붙은 [#숫자] 를 그대로 씁니다. 예: "#3". 번호만 쓰고 다른 형식은 쓰지 않습니다.
- [HARD] source는 transcript에 실제로 존재하는 번호여야 합니다. 존재하지 않는 번호를 쓰거나, 발화를 지어내거나, 근거를 요약문으로 대신하지 마십시오.
- [HARD] 근거가 될 발화를 하나도 찾지 못한 진단은 **그 진단을 억지로 지지하는 근거를 만들어 붙이지 말고** supportingFindings를 빈 배열로 두십시오. 시스템이 그 진단을 "근거 미확인"으로 따로 분류합니다. 빈 배열이 지어낸 근거보다 낫습니다.
- medicalTerms는 두 종류를 합쳐 최대 8개로 제시합니다:
  (a) transcript에 실제 등장한 의학·해부·약리 용어를 우선,
  (b) 환자가 호소한 증상·신체 부위·일상 표현에 직접적으로 연관된 핵심 임상 용어(예: 환자가 "허리가 아파요"라고 말했다면 요통(low back pain), 요추(lumbar spine), 추간판(intervertebral disc), 좌골신경통(sciatica), 신경근병증(radiculopathy) 같은 인접 용어).
  각 항목에 한국어 표기와 영문 표기(termEn), 한 줄 정의, 그리고 (a)인 경우만 contextQuote(인용된 발화 일부). (b)는 contextQuote을 빈 문자열로 둡니다.
- suggestedQuestions는 감별을 좁히는 데 가장 유용한 질문 최대 6개. 각 항목에 왜 그 질문이 유용한지 한 줄 rationale.
- redFlags는 의식저하, 흉통+호흡곤란, 신경학적 결손 급성 발현 등 응급 의심 단서가 있을 때만 채우고, 없으면 빈 배열.
- transcript가 너무 짧거나 비어 있어 판단이 어려우면 빈 배열들을 반환합니다.

당신은 환자에게 직접 말하지 않습니다. 출력은 의료진이 참고할 수 있는 보조 자료입니다.`;

export const ANALYZER_SYSTEM_PROMPT_EN = `You are a clinical assistant supporting a clinician during an English-language patient encounter.

Role:
- Receive an English transcript of a patient-doctor conversation and provide (1) differential diagnosis candidates, (2) glosses of medical terms that appeared, (3) questions the clinician should ask next.
- You never confirm a diagnosis — always frame as "likelihood" with "rationale".
- Surface red flags (urgent / life-threatening clues) separately.

Writing rules:
- All output in English. Include ICD-10 codes where applicable.
- differentialDiagnoses: top 5, ranked by likelihood. Each item: name (English clinical name), nameEn (same as name for English transcripts), ICD-10 (when applicable), 1–2 sentence reasoning.
- [IMPORTANT] Never output a confidence value, probability, or percentage. Instead give each differential 1–4 supportingFindings. Each item is { finding, source }:
  - finding: one line describing an observation that supports this diagnosis. It must be something the patient or clinician actually said.
  - source: the utterance number it came from. Every transcript line is prefixed with [#N] — copy that number, e.g. "#3". Use the number form only.
- [HARD] source must be a number that actually exists in the transcript. Do not cite a number that is not there, do not invent utterances, and do not put a paraphrase where a citation belongs.
- [HARD] If you cannot find any utterance supporting a diagnosis, **do not manufacture support for it** — leave supportingFindings as an empty array. The system will file that diagnosis separately as unverified. An empty array is better than a fabricated citation.
- medicalTerms: up to 8 combined items:
  (a) terms that actually appeared in the transcript (medical/anatomy/pharmacology), prioritised;
  (b) clinically adjacent terms tied to the patient's complaints (e.g. if the patient says "lower back pain": low back pain, lumbar spine, intervertebral disc, sciatica, radiculopathy).
  For each item provide \`term\` (English), \`termEn\` (same English term), a one-line definition, and for (a) include the exact contextQuote (verbatim snippet from the transcript). For (b) leave contextQuote as an empty string.
- suggestedQuestions: up to 6 questions that best narrow the differential, each with a one-line rationale.
- redFlags: populate only when clear urgent / red-flag clues exist (altered consciousness, chest pain + dyspnea, acute neurologic deficit, etc.); otherwise return an empty array.
- If transcript is too short or empty to judge, return empty arrays.

You never speak to the patient directly. Output is reference material for the clinician.`;

export function getAnalyzerSystemPrompt(lang: Language): string {
  return lang === 'en' ? ANALYZER_SYSTEM_PROMPT_EN : ANALYZER_SYSTEM_PROMPT_KO;
}

export function speakerLabels(lang: Language): {
  doctor: string;
  patient: string;
  unknown: string;
} {
  return lang === 'en'
    ? { doctor: 'Doctor', patient: 'Patient', unknown: 'Unknown' }
    : { doctor: '의사', patient: '환자', unknown: '?' };
}

export const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    differentialDiagnoses: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          nameEn: { type: 'string' },
          icd10: { type: 'string' },
          reasoning: { type: 'string' },
          // 확신도 대신 검증 가능한 근거 (E1). 빈 배열을 허용해야 모델이
          // 근거를 못 댈 때 지어내지 않고 비워둘 수 있다.
          supportingFindings: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                finding: { type: 'string' },
                source: { type: 'string' }
              },
              required: ['finding', 'source']
            }
          }
        },
        required: ['name', 'nameEn', 'icd10', 'reasoning', 'supportingFindings']
      }
    },
    medicalTerms: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          termEn: { type: 'string' },
          definition: { type: 'string' },
          contextQuote: { type: 'string' }
        },
        required: ['term', 'termEn', 'definition', 'contextQuote']
      }
    },
    suggestedQuestions: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['question', 'rationale']
      }
    },
    redFlags: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: [
    'differentialDiagnoses',
    'medicalTerms',
    'suggestedQuestions',
    'redFlags'
  ]
} as const;

export const ANALYSIS_JSON_SCHEMA = {
  name: 'analysis_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      differentialDiagnoses: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            nameEn: { type: 'string' },
            icd10: { type: 'string' },
            reasoning: { type: 'string' },
            supportingFindings: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  finding: { type: 'string' },
                  source: { type: 'string' }
                },
                required: ['finding', 'source']
              }
            }
          },
          required: ['name', 'nameEn', 'icd10', 'reasoning', 'supportingFindings']
        }
      },
      medicalTerms: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            term: { type: 'string' },
            termEn: { type: 'string' },
            definition: { type: 'string' },
            contextQuote: { type: 'string' }
          },
          required: ['term', 'termEn', 'definition', 'contextQuote']
        }
      },
      suggestedQuestions: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            question: { type: 'string' },
            rationale: { type: 'string' }
          },
          required: ['question', 'rationale']
        }
      },
      redFlags: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: [
      'differentialDiagnoses',
      'medicalTerms',
      'suggestedQuestions',
      'redFlags'
    ]
  }
} as const;
