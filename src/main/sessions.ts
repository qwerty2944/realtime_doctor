import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  AnalysisResult,
  DictationResult,
  SessionSummary,
  Speaker,
  SummaryResult,
  TranscriptChunk
} from '../shared/types.js';
import { getCurrentUser } from './auth.js';
import {
  listLocalSessions,
  loadLocalSession,
  localAppendChunk,
  localAppendDictation,
  localAppendSummary,
  localCreateSession,
  localEndSession,
  localRelabelChunk,
  localRemoveChunk,
  localSaveSessionAudio,
  localSessionEnabled,
  localUpsertAnalysis
} from './localSessions.js';
import { getCloudSync, getTranscribeProvider } from './store.js';
import { getSupabase } from './supabaseClient.js';

export type UsageProvider =
  | 'gemini'
  | 'openai-realtime'
  | 'clova-csr'
  | 'clova-stream';

export type UsageTask =
  | 'transcribe'
  | 'diarize'
  | 'analyze'
  | 'summarize'
  | 'dictate'
  | 'realtime-session';

export interface UsageEventInput {
  provider: UsageProvider;
  task: UsageTask;
  model: string;
  prompt_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  chars?: number;
  duration_ms?: number;
}

let currentSessionId: string | null = null;
/** 클라우드 sessions row 생성/확인 promise. null 이면 아직 시도 전. */
let cloudReady: Promise<boolean> | null = null;
/**
 * 현재 녹취를 붙일 진료(encounter) id.
 *
 * 환자를 선택한 채로 녹음을 시작하면 그 녹취는 그 진료의 기록이다 — 선택을
 * 자동 해제하지 않고 `sessions.encounter_id` 로 연결한다.
 */
let sessionEncounterId: string | null = null;

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[sessions:${scope}]`, msg);
}

function canPersist(): boolean {
  if (!getCloudSync().enabled) return false;
  if (!getCurrentUser()) return false;
  if (!getSupabase()) return false;
  return true;
}

/**
 * 세션 ID 는 로컬에서 생성한다 (uuid). 로컬 파일과 클라우드 row 가 같은 ID 를
 * 공유해 목록 병합/동기화가 단순해진다. 로컬 저장과 클라우드 저장 둘 다
 * 꺼져 있으면 세션을 만들지 않는다.
 */
function ensureSessionId(): string | null {
  if (currentSessionId) return currentSessionId;
  if (!localSessionEnabled() && !canPersist()) return null;
  currentSessionId = randomUUID();
  cloudReady = null;
  localCreateSession(currentSessionId, getTranscribeProvider());
  return currentSessionId;
}

/** 클라우드 sessions row 보장 (ignoreDuplicates upsert — 기존 row 는 불변). */
async function ensureCloudSession(): Promise<string | null> {
  const id = ensureSessionId();
  if (!id || !canPersist()) return null;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return null;
  if (!cloudReady) {
    cloudReady = (async () => {
      try {
        const { error } = await supabase.from('sessions').upsert(
          {
            id,
            user_id: user.id,
            transcribe_provider: getTranscribeProvider(),
            encounter_id: sessionEncounterId
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
        if (error) {
          warn('ensureCloudSession', error.message);
          return false;
        }
        return true;
      } catch (err) {
        warn('ensureCloudSession', err);
        return false;
      }
    })();
  }
  const ok = await cloudReady;
  if (!ok) cloudReady = null; // 다음 저장 때 재시도
  return ok ? id : null;
}

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
  cloudReady = null;
}

/**
 * 녹취-진료 연결. 환자 선택/해제 때 호출한다.
 *
 * 이미 만들어진 세션 row 가 있으면 그 row 도 즉시 갱신한다 (upsert 는
 * ignoreDuplicates 라 기존 row 를 건드리지 않으므로 여기서 따로 update).
 * 실패해도 녹취 자체는 계속돼야 하므로 경고만 남긴다.
 */
export function linkSessionToEncounter(encounterId: string | null): void {
  sessionEncounterId = encounterId;
  const id = currentSessionId;
  if (!id || !canPersist()) return;
  const supabase = getSupabase();
  const user = getCurrentUser();
  if (!supabase || !user) return;
  void (async () => {
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ encounter_id: encounterId })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) warn('linkSessionToEncounter', error.message);
    } catch (err) {
      warn('linkSessionToEncounter', err);
    }
  })();
}

export interface LoadedSession {
  session: {
    id: string;
    started_at: string;
    ended_at: string | null;
    transcribe_provider: string | null;
  };
  chunks: Array<{
    chunk_id: string;
    speaker: Speaker;
    text: string;
    timestamp_ms: number;
  }>;
  analysis: AnalysisResult | null;
  latestSummary: SummaryResult | null;
  latestDictation: DictationResult | null;
}

export type SessionSummaryRow = SessionSummary;

/** 로컬 + 클라우드 세션 목록 병합. 같은 ID 는 'both' 로 합친다. */
export async function listMySessions(limit = 30): Promise<SessionSummary[]> {
  const [local, cloud] = await Promise.all([
    listLocalSessions(),
    listCloudSessions(limit)
  ]);
  const byId = new Map<string, SessionSummary>();
  for (const c of cloud) byId.set(c.id, c);
  for (const l of local) {
    const c = byId.get(l.id);
    if (c) {
      byId.set(l.id, {
        ...c,
        chunk_count: Math.max(c.chunk_count, l.chunk_count),
        preview: c.preview || l.preview,
        source: 'both'
      });
    } else {
      byId.set(l.id, l);
    }
  }
  return [...byId.values()]
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, limit);
}

async function listCloudSessions(limit = 30): Promise<SessionSummary[]> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, started_at, ended_at, transcribe_provider')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) {
      warn('listMySessions', error.message);
      return [];
    }
    const sessions = (data ?? []) as Array<{
      id: string;
      started_at: string;
      ended_at: string | null;
      transcribe_provider: string | null;
    }>;
    if (sessions.length === 0) return [];
    // 첫 chunk preview + count
    const ids = sessions.map((s) => s.id);
    const { data: chunkRows } = await supabase
      .from('transcript_chunks')
      .select('session_id, text, timestamp_ms')
      .in('session_id', ids)
      .order('timestamp_ms', { ascending: true });
    const byId = new Map<string, { count: number; first: string }>();
    for (const r of (chunkRows ?? []) as Array<{
      session_id: string;
      text: string;
    }>) {
      const cur = byId.get(r.session_id);
      if (!cur) byId.set(r.session_id, { count: 1, first: r.text });
      else cur.count += 1;
    }
    return sessions.map((s) => ({
      id: s.id,
      started_at: s.started_at,
      ended_at: s.ended_at,
      transcribe_provider: s.transcribe_provider,
      chunk_count: byId.get(s.id)?.count ?? 0,
      preview: byId.get(s.id)?.first?.slice(0, 60) ?? '',
      source: 'cloud' as const
    }));
  } catch (err) {
    warn('listMySessions', err);
    return [];
  }
}

export async function loadSession(sessionId: string): Promise<LoadedSession | null> {
  // 1) 로컬 파일 우선 — 더 빠르고 오프라인에서도 동작. (로컬/클라우드는
  //    동일 ID 로 이중 기록되므로 내용이 동등하다.)
  const local = await loadLocalSession(sessionId);
  if (local) {
    currentSessionId = sessionId;
    cloudReady = null;
    return {
      session: {
        id: local.id,
        started_at: local.started_at,
        ended_at: local.ended_at,
        transcribe_provider: local.transcribe_provider
      },
      chunks: local.chunks,
      analysis: local.analysis,
      latestSummary: local.summaries[local.summaries.length - 1] ?? null,
      latestDictation: local.dictations[local.dictations.length - 1] ?? null
    };
  }

  // 2) 클라우드 조회.
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return null;
  try {
    const [sessionRes, chunksRes, analysisRes, summariesRes, dictationsRes] =
      await Promise.all([
        supabase
          .from('sessions')
          .select('id, started_at, ended_at, transcribe_provider')
          .eq('id', sessionId)
          .maybeSingle(),
        supabase
          .from('transcript_chunks')
          .select('chunk_id, speaker, text, timestamp_ms')
          .eq('session_id', sessionId)
          .order('timestamp_ms', { ascending: true }),
        supabase
          .from('analyses')
          .select(
            'differential_diagnoses, medical_terms, suggested_questions, red_flags, updated_at'
          )
          .eq('session_id', sessionId)
          .maybeSingle(),
        supabase
          .from('summaries')
          .select(
            'chief_complaint, history_of_present_illness, pertinent_findings, investigations_mentioned, clinical_impression, plan, generated_at'
          )
          .eq('session_id', sessionId)
          .order('generated_at', { ascending: false })
          .limit(1),
        supabase
          .from('dictations')
          .select('template, sections, generated_at')
          .eq('session_id', sessionId)
          .order('generated_at', { ascending: false })
          .limit(1)
      ]);
    if (sessionRes.error || !sessionRes.data) {
      warn('loadSession:session', sessionRes.error?.message);
      return null;
    }
    currentSessionId = sessionId;
    cloudReady = Promise.resolve(true); // 방금 클라우드에서 확인된 row
    const chunks = ((chunksRes.data ?? []) as Array<{
      chunk_id: string;
      speaker: string;
      text: string;
      timestamp_ms: number;
    }>).map((r) => ({
      chunk_id: r.chunk_id,
      speaker: (r.speaker === 'doctor' || r.speaker === 'patient'
        ? r.speaker
        : 'unknown') as Speaker,
      text: r.text,
      timestamp_ms: r.timestamp_ms
    }));
    const a = analysisRes.data as
      | {
          differential_diagnoses: unknown;
          medical_terms: unknown;
          suggested_questions: unknown;
          red_flags: unknown;
          updated_at: string;
        }
      | null;
    const analysis: AnalysisResult | null = a
      ? {
          differentialDiagnoses: (a.differential_diagnoses as never[]) ?? [],
          medicalTerms: (a.medical_terms as never[]) ?? [],
          suggestedQuestions: (a.suggested_questions as never[]) ?? [],
          redFlags: (a.red_flags as string[]) ?? [],
          updatedAt: new Date(a.updated_at).getTime()
        }
      : null;
    const sRow = (summariesRes.data ?? [])[0] as
      | {
          chief_complaint: string;
          history_of_present_illness: string;
          pertinent_findings: string;
          investigations_mentioned: string;
          clinical_impression: string;
          plan: string;
          generated_at: string;
        }
      | undefined;
    const latestSummary: SummaryResult | null = sRow
      ? {
          chiefComplaint: sRow.chief_complaint,
          historyOfPresentIllness: sRow.history_of_present_illness,
          pertinentFindings: sRow.pertinent_findings,
          investigationsMentioned: sRow.investigations_mentioned,
          clinicalImpression: sRow.clinical_impression,
          plan: sRow.plan,
          generatedAt: new Date(sRow.generated_at).getTime()
        }
      : null;
    const dRow = (dictationsRes.data ?? [])[0] as
      | { template: string; sections: unknown; generated_at: string }
      | undefined;
    const latestDictation: DictationResult | null = dRow
      ? {
          template: dRow.template as DictationResult['template'],
          sections: (dRow.sections as never[]) ?? [],
          generatedAt: new Date(dRow.generated_at).getTime()
        }
      : null;
    return {
      session: sessionRes.data as LoadedSession['session'],
      chunks,
      analysis,
      latestSummary,
      latestDictation
    };
  } catch (err) {
    warn('loadSession', err);
    return null;
  }
}

export async function endCurrentSession(): Promise<void> {
  const id = currentSessionId;
  currentSessionId = null;
  cloudReady = null;
  if (!id) return;
  localEndSession(id);
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase
      .from('sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', id)
      .is('ended_at', null);
  } catch (err) {
    warn('endCurrentSession', err);
  }
}

export function clearSessionCache(): void {
  currentSessionId = null;
  cloudReady = null;
}

export async function saveTranscriptChunk(
  chunk: TranscriptChunk & { speaker: Speaker },
  opts: { audioPath?: string | null } = {}
): Promise<void> {
  const id = ensureSessionId();
  if (!id) return;
  localAppendChunk(id, chunk);

  if (!canPersist()) return;
  if (!getCloudSync().saveTranscripts) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureCloudSession();
  if (!sessionId) return;
  try {
    const { error } = await supabase.from('transcript_chunks').insert({
      session_id: sessionId,
      user_id: user.id,
      chunk_id: chunk.id,
      speaker: chunk.speaker,
      text: chunk.text,
      timestamp_ms: chunk.timestamp,
      audio_path: opts.audioPath ?? null
    });
    if (error) warn('saveTranscriptChunk', error.message);
  } catch (err) {
    warn('saveTranscriptChunk', err);
  }
}

/** chunk 모드 WAV 업로드. saveAudio=false면 no-op. */
export async function uploadChunkAudio(
  chunkId: string,
  base64Wav: string
): Promise<string | null> {
  if (!canPersist()) return null;
  if (!getCloudSync().saveAudio) return null;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return null;
  const sessionId = await ensureCloudSession();
  if (!sessionId) return null;
  const path = `${user.id}/${sessionId}/${chunkId}.wav`;
  try {
    const buf = Buffer.from(base64Wav, 'base64');
    const { error } = await supabase.storage
      .from('recordings')
      .upload(path, buf, { contentType: 'audio/wav', upsert: true });
    if (error) {
      warn('uploadChunkAudio', error.message);
      return null;
    }
    return path;
  } catch (err) {
    warn('uploadChunkAudio', err);
    return null;
  }
}

/**
 * 스트림 모드 세션 전체 PCM → WAV 업로드 + sessions.audio_path 업데이트.
 * 같은 세션에서 시작/정지가 여러 번 반복되면 모든 구간이 하나의 WAV 로 이어
 * 붙어 마지막에 한 번만 업로드된다 (PCM 버퍼는 세션 종료 시점에만 flush).
 */
export async function uploadSessionAudio(
  sessionId: string,
  wavBuffer: Buffer
): Promise<string | null> {
  if (!wavBuffer || wavBuffer.length <= 44) return null;
  // 로컬 저장은 클라우드 설정과 무관하게 자체 게이트로 판단.
  await localSaveSessionAudio(sessionId, wavBuffer);

  if (!canPersist()) return null;
  if (!getCloudSync().saveAudio) return null;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return null;
  const path = `${user.id}/${sessionId}/session.wav`;
  try {
    const { error: upErr } = await supabase.storage
      .from('recordings')
      .upload(path, wavBuffer, { contentType: 'audio/wav', upsert: true });
    if (upErr) {
      warn('uploadSessionAudio:upload', upErr.message);
      return null;
    }
    const { error: dbErr } = await supabase
      .from('sessions')
      .update({ audio_path: path })
      .eq('id', sessionId);
    if (dbErr) warn('uploadSessionAudio:update', dbErr.message);
    return path;
  } catch (err) {
    warn('uploadSessionAudio', err);
    return null;
  }
}

export async function relabelChunk(chunkId: string, speaker: Speaker): Promise<void> {
  if (currentSessionId) localRelabelChunk(currentSessionId, chunkId, speaker);
  if (!canPersist()) return;
  if (!getCloudSync().saveTranscripts) return;
  const supabase = getSupabase();
  if (!supabase || !currentSessionId) return;
  try {
    const { error } = await supabase
      .from('transcript_chunks')
      .update({ speaker })
      .eq('session_id', currentSessionId)
      .eq('chunk_id', chunkId);
    if (error) warn('relabelChunk', error.message);
  } catch (err) {
    warn('relabelChunk', err);
  }
}

export async function deleteChunkRow(chunkId: string): Promise<void> {
  if (currentSessionId) localRemoveChunk(currentSessionId, chunkId);
  if (!canPersist()) return;
  if (!getCloudSync().saveTranscripts) return;
  const supabase = getSupabase();
  if (!supabase || !currentSessionId) return;
  try {
    const { error } = await supabase
      .from('transcript_chunks')
      .delete()
      .eq('session_id', currentSessionId)
      .eq('chunk_id', chunkId);
    if (error) warn('deleteChunkRow', error.message);
  } catch (err) {
    warn('deleteChunkRow', err);
  }
}

export async function upsertAnalysis(result: AnalysisResult): Promise<void> {
  const id = ensureSessionId();
  if (!id) return;
  localUpsertAnalysis(id, result);

  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureCloudSession();
  if (!sessionId) return;
  try {
    const { error } = await supabase
      .from('analyses')
      .upsert(
        {
          session_id: sessionId,
          user_id: user.id,
          differential_diagnoses: result.differentialDiagnoses,
          medical_terms: result.medicalTerms,
          suggested_questions: result.suggestedQuestions,
          red_flags: result.redFlags,
          updated_at: new Date(result.updatedAt).toISOString()
        },
        { onConflict: 'session_id' }
      );
    if (error) warn('upsertAnalysis', error.message);
  } catch (err) {
    warn('upsertAnalysis', err);
  }
}

export async function appendSummary(result: SummaryResult): Promise<void> {
  const id = ensureSessionId();
  if (!id) return;
  localAppendSummary(id, result);

  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureCloudSession();
  if (!sessionId) return;
  try {
    const { error } = await supabase.from('summaries').insert({
      session_id: sessionId,
      user_id: user.id,
      chief_complaint: result.chiefComplaint,
      history_of_present_illness: result.historyOfPresentIllness,
      pertinent_findings: result.pertinentFindings,
      investigations_mentioned: result.investigationsMentioned,
      clinical_impression: result.clinicalImpression,
      plan: result.plan,
      generated_at: new Date(result.generatedAt).toISOString()
    });
    if (error) warn('appendSummary', error.message);
  } catch (err) {
    warn('appendSummary', err);
  }
}

export async function logUsage(input: UsageEventInput): Promise<void> {
  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  // 세션 ID 는 클라우드 row 생성이 확인된 경우에만 참조 (로컬 전용 세션 ID 를
  // FK 로 넣으면 위반). 미확인이면 세션 없이 사용량만 기록.
  let sessionId: string | null = null;
  if (currentSessionId && cloudReady) {
    sessionId = (await cloudReady) ? currentSessionId : null;
  }
  try {
    const { error } = await supabase.from('usage_events').insert({
      user_id: user.id,
      session_id: sessionId,
      provider: input.provider,
      task: input.task,
      model: input.model,
      prompt_tokens: input.prompt_tokens,
      output_tokens: input.output_tokens,
      total_tokens: input.total_tokens,
      chars: input.chars,
      duration_ms: input.duration_ms,
      app_version: app.getVersion(),
      platform: process.platform
    });
    if (error) warn('logUsage', error.message);
  } catch (err) {
    warn('logUsage', err);
  }
}

export async function appendDictation(result: DictationResult): Promise<void> {
  const id = ensureSessionId();
  if (!id) return;
  localAppendDictation(id, result);

  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureCloudSession();
  if (!sessionId) return;
  try {
    const { error } = await supabase.from('dictations').insert({
      session_id: sessionId,
      user_id: user.id,
      template: result.template,
      sections: result.sections,
      generated_at: new Date(result.generatedAt).toISOString()
    });
    if (error) warn('appendDictation', error.message);
  } catch (err) {
    warn('appendDictation', err);
  }
}
