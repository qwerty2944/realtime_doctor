import type {
  AnalysisResult,
  DifferentialDiagnosis,
  Speaker,
  TranscriptChunk
} from '../shared/types.js';
import {
  partitionDifferentials,
  sourceRefFor,
  type SourceUtterance
} from '../shared/findings.js';
import {
  describeAxiosError,
  extractText,
  getGeminiClient
} from './geminiClient.js';
import type { InterpretationProvenance } from '../shared/provenance.js';
import {
  ANALYSIS_RESPONSE_SCHEMA,
  ANALYZER_PROMPT_VERSION,
  ANALYZER_SCHEMA_VERSION,
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

/**
 * 모델이 돌려준 원시 응답.
 *
 * `supportingFindings` 는 아직 검증 전이라 `SupportingFinding` 이 아니다 —
 * 그 타입은 검증기만 만들 수 있다.
 */
interface RawAnalysisPayload extends Omit<AnalysisResult, 'updatedAt' | 'differentialDiagnoses'> {
  differentialDiagnoses?: Array<DifferentialDiagnosis & { supportingFindings?: unknown }>;
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

  remove(id: string): void {
    const before = this.chunks.length;
    this.chunks = this.chunks.filter((c) => c.id !== id);
    if (this.chunks.length !== before) this.schedule();
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

  /**
   * 모델에게 줄 transcript 와, 근거 검증에 쓸 발화 목록을 **함께** 만든다.
   *
   * 두 개가 반드시 같은 슬라이스에서 나와야 한다. 예전에는 join 한 문자열의
   * 뒤쪽만 잘라냈는데, 그러면 `[#N]` 접두사가 중간에서 잘리고 번호와 실제
   * 발화가 어긋난다 — 근거가 엉뚱한 발화를 가리키게 된다. 그래서 문자열이
   * 아니라 **발화 단위로** 앞에서부터 버린다.
   */
  private buildTranscript(labels: {
    doctor: string;
    patient: string;
    unknown: string;
  }): { text: string; utterances: SourceUtterance[] } {
    const tagOf = (speaker: Speaker): string =>
      speaker === 'doctor'
        ? labels.doctor
        : speaker === 'patient'
          ? labels.patient
          : labels.unknown;

    // 뒤에서부터 예산만큼만 담고 원래 순서로 되돌린다.
    const shown: StoredChunk[] = [];
    let budget = MAX_TRANSCRIPT_CHARS;
    for (let i = this.chunks.length - 1; i >= 0; i -= 1) {
      const chunk = this.chunks[i];
      const cost = chunk.text.length + tagOf(chunk.speaker).length + 8;
      if (shown.length > 0 && budget - cost < 0) break;
      budget -= cost;
      shown.push(chunk);
    }
    shown.reverse();

    const utterances: SourceUtterance[] = shown.map((c) => ({
      id: c.id,
      text: c.text
    }));
    const text = shown
      .map((c, index) => `[${sourceRefFor(index)} ${tagOf(c.speaker)}] ${c.text}`)
      .join('\n');
    return { text, utterances };
  }

  private async run(): Promise<void> {
    const lang = getLanguage() ?? 'ko';
    const labels = speakerLabels(lang);
    const { text: built, utterances } = this.buildTranscript(labels);
    const transcript = built.trim();
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
      const parsed = JSON.parse(text) as RawAnalysisPayload;
      // [E1] 근거 검증. 모델이 가리킨 발화 번호를 **이번 요청에 실제로 보낸**
      // 발화 목록과 대조한다. 통과하지 못한 진단은 버리지 않고 따로 담는다.
      const { supported, unverified } = partitionDifferentials(
        (parsed.differentialDiagnoses ?? []).map((d) => {
          const { supportingFindings, ...rest } = d;
          return { ...rest, rawFindings: supportingFindings };
        }),
        utterances
      );
      if (unverified.length > 0) {
        console.warn(
          `[analyzer] 근거 미확인 감별진단 ${unverified.length}건:`,
          unverified.map((u) => `${u.diagnosis.name}(${u.reason})`).join(', ')
        );
      }
      // [E3] 실시간 분석도 키오스크 문진과 같은 종류의 산출물이다 — 기계가
      // 내린 판단이지 환자가 말한 사실이 아니다. 같은 모양의 출처를 붙인다.
      // 모델명은 상수가 아니라 이번 호출에 실제로 쓴 값에서 뽑는다.
      const provenance: InterpretationProvenance = {
        engine: 'desktop-live-analysis',
        provider: 'gemini',
        model,
        promptVersion: ANALYZER_PROMPT_VERSION,
        schemaVersion: ANALYZER_SCHEMA_VERSION,
        generatedAt: new Date().toISOString()
      };
      const result: AnalysisResult = {
        ...parsed,
        differentialDiagnoses: supported,
        unverifiedDiagnoses: unverified,
        provenance,
        updatedAt: Date.now()
      };
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
