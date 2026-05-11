import {
  describeAxiosError,
  extractText,
  getGeminiClient
} from './geminiClient.js';

const PROMPT = `당신은 한국 의료 진료 대화의 음성을 받아 적는 전사기입니다.
규칙:
- 들리는 그대로 충실하게 전사합니다.
- 한국어로 말한 부분은 한국어, 영어로 말한 부분(MRI, BP, amoxicillin 등)은 그 영어 그대로 적습니다.
- 음차하지 말고, 영문 병기도 하지 말고, 의역도 하지 않습니다.
- 숫자와 단위는 아라비아 숫자로 적습니다.
- 텍스트만 출력합니다. 따옴표나 메타 설명 없이 발화 내용만.
- 음성이 거의 없거나 침묵이면 빈 문자열을 출력합니다.`;

export async function transcribeWithGemini(base64Wav: string): Promise<string> {
  const client = getGeminiClient();
  const model = process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-2.5-flash';

  try {
    const { data } = await client.post(
      `/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: PROMPT },
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: base64Wav
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0
        }
      },
      { metadata: { task: 'transcribe' } }
    );

    return extractText(data).trim();
  } catch (err) {
    throw new Error(describeAxiosError(err));
  }
}
