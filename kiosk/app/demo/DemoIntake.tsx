'use client';

/**
 * 대화형 문진 데모 화면.
 *
 * 운영 문진(app/intake)과의 차이는 셋뿐이고, 전부 "데모라서" 다.
 *   1. 방문코드 게이트가 없다. 누구나 URL 로 바로 들어온다.
 *   2. 저장이 없다. 대화와 수집 항목은 이 컴포넌트 메모리에만 있고,
 *      새로고침하면 사라진다. Supabase 에 아무것도 쓰지 않는다.
 *   3. 한 질문 = 한 화면이 아니라 말풍선 대화다. 7항목 체크리스트를 채우는
 *      과정을 보여주는 것이 데모의 목적이기 때문이다.
 *
 * # 핸즈프리 루프
 * 「시작」을 한 번 누르면 7항목이 다 찰 때까지 버튼을 누르지 않는다.
 *
 *   말하는 중(TTS) ──읽기 끝──▶ 듣는 중(마이크) ──침묵 감지──▶ 생각 중(모델)
 *        ▲                                                          │
 *        └──────────────────────  답변 도착  ◀────────────────────────┘
 *
 * 반이중(HALF-DUPLEX)을 지킨다: 말하는 중·생각 중에는 마이크가 아예 꺼져 있다.
 * 안 그러면 AI 가 자기 목소리를 받아적는다 — Flutter 판에서 실제로 났던 실패다.
 * 같은 이유로 이전 듣기 세션의 늦은 인식 결과는 훅에서 버린다.
 *
 * 갇히지 않는 것이 핸즈프리보다 우선이다. 「일시정지」는 항상 보이고, 글자
 * 입력창도 항상 살아 있다(타이핑하면 음성 루프가 멈춘다). 음성 인식이 없는
 * 브라우저(iOS Safari)는 처음부터 글자 입력만으로 돈다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Ear, Loader2, Mic, Pause, Send, Volume2, VolumeX } from 'lucide-react';

import type { DemoSummaryResponse, DemoTurnResponse } from '@/app/api/demo-turn/route';
import { useSpeechSynthesis } from '@/app/intake/useSpeechSynthesis';
import { Button, DraftNotice, ErrorNotice } from '@/app/intake/ui';
import { apiPath } from '@/lib/basePath';
import {
  INTAKE_FIELDS,
  INTAKE_FIELD_LABELS,
  isComplete,
  recordField,
  type IntakeMessage,
  type IntakeRecord
} from '@/lib/demo/intake';

import { useDemoSpeechRecognition } from './useDemoSpeechRecognition';

const GREETING =
  '안녕하세요, 접수 도우미입니다. 진료 전에 몇 가지만 여쭤볼게요. 오늘 어디가 어떻게 불편해서 오셨나요?';

/** 서버 라우트의 상한과 맞춘 클라이언트 방어선. */
const MAX_TURNS = 40;
const MAX_MESSAGE_LENGTH = 500;

const TURN_FAILURE_MESSAGE = '문진 도우미가 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const TROUBLE_HINT = '잘 안 들려요. 조금 더 크게 말씀해 주시겠어요?';

/**
 * `onend` 가 끝내 오지 않는 브라우저를 위해 읽기 종료를 강제하는 상한.
 * 이게 없으면 핸즈프리 루프가 "말하는 중" 에서 영영 멈춘다.
 * (app/intake/InterviewStep.tsx 의 같은 방어를 그대로 가져왔다.)
 */
const SPEECH_FALLBACK_MIN_MS = 8000;
const SPEECH_FALLBACK_MAX_MS = 25000;
const SPEECH_FALLBACK_PER_CHAR_MS = 320;

function speechFallbackMs(text: string): number {
  return Math.min(
    SPEECH_FALLBACK_MAX_MS,
    Math.max(SPEECH_FALLBACK_MIN_MS, text.length * SPEECH_FALLBACK_PER_CHAR_MS)
  );
}

/**
 * 대화 단계.
 * - `chat`    대화 중.
 * - `summary` 7항목이 다 찼고 확인 카드를 보여주는 중.
 * - `done`    환자가 확인을 눌렀다.
 */
type Phase = 'chat' | 'summary' | 'done';

/**
 * 음성 루프의 현재 위치. 화면에 글자로도 보여준다 — 색이나 애니메이션만으로
 * 상태를 구분하지 않는다.
 */
type Stage = 'idle' | 'speaking' | 'listening' | 'thinking';

/** 라우트가 비-2xx 와 함께 돌려주는 한국어 메시지를 읽는다. */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
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
  return fallback;
}

export default function DemoIntake() {
  const [messages, setMessages] = useState<IntakeMessage[]>([
    { role: 'assistant', text: GREETING }
  ]);
  const [record, setRecord] = useState<IntakeRecord>({});
  const [phase, setPhase] = useState<Phase>('chat');
  const [stage, setStage] = useState<Stage>('idle');
  const [summary, setSummary] = useState('');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // state 는 비동기라 즉시 반영되지 않는다. 중복 전송은 ref 로 막는다.
  const submittingRef = useRef(false);
  /** 핸즈프리 루프가 돌고 있는가. 콜백 안에서는 이 ref 만 믿는다. */
  const voiceActiveRef = useRef(false);

  /** 읽기가 끝나면 할 일. TTS onend 와 강제 종료 타이머가 공유한다. */
  const afterSpeechRef = useRef<(() => void) | null>(null);
  const speechFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 훅이 만들어지기 전에 정의되는 콜백들이 마이크를 제어할 수 있게 하는 우회로.
   * (`send` 가 훅의 `onUtterance` 로 들어가므로 정의 순서가 뒤집혀 있다.)
   */
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef = useRef<() => void>(() => {});

  /** onend 와 강제 타이머 중 먼저 온 쪽만 이긴다. */
  const runAfterSpeech = useCallback(() => {
    if (speechFallbackTimerRef.current !== null) {
      clearTimeout(speechFallbackTimerRef.current);
      speechFallbackTimerRef.current = null;
    }
    const next = afterSpeechRef.current;
    afterSpeechRef.current = null;
    next?.();
  }, []);

  const { supported: speechSupported, speak, cancel } = useSpeechSynthesis({
    onEnd: runAfterSpeech
  });

  /** 읽기를 끊는다. 예약된 후속 동작도 함께 버린다. */
  const stopSpeaking = useCallback(() => {
    if (speechFallbackTimerRef.current !== null) {
      clearTimeout(speechFallbackTimerRef.current);
      speechFallbackTimerRef.current = null;
    }
    afterSpeechRef.current = null;
    cancel();
  }, [cancel]);

  /**
   * 읽어준 다음 `next` 를 실행한다. 음소거이거나 TTS 가 없으면 기다릴 이유가
   * 없으므로 즉시 `next` 로 넘어간다 — 영영 오지 않을 onend 를 기다리는 것이
   * 이 화면에서 가장 흔한 교착이다.
   */
  const speakThen = useCallback(
    (text: string, next: () => void) => {
      if (muted || !speechSupported || text.trim() === '') {
        next();
        return;
      }
      afterSpeechRef.current = next;
      speak(text);
      if (speechFallbackTimerRef.current !== null) {
        clearTimeout(speechFallbackTimerRef.current);
      }
      speechFallbackTimerRef.current = setTimeout(runAfterSpeech, speechFallbackMs(text));
    },
    [muted, runAfterSpeech, speak, speechSupported]
  );

  const beginListening = useCallback(() => {
    if (!voiceActiveRef.current) return;
    setStage('listening');
    startListeningRef.current();
  }, []);

  /** 핸즈프리 루프를 멈춘다. 마이크와 읽기를 모두 끈다. */
  const stopVoiceLoop = useCallback(() => {
    voiceActiveRef.current = false;
    setVoiceActive(false);
    setStage('idle');
    setHint(null);
    stopSpeaking();
    stopListeningRef.current();
  }, [stopSpeaking]);

  const requestSummary = useCallback(
    async (finalRecord: IntakeRecord) => {
      setPhase('summary');
      setSubmitting(true);
      try {
        const response = await fetch(apiPath('/api/demo-turn'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'summary', record: finalRecord })
        });

        if (!response.ok) {
          setServerError(await readErrorMessage(response, TURN_FAILURE_MESSAGE));
          return;
        }

        const data = (await response.json()) as DemoSummaryResponse;
        setSummary(data.summary);
        if (!muted && speechSupported) speak(data.summary);
      } catch (error) {
        console.error('[demo] Summary request failed.', error);
        setServerError(TURN_FAILURE_MESSAGE);
      } finally {
        setSubmitting(false);
      }
    },
    [muted, speak, speechSupported]
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (text === '' || submittingRef.current || phase !== 'chat') return;

      if (messages.length >= MAX_TURNS) {
        stopVoiceLoop();
        setServerError('대화가 너무 길어졌습니다. 새로고침해서 다시 시작해 주세요.');
        return;
      }

      // 환자가 말하거나 쓰기 시작하면 읽어주던 안내를 끊는다.
      stopSpeaking();
      setServerError(null);
      setHint(null);
      setDraft('');
      submittingRef.current = true;
      setSubmitting(true);
      // 모델을 기다리는 동안 마이크는 꺼진 채로 둔다(반이중).
      if (voiceActiveRef.current) setStage('thinking');

      const history: IntakeMessage[] = [...messages, { role: 'patient', text }];
      setMessages(history);

      try {
        const response = await fetch(apiPath('/api/demo-turn'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'turn', history, record })
        });

        if (!response.ok) {
          // 조용히 멈춘 것처럼 보이지 않도록 루프를 접고 이유를 보여준다.
          stopVoiceLoop();
          setServerError(await readErrorMessage(response, TURN_FAILURE_MESSAGE));
          return;
        }

        const data = (await response.json()) as DemoTurnResponse;

        let next = record;
        for (const call of data.calls) {
          next = recordField(next, call.field, call.value);
        }
        setRecord(next);
        setMessages((previous) => [...previous, { role: 'assistant', text: data.reply }]);

        if (isComplete(next)) {
          // 확인 카드는 환자의 선택이 필요하다. 여기서 핸즈프리를 끝낸다.
          stopVoiceLoop();
          void requestSummary(next);
          return;
        }

        if (voiceActiveRef.current) {
          setStage('speaking');
          speakThen(data.reply, beginListening);
          return;
        }

        if (!muted && speechSupported) speak(data.reply);
      } catch (error) {
        console.error('[demo] Turn request failed.', error);
        stopVoiceLoop();
        setServerError(TURN_FAILURE_MESSAGE);
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [
      beginListening,
      messages,
      muted,
      phase,
      record,
      requestSummary,
      speak,
      speakThen,
      speechSupported,
      stopSpeaking,
      stopVoiceLoop
    ]
  );

  const handleTrouble = useCallback(() => setHint(TROUBLE_HINT), []);

  const recognition = useDemoSpeechRecognition({ onUtterance: send, onTrouble: handleTrouble });

  // 훅이 만들어진 뒤에야 마이크를 만질 수 있다. 위쪽 콜백들은 이 ref 를 통해 부른다.
  const { start: startRecognition, stop: stopRecognition } = recognition;
  useEffect(() => {
    startListeningRef.current = startRecognition;
    stopListeningRef.current = stopRecognition;
  }, [startRecognition, stopRecognition]);

  // 언마운트 시 마이크를 반드시 놓는다. 태블릿에 녹음 표시등이 남으면
  // 다음 사람이 도청당한다고 생각한다.
  useEffect(
    () => () => {
      voiceActiveRef.current = false;
      stopRecognition();
    },
    [stopRecognition]
  );

  // 새 말풍선이 붙으면 항상 최신 내용이 보이게 한다.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, phase, summary, stage]);

  const startVoiceLoop = () => {
    recognition.clearError();
    setServerError(null);
    setHint(null);
    voiceActiveRef.current = true;
    setVoiceActive(true);

    // 마지막 AI 발화부터 이어간다. 처음이면 인사말이다.
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    setStage('speaking');
    speakThen(lastAssistant?.text ?? GREETING, beginListening);
  };

  const pauseVoiceLoop = () => stopVoiceLoop();

  const downloadJson = () => {
    const payload = { fields: record, summary, generatedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `intake-demo-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const filledCount = INTAKE_FIELDS.filter((field) => record[field]).length;
  const inputDisabled = submitting || phase !== 'chat';

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      <header className="shrink-0 border-b-2 border-slate-200 bg-white px-4 py-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">문진 도우미</h1>
              <p className="text-base text-slate-500">
                문진 항목 {filledCount} / {INTAKE_FIELDS.length}
              </p>
            </div>
            {speechSupported ? (
              <button
                type="button"
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  // 음소거로 바꾸면 읽는 중이던 말을 끊는다. 핸즈프리 중이라면
                  // 읽기를 기다릴 이유가 없어졌으므로 바로 듣기로 넘어간다.
                  if (next) {
                    const pending = afterSpeechRef.current;
                    stopSpeaking();
                    if (voiceActiveRef.current && pending) pending();
                  }
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
          </div>

          <ul className="flex flex-wrap gap-2">
            {INTAKE_FIELDS.map((field) => {
              const done = Boolean(record[field]);
              return (
                <li
                  key={field}
                  className={`flex items-center gap-1 rounded-full border-2 px-3 py-1 text-base ${
                    done
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-300 bg-white text-slate-500'
                  }`}
                >
                  {/* 상태를 색으로만 구분하지 않는다 — 체크 표시를 함께 쓴다. */}
                  {done ? <Check aria-hidden="true" className="size-4" /> : null}
                  {INTAKE_FIELD_LABELS[field]}
                  <span className="sr-only">{done ? ' 수집 완료' : ' 아직 수집 안 됨'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'assistant' ? 'justify-start' : 'justify-end'}`}
            >
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-5 py-3 text-xl leading-relaxed ${
                  message.role === 'assistant'
                    ? 'rounded-bl-md border-2 border-slate-200 bg-white text-slate-900'
                    : 'rounded-br-md bg-blue-600 text-white'
                }`}
              >
                {message.text}
              </p>
            </div>
          ))}

          {recognition.interim !== '' ? (
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-400 px-5 py-3 text-xl leading-relaxed text-white">
                {recognition.interim}
              </p>
            </div>
          ) : null}

          {phase !== 'chat' && summary !== '' ? (
            <section className="flex flex-col gap-4 rounded-2xl border-2 border-slate-300 bg-white p-5">
              <h2 className="text-xl font-bold text-slate-900">문진 내용 확인</h2>
              <p className="whitespace-pre-wrap text-lg leading-relaxed text-slate-800">
                {summary}
              </p>

              <dl className="flex flex-col divide-y-2 divide-slate-100 border-t-2 border-slate-100">
                {INTAKE_FIELDS.map((field) => (
                  <div key={field} className="flex gap-4 py-3">
                    <dt className="w-32 shrink-0 text-base font-semibold text-slate-500">
                      {INTAKE_FIELD_LABELS[field]}
                    </dt>
                    <dd className="flex-1 text-lg text-slate-900">{record[field] ?? '-'}</dd>
                  </div>
                ))}
              </dl>

              {phase === 'summary' ? (
                <div className="flex flex-col gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      stopSpeaking();
                      setPhase('chat');
                    }}
                  >
                    더 말할게요
                  </Button>
                  <Button
                    onClick={() => {
                      stopSpeaking();
                      setPhase('done');
                    }}
                  >
                    확인
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-lg font-semibold text-blue-800">
                    문진이 완료되었습니다. 접수처에 알려 주세요.
                  </p>
                  <Button variant="secondary" onClick={downloadJson}>
                    문진 결과 내려받기 (JSON)
                  </Button>
                </div>
              )}
            </section>
          ) : null}

          {hint ? <p className="text-lg font-medium text-amber-700">{hint}</p> : null}
          {recognition.error ? <ErrorNotice>{recognition.error}</ErrorNotice> : null}
          {serverError ? <ErrorNotice>{serverError}</ErrorNotice> : null}
        </div>
      </div>

      <footer className="shrink-0 border-t-2 border-slate-200 bg-white px-4 py-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          {recognition.supported && phase === 'chat' ? (
            voiceActive ? (
              <>
                <VoiceStatus stage={stage} />
                <Button variant="secondary" onClick={pauseVoiceLoop}>
                  <Pause aria-hidden="true" className="size-6" />
                  일시정지
                </Button>
              </>
            ) : (
              <>
                <Button onClick={startVoiceLoop} disabled={submitting}>
                  <Mic aria-hidden="true" className="size-6" />
                  {messages.length > 1 ? '음성으로 계속하기' : '음성으로 시작하기'}
                </Button>
                <p className="text-base text-slate-500">
                  한 번만 누르시면 됩니다. 이후에는 말씀만 하시면 대화가 이어집니다.
                </p>
              </>
            )
          ) : null}

          {!recognition.supported ? (
            <p className="text-base text-slate-500">
              이 브라우저에서는 말로 답하기를 쓸 수 없습니다. 아래에 글자로 적어 주세요.
            </p>
          ) : null}

          <label className="flex flex-col gap-2">
            <span className="sr-only">답변</span>
            <textarea
              value={draft}
              onChange={(event) => {
                // 글자로 답하기 시작하면 음성 루프를 멈춘다. 두 입력이 동시에
                // 돌면 어느 쪽이 제출될지 환자가 예측할 수 없다.
                if (voiceActiveRef.current) pauseVoiceLoop();
                else stopSpeaking();
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              rows={2}
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={inputDisabled}
              placeholder={
                phase === 'chat' ? '여기에 답을 적어 주세요.' : '문진 내용을 확인해 주세요.'
              }
              className="rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-xl leading-relaxed text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100"
            />
          </label>

          <Button
            onClick={() => void send(draft)}
            loading={submitting}
            disabled={draft.trim() === '' || inputDisabled}
          >
            <Send aria-hidden="true" className="size-6" />
            보내기
          </Button>

          <DraftNotice />
          <p className="text-base leading-relaxed text-slate-500">
            이 화면은 데모입니다. 의료 조언이 아니며, 입력하신 내용은 저장되지 않습니다.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * 지금 무슨 일이 일어나는지 글자와 아이콘으로 같이 보여준다. 고령 환자가
 * 화면을 읽지 않아도 알아볼 수 있도록 듣는 중에는 마이크가 함께 깜빡인다.
 */
function VoiceStatus({ stage }: { stage: Stage }) {
  const view = {
    idle: null,
    speaking: {
      icon: <Volume2 aria-hidden="true" className="size-7" />,
      label: '말하는 중입니다',
      hint: '잠시만 들어주세요.',
      tone: 'border-slate-300 bg-slate-50 text-slate-700',
      pulse: false
    },
    listening: {
      icon: <Ear aria-hidden="true" className="size-7" />,
      label: '듣는 중입니다',
      hint: '편하게 말씀하세요. 다 말씀하시면 잠시 후 자동으로 넘어갑니다.',
      tone: 'border-blue-600 bg-blue-50 text-blue-800',
      pulse: true
    },
    thinking: {
      icon: <Loader2 aria-hidden="true" className="size-7 animate-spin" />,
      label: '생각 중입니다',
      hint: '잠시만 기다려 주세요.',
      tone: 'border-slate-300 bg-slate-50 text-slate-700',
      pulse: false
    }
  }[stage];

  if (!view) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-4 ${view.tone}`}
    >
      <span className={view.pulse ? 'animate-pulse' : undefined}>{view.icon}</span>
      <span className="flex flex-col">
        <span className="text-xl font-bold">{view.label}</span>
        <span className="text-base">{view.hint}</span>
      </span>
    </div>
  );
}
