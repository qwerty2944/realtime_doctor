'use client';

/**
 * 3단계: AI 문진. 고령 환자 기준으로 설계했다 (반이중 + 최소 탭).
 *
 * 실제 사용에서 관찰된 두 가지 실패가 이 설계를 만들었다:
 *   1. 작은 질문마다 버튼을 눌러 답하게 하면 환자가 지친다.
 *      → 문진 자체를 짧게 만들고(넓은 여는 질문 → 정말 빠진 것만),
 *        한 턴은 크고 분명한 동작 하나로 끝난다.
 *   2. 질문을 읽어주는 동안 마이크가 열려 있으면 AI 자기 목소리가 녹음된다.
 *      → 반이중(HALF-DUPLEX): 질문을 읽는 동안 녹음 버튼은 잠긴다. 읽기가
 *        끝나야 풀린다. 음소거이거나 TTS 미지원이면 잠금 자체를 건너뛴다 —
 *        영영 안 풀릴 잠금을 기다리게 두지 않는다.
 *
 * 음성 입력은 서버측이다: MediaRecorder 클립 → /api/intake/transcribe →
 * CLOVA Speech 텍스트. Web Speech **인식** API 는 일부러 쓰지 않는다(카카오톡
 * 인앱 브라우저와 iOS Safari 에서 실패한다). **합성**은 출력 전용이라 음소거
 * 버튼과 함께 유지한다. 글자 입력창은 항상 보이므로 마이크가 안 되는 환자가
 * 갇히는 일은 없다.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, Square, Volume2, VolumeX } from 'lucide-react';

import type { IntakeTranscribeResponse } from '@/app/api/intake/transcribe/route';

import { Button, DraftNotice, ErrorNotice } from './ui';
import { useSpeechSynthesis } from './useSpeechSynthesis';

export interface InterviewExchange {
  question: string;
  answer: string;
}

export interface InterviewStepProps {
  question: string;
  history: readonly InterviewExchange[];
  submitting: boolean;
  serverError: string | null;
  /** 완료 화면까지 설정이 이어지도록 부모가 소유한다. */
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onAnswer: (text: string) => void;
  /** 전사 업로드 인가에 필요하다. 둘 다 /api/intake/start 에서 온다. */
  encounterId: string;
  token: string;
  /** CLOVA 자격증명이 있는 배포에서만 true. */
  voiceEnabled: boolean;
}

/**
 * 턴별 UI 단계.
 * - `locked`       질문을 읽어주는 중. 마이크 비활성.
 * - `ready`        읽기가 끝났거나 건너뛰었다. 녹음 버튼 활성.
 * - `recording`    환자가 말하는 중.
 * - `transcribing` 클립을 CLOVA 가 변환 중.
 */
type Phase = 'locked' | 'ready' | 'recording' | 'transcribing';

/** 후보 컨테이너 형식, 선호 순. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg'
];

const TRANSCRIBE_FAILURE_MESSAGE = '음성 변환에 실패했습니다. 글자로 입력해 주세요.';
const MIC_DENIED_MESSAGE = '마이크 사용이 허용되지 않았습니다. 글자로 입력해 주세요.';

/**
 * `onend` 가 끝내 오지 않는 브라우저를 위해 TTS 뒤 마이크 잠금을 강제로 푸는
 * 상한. 예상 발화 길이보다 넉넉히 잡아서 정상적인 `onend` 해제가 항상 먼저
 * 이기도록 한다.
 */
const LOCK_FALLBACK_MIN_MS = 8000;
const LOCK_FALLBACK_MAX_MS = 25000;
const LOCK_FALLBACK_PER_CHAR_MS = 320;

function lockFallbackMs(question: string): number {
  return Math.min(
    LOCK_FALLBACK_MAX_MS,
    Math.max(LOCK_FALLBACK_MIN_MS, question.length * LOCK_FALLBACK_PER_CHAR_MS)
  );
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * 이 브라우저가 녹음을 할 수 있는지. useSyncExternalStore 로 읽어서 서버와
 * 클라이언트가 같은 마크업을 렌더링하게 하고, 하이드레이션 중에 녹음 버튼이
 * 번쩍 나타나지 않게 한다. 능력은 변하지 않으므로 subscribe 는 no-op 이다.
 */
function getRecordingSupportSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    pickMimeType() !== null
  );
}

function getUnsupportedServerSnapshot(): boolean {
  return false;
}

/** 전사 라우트가 비-2xx 와 함께 돌려주는 한국어 메시지를 읽는다. */
async function readTranscribeError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // 아래 일반 메시지로 떨어진다.
  }
  return TRANSCRIBE_FAILURE_MESSAGE;
}

export default function InterviewStep({
  question,
  history,
  submitting,
  serverError,
  muted,
  onMutedChange,
  onAnswer,
  encounterId,
  token,
  voiceEnabled
}: InterviewStepProps) {
  const recordingSupported = useSyncExternalStore(
    subscribeToNothing,
    getRecordingSupportSnapshot,
    getUnsupportedServerSnapshot
  );

  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState<Phase>('ready');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canRecord = voiceEnabled && recordingSupported;

  const clearLockTimer = useCallback(() => {
    if (lockTimerRef.current !== null) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }, []);

  const unlock = useCallback(() => {
    clearLockTimer();
    // 녹음/전사 중에 늦게 도착한 TTS onend 가 단계를 되돌리면 안 된다.
    setPhase((previous) => (previous === 'locked' ? 'ready' : previous));
  }, [clearLockTimer]);

  const { supported: speechSupported, speak, cancel } = useSpeechSynthesis({
    onEnd: unlock
  });

  // 새 질문: 입력창을 비우고, 읽어주는 동안 마이크를 잠근다.
  useEffect(() => {
    setAnswer('');
    setVoiceError(null);
    clearLockTimer();

    const willSpeak = !muted && speechSupported && canRecord;
    if (!willSpeak) {
      // 읽어주지 않을 거라면 잠글 이유가 없다. 음소거 환자가 풀리지 않을
      // 잠금을 기다리는 것이 이 화면의 가장 흔한 교착이었다.
      setPhase('ready');
      if (!muted && speechSupported) speak(question);
      return;
    }

    setPhase('locked');
    speak(question);
    lockTimerRef.current = setTimeout(unlock, lockFallbackMs(question));

    return clearLockTimer;
  }, [question, muted, speechSupported, canRecord, speak, unlock, clearLockTimer]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // 언마운트 시 마이크를 반드시 놓는다. 태블릿에 녹음 표시등이 켜진 채로
  // 남으면 다음 환자가 도청당한다고 생각한다.
  useEffect(() => () => stopStream(), [stopStream]);

  const uploadClip = useCallback(
    async (blob: Blob, mimeType: string) => {
      setPhase('transcribing');
      try {
        const form = new FormData();
        form.append('encounterId', encounterId);
        form.append('token', token);
        form.append('audio', blob, `intake.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`);

        const response = await fetch('/api/intake/transcribe', {
          method: 'POST',
          body: form
        });

        if (!response.ok) {
          setVoiceError(await readTranscribeError(response));
          return;
        }

        const data = (await response.json()) as IntakeTranscribeResponse;
        // 덧붙인다: 환자가 두 번 나눠 말할 수 있고, 먼저 친 글자를 지우면 안 된다.
        setAnswer((previous) => (previous ? `${previous} ${data.text}` : data.text));
      } catch (error) {
        console.error('[intake] Transcription upload failed.', error);
        setVoiceError(TRANSCRIBE_FAILURE_MESSAGE);
      } finally {
        setPhase('ready');
      }
    },
    [encounterId, token]
  );

  const startRecording = useCallback(async () => {
    const mimeType = pickMimeType();
    if (!mimeType) {
      setVoiceError(TRANSCRIBE_FAILURE_MESSAGE);
      return;
    }

    setVoiceError(null);
    // 마이크를 열기 전에 읽어주기를 멈춘다. 반이중의 핵심.
    cancel();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      console.warn('[intake] Microphone permission denied.', error);
      setVoiceError(MIC_DENIED_MESSAGE);
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stopStream();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (blob.size === 0) {
        setVoiceError('녹음된 내용이 없습니다. 다시 녹음하거나 글자로 입력해 주세요.');
        setPhase('ready');
        return;
      }
      void uploadClip(blob, mimeType);
    };

    recorder.start();
    setPhase('recording');
  }, [cancel, stopStream, uploadClip]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const handleSubmit = () => {
    const trimmed = answer.trim();
    if (trimmed === '') return;
    cancel();
    onAnswer(trimmed);
  };

  const busy = submitting || phase === 'transcribing';

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <p className="text-base font-semibold text-slate-500">
          질문 {history.length + 1}
        </p>
        {speechSupported ? (
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              onMutedChange(next);
              if (next) cancel();
            }}
            className="flex min-h-touch items-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-4 text-lg text-slate-700"
          >
            {muted ? (
              <VolumeX aria-hidden="true" className="size-6" />
            ) : (
              <Volume2 aria-hidden="true" className="size-6" />
            )}
            {muted ? '소리 켜기' : '소리 끄기'}
          </button>
        ) : null}
      </header>

      <h1 className="text-3xl font-bold leading-relaxed text-slate-900">{question}</h1>

      {canRecord ? (
        <div className="flex flex-col gap-3">
          {phase === 'recording' ? (
            <Button onClick={stopRecording} className="bg-red-600 hover:bg-red-700">
              <Square aria-hidden="true" className="size-6" />
              다 말했어요
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => void startRecording()}
              disabled={phase !== 'ready' || busy}
              loading={phase === 'transcribing'}
            >
              {phase === 'transcribing' ? null : (
                <Mic aria-hidden="true" className="size-6" />
              )}
              {phase === 'locked'
                ? '질문을 읽어드리는 중입니다'
                : phase === 'transcribing'
                  ? '말씀하신 내용을 옮기는 중입니다'
                  : '말로 답하기'}
            </Button>
          )}
          <p className="text-base text-slate-500">
            말로 답하기 어려우시면 아래에 글자로 적어 주셔도 됩니다.
          </p>
        </div>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className="text-lg font-semibold text-slate-800">답변</span>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="여기에 답을 적어 주세요."
          className="rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-xl leading-relaxed text-slate-900 placeholder:text-slate-400"
        />
      </label>

      {voiceError ? <ErrorNotice>{voiceError}</ErrorNotice> : null}
      {serverError ? <ErrorNotice>{serverError}</ErrorNotice> : null}

      <Button onClick={handleSubmit} loading={submitting} disabled={answer.trim() === '' || busy}>
        다음
      </Button>

      <DraftNotice />
    </section>
  );
}
