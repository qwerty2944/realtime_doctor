import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AnalysisResult,
  DictationResult,
  SessionSummary,
  Speaker,
  SummaryResult,
  TranscriptChunk
} from '../shared/types.js';
import { getLocalSave } from './store.js';

/**
 * 세션 로컬 저장.
 *
 * 클라우드 동기화와 독립적으로, 세션 전체(메타 + 전사 청크 + 분석/요약/
 * 받아쓰기)를 `userData/sessions/<id>.json` 한 파일로 저장한다. 오디오는
 * localSave.saveAudio 가 켜진 경우 `<id>.wav` 로 같은 폴더에 저장.
 *
 * 쓰기는 세션 단위 직렬화(promise chain)로 동시 쓰기 충돌을 막고, 메모리에
 * 현재 세션 객체를 캐시해 매 변경마다 전체 JSON 을 다시 쓴다 (세션 JSON 은
 * 수십 KB 수준이라 비용 미미).
 */

export interface LocalSessionFile {
  id: string;
  started_at: string;
  ended_at: string | null;
  transcribe_provider: string | null;
  chunks: Array<{
    chunk_id: string;
    speaker: Speaker;
    text: string;
    timestamp_ms: number;
  }>;
  analysis: AnalysisResult | null;
  summaries: SummaryResult[];
  dictations: DictationResult[];
  updated_at: string;
}

function dir(): string {
  const d = join(app.getPath('userData'), 'sessions');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function fileOf(id: string): string {
  return join(dir(), `${id}.json`);
}

function audioFileOf(id: string): string {
  return join(dir(), `${id}.wav`);
}

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[localSessions:${scope}]`, msg);
}

/** 세션별 쓰기 직렬화 큐. */
const writeQueues = new Map<string, Promise<void>>();
/** 현재(쓰는 중인) 세션 캐시 — 디스크 재읽기 없이 변경 누적. */
const cache = new Map<string, LocalSessionFile>();

function enqueue(id: string, work: () => Promise<void>): void {
  const prev = writeQueues.get(id) ?? Promise.resolve();
  const next = prev.then(work).catch((err) => warn('write', err));
  writeQueues.set(id, next);
}

async function flush(id: string): Promise<void> {
  const data = cache.get(id);
  if (!data) return;
  data.updated_at = new Date().toISOString();
  await writeFile(fileOf(id), JSON.stringify(data, null, 1), 'utf8');
}

async function getOrLoad(id: string): Promise<LocalSessionFile | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    const raw = await readFile(fileOf(id), 'utf8');
    const parsed = JSON.parse(raw) as LocalSessionFile;
    cache.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function localSessionEnabled(): boolean {
  return getLocalSave().enabled;
}

/** 새 세션 파일 생성 (이미 있으면 no-op). */
export function localCreateSession(id: string, provider: string | null): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    if (cache.has(id) || existsSync(fileOf(id))) {
      // 기존 세션 이어쓰기 (loadSession 후 추가 발화 등).
      if (!cache.has(id)) await getOrLoad(id);
      return;
    }
    cache.set(id, {
      id,
      started_at: new Date().toISOString(),
      ended_at: null,
      transcribe_provider: provider,
      chunks: [],
      analysis: null,
      summaries: [],
      dictations: [],
      updated_at: new Date().toISOString()
    });
    await flush(id);
  });
}

export function localAppendChunk(
  id: string,
  chunk: TranscriptChunk & { speaker: Speaker }
): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    s.chunks.push({
      chunk_id: chunk.id,
      speaker: chunk.speaker,
      text: chunk.text,
      timestamp_ms: chunk.timestamp
    });
    await flush(id);
  });
}

export function localRelabelChunk(
  id: string,
  chunkId: string,
  speaker: Speaker
): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    const c = s.chunks.find((x) => x.chunk_id === chunkId);
    if (!c) return;
    c.speaker = speaker;
    await flush(id);
  });
}

export function localRemoveChunk(id: string, chunkId: string): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    const before = s.chunks.length;
    s.chunks = s.chunks.filter((x) => x.chunk_id !== chunkId);
    if (s.chunks.length !== before) await flush(id);
  });
}

export function localUpsertAnalysis(id: string, analysis: AnalysisResult): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    s.analysis = analysis;
    await flush(id);
  });
}

export function localAppendSummary(id: string, summary: SummaryResult): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    s.summaries.push(summary);
    await flush(id);
  });
}

export function localAppendDictation(id: string, dictation: DictationResult): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    s.dictations.push(dictation);
    await flush(id);
  });
}

export function localEndSession(id: string): void {
  if (!localSessionEnabled()) return;
  enqueue(id, async () => {
    const s = await getOrLoad(id);
    if (!s) return;
    if (!s.ended_at) s.ended_at = new Date().toISOString();
    await flush(id);
    cache.delete(id);
    writeQueues.delete(id);
  });
}

/** 스트림 세션 오디오 WAV 로컬 저장 (localSave.saveAudio 게이트). */
export async function localSaveSessionAudio(
  id: string,
  wavBuffer: Buffer
): Promise<void> {
  if (!localSessionEnabled() || !getLocalSave().saveAudio) return;
  if (!wavBuffer || wavBuffer.length <= 44) return;
  try {
    await writeFile(audioFileOf(id), wavBuffer);
  } catch (err) {
    warn('saveAudio', err);
  }
}

export async function listLocalSessions(): Promise<SessionSummary[]> {
  try {
    const files = (await readdir(dir())).filter((f) => f.endsWith('.json'));
    const out: SessionSummary[] = [];
    for (const f of files) {
      try {
        const raw = await readFile(join(dir(), f), 'utf8');
        const s = JSON.parse(raw) as LocalSessionFile;
        if (!s?.id) continue;
        out.push({
          id: s.id,
          started_at: s.started_at,
          ended_at: s.ended_at,
          transcribe_provider: s.transcribe_provider,
          chunk_count: s.chunks?.length ?? 0,
          preview: s.chunks?.[0]?.text?.slice(0, 60) ?? '',
          source: 'local'
        });
      } catch {
        // 깨진 파일은 목록에서 무시
      }
    }
    out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return out;
  } catch (err) {
    warn('list', err);
    return [];
  }
}

export async function loadLocalSession(id: string): Promise<LocalSessionFile | null> {
  return getOrLoad(id);
}

export async function deleteLocalSession(id: string): Promise<void> {
  cache.delete(id);
  writeQueues.delete(id);
  try {
    await rm(fileOf(id), { force: true });
    await rm(audioFileOf(id), { force: true });
  } catch (err) {
    warn('delete', err);
  }
}
