import type { EphemeralSession } from '../shared/types.js';
import { describeOpenAIError, getOpenAIClient } from './openaiClient.js';
import { getLanguage } from './store.js';

const PROMPT_KO =
  '한국 의료 진료 대화를 들리는 그대로 충실히 받아 적습니다. 한국어로 말한 부분은 한국어, 영어로 말한 부분(MRI, BP, amoxicillin 등)은 그 영어 그대로. 음차/병기/의역 금지. 숫자와 단위는 아라비아 숫자로.';

const PROMPT_EN =
  'Transcribe a clinical encounter. The output MUST be in English only, using Latin characters. If the speaker uses Korean or any non-English language, render the closest English equivalent — never emit Hangul or other non-Latin scripts. Keep medical terms (e.g. MRI, BP, amoxicillin) exactly as spoken. Do not translate doses or numeric values. Write numbers and units as Arabic numerals.';

export async function mintOpenAIRealtimeSession(): Promise<EphemeralSession> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe';
  const lang = getLanguage() ?? 'ko';
  const prompt = lang === 'en' ? PROMPT_EN : PROMPT_KO;

  try {
    const { data } = await client.post(
      '/realtime/client_secrets',
      {
        session: {
          type: 'transcription',
          audio: {
            input: {
              transcription: {
                model,
                language: lang,
                prompt
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
              }
            }
          }
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!data?.value) {
      throw new Error(
        'Realtime client_secret response missing value: ' + JSON.stringify(data)
      );
    }

    return {
      client_secret: { value: data.value, expires_at: data.expires_at },
      model
    };
  } catch (err) {
    throw new Error(describeOpenAIError(err));
  }
}
