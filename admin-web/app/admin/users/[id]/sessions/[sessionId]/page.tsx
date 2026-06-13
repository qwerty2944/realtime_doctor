import { notFound } from 'next/navigation';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { SessionDetailClient } from '@/components/session-detail/SessionDetailClient';
import { isSessionColor } from '@/lib/session-colors';

export const dynamic = 'force-dynamic';

const CHUNK_LIMIT = 2000;

export default async function SessionDetail({
  params
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const supabase = await getCookieSupabase();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();
  const isAdmin = !!profile?.is_admin;

  const { data: session } = await supabase
    .from('sessions')
    .select(
      'id, user_id, started_at, ended_at, transcribe_provider, audio_path, title, color, pinned'
    )
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) notFound();
  if (!isAdmin && session.user_id !== user.id) notFound();

  const [
    { data: chunks = [] },
    { data: analysis },
    { data: summaries = [] },
    { data: dictations = [] }
  ] = await Promise.all([
    supabase
      .from('transcript_chunks')
      .select('id, chunk_id, speaker, text, timestamp_ms, audio_path, created_at')
      .eq('session_id', sessionId)
      .order('timestamp_ms', { ascending: true })
      .limit(CHUNK_LIMIT),
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
        'id, chief_complaint, history_of_present_illness, pertinent_findings, investigations_mentioned, clinical_impression, plan, generated_at'
      )
      .eq('session_id', sessionId)
      .order('generated_at', { ascending: false }),
    supabase
      .from('dictations')
      .select('id, template, sections, generated_at')
      .eq('session_id', sessionId)
      .order('generated_at', { ascending: false })
  ]);

  type Chunk = {
    id: string;
    chunk_id: string;
    speaker: string;
    text: string;
    timestamp_ms: number;
    audio_path: string | null;
    created_at: string;
  };
  const chunkRows = (chunks ?? []) as Chunk[];

  const audioUrl = session.audio_path
    ? (await supabase.storage.from('recordings').createSignedUrl(session.audio_path, 3600)).data
        ?.signedUrl ?? null
    : null;

  const chunkPaths = chunkRows.map((c) => c.audio_path).filter((p): p is string => !!p);
  const chunkAudioUrls: Record<string, string> = {};
  if (chunkPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('recordings')
      .createSignedUrls(chunkPaths, 3600);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) chunkAudioUrls[item.path] = item.signedUrl;
    }
  }

  return (
    <SessionDetailClient
      backHref={isAdmin ? `/admin/users/${id}` : '/admin'}
      session={{
        id: session.id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        transcribe_provider: session.transcribe_provider,
        alias: (session as { title?: string | null }).title ?? null,
        color: isSessionColor((session as { color?: unknown }).color)
          ? ((session as { color: import('@/lib/session-colors').SessionColor }).color)
          : null,
        pinned: !!(session as { pinned?: boolean }).pinned
      }}
      audioUrl={audioUrl}
      analysis={(analysis as never) ?? null}
      summaries={summaries as never}
      dictations={dictations as never}
      chunks={chunkRows.map((c) => ({
        id: c.id,
        speaker: c.speaker,
        text: c.text,
        timestamp_ms: c.timestamp_ms,
        audio_path: c.audio_path
      }))}
      chunkAudioUrls={chunkAudioUrls}
      truncated={chunkRows.length >= CHUNK_LIMIT}
    />
  );
}
