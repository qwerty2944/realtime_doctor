/**
 * 환자에게 보이는 AI 고지 (배포구조·책임등급 문서 5장).
 *
 * 문구는 서버에서 내려온다(`lib/intake/disclosure.ts`). 여기는 그리기만 한다.
 *
 * [HARD] 접지 않는다. 스크롤 안에 숨기지 않는다. 체크박스를 달지 않는다.
 * 동의 항목은 체크되지 읽히지 않는다는 것을 전제로 만들어져 있고, 이 세 문장은
 * 읽혀야 하는 문장이다. 그래서 동의 목록 **위에** 항상 펼쳐진 채로 놓인다.
 *
 * 고령 환자 제약(`ui.tsx` 와 같다): 본문 18px 이상, 상태를 색으로만 구분하지
 * 않는다 — 응급 항목은 빨간 테두리와 함께 아이콘·굵은 글씨를 같이 쓴다.
 */

import { AlertTriangle, Info } from 'lucide-react';

import type { IntakeDisclosure } from '@/lib/intake/disclosure';

export default function AiDisclosure({
  disclosure
}: {
  disclosure: IntakeDisclosure;
}) {
  return (
    <section
      aria-labelledby="intake-disclosure-title"
      className="flex flex-col gap-4 rounded-2xl border-2 border-slate-300 bg-white p-5"
    >
      <h2
        id="intake-disclosure-title"
        className="text-2xl font-bold leading-snug text-slate-900"
      >
        {disclosure.title}
      </h2>

      <ul className="flex flex-col gap-4">
        {disclosure.items.map((item) => {
          const urgent = item.tone === 'urgent';
          const Icon = urgent ? AlertTriangle : Info;
          return (
            <li
              key={item.key}
              className={`flex items-start gap-3 rounded-xl border-2 px-4 py-4 ${
                urgent ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`mt-1 size-7 shrink-0 ${
                  urgent ? 'text-red-600' : 'text-slate-500'
                }`}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p
                  className={`text-xl font-bold leading-relaxed ${
                    urgent ? 'text-red-800' : 'text-slate-900'
                  }`}
                >
                  {item.headline}
                </p>
                <p
                  className={`text-lg leading-relaxed ${
                    urgent ? 'text-red-800' : 'text-slate-700'
                  }`}
                >
                  {item.body}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
