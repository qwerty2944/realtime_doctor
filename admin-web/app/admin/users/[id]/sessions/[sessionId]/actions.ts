'use server';

import { getCookieSupabase } from '@/lib/supabase/ssr';

type Speaker = 'doctor' | 'patient' | 'unknown';

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();
  const isAdmin = !!profile?.is_admin;
  if (!isAdmin && session.user_id !== user.id) {
    return { ok: false, error: 'forbidden' };
  }

  const { error } = await supabase
    .from('transcript_chunks')
    .update({ speaker })
    .eq('id', chunkRowId)
    .eq('session_id', sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
