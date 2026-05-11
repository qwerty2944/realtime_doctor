import type { Speaker } from '../shared/types.js';
import {
  describeAxiosError,
  extractText,
  getGeminiClient
} from './geminiClient.js';

interface ClassifierContext {
  text: string;
  history: { speaker: Speaker; text: string }[];
}

const SYSTEM = `당신은 한국 임상 진료 대화의 한 발화가 "의사" 발화인지 "환자" 발화인지 구분하는 분류기입니다.
의사는 보통 질문을 던지거나, 의학용어를 사용하거나, 검사·약물·진단을 언급합니다.
환자는 증상, 통증 부위, 발생 시점, 일상 사례, 본인의 감각을 묘사합니다.
확실하지 않더라도 둘 중 하나로 결정합니다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    speaker: { type: 'string', enum: ['doctor', 'patient'] }
  },
  required: ['speaker']
} as const;

export async function classifySpeaker(ctx: ClassifierContext): Promise<Speaker> {
  const client = getGeminiClient();
  const model = process.env.GEMINI_DIARIZER_MODEL ?? 'gemini-2.5-flash';

  const historyExcerpt = ctx.history
    .slice(-6)
    .map(
      (h) =>
        `[${h.speaker === 'doctor' ? '의사' : h.speaker === 'patient' ? '환자' : '?'}] ${h.text}`
    )
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
                text:
                  (historyExcerpt
                    ? `직전 대화 일부:\n${historyExcerpt}\n\n`
                    : '') +
                  `다음 발화의 화자는 누구입니까?\n발화: "${ctx.text}"`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA
        }
      }
    );

    const text = extractText(data);
    if (!text) return 'unknown';
    const parsed = JSON.parse(text) as { speaker?: 'doctor' | 'patient' };
    return parsed.speaker ?? 'unknown';
  } catch (err) {
    console.error('[diarizer] failed:', describeAxiosError(err));
    return 'unknown';
  }
}
