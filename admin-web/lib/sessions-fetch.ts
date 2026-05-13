import type { SessionCardData } from '@/components/session-card';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSessionColor, type SessionColor } from './session-colors';

interface RawSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  transcribe_provider: string | null;
  audio_path: string | null;
  title: string | null;
  color: string | null;
  pinned: boolean | null;
  pinned_at: string | null;
}

export interface SessionsParams {
  userId?: string;
  q?: string;
  sort?: 'recent' | 'oldest' | 'duration' | 'chunks';
  range?: '7' | '30' | 'all';
  colors?: SessionColor[];
  pinnedOnly?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

export async function fetchSessionCards(
  supabase: SupabaseClient,
  params: SessionsParams = {}
): Promise<SessionCardData[]> {
  const {
    userId,
    q = '',
    sort = 'recent',
    range = 'all',
    colors,
    pinnedOnly
  } = params;

  let query = supabase
    .from('sessions')
    .select(
      'id, user_id, started_at, ended_at, transcribe_provider, audio_path, title, color, pinned, pinned_at'
    )
    .order('started_at', { ascending: false })
    .limit(500);
  if (userId) query = query.eq('user_id', userId);
  if (range !== 'all') {
    const since = new Date(Date.now() - Number(range) * DAY).toISOString();
    query = query.gte('started_at', since);
  }
  if (colors && colors.length > 0) {
    query = query.in('color', colors);
  }
  if (pinnedOnly) {
    query = query.eq('pinned', true);
  }
  const { data: sessions = [] } = await query;
  const sessionRows = (sessions ?? []) as RawSession[];
  if (sessionRows.length === 0) return [];

  const sids = sessionRows.map((s) => s.id);

  const [chunkRes, sumRes, anaRes, dictRes] = await Promise.all([
    supabase
      .from('transcript_chunks')
      .select('session_id, speaker, text, timestamp_ms')
      .in('session_id', sids)
      .order('timestamp_ms', { ascending: true }),
    supabase
      .from('summaries')
      .select('session_id, chief_complaint, generated_at')
      .in('session_id', sids)
      .order('generated_at', { ascending: false }),
    supabase.from('analyses').select('session_id').in('session_id', sids),
    supabase.from('dictations').select('session_id').in('session_id', sids)
  ]);

  type RawChunk = {
    session_id: string;
    speaker: string;
    text: string;
    timestamp_ms: number;
  };
  const chunks = (chunkRes.data ?? []) as RawChunk[];

  type ChunkAgg = {
    chunk_count: number;
    doctor_count: number;
    patient_count: number;
    first_text: string;
  };
  const chunkBy = new Map<string, ChunkAgg>();
  for (const c of chunks) {
    let agg = chunkBy.get(c.session_id);
    if (!agg) {
      agg = { chunk_count: 0, doctor_count: 0, patient_count: 0, first_text: c.text };
      chunkBy.set(c.session_id, agg);
    }
    agg.chunk_count += 1;
    if (c.speaker === 'doctor') agg.doctor_count += 1;
    else if (c.speaker === 'patient') agg.patient_count += 1;
  }

  const summaryBy = new Map<string, string>();
  for (const s of (sumRes.data ?? []) as Array<{
    session_id: string;
    chief_complaint: string | null;
  }>) {
    if (!summaryBy.has(s.session_id) && s.chief_complaint) {
      summaryBy.set(s.session_id, s.chief_complaint);
    }
  }
  const hasAna = new Set(
    ((anaRes.data ?? []) as Array<{ session_id: string }>).map((r) => r.session_id)
  );
  const hasDict = new Set(
    ((dictRes.data ?? []) as Array<{ session_id: string }>).map((r) => r.session_id)
  );

  let cards: SessionCardData[] = sessionRows.map((s) => {
    const agg = chunkBy.get(s.id) ?? {
      chunk_count: 0,
      doctor_count: 0,
      patient_count: 0,
      first_text: ''
    };
    return {
      id: s.id,
      user_id: s.user_id,
      started_at: s.started_at,
      ended_at: s.ended_at,
      transcribe_provider: s.transcribe_provider,
      audio_path: s.audio_path,
      chunk_count: agg.chunk_count,
      doctor_count: agg.doctor_count,
      patient_count: agg.patient_count,
      first_text: agg.first_text,
      chief_complaint: summaryBy.get(s.id) ?? null,
      has_analysis: hasAna.has(s.id),
      has_summary: summaryBy.has(s.id),
      has_dictation: hasDict.has(s.id),
      alias: s.title,
      color: isSessionColor(s.color) ? s.color : null,
      pinned: !!s.pinned
    };
  });

  // keyword filter (alias 도 검색 대상에 추가)
  const needle = q.trim().toLowerCase();
  if (needle) {
    cards = cards.filter((c) => {
      const hay = `${c.alias ?? ''}\n${c.chief_complaint ?? ''}\n${c.first_text}`.toLowerCase();
      return hay.includes(needle);
    });
  }

  // sort: 핀 먼저, 그 다음 선택된 정렬
  cards.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    switch (sort) {
      case 'oldest':
        return new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
      case 'duration': {
        const da = a.ended_at
          ? new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()
          : 0;
        const db = b.ended_at
          ? new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()
          : 0;
        return db - da;
      }
      case 'chunks':
        return b.chunk_count - a.chunk_count;
      case 'recent':
      default:
        return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    }
  });

  return cards;
}
