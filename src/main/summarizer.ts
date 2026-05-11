import type { Speaker, SummaryResult } from '../shared/types.js';
import {
  describeAxiosError,
  extractText,
  getGeminiClient
} from './geminiClient.js';

const SYSTEM = `당신은 한국 임상 의료진을 위한 진료 대화 요약 도우미입니다.
[의사]/[환자] 라벨이 달린 transcript를 받아, 요청한 JSON 스키마에 맞게 임상 진료기록 형태로 요약합니다.

규칙:
- 한국어로 작성하고 의학용어는 한국어(영문) 형태로 병기합니다.
- 각 필드는 한 줄~짧은 단락 정도로 간결하게.
- transcript에 명시되지 않은 사실은 추정하지 말고, 해당 필드는 "(언급 없음)"으로 채웁니다.
- 진단을 확정하는 어조는 피하고, 임상 인상(impression)은 "가능성"으로 표현합니다.
- 환자에게 직접 말하는 어조 대신 의무기록 톤(서술형, 객관적)으로 작성합니다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    chiefComplaint: { type: 'string' },
    historyOfPresentIllness: { type: 'string' },
    pertinentFindings: { type: 'string' },
    investigationsMentioned: { type: 'string' },
    clinicalImpression: { type: 'string' },
    plan: { type: 'string' }
  },
  required: [
    'chiefComplaint',
    'historyOfPresentIllness',
    'pertinentFindings',
    'investigationsMentioned',
    'clinicalImpression',
    'plan'
  ]
} as const;

export async function summarizeConversation(
  history: { speaker: Speaker; text: string }[]
): Promise<SummaryResult> {
  if (history.length === 0) {
    throw new Error('요약할 대화가 아직 없습니다.');
  }

  const client = getGeminiClient();
  const model =
    process.env.GEMINI_SUMMARIZER_MODEL ??
    process.env.GEMINI_ANALYZER_MODEL ??
    'gemini-2.5-flash';

  const transcript = history
    .map((h) => {
      const tag =
        h.speaker === 'doctor'
          ? '의사'
          : h.speaker === 'patient'
            ? '환자'
            : '?';
      return `[${tag}] ${h.text}`;
    })
    .join('\n');

  try {
    const { data } = await client.post(
      `/models/${encodeURIComponent(model)}:generateContent`,
      {
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `다음 진료 대화를 요청한 스키마대로 요약해 주세요.\n\n---\n${transcript}\n---`
              }
            ]
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
    if (!text) throw new Error('Summarizer returned no content');
    const parsed = JSON.parse(text) as Omit<SummaryResult, 'generatedAt'>;
    return { ...parsed, generatedAt: Date.now() };
  } catch (err) {
    throw new Error(describeAxiosError(err));
  }
}
