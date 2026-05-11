import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCookieSupabase } from '@/lib/supabase/ssr';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Chunk = {
  id: string;
  chunk_id: string;
  speaker: string;
  text: string;
  timestamp_ms: number;
  audio_path: string | null;
  created_at: string;
};

type Analysis = {
  differential_diagnoses: unknown;
  medical_terms: unknown;
  suggested_questions: unknown;
  red_flags: unknown;
  updated_at: string;
};

type Summary = {
  id: string;
  chief_complaint: string;
  history_of_present_illness: string;
  pertinent_findings: string;
  investigations_mentioned: string;
  clinical_impression: string;
  plan: string;
  generated_at: string;
};

type Dictation = {
  id: string;
  template: string;
  sections: unknown;
  generated_at: string;
};

export default async function SessionDetail({
  params
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const supabase = await getCookieSupabase();

  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id, started_at, ended_at, transcribe_provider, audio_path')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) notFound();

  const [{ data: chunks = [] }, { data: analysis }, { data: summaries = [] }, { data: dictations = [] }] =
    await Promise.all([
      supabase
        .from('transcript_chunks')
        .select('id, chunk_id, speaker, text, timestamp_ms, audio_path, created_at')
        .eq('session_id', sessionId)
        .order('timestamp_ms', { ascending: true })
        .limit(2000),
      supabase
        .from('analyses')
        .select('differential_diagnoses, medical_terms, suggested_questions, red_flags, updated_at')
        .eq('session_id', sessionId)
        .maybeSingle(),
      supabase
        .from('summaries')
        .select('id, chief_complaint, history_of_present_illness, pertinent_findings, investigations_mentioned, clinical_impression, plan, generated_at')
        .eq('session_id', sessionId)
        .order('generated_at', { ascending: false }),
      supabase
        .from('dictations')
        .select('id, template, sections, generated_at')
        .eq('session_id', sessionId)
        .order('generated_at', { ascending: false })
    ]);

  const chunkRows = (chunks ?? []) as Chunk[];
  const summaryRows = (summaries ?? []) as Summary[];
  const dictationRows = (dictations ?? []) as Dictation[];

  // Storage signed URLs
  const sessionAudioUrl = session.audio_path
    ? (await supabase.storage.from('recordings').createSignedUrl(session.audio_path, 3600)).data?.signedUrl ?? null
    : null;

  const chunkAudioUrls: Record<string, string> = {};
  const chunkPaths = chunkRows.map((c) => c.audio_path).filter((p): p is string => !!p);
  if (chunkPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('recordings')
      .createSignedUrls(chunkPaths, 3600);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) chunkAudioUrls[item.path] = item.signedUrl;
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/users/${id}`}
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          ← 사용자
        </Link>
        <h1 className="mt-1 text-lg font-semibold">진료 세션</h1>
        <p className="text-xs text-foreground/50">
          {fmtDate(session.started_at)} → {fmtDate(session.ended_at)} ·{' '}
          {session.transcribe_provider ?? '—'} ·{' '}
          <span className="font-mono">{session.id.slice(0, 8)}</span>
        </p>
      </div>

      {sessionAudioUrl && (
        <Section title="세션 음성 (전체)">
          <audio controls src={sessionAudioUrl} className="w-full" />
        </Section>
      )}

      {analysis && (
        <Section title={`분석 (updated ${fmtDate((analysis as Analysis).updated_at)})`}>
          <AnalysisView a={analysis as Analysis} />
        </Section>
      )}

      {summaryRows.length > 0 && (
        <Section title={`임상 노트 (${summaryRows.length}건)`}>
          <div className="space-y-4">
            {summaryRows.map((s) => (
              <div key={s.id} className="rounded-lg border border-border/60 p-3">
                <div className="mb-2 text-[11px] text-foreground/50">
                  {fmtDate(s.generated_at)}
                </div>
                <SummaryView s={s} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {dictationRows.length > 0 && (
        <Section title={`Dictation (${dictationRows.length}건)`}>
          <div className="space-y-4">
            {dictationRows.map((d) => (
              <div key={d.id} className="rounded-lg border border-border/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] text-foreground/50">
                  <span className="rounded bg-white/10 px-1 py-0.5 font-mono uppercase">
                    {d.template}
                  </span>
                  <span>{fmtDate(d.generated_at)}</span>
                </div>
                <DictationView sections={d.sections} />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`전사 (${chunkRows.length}건)`}>
        {chunkRows.length === 0 ? (
          <p className="text-sm text-foreground/60">
            저장된 전사 청크가 없습니다 (전사 원문 저장 옵션 OFF).
          </p>
        ) : (
          <ul className="space-y-2">
            {chunkRows.map((c) => (
              <li key={c.id} className="rounded-md border border-border/40 bg-muted/30 p-3">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-foreground/50">
                  <span
                    className={
                      c.speaker === 'doctor'
                        ? 'rounded bg-sky-500/30 px-1.5 py-0.5 text-sky-100'
                        : c.speaker === 'patient'
                          ? 'rounded bg-emerald-500/30 px-1.5 py-0.5 text-emerald-100'
                          : 'rounded bg-white/10 px-1.5 py-0.5'
                    }
                  >
                    {c.speaker === 'doctor' ? '의사' : c.speaker === 'patient' ? '환자' : '?'}
                  </span>
                  <span>{new Date(c.timestamp_ms).toLocaleTimeString('ko-KR')}</span>
                </div>
                <div className="text-sm text-foreground/90">{c.text}</div>
                {c.audio_path && chunkAudioUrls[c.audio_path] && (
                  <audio
                    controls
                    src={chunkAudioUrls[c.audio_path]}
                    className="mt-2 w-full"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function AnalysisView({ a }: { a: Analysis }) {
  const dd = Array.isArray(a.differential_diagnoses) ? a.differential_diagnoses : [];
  const terms = Array.isArray(a.medical_terms) ? a.medical_terms : [];
  const qs = Array.isArray(a.suggested_questions) ? a.suggested_questions : [];
  const flags = Array.isArray(a.red_flags) ? a.red_flags : [];
  return (
    <div className="space-y-3 text-sm">
      {flags.length > 0 && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-200">
          <div className="text-[10px] uppercase tracking-wider">Red flags</div>
          <ul className="mt-1 list-disc pl-5">
            {(flags as unknown[]).map((f, i) => (
              <li key={i}>{String(f)}</li>
            ))}
          </ul>
        </div>
      )}
      {dd.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-foreground/50">
            감별진단 ({dd.length})
          </div>
          <ul className="mt-1 space-y-1">
            {(dd as Array<{ name?: string; icd10?: string; confidence?: number; reasoning?: string }>).map(
              (d, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-12 text-right text-xs text-foreground/50">
                    {Math.round((d.confidence ?? 0) * 100)}%
                  </span>
                  <span className="font-medium">{d.name}</span>
                  {d.icd10 && (
                    <span className="rounded bg-white/10 px-1 text-[10px] font-mono">
                      {d.icd10}
                    </span>
                  )}
                  <span className="text-xs text-foreground/60">{d.reasoning}</span>
                </li>
              )
            )}
          </ul>
        </div>
      )}
      {terms.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-foreground/50">
            의학용어 ({terms.length})
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {(terms as Array<{ term?: string; termEn?: string; definition?: string }>).map((t, i) => (
              <li key={i}>
                <span className="font-medium">{t.term}</span>
                {t.termEn && <span className="text-foreground/50"> ({t.termEn})</span>}
                {t.definition && <span> — {t.definition}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {qs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-foreground/50">
            다음 질문 ({qs.length})
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {(qs as Array<{ question?: string; rationale?: string }>).map((q, i) => (
              <li key={i}>
                {q.question}
                {q.rationale && <span className="text-foreground/50"> — {q.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryView({ s }: { s: Summary }) {
  const rows: [string, string][] = [
    ['CC', s.chief_complaint],
    ['HPI', s.history_of_present_illness],
    ['소견', s.pertinent_findings],
    ['검사·약물', s.investigations_mentioned],
    ['Impression', s.clinical_impression],
    ['Plan', s.plan]
  ];
  return (
    <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">
            {k}
          </dt>
          <dd className="whitespace-pre-wrap">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function DictationView({ sections }: { sections: unknown }) {
  const arr = Array.isArray(sections) ? sections : [];
  return (
    <div className="space-y-2 text-sm">
      {(arr as Array<{ heading?: string; body?: string }>).map((s, i) => (
        <div key={i}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">
            {s.heading}
          </div>
          <div className="whitespace-pre-wrap">{s.body}</div>
        </div>
      ))}
    </div>
  );
}
