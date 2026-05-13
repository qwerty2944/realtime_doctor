import type {
  AnalysisResult,
  Speaker,
  TranscriptChunk
} from '../shared/types.js';
import {
  describeAxiosError,
  extractText,
  getGeminiClient
} from './geminiClient.js';
import {
  ANALYSIS_RESPONSE_SCHEMA,
  getAnalyzerSystemPrompt,
  speakerLabels
} from './prompts.js';
import { getLanguage } from './store.js';

const DEBOUNCE_MS = 2500;
// Cap total wait so continuous chunks (each <DEBOUNCE_MS apart) don't starve
// the analyzer. After this much time has elapsed since the first chunk in
// this batch, fire immediately even if more chunks keep arriving.
const MAX_WAIT_MS = 12_000;
const MAX_TRANSCRIPT_CHARS = 18_000;

type Listener = (result: AnalysisResult) => void;

interface StoredChunk extends TranscriptChunk {
  speaker: Speaker;
}

class Analyzer {
  private chunks: StoredChunk[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inflight: AbortController | null = null;
  private listeners = new Set<Listener>();
  private firstChunkSinceRunAt = 0;

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(chunk: TranscriptChunk): void {
    this.chunks.push({ ...chunk, speaker: chunk.speaker ?? 'unknown' });
    if (this.firstChunkSinceRunAt === 0) this.firstChunkSinceRunAt = Date.now();
    this.schedule();
  }

  relabel(id: string, speaker: Speaker): void {
    const target = this.chunks.find((c) => c.id === id);
    if (!target) return;
    target.speaker = speaker;
    this.schedule();
  }

  history(): { id: string; speaker: Speaker; text: string }[] {
    return this.chunks.map((c) => ({
      id: c.id,
      speaker: c.speaker,
      text: c.text
    }));
  }

  reset(): void {
    this.chunks = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inflight) this.inflight.abort();
    this.inflight = null;
    this.firstChunkSinceRunAt = 0;
  }

  runNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.run();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const remainingMaxWait = this.firstChunkSinceRunAt
      ? Math.max(0, MAX_WAIT_MS - (Date.now() - this.firstChunkSinceRunAt))
      : DEBOUNCE_MS;
    const delay = Math.min(DEBOUNCE_MS, remainingMaxWait);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private buildTranscript(labels: { doctor: string; patient: string; unknown: string }): string {
    const lines = this.chunks.map((c) => {
      const tag =
        c.speaker === 'doctor'
          ? labels.doctor
          : c.speaker === 'patient'
            ? labels.patient
            : labels.unknown;
      return `[${tag}] ${c.text}`;
    });
    let text = lines.join('\n');
    if (text.length > MAX_TRANSCRIPT_CHARS) {
      text = text.slice(text.length - MAX_TRANSCRIPT_CHARS);
    }
    return text;
  }

  private async run(): Promise<void> {
    const lang = getLanguage() ?? 'ko';
    const labels = speakerLabels(lang);
    const transcript = this.buildTranscript(labels).trim();
    if (!transcript) return;

    if (this.inflight) this.inflight.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;

    try {
      const client = getGeminiClient();
      const model = process.env.GEMINI_ANALYZER_MODEL ?? 'gemini-2.5-flash';

      const userMessage =
        lang === 'en'
          ? `Below is the accumulating transcript of an ongoing patient encounter. [${labels.doctor}] / [${labels.patient}] tags mark the speaker.\n\n---\n${transcript}\n---\n\nReturn the analysis matching the requested JSON schema.`
          : `다음은 진행 중인 진료 대화의 누적 transcript입니다. [${labels.doctor}]/[${labels.patient}] 라벨이 화자 구분입니다.\n\n---\n${transcript}\n---\n\n요청한 JSON 스키마에 맞게 분석을 반환하세요.`;

      const { data } = await client.post(
        `/models/${encodeURIComponent(model)}:generateContent`,
        {
          system_instruction: { parts: [{ text: getAnalyzerSystemPrompt(lang) }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: userMessage }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: ANALYSIS_RESPONSE_SCHEMA
          }
        },
        { signal: ctrl.signal, metadata: { task: 'analyze' } }
      );

      const text = extractText(data);
      if (!text) throw new Error('Analyzer returned no content');
      const parsed = JSON.parse(text) as Omit<AnalysisResult, 'updatedAt'>;
      const result: AnalysisResult = { ...parsed, updatedAt: Date.now() };
      this.firstChunkSinceRunAt = 0;
      for (const listener of this.listeners) listener(result);
    } catch (err) {
      if (axiosAborted(err)) return;
      console.error('[analyzer] failed:', describeAxiosError(err));
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }
}

function axiosAborted(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_CANCELED' || code === 'ABORT_ERR') return true;
  }
  return err instanceof Error && err.name === 'AbortError';
}

export const analyzer = new Analyzer();
