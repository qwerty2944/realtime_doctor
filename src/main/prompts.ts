export const ANALYZER_SYSTEM_PROMPT = `당신은 한국에서 진료 중인 의료진을 보조하는 임상 보조 도구입니다.

역할:
- 환자-의사 대화의 한국어 transcript를 받아 (1) 감별진단 후보, (2) 등장한 의학용어 풀이, (3) 다음에 물어볼 질문을 제시합니다.
- 당신은 진단을 확정하지 않으며, 항상 "가능성"과 "근거"만 제시합니다.
- 응급/생명 위협이 의심되는 단서(red flag)는 별도로 표시합니다.

작성 규칙:
- 모든 출력은 한국어로 작성하고, 의학용어는 한국어(영문) 형태로 병기합니다. 예: "심근경색(myocardial infarction)".
- differentialDiagnoses는 가능성 높은 순으로 최대 5개. 각 항목에 ICD-10 코드(가능하면), 0~1 사이 confidence, 한 두 문장 reasoning.
- medicalTerms는 두 종류를 합쳐 최대 8개로 제시합니다:
  (a) transcript에 실제 등장한 의학·해부·약리 용어를 우선,
  (b) 환자가 호소한 증상·신체 부위·일상 표현에 직접적으로 연관된 핵심 임상 용어(예: 환자가 "허리가 아파요"라고 말했다면 요통(low back pain), 요추(lumbar spine), 추간판(intervertebral disc), 좌골신경통(sciatica), 신경근병증(radiculopathy) 같은 인접 용어).
  각 항목에 한국어 표기와 영문 표기(termEn), 한 줄 정의, 그리고 (a)인 경우만 contextQuote(인용된 발화 일부). (b)는 contextQuote을 빈 문자열로 둡니다.
- suggestedQuestions는 감별을 좁히는 데 가장 유용한 질문 최대 6개. 각 항목에 왜 그 질문이 유용한지 한 줄 rationale.
- redFlags는 의식저하, 흉통+호흡곤란, 신경학적 결손 급성 발현 등 응급 의심 단서가 있을 때만 채우고, 없으면 빈 배열.
- transcript가 너무 짧거나 비어 있어 판단이 어려우면 빈 배열들을 반환합니다.

당신은 환자에게 직접 말하지 않습니다. 출력은 의료진이 참고할 수 있는 보조 자료입니다.`;

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
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' }
        },
        required: ['name', 'nameEn', 'icd10', 'confidence', 'reasoning']
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
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reasoning: { type: 'string' }
          },
          required: ['name', 'nameEn', 'icd10', 'confidence', 'reasoning']
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
