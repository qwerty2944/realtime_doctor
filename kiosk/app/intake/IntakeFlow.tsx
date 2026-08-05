'use client';

/**
 * 네 단계짜리 문진 흐름: 동의 → 환자 정보 → AI 문진 → 완료.
 *
 * 모든 LLM·Supabase 접근은 /api/intake/* 뒤에서 일어난다. 이 컴포넌트는 그
 * 라우트들하고만 이야기하므로 API 키나 서비스 롤 키가 클라이언트에 존재하지
 * 않는다.
 *
 * 대화 기록(`turns`)은 여기 컴포넌트 상태에 있고 매 턴 서버로 되돌아간다.
 * 이 스키마에는 righthand 의 `messages` 테이블에 해당하는 것이 없기 때문이다
 * (근거는 `lib/intake/interview.ts`). 문진이 끝나면 서버가 전문을
 * `intake_results.soap_json.transcript` 에 저장한다.
 */

import { useState, type ReactNode } from 'react';

import type { IntakeStartResponse } from '@/app/api/intake/start/route';
import type { IntakeTurnResponse } from '@/app/api/intake/turn/route';
import { apiPath } from '@/lib/basePath';
import type { ConsentItem } from '@/lib/intake/consent';
import type { IntakeDisclosure } from '@/lib/intake/disclosure';

import CompleteStep from './CompleteStep';
import ConsentStep, { type ConsentState } from './ConsentStep';
import InterviewStep, { type InterviewExchange } from './InterviewStep';
import PatientInfoStep, { type PatientInfo } from './PatientInfoStep';
import VisitCodeStep from './VisitCodeStep';

type Step = 'code' | 'consent' | 'info' | 'interview' | 'complete';

interface DialogueTurn {
  role: 'agent' | 'patient';
  text: string;
}

const NETWORK_ERROR = '연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.';

/** 문진 라우트가 비-2xx 와 함께 돌려주는 한국어 메시지를 읽는다. */
async function readErrorMessage(response: Response): Promise<string> {
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
  return NETWORK_ERROR;
}

export interface IntakeFlowProps {
  /** 서버에서 해석된 동의 문구. `lib/intake/consent.ts` 참고. */
  consentItems: readonly ConsentItem[];
  /**
   * 서버에서 만든 AI 고지 (배포구조 문서 5장). 컴포넌트에 문자열로 박지 않는
   * 이유는 `lib/intake/disclosure.ts` 참고 — 고지가 실제로 화면에 내려갔는지가
   * 검증 대상이어야 한다.
   */
  disclosure: IntakeDisclosure;
  /**
   * URL 의 `?c=` 로 들어온, 서버가 이미 확인해 준 방문 코드.
   *
   * QR 을 찍고 들어온 환자는 코드 입력 화면을 건너뛴다. 값이 있다는 것은
   * "그때 유효했다" 는 뜻일 뿐이고, 실제 권한 판정은 `/api/intake/start` 가
   * 코드를 **소모할 때** 다시 한다 — 여기서 넘어온 값은 화면 흐름을 줄이는
   * 편의이지 자격증명이 아니다.
   */
  prevalidatedCode: string | null;
  /**
   * 이 태블릿의 키오스크 슬러그. 담당 의사 uuid 자체는 절대 클라이언트로
   * 내려오지 않는다 — 서버가 매번 다시 해석한다.
   */
  kioskSlug: string;
  voiceEnabled: boolean;
}

export default function IntakeFlow({
  consentItems,
  disclosure,
  prevalidatedCode,
  kioskSlug,
  voiceEnabled
}: IntakeFlowProps) {
  const [step, setStep] = useState<Step>(prevalidatedCode ? 'consent' : 'code');
  const [visitCode, setVisitCode] = useState<string | null>(prevalidatedCode);
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  // 컴포넌트 상태에만 둔다: localStorage 나 URL 에 절대 쓰지 않으므로 탭보다
  // 오래 살지 않고 공유된 브라우저 기록으로 새지 않는다.
  const [token, setToken] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [history, setHistory] = useState<InterviewExchange[]>([]);
  const [closingMessage, setClosingMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  /**
   * 코드 확인. 아무것도 만들지 않고 소모하지도 않는다 —
   * `/api/intake/code/check` 는 같은 DB 함수를 확인 모드로 부를 뿐이다.
   * 오타를 여기서 잡는 이유: 이름·생년월일을 다 적은 뒤에 거절당하지 않게.
   */
  const handleCode = async (code: string) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const response = await fetch(apiPath('/api/intake/code/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosk: kioskSlug, code })
      });
      if (!response.ok) {
        setServerError(await readErrorMessage(response));
        return;
      }
      setVisitCode(code);
      setStep('consent');
    } catch (error) {
      console.error('[intake] Failed to check the visit code.', error);
      setServerError(NETWORK_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAgree = (agreed: ConsentState) => {
    setConsents(agreed);
    setStep('info');
  };

  const handleStart = async (info: PatientInfo) => {
    if (!consents) {
      setServerError('동의 정보가 없습니다. 처음부터 다시 시작해 주세요.');
      return;
    }
    if (!visitCode) {
      // 여기에 오면 상태 기계가 깨진 것이다. 코드 없이 start 를 부르면 서버가
      // 어차피 거절하지만, 환자에게는 "코드를 입력해 주세요" 가 정확한 안내다.
      setServerError('접수 코드가 없습니다. 처음부터 다시 시작해 주세요.');
      setStep('code');
      return;
    }

    setSubmitting(true);
    setServerError(null);

    try {
      const response = await fetch(apiPath('/api/intake/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kiosk: kioskSlug,
          code: visitCode,
          name: info.name,
          birthDate: info.birthDate,
          registrationNo: info.registrationNo === '' ? null : info.registrationNo,
          consents
        })
      });

      if (!response.ok) {
        setServerError(await readErrorMessage(response));
        return;
      }

      const data = (await response.json()) as IntakeStartResponse;
      setEncounterId(data.encounterId);
      setToken(data.token);
      setQuestion(data.question);
      setTurns([{ role: 'agent', text: data.question }]);
      setStep('interview');
    } catch (error) {
      console.error('[intake] Failed to start the intake.', error);
      setServerError(NETWORK_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnswer = async (text: string) => {
    if (!encounterId || !token) {
      setServerError('세션 정보가 없습니다. 처음부터 다시 시작해 주세요.');
      return;
    }

    setSubmitting(true);
    setServerError(null);

    const askedQuestion = question;

    try {
      const response = await fetch(apiPath('/api/intake/turn'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId, token, turns, text })
      });

      if (!response.ok) {
        setServerError(await readErrorMessage(response));
        return;
      }

      const data = (await response.json()) as IntakeTurnResponse;
      setHistory((previous) => [...previous, { question: askedQuestion, answer: text }]);

      if (data.done) {
        setClosingMessage(data.message);
        setStep('complete');
        return;
      }

      // 서버가 본 것과 같은 대화를 유지한다: 방금 답변 + 새 질문.
      setTurns((previous) => [
        ...previous,
        { role: 'patient', text },
        { role: 'agent', text: data.question }
      ]);
      setQuestion(data.question);
    } catch (error) {
      console.error('[intake] Failed to submit the answer.', error);
      setServerError(NETWORK_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const renderStep = (): ReactNode => {
    switch (step) {
      case 'code':
        return (
          <VisitCodeStep
            disclosure={disclosure}
            submitting={submitting}
            serverError={serverError}
            onSubmit={handleCode}
          />
        );
      case 'consent':
        return (
          <ConsentStep
            items={consentItems}
            disclosure={disclosure}
            onAgree={handleAgree}
          />
        );
      case 'info':
        return (
          <PatientInfoStep
            submitting={submitting}
            serverError={serverError}
            onSubmit={handleStart}
          />
        );
      case 'interview':
        // interview 단계에 도달하면 encounterId 와 token 은 항상 채워져 있다
        // (handleStart 가 둘 다 세운 뒤에 전환한다). 아래 가드는 타입을
        // 만족시키기 위한 것이고, 그 불변식이 깨졌을 때만 발동한다.
        if (!encounterId || !token) {
          return (
            <PatientInfoStep
              submitting={submitting}
              serverError={serverError}
              onSubmit={handleStart}
            />
          );
        }
        return (
          <InterviewStep
            question={question}
            history={history}
            submitting={submitting}
            serverError={serverError}
            muted={muted}
            onMutedChange={setMuted}
            onAnswer={handleAnswer}
            encounterId={encounterId}
            token={token}
            voiceEnabled={voiceEnabled}
          />
        );
      case 'complete':
        return <CompleteStep closingMessage={closingMessage} muted={muted} />;
    }
  };

  return <div className="mx-auto w-full max-w-2xl px-6 py-8">{renderStep()}</div>;
}
