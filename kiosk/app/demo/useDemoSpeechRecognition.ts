'use client';

/**
 * 브라우저 Web Speech **인식** API — 핸즈프리 연속 대화용. **데모 전용이다.**
 *
 * [주의] 운영 문진은 이것을 일부러 쓰지 않는다. `app/api/intake/transcribe`
 * 주석에 적힌 대로 카카오톡 인앱 브라우저와 iOS Safari 에서 동작하지 않고
 * 안드로이드 Chrome 에서는 전사가 중복된다. 운영 경로는 MediaRecorder 클립을
 * 서버로 올려 CLOVA Speech 로 변환한다. 데모는 CLOVA 자격증명이 없고 방문코드
 * 게이트도 건너뛰므로, 지원되는 브라우저에서만 켜지는 부가 기능으로 쓴다.
 * 글자 입력창은 항상 떠 있으므로 인식이 없거나 실패해도 갇히지 않는다.
 *
 * 데모가 아닌 화면에 이 훅을 재사용하지 말 것.
 *
 * # 발화 종료 판정
 * 브라우저는 "환자가 말을 끝냈다" 를 알려주지 않는다. `isFinal` 결과는 한
 * 문장이 끝날 때마다 오므로 그것만 보고 제출하면 여러 문장짜리 답변이
 * 중간에서 잘린다. 그래서 **마지막 결과 이후 침묵 {@link SILENCE_MS}** 을
 * 발화 종료로 본다. 결과(중간·확정 모두)가 올 때마다 타이머를 다시 건다.
 *
 * # 자동 재시작
 * Chrome 은 침묵이 길어지면 인식을 스스로 끝낸다(`onend`). 핸즈프리에서는 그게
 * 곧 대화 중단이므로, 듣기를 원하는 동안에는 `onend` 에서 다시 켠다. 대신
 * 무한 재시작이 되지 않도록 빈 인식이 연속 {@link MAX_EMPTY_RESTARTS} 번
 * 나오면 호출부에 알려서 안내를 띄우게 한다(듣기는 계속한다).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * 마지막 인식 결과 이후 이만큼 조용하면 발화가 끝났다고 본다.
 *
 * 짧으면 문장 사이 숨 쉬는 동안 잘리고, 길면 대화가 굼떠 보인다. 고령 환자가
 * 천천히 말하는 것을 감안해 1.4초로 잡았다.
 */
const SILENCE_MS = 1400;

/** 이만큼 연속으로 빈 인식이 나오면 "잘 안 들려요" 안내를 띄운다. */
const MAX_EMPTY_RESTARTS = 3;

/**
 * `onend` 직후 곧바로 `start()` 를 부르면 일부 브라우저가 InvalidStateError 를
 * 던진다. 한 틱 물러섰다가 켠다.
 */
const RESTART_DELAY_MS = 120;

/** DOM 표준 라이브러리에 아직 없어서 쓰는 최소 표면. */
interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechCapableWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as SpeechCapableWindow;
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function subscribeToNothing(): () => void {
  return () => {};
}

function isSupportedSnapshot(): boolean {
  return recognitionConstructor() !== null;
}

/** 서버 렌더에서는 항상 "지원 안 함". 하이드레이션 불일치를 막는다. */
function getServerSnapshot(): boolean {
  return false;
}

const MIC_DENIED_MESSAGE = '마이크 사용이 허용되지 않았습니다. 글자로 입력해 주세요.';
const RECOGNITION_FAILURE_MESSAGE = '음성 인식에 실패했습니다. 글자로 입력해 주세요.';

export interface UseDemoSpeechRecognitionOptions {
  /**
   * 발화가 끝났다고 판정됐을 때 한 번 호출된다. 호출 시점에 인식은 이미 꺼져
   * 있으므로, 호출부는 모델 호출이 끝난 뒤 다시 {@link start} 하면 된다.
   */
  onUtterance: (text: string) => void;
  /** 빈 인식이 연속으로 쌓였을 때. 듣기는 계속되므로 안내만 띄우면 된다. */
  onTrouble?: () => void;
}

export interface UseDemoSpeechRecognitionResult {
  supported: boolean;
  listening: boolean;
  /** 인식 중인 중간 결과. 확정 전에 화면에 미리 보여준다. */
  interim: string;
  error: string | null;
  /** 새 듣기 세션을 시작한다. 이전 세션의 남은 결과는 버려진다. */
  start: () => void;
  /** 듣기를 끝낸다. 모아둔 미확정 발화는 버린다. */
  stop: () => void;
  clearError: () => void;
}

export function useDemoSpeechRecognition({
  onUtterance,
  onTrouble
}: UseDemoSpeechRecognitionOptions): UseDemoSpeechRecognitionResult {
  const supported = useSyncExternalStore(
    subscribeToNothing,
    isSupportedSnapshot,
    getServerSnapshot
  );

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyCountRef = useRef(0);

  /** 지금 듣기를 **원하는가**. `onend` 가 재시작할지 말지의 단일 기준이다. */
  const wantListeningRef = useRef(false);

  /**
   * 듣기 세션 번호. 제출·중단 때 올린다. 이전 세션에서 늦게 도착한 결과를
   * 버리는 데 쓴다 — 모델 호출 중에 도착한 옛 인식이 다음 턴 답변에 섞여
   * 들어가는 것이 Flutter 판에서 실제로 났던 버그다.
   */
  const sessionRef = useRef(0);

  // 콜백은 ref 로 최신값을 본다. 인식 객체를 매 렌더마다 다시 만들지 않기 위해서다.
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const onTroubleRef = useRef(onTrouble);
  useEffect(() => {
    onTroubleRef.current = onTrouble;
  }, [onTrouble]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = 'ko-KR';
    // 핸즈프리이므로 연속 인식. 그래도 Chrome 은 침묵이 길면 스스로 끝내므로
    // `onend` 재시작이 함께 필요하다.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (event) => {
      // 이미 제출했거나 멈춘 세션의 늦은 결과는 버린다.
      if (!wantListeningRef.current) return;

      let pending = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) transcriptRef.current += transcript;
        else pending += transcript;
      }
      setInterim(pending);

      // 무언가 들리는 동안에는 발화가 계속되는 것으로 본다. 침묵 시계를 다시 건다.
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        const text = transcriptRef.current.trim();
        // 확정된 말이 없으면 제출하지 않는다. 잡음만 들어온 경우다.
        if (text === '') return;

        // 제출 = 이 세션의 끝. 순서가 중요하다: 먼저 원하지 않는다고 표시해야
        // `onend` 가 재시작하지 않고, 늦은 결과도 위에서 걸러진다.
        wantListeningRef.current = false;
        sessionRef.current += 1;
        transcriptRef.current = '';
        emptyCountRef.current = 0;
        clearSilenceTimer();
        setInterim('');
        recognition.abort();
        setListening(false);
        onUtteranceRef.current(text);
      }, SILENCE_MS);
    };

    recognition.onerror = (event) => {
      // 사용자가 멈췄거나 아무 말도 없었던 경우는 고장이 아니다. no-speech 는
      // `onend` 재시작 경로가 알아서 처리한다.
      if (event.error === 'aborted' || event.error === 'no-speech') return;

      wantListeningRef.current = false;
      sessionRef.current += 1;
      clearSilenceTimer();
      setListening(false);
      setInterim('');
      setError(event.error === 'not-allowed' ? MIC_DENIED_MESSAGE : RECOGNITION_FAILURE_MESSAGE);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim('');

      // 제출·중단으로 끝난 것이면 여기서 끝이다.
      if (!wantListeningRef.current) return;

      // Chrome 이 침묵 때문에 끊은 것이다. 아직 듣기를 원하므로 다시 켠다.
      // 모아둔 말은 지우지 않는다 — 재시작을 사이에 두고도 한 발화로 이어진다.
      if (transcriptRef.current.trim() === '') {
        emptyCountRef.current += 1;
        if (emptyCountRef.current >= MAX_EMPTY_RESTARTS) {
          emptyCountRef.current = 0;
          onTroubleRef.current?.();
        }
      }

      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        if (!wantListeningRef.current) return;
        try {
          recognition.start();
        } catch {
          // 이미 켜져 있으면 InvalidStateError. 무시해도 안전하다.
        }
      }, RESTART_DELAY_MS);
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      clearSilenceTimer();
      clearRestartTimer();
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [clearRestartTimer, clearSilenceTimer]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    // 새 세션: 이전 세션의 잔여물을 전부 버린다.
    sessionRef.current += 1;
    transcriptRef.current = '';
    emptyCountRef.current = 0;
    clearSilenceTimer();
    clearRestartTimer();
    setInterim('');
    wantListeningRef.current = true;

    try {
      recognition.start();
    } catch {
      // 이미 켜져 있는 경우. 그대로 두면 된다.
    }
  }, [clearRestartTimer, clearSilenceTimer]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    sessionRef.current += 1;
    transcriptRef.current = '';
    clearSilenceTimer();
    clearRestartTimer();
    setInterim('');
    setListening(false);
    recognitionRef.current?.abort();
  }, [clearRestartTimer, clearSilenceTimer]);

  const clearError = useCallback(() => setError(null), []);

  return { supported, listening, interim, error, start, stop, clearError };
}
