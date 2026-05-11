import type {
  DictationResult,
  DictationTemplate,
  Speaker
} from '../shared/types.js';
import {
  describeAxiosError,
  extractText,
  getGeminiClient
} from './geminiClient.js';

const SYSTEM = `당신은 한국 임상 의사를 위한 EMR 딕테이션 보조 도구입니다.
의사 1인칭 의무기록 톤(서술형, 과거형, 객관적)으로 prose를 작성합니다.
규칙:
- transcript에 명시된 사실만 사용. 추정·창작 금지.
- 의학용어는 한국어 표기 뒤 영문 병기. 예: "심전도(ECG)", "혈압(BP) 150/95".
- 환자에게 직접 말하는 어조 X. 진단을 단정하지 않고 "가능성"으로 표현.
- 비어 있는 섹션은 본문을 정확히 "(언급 없음)"으로 채웁니다.
- 한 섹션은 1~5문장의 자연스러운 문단으로 작성합니다(불릿 X, 줄바꿈 최소).
- 화자 라벨([의사]/[환자])은 출력에 포함하지 않습니다.`;

interface TemplateSpec {
  name: string;
  sections: { heading: string; guidance: string }[];
  narrative?: boolean;
}

const TEMPLATES: Record<DictationTemplate, TemplateSpec> = {
  soap: {
    name: 'SOAP',
    sections: [
      {
        heading: 'S — Subjective',
        guidance:
          '환자의 호소·증상·증상 발생 시점·악화·완화 인자·관련 과거력/사회력을 환자 진술 기반으로 서술.'
      },
      {
        heading: 'O — Objective',
        guidance:
          '활력징후, 신체검진 소견, 언급된 검사 결과(랩·영상·심전도 등)를 객관적 사실 위주로 서술.'
      },
      {
        heading: 'A — Assessment',
        guidance:
          '가장 가능성 높은 임상 인상과 감별진단(가능성 순). 단정 X, "~가능성" 표현 사용.'
      },
      {
        heading: 'P — Plan',
        guidance:
          '추가 검사, 처방, 처치, 환자 교육, 추적 일정 등 계획. 언급된 항목만 기록.'
      }
    ]
  },
  apso: {
    name: 'APSO',
    sections: [
      {
        heading: 'A — Assessment',
        guidance: 'SOAP의 Assessment와 동일.'
      },
      { heading: 'P — Plan', guidance: 'SOAP의 Plan과 동일.' },
      { heading: 'S — Subjective', guidance: 'SOAP의 Subjective와 동일.' },
      { heading: 'O — Objective', guidance: 'SOAP의 Objective와 동일.' }
    ]
  },
  hp: {
    name: 'H&P (History & Physical)',
    sections: [
      { heading: 'CC — 주호소', guidance: '입원·내원 사유 한 줄.' },
      {
        heading: 'HPI — 현병력',
        guidance:
          '증상 발생 시점·양상·동반증상·악화/완화 인자·시간 경과를 서술적으로.'
      },
      {
        heading: 'PMH — 과거력',
        guidance: '기저질환, 수술력, 입원력, 알려진 질환.'
      },
      { heading: 'Meds — 복용약', guidance: '복용 중인 약물 목록(언급된 것만).' },
      { heading: 'Allergies — 알레르기', guidance: '약물·음식 알레르기 이력.' },
      {
        heading: 'FH/SH — 가족력·사회력',
        guidance: '가족력, 흡연·음주·직업·생활습관.'
      },
      {
        heading: 'ROS — 계통 문진',
        guidance: '주요 계통(심혈관, 호흡기, 위장관 등)의 양성·음성 소견.'
      },
      {
        heading: 'PE — 신체검진',
        guidance: '활력징후 + 계통별 신체검진 소견.'
      },
      {
        heading: 'Labs/Imaging — 검사 결과',
        guidance: '언급된 랩·영상·기능검사 결과.'
      },
      {
        heading: 'A/P — 임상 인상 및 계획',
        guidance: '문제별 인상과 계획을 통합 서술.'
      }
    ]
  },
  narrative: {
    name: 'Narrative',
    narrative: true,
    sections: [
      {
        heading: '진료 기록',
        guidance:
          '섹션 분리 없이 단일 prose 문단으로, 환자 인적사항 → 호소 → 검사·소견 → 임상 인상 → 계획을 자연스럽게 이어서 작성.'
      }
    ]
  }
};

const SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['heading', 'body']
      }
    }
  },
  required: ['sections']
} as const;

export async function generateDictation(
  history: { speaker: Speaker; text: string }[],
  template: DictationTemplate
): Promise<DictationResult> {
  if (history.length === 0) {
    throw new Error('정리할 대화가 아직 없습니다.');
  }

  const spec = TEMPLATES[template];
  const client = getGeminiClient();
  const model =
    process.env.GEMINI_DICTATOR_MODEL ??
    process.env.GEMINI_ANALYZER_MODEL ??
    'gemini-2.5-flash';

  const transcript = history
    .map((h) => {
      const tag =
        h.speaker === 'doctor' ? '의사' : h.speaker === 'patient' ? '환자' : '?';
      return `[${tag}] ${h.text}`;
    })
    .join('\n');

  const sectionsList = spec.sections
    .map((s, i) => `${i + 1}. ${s.heading}\n   가이드: ${s.guidance}`)
    .join('\n');

  const userMessage = `다음 진료 대화를 ${spec.name} 템플릿의 의무기록 prose로 정리합니다.

[지정된 섹션 — 이 순서대로, 이 헤딩 그대로 사용하세요]
${sectionsList}

[화자 라벨된 누적 transcript]
---
${transcript}
---

JSON 스키마에 맞춰 sections를 반환하세요. heading은 위에 명시된 그대로 복사하고, body는 의무기록 톤 prose로 작성합니다.${
    spec.narrative
      ? ' 이 템플릿은 단일 narrative이므로 sections는 1개만 반환합니다.'
      : ''
  }`;

  try {
    const { data } = await client.post(
      `/models/${encodeURIComponent(model)}:generateContent`,
      {
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: userMessage }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA
        }
      }
    );

    const text = extractText(data);
    if (!text) throw new Error('Dictator returned no content');

    const parsed = JSON.parse(text) as { sections: DictationResult['sections'] };
    return {
      template,
      sections: parsed.sections,
      generatedAt: Date.now()
    };
  } catch (err) {
    throw new Error(describeAxiosError(err));
  }
}
