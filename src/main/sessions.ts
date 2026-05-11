import { app } from 'electron';
import type {
  AnalysisResult,
  DictationResult,
  Speaker,
  SummaryResult,
  TranscriptChunk
} from '../shared/types.js';
import { getCurrentUser } from './auth.js';
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
let creating: Promise<string | null> | null = null;

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

async function ensureSession(): Promise<string | null> {
  if (currentSessionId) return currentSessionId;
  if (!canPersist()) return null;
  if (creating) return creating;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return null;

  creating = (async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          user_id: user.id,
          transcribe_provider: getTranscribeProvider()
        })
        .select('id')
        .single();
      if (error) {
        warn('ensureSession', error.message);
        return null;
      }
      currentSessionId = (data as { id: string }).id;
      return currentSessionId;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export async function endCurrentSession(): Promise<void> {
  const id = currentSessionId;
  currentSessionId = null;
  if (!id) return;
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
  creating = null;
}

export async function saveTranscriptChunk(
  chunk: TranscriptChunk & { speaker: Speaker }
): Promise<void> {
  if (!canPersist()) return;
  if (!getCloudSync().saveTranscripts) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureSession();
  if (!sessionId) return;
  try {
    const { error } = await supabase.from('transcript_chunks').insert({
      session_id: sessionId,
      user_id: user.id,
      chunk_id: chunk.id,
      speaker: chunk.speaker,
      text: chunk.text,
      timestamp_ms: chunk.timestamp
    });
    if (error) warn('saveTranscriptChunk', error.message);
  } catch (err) {
    warn('saveTranscriptChunk', err);
  }
}

export async function relabelChunk(chunkId: string, speaker: Speaker): Promise<void> {
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

export async function upsertAnalysis(result: AnalysisResult): Promise<void> {
  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureSession();
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
  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureSession();
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
  try {
    const { error } = await supabase.from('usage_events').insert({
      user_id: user.id,
      session_id: currentSessionId,
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
  if (!canPersist()) return;
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const sessionId = await ensureSession();
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
