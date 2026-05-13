'use server';

import { getCookieSupabase } from '@/lib/supabase/ssr';
import { isSessionColor, type SessionColor } from '@/lib/session-colors';

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

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from('sessions')
    .update(patch)
    .eq('id', input.sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
