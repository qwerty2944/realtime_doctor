'use client';

/**
 * 0단계: 접수처에서 받은 방문 코드.
 *
 * 이 화면이 존재하는 이유는 배포구조 문서 4장이다 — 공개 주소에서 슬러그만으로
 * 문진을 시작할 수 있으면, 의사가 본 적 없는 사람과 AI 가 나눈 대화가 그 의사
 * 이름으로 대기목록에 쌓인다.
 *
 * QR 로 들어온 환자는 이 화면을 보지 않는다(URL 의 `?c=` 가 이미 코드를
 * 들고 있고, 서버가 미리 확인해 준다). 코드를 손으로 입력하는 환자만 여기서
 * 시작하므로, AI 고지도 이 화면에 함께 붙는다 — **환자가 처음 보는 화면**이
 * 둘 중 어느 쪽이든 고지는 거기 있어야 한다.
 *
 * 입력 편의(고령 환자 · 접수처가 불러주는 코드):
 *   - 대문자로 자동 변환, 4-3 하이픈 자동 삽입
 *   - 헷갈리는 글자(O, I, L, 0, 1 …)는 애초에 코드에 쓰이지 않으므로 입력에서
 *     조용히 버려진다. 다른 글자로 고쳐 넣지 않는다 — 오타가 남의 코드로
 *     바뀌는 것이 오타로 거절되는 것보다 나쁘다.
 *   - `inputMode="text"` + `autoCapitalize="characters"`: 태블릿 키보드가
 *     대문자로 열린다.
 */

import { useState } from 'react';

import type { IntakeDisclosure } from '@/lib/intake/disclosure';
import {
  formatVisitCode,
  isVisitCodeShaped,
  normalizeVisitCode,
  VISIT_CODE_LENGTH
} from '@/lib/intake/visitCode';

import AiDisclosure from './AiDisclosure';
import { Button, ErrorNotice } from './ui';

export interface VisitCodeStepProps {
  disclosure: IntakeDisclosure;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (code: string) => void;
}

export default function VisitCodeStep({
  disclosure,
  submitting,
  serverError,
  onSubmit
}: VisitCodeStepProps) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  const normalized = normalizeVisitCode(value);
  const ready = isVisitCodeShaped(normalized);
  const showLengthHint = touched && !ready && normalized.length > 0;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-slate-900">접수 코드를 입력해 주세요</h1>
        <p className="text-xl leading-relaxed text-slate-600">
          접수처에서 받으신 {VISIT_CODE_LENGTH}자리 코드를 입력하시면 문진이 시작됩니다.
          코드가 없으시면 접수처에 말씀해 주세요.
        </p>
      </header>

      <AiDisclosure disclosure={disclosure} />

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!ready || submitting) return;
          onSubmit(normalized);
        }}
      >
        <label htmlFor="visit-code" className="text-lg font-semibold text-slate-800">
          접수 코드
          <span className="ml-2 text-base text-red-600">필수</span>
        </label>
        <input
          id="visit-code"
          name="visit-code"
          value={formatVisitCode(value)}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoCapitalize="characters"
          inputMode="text"
          aria-describedby="visit-code-hint"
          // 코드는 읽으면서 따라 치는 값이다. 크고, 자간을 벌리고, 고정폭으로.
          className="min-h-touch rounded-2xl border-2 border-slate-300 bg-white px-4 py-4 text-center font-mono text-4xl tracking-[0.3em] text-slate-900 placeholder:tracking-normal placeholder:text-2xl placeholder:text-slate-400"
          placeholder="예) A2CD-4EF"
        />
        <p id="visit-code-hint" className="text-base leading-relaxed text-slate-500">
          영문 대문자와 숫자로만 되어 있습니다. 하이픈(-)은 자동으로 들어가니
          입력하지 않으셔도 됩니다.
        </p>

        {showLengthHint ? (
          <p role="alert" className="text-lg font-medium text-red-600">
            코드는 {VISIT_CODE_LENGTH}자리입니다. 다시 확인해 주세요.
          </p>
        ) : null}

        {serverError ? <ErrorNotice>{serverError}</ErrorNotice> : null}

        <Button type="submit" disabled={!ready} loading={submitting}>
          다음
        </Button>
      </form>
    </section>
  );
}
