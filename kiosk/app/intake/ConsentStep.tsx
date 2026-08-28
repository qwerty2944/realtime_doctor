'use client';

/** 1단계: 시작 전 필수 동의 세 가지. */

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import type { ConsentItem, ConsentKey } from '@/lib/intake/consent';
import type { IntakeDisclosure } from '@/lib/intake/disclosure';

import AiDisclosure from './AiDisclosure';
import { Button } from './ui';

export type ConsentState = Record<ConsentKey, boolean>;

const EMPTY_CONSENTS: ConsentState = { privacy: false, recording: false, ai: false };

/**
 * 동의 제목은 "(필수)" 접미사를 달고 온다. 그걸 떼어내서 별도 텍스트 요소로
 * 렌더링한다 — 필수/선택은 색이 아니라 글자로 구별되어야 하고, 제목도 그래야
 * 깔끔하게 읽힌다.
 */
function splitRequiredMarker(title: string): { label: string; required: boolean } {
  const match = title.match(/^(.*?)\s*\(필수\)\s*$/);
  if (match) return { label: match[1], required: true };
  return { label: title, required: false };
}

export interface ConsentStepProps {
  /**
   * 서버에서 해석된 동의 문구. 이 배포에 실제로 설정된 처리자를 이름으로
   * 적기 위해서다. `lib/intake/consent.ts` 참고.
   */
  items: readonly ConsentItem[];
  /**
   * AI 고지 (배포구조 문서 5장). 동의 **항목 안이 아니라 위에** 그린다 —
   * 항목 안에 넣으면 "약관 전문 보기" 뒤로 접혀 들어가고, 접힌 경고는 경고가
   * 아니다. 근거는 `lib/intake/disclosure.ts`.
   */
  disclosure: IntakeDisclosure;
  onAgree: (consents: ConsentState) => void;
}

export default function ConsentStep({ items, disclosure, onAgree }: ConsentStepProps) {
  const [consents, setConsents] = useState<ConsentState>(EMPTY_CONSENTS);
  const [expanded, setExpanded] = useState<Partial<Record<ConsentKey, boolean>>>({});

  const allAgreed = useMemo(
    () => items.every((item) => consents[item.key]),
    [consents, items]
  );

  const toggleAll = (checked: boolean) => {
    setConsents(
      items.reduce<ConsentState>((acc, item) => ({ ...acc, [item.key]: checked }), {
        ...EMPTY_CONSENTS
      })
    );
  };

  const checkboxClass = 'mt-1 size-7 shrink-0 accent-blue-600';

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-slate-900">문진 시작 전 동의</h1>
        <p className="text-xl leading-relaxed text-slate-600">
          아래 필수 항목에 모두 동의하셔야 문진을 시작할 수 있습니다.
        </p>
      </header>

      <AiDisclosure disclosure={disclosure} />

      <div className="flex flex-col gap-3">
        {/* 전체 동의 행이 개별 항목 위에 온다. */}
        <label className="flex min-h-touch cursor-pointer items-center gap-4 rounded-2xl border-2 border-slate-400 bg-white px-5 py-4">
          <input
            type="checkbox"
            checked={allAgreed}
            onChange={(event) => toggleAll(event.target.checked)}
            className={checkboxClass}
          />
          <span className="text-xl font-bold text-slate-900">전체 동의</span>
        </label>

        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const { label, required } = splitRequiredMarker(item.title);
            const isOpen = expanded[item.key] ?? false;
            const bodyId = `consent-body-${item.key}`;

            return (
              <li key={item.key} className="rounded-2xl border-2 border-slate-200 bg-white">
                <label className="flex cursor-pointer items-start gap-4 px-5 pt-5">
                  <input
                    type="checkbox"
                    checked={consents[item.key]}
                    onChange={(event) =>
                      setConsents((previous) => ({
                        ...previous,
                        [item.key]: event.target.checked
                      }))
                    }
                    className={checkboxClass}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={`text-base font-bold ${
                        required ? 'text-red-600' : 'text-slate-500'
                      }`}
                    >
                      {required ? '필수' : '선택'}
                    </span>
                    <span className="text-xl font-semibold text-slate-900">{label}</span>
                  </span>
                </label>

                {/* 전문은 펼쳐서 본다. 절대 줄이지 않는다. */}
                <div className="px-5 pb-5 pl-[4.25rem]">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    onClick={() =>
                      setExpanded((previous) => ({ ...previous, [item.key]: !isOpen }))
                    }
                    className="inline-flex min-h-touch items-center gap-2 text-lg text-slate-600 underline"
                  >
                    약관 전문 {isOpen ? '접기' : '보기'}
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {isOpen ? (
                    <p id={bodyId} className="mt-2 text-lg leading-relaxed text-slate-700">
                      {item.body}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <Button disabled={!allAgreed} onClick={() => onAgree(consents)}>
        동의하고 시작하기
      </Button>
    </section>
  );
}
