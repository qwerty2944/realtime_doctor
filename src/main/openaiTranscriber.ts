import { describeOpenAIError, getOpenAIClient } from './openaiClient.js';

const PROMPT =
  '한국 의료 진료 대화. 들리는 그대로 한국어/영어 원어 그대로. 음차·병기·의역 금지. 숫자 단위는 아라비아 숫자.';

export async function transcribeWithOpenAI(base64Wav: string): Promise<string> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe';

  try {
    const buf = Buffer.from(base64Wav, 'base64');
    const blob = new Blob([buf], { type: 'audio/wav' });
    const form = new FormData();
    form.append('file', blob, 'audio.wav');
    form.append('model', model);
    form.append('language', 'ko');
    form.append('prompt', PROMPT);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const { data } = await client.post('/audio/transcriptions', form);
    const text = typeof data?.text === 'string' ? data.text : '';
    return text.trim();
  } catch (err) {
    throw new Error(describeOpenAIError(err));
  }
}
