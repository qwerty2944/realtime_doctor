'use client';

/**
 * Web Speech Synthesis API 로 AI 질문을 읽어준다.
 * 고령 환자에게는 질문이 보이는 것만으로 부족하고 들려야 한다.
 *
 * 음소거 상태는 호출자가 소유한다. 이 훅은 브라우저가 못 할 때만 말하기를
 * 거부한다.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** 기본보다 살짝 느리게. 한국어를 따라가기 쉽도록. */
const SPEECH_RATE = 0.95;

function subscribeToNothing(): () => void {
  return () => {};
}

function isSupportedSnapshot(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** 서버 렌더에서는 항상 "지원 안 함". 하이드레이션 불일치를 막는다. */
function getServerSnapshot(): boolean {
  return false;
}

export interface UseSpeechSynthesisOptions {
  lang?: string;
  /**
   * 발화가 끝나거나 에러로 종료될 때 한 번 호출된다. 반이중(half-duplex)
   * 녹음기가 "TTS 끝났으니 마이크 열어라" 신호로 쓴다 — 일부 브라우저가
   * 레이스를 내는 `speaking` 플래그를 지켜보는 것보다 믿을 만하다.
   */
  onEnd?: () => void;
}

export interface UseSpeechSynthesisResult {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  cancel: () => void;
}

export function useSpeechSynthesis(
  options: UseSpeechSynthesisOptions = {}
): UseSpeechSynthesisResult {
  const { lang = 'ko-KR', onEnd } = options;

  const supported = useSyncExternalStore(
    subscribeToNothing,
    isSupportedSnapshot,
    getServerSnapshot
  );

  const [speaking, setSpeaking] = useState(false);

  // ref 에 담아서 `speak` 가 안정적으로 유지되면서도 항상 최신 콜백을 부르게
  // 한다. 발화 객체가 만들어질 때 캡처된 낡은 콜백이 아니라.
  const onEndRef = useRef<(() => void) | undefined>(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  // 지금 onEnd 핸들러를 쥐고 있는 발화. 큐를 비울 때(speak 또는 cancel) 이전
  // 발화의 핸들러를 **먼저** 떼어내기 위해 추적한다 — 안 그러면 취소가
  // `onend` 를 쏘고, 반이중 녹음기가 그걸 "질문이 끝났다, 마이크 열어라" 로
  // 읽어서 너무 일찍 잠금을 푼다. React StrictMode 의 이중 마운트에서도 안전해진다.
  const currentRef = useRef<SpeechSynthesisUtterance | null>(null);

  const detachCurrent = useCallback(() => {
    const utterance = currentRef.current;
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
      currentRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (isSupportedSnapshot()) {
        detachCurrent();
        window.speechSynthesis.cancel();
      }
    },
    [detachCurrent]
  );

  const speak = useCallback(
    (text: string) => {
      if (!isSupportedSnapshot() || text.trim() === '') return;

      detachCurrent();
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = SPEECH_RATE;

      const finish = () => {
        setSpeaking(false);
        onEndRef.current?.();
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      currentRef.current = utterance;
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [detachCurrent, lang]
  );

  const cancel = useCallback(() => {
    if (!isSupportedSnapshot()) return;
    detachCurrent();
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [detachCurrent]);

  return { supported, speaking, speak, cancel };
}
