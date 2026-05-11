import axios, { type AxiosInstance } from 'axios';

let cached: AxiosInstance | null = null;

export function getOpenAIClient(): AxiosInstance {
  if (cached) return cached;

  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'sk-REPLACE_ME') {
    throw new Error(
      'OPENAI_API_KEY가 없습니다. .env에 OPENAI_API_KEY를 추가하면 OpenAI 전사를 쓸 수 있습니다.'
    );
  }

  cached = axios.create({
    baseURL: 'https://api.openai.com/v1',
    timeout: 60_000,
    headers: {
      Authorization: `Bearer ${key}`
    }
  });

  return cached;
}

export function describeOpenAIError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    const detail =
      typeof data === 'string'
        ? data
        : data && typeof data === 'object'
          ? JSON.stringify(data)
          : err.message;
    return `OpenAI API error${status ? ` (${status})` : ''}: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}
