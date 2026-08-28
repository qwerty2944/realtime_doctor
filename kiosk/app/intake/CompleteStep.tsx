'use client';

/** 4단계: 완료 화면. */

import { useEffect } from 'react';
import { CircleCheck } from 'lucide-react';

import { DraftNotice } from './ui';
import { useSpeechSynthesis } from './useSpeechSynthesis';

const RESULT_TITLE = '문진이 완료되었습니다';
const RESULT_SUPPORT = '잠시 후 진료실로 안내됩니다';
const COMPLETION_SPEECH = `${RESULT_TITLE}. ${RESULT_SUPPORT}`;

export interface CompleteStepProps {
  /** AI 의 마무리 인사. 고정 완료 문구 아래에 보여준다. */
  closingMessage: string;
  muted: boolean;
}

export default function CompleteStep({ closingMessage, muted }: CompleteStepProps) {
  const { speak } = useSpeechSynthesis();

  useEffect(() => {
    if (!muted) speak(COMPLETION_SPEECH);
  }, [muted, speak]);

  return (
    <section className="flex flex-col items-center gap-6 py-12 text-center">
      <span className="flex size-20 items-center justify-center rounded-full bg-green-100">
        <CircleCheck aria-hidden="true" className="size-12 text-green-700" />
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-900">{RESULT_TITLE}</h1>
        <p className="text-xl text-slate-600">{RESULT_SUPPORT}</p>
      </div>

      {closingMessage.trim() === '' ? null : (
        <p className="text-lg leading-relaxed text-slate-600">{closingMessage}</p>
      )}

      <p className="text-base text-slate-500">
        이 화면을 닫으셔도 됩니다. 문진 내용은 담당 의사에게 전달되었습니다.
      </p>

      <DraftNotice className="mt-2" />
    </section>
  );
}
