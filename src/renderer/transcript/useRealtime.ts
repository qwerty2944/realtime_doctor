import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Speaker, TranscriptChunk } from '../../shared/types';
import {
  startChunkSession,
  type ChunkSessionHandle
} from './chunkSession';
import {
  startClovaStreamSession,
  type ClovaStreamHandle
} from './clovaStreamSession';
import {
  startStreamSession,
  type StreamSessionHandle
} from './streamSession';

export interface CompletedUtterance {
  id: string;
  text: string;
  timestamp: number;
  speaker: Speaker;
  pending?: boolean;
}

interface PartialStreamState {
  itemId: string;
  text: string;
}

export function useRealtime() {
  const sessionRef = useRef<
    ChunkSessionHandle | StreamSessionHandle | ClovaStreamHandle | null
  >(null);

  const [utterances, setUtterances] = useState<CompletedUtterance[]>([]);
  const [partial, setPartial] = useState<PartialStreamState | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = window.api.onTranscriptLabel(({ id, speaker }) => {
      setUtterances((prev) =>
        prev.map((u) => (u.id === id ? { ...u, speaker } : u))
      );
    });
    return off;
  }, []);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setPartial(null);
    setActive(false);
  }, []);

  const addPending = useCallback((id: string) => {
    setUtterances((prev) => [
      ...prev,
      {
        id,
        text: '(전사 중…)',
        timestamp: Date.now(),
        speaker: 'unknown',
        pending: true
      }
    ]);
  }, []);

  const completeUtterance = useCallback((id: string, text: string) => {
    setUtterances((prev) => {
      const exists = prev.some((u) => u.id === id);
      if (exists) {
        return prev.map((u) =>
          u.id === id ? { ...u, text, pending: false } : u
        );
      }
      return [
        ...prev,
        {
          id,
          text,
          timestamp: Date.now(),
          speaker: 'unknown',
          pending: false
        }
      ];
    });
  }, []);

  const markFailed = useCallback((id: string) => {
    setUtterances((prev) =>
      prev.map((u) =>
        u.id === id ? { ...u, text: '(전사 실패)', pending: false } : u
      )
    );
  }, []);

  const dropPending = useCallback((id: string) => {
    setUtterances((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const startMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const providers = await window.api.listTranscribeProviders();
      const current = await window.api.getTranscribeProvider();
      const info = providers.find((p) => p.id === current);
      if (!info) throw new Error(`알 수 없는 공급자: ${current}`);
      if (!info.available) {
        throw new Error(
          `${info.label} 공급자가 비활성 상태입니다. 설정에서 다른 공급자를 선택하세요.`
        );
      }

      if (info.mode === 'chunk') {
        const handle = await startChunkSession({
          onPending: addPending,
          onComplete: completeUtterance,
          onFailed: markFailed,
          onEmpty: dropPending,
          onError: (err) => {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
        sessionRef.current = handle;
      } else if (info.id === 'clova-stream') {
        const handle = await startClovaStreamSession({
          onDelta: (itemId, text) => {
            setPartial({ itemId, text });
          },
          onCompleted: (itemId, text) => {
            const finalText = text.trim();
            setPartial((prev) => (prev?.itemId === itemId ? null : prev));
            if (!finalText) return;
            completeUtterance(itemId, finalText);
          },
          onError: (err) => {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
        sessionRef.current = handle;
      } else {
        const handle = await startStreamSession({
          onDelta: (itemId, delta) => {
            setPartial((prev) =>
              prev && prev.itemId === itemId
                ? { itemId, text: prev.text + delta }
                : { itemId, text: delta }
            );
          },
          onCompleted: (itemId, transcript) => {
            const text = transcript.trim();
            setPartial((prev) => (prev?.itemId === itemId ? null : prev));
            if (!text) return;
            completeUtterance(itemId, text);
            const chunk: TranscriptChunk = {
              id: itemId,
              text,
              timestamp: Date.now()
            };
            window.api.pushTranscriptChunk(chunk);
          },
          onError: (err) => {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
        sessionRef.current = handle;
      }

      setActive(true);
    },
    onError: (err: unknown) => {
      console.error('[realtime] start failed', err);
      setError(err instanceof Error ? err.message : String(err));
      stop();
    }
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      stop();
    }
  });

  const reset = useCallback(() => {
    setUtterances([]);
    setPartial(null);
    window.api.resetTranscript();
  }, []);

  const relabel = useCallback((id: string, speaker: Speaker) => {
    setUtterances((prev) =>
      prev.map((u) => (u.id === id ? { ...u, speaker } : u))
    );
    window.api.relabelSpeaker(id, speaker);
  }, []);

  const swapAll = useCallback(() => {
    setUtterances((prev) => {
      const next = prev.map((u) => {
        if (u.speaker === 'doctor') return { ...u, speaker: 'patient' as Speaker };
        if (u.speaker === 'patient') return { ...u, speaker: 'doctor' as Speaker };
        return u;
      });
      next.forEach((u, i) => {
        if (u.speaker !== prev[i].speaker) {
          window.api.relabelSpeaker(u.id, u.speaker);
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const pendingCount = utterances.filter((u) => u.pending).length;
  const finishing = !active && pendingCount > 0;

  return {
    active,
    finishing,
    pendingCount,
    partial: partial?.text ?? '',
    utterances,
    error,
    isPending: startMutation.isPending || stopMutation.isPending,
    start: () => startMutation.mutate(),
    stop: () => stopMutation.mutate(),
    reset,
    relabel,
    swapAll
  };
}
