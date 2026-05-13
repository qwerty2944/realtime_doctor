'use server';

import { revalidatePath } from 'next/cache';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { isSessionColor, type SessionColor } from '@/lib/session-colors';
import { runAnalyzer } from '@/lib/analyzer';

type Speaker = 'doctor' | 'patient' | 'unknown';

async function ownerOrAdminGate(
  supabase: Awaited<ReturnType<typeof getCookieSupabase>>,
  sessionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: session } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: 'session not found' };

  if (session.user_id === user.id) return { ok: true };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profile?.is_admin) return { ok: true };
  return { ok: false, error: 'forbidden' };
}

export async function relabelChunkAction(input: {
  sessionId: string;
  chunkRowId: string;
  speaker: Speaker;
}): Promise<{ ok: boolean; error?: string }> {
  const { sessionId, chunkRowId, speaker } = input;
  if (!['doctor', 'patient', 'unknown'].includes(speaker)) {
    return { ok: false, error: 'invalid speaker' };
  }

  const supabase = await getCookieSupabase();
  const gate = await ownerOrAdminGate(supabase, sessionId);
  if (!gate.ok) return gate;

  const { error } = await supabase
    .from('transcript_chunks')
    .update({ speaker })
    .eq('id', chunkRowId)
    .eq('session_id', sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface SessionMetaPatch {
  sessionId: string;
  alias?: string | null;
  color?: SessionColor | null;
  pinned?: boolean;
  ended_at?: string | null;
}

export async function regenerateAnalysisAction(input: {
  sessionId: string;
  language?: 'ko' | 'en';
}): Promise<{ ok: boolean; error?: string }> {
  const { sessionId } = input;
  const supabase = await getCookieSupabase();
  const gate = await ownerOrAdminGate(supabase, sessionId);
  if (!gate.ok) return gate;

  const { data: chunkRows, error: chunkErr } = await supabase
    .from('transcript_chunks')
    .select('speaker, text, timestamp_ms')
    .eq('session_id', sessionId)
    .order('timestamp_ms', { ascending: true })
    .limit(5000);
  if (chunkErr) return { ok: false, error: chunkErr.message };
  const chunks = (chunkRows ?? []) as Array<{ speaker: string; text: string; timestamp_ms: number }>;
  if (chunks.length === 0) {
    return { ok: false, error: '전사 청크가 없어 분석을 생성할 수 없습니다.' };
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: 'session not found' };

  let result;
  try {
    result = await runAnalyzer({ language: input.language, chunks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const { error: upsertErr } = await supabase.from('analyses').upsert(
    {
      session_id: sessionId,
      user_id: (session as { user_id: string }).user_id,
      differential_diagnoses: result.differentialDiagnoses,
      medical_terms: result.medicalTerms,
      suggested_questions: result.suggestedQuestions,
      red_flags: result.redFlags,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'session_id' }
  );
  if (upsertErr) return { ok: false, error: upsertErr.message };

  revalidatePath(`/admin/users/${(session as { user_id: string }).user_id}/sessions/${sessionId}`);
  return { ok: true };
}

export async function updateDictationSectionsAction(input: {
  sessionId: string;
  dictationId: string;
  sections: Array<{ heading: string; body: string }>;
}): Promise<{ ok: boolean; error?: string }> {
  const { sessionId, dictationId, sections } = input;
  if (!Array.isArray(sections)) return { ok: false, error: 'invalid sections' };
  const cleaned = sections.map((s) => ({
    heading: typeof s.heading === 'string' ? s.heading : '',
    body: typeof s.body === 'string' ? s.body : ''
  }));

  const supabase = await getCookieSupabase();
  const gate = await ownerOrAdminGate(supabase, sessionId);
  if (!gate.ok) return gate;

  const { error } = await supabase
    .from('dictations')
    .update({ sections: cleaned })
    .eq('id', dictationId)
    .eq('session_id', sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateSessionMeta(
  input: SessionMetaPatch
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getCookieSupabase();
  const gate = await ownerOrAdminGate(supabase, input.sessionId);
  if (!gate.ok) return gate;

  const patch: Record<string, unknown> = {};
  if (input.alias !== undefined) {
    if (input.alias === null) {
      patch.title = null;
    } else {
      const trimmed = input.alias.trim();
      if (trimmed.length > 80) return { ok: false, error: 'alias too long' };
      patch.title = trimmed || null;
    }
  }
  if (input.color !== undefined) {
    if (input.color !== null && !isSessionColor(input.color)) {
      return { ok: false, error: 'invalid color' };
    }
    patch.color = input.color;
  }
  if (input.pinned !== undefined) {
    patch.pinned = input.pinned;
    patch.pinned_at = input.pinned ? new Date().toISOString() : null;
  }
  if (input.ended_at !== undefined) {
    if (input.ended_at === null) {
      patch.ended_at = null;
    } else {
      const t = Date.parse(input.ended_at);
      if (Number.isNaN(t)) return { ok: false, error: 'invalid ended_at' };
      patch.ended_at = new Date(t).toISOString();
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from('sessions')
    .update(patch)
    .eq('id', input.sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
