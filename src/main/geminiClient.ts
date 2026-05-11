import axios, { type AxiosInstance } from 'axios';
import { logUsage, type UsageTask } from './sessions.js';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: { task?: UsageTask };
  }
  interface AxiosRequestConfig {
    metadata?: { task?: UsageTask };
  }
}

let cached: AxiosInstance | null = null;

export function getGeminiClient(): AxiosInstance {
  if (cached) return cached;

  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'AIza-REPLACE_ME') {
    throw new Error(
      'GEMINI_API_KEY is missing. Copy .env.example to .env and set a real key.'
    );
  }

  cached = axios.create({
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    timeout: 60_000,
    headers: {
      'x-goog-api-key': key,
      'Content-Type': 'application/json'
    }
  });

  cached.interceptors.response.use((response) => {
    const task = response.config.metadata?.task;
    const url = response.config.url ?? '';
    const m = url.match(/\/models\/([^:/?]+):generateContent/);
    const model = m ? decodeURIComponent(m[1]) : null;
    const usage = (response.data as GeminiTextResponse | undefined)?.usageMetadata;
    if (task && model && usage) {
      void logUsage({
        provider: 'gemini',
        task,
        model,
        prompt_tokens: usage.promptTokenCount,
        output_tokens: usage.candidatesTokenCount,
        total_tokens: usage.totalTokenCount
      });
    }
    return response;
  });

  return cached;
}

export function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    const detail =
      typeof data === 'string'
        ? data
        : data && typeof data === 'object'
          ? JSON.stringify(data)
          : err.message;
    return `Gemini API error${status ? ` (${status})` : ''}: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface GeminiTextResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function extractText(data: GeminiTextResponse): string {
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) return '';
  return parts.map((p) => p.text ?? '').join('');
}
