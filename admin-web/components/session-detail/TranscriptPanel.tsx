'use client';

import { useMemo, useState } from 'react';
import { ClipboardCopy, Download, Search } from 'lucide-react';
import { fmtTime } from '@/lib/format';
import {
  copyMarkdown,
  downloadMarkdown,
  transcriptToMarkdown,
  type ChunkLike
} from '@/lib/exports';

type Speaker = 'doctor' | 'patient' | 'unknown';
const SPEAKERS: Speaker[] = ['doctor', 'patient', 'unknown'];

const SPEAKER_LABEL: Record<Speaker, string> = {
  doctor: '의사',
  patient: '환자',
  unknown: '미확인'
};

const SPEAKER_TONE: Record<Speaker, string> = {
  doctor: 'bg-sky-500/25 text-sky-100 border-sky-500/40',
  patient: 'bg-emerald-500/25 text-emerald-100 border-emerald-500/40',
  unknown: 'bg-white/10 text-foreground/70 border-white/20'
};

interface ChunkRow extends ChunkLike {
  id: string;
  audio_path: string | null;
}

export function TranscriptPanel({
  chunks,
  chunkAudioUrls,
  onSeek,
  truncated
}: {
  chunks: ChunkRow[];
  chunkAudioUrls: Record<string, string>;
  onSeek: ((timestampMs: number) => void) | null;
  truncated: boolean;
}) {
  const [q, setQ] = useState('');
  const [enabled, setEnabled] = useState<Record<Speaker, boolean>>({
    doctor: true,
    patient: true,
    unknown: true
  });

  const counts = useMemo(() => {
    const c: Record<Speaker, number> = { doctor: 0, patient: 0, unknown: 0 };
    for (const ch of chunks) {
      const s = (SPEAKERS.includes(ch.speaker as Speaker) ? ch.speaker : 'unknown') as Speaker;
      c[s] += 1;
    }
    return c;
  }, [chunks]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return chunks.filter((c) => {
      const sp = (SPEAKERS.includes(c.speaker as Speaker)
        ? c.speaker
        : 'unknown') as Speaker;
      if (!enabled[sp]) return false;
      if (!needle) return true;
      return c.text.toLowerCase().includes(needle);
    });
  }, [chunks, q, enabled]);

  if (chunks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-foreground/60">
        저장된 전사 청크가 없습니다 (전사 원문 저장 옵션 OFF).
      </div>
    );
  }

  const md = transcriptToMarkdown(filtered);

  return (
    <div className="space-y-3">
      {truncated && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          청크가 너무 많아 처음 2000개만 표시됩니다.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="발화 내용 검색…"
            className="w-full rounded-md border border-border bg-muted/40 py-1.5 pl-7 pr-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          {SPEAKERS.map((s) => (
            <button
              key={s}
              onClick={() => setEnabled((e) => ({ ...e, [s]: !e[s] }))}
              className={`rounded-full border px-2 py-1 transition-colors ${
                enabled[s] ? SPEAKER_TONE[s] : 'border-border bg-transparent text-foreground/40'
              }`}
            >
              {SPEAKER_LABEL[s]} {counts[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void copyMarkdown(md)}
            title="필터링된 전사 복사"
            className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => downloadMarkdown('transcript.md', md)}
            title="필터링된 전사 다운로드"
            className="rounded-md border border-border bg-muted/40 p-1.5 text-foreground/70 hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="text-[11px] text-foreground/40">
        {filtered.length}/{chunks.length} 발화
      </div>

      <ul className="space-y-2">
        {filtered.map((c) => {
          const sp = (SPEAKERS.includes(c.speaker as Speaker)
            ? c.speaker
            : 'unknown') as Speaker;
          const chunkUrl = c.audio_path ? chunkAudioUrls[c.audio_path] ?? null : null;
          return (
            <li
              key={c.id}
              className="rounded-md border border-border/40 bg-muted/30 p-3"
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] text-foreground/50">
                <span className={`rounded px-1.5 py-0.5 ${SPEAKER_TONE[sp].split(' ')[0]} ${SPEAKER_TONE[sp].split(' ')[1]}`}>
                  {SPEAKER_LABEL[sp]}
                </span>
                {onSeek ? (
                  <button
                    onClick={() => onSeek(c.timestamp_ms)}
                    className="font-mono text-foreground/60 hover:text-accent hover:underline"
                    title="이 시점으로 재생"
                  >
                    {fmtTime(c.timestamp_ms)}
                  </button>
                ) : (
                  <span className="font-mono">{fmtTime(c.timestamp_ms)}</span>
                )}
              </div>
              <div className="text-sm text-foreground/90">{c.text}</div>
              {chunkUrl && (
                <audio
                  controls
                  src={chunkUrl}
                  className="mt-2 w-full"
                  preload="none"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
