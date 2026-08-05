/**
 * 문진 시작 전에 반드시 받아야 하는 세 가지 동의.
 *
 * 동의 화면과 start API 라우트가 공유해서, 환자에게 보여준 문구와 기록되는
 * 값이 어긋날 수 없게 한다.
 *
 * AI 동의는 환자의 답변을 실제로 받는 회사와 서비스를 이름으로 적는다. 그
 * 이름은 본문에 박아넣지 않고 설정된 프로바이더에서 끌어온다 — 이건 법적
 * 고지이고, 프로바이더를 바꿔놓고 낡은 처리자 이름을 화면에 남긴 배포는
 * 실제로 일어나는 것과 다른 이전에 대해 동의를 받은 것이 되기 때문이다.
 */

import type { LlmProviderName } from '@/lib/llm/types';

export type ConsentKey = 'privacy' | 'recording' | 'ai';

export interface ConsentItem {
  key: ConsentKey;
  title: string;
  /** 환자에게 보여주는 동의 전문. 표시하되 절대 줄이지 않는다. */
  body: string;
}

/**
 * 각 프로바이더를 환자에게 어떻게 부르는지: 법인명 + 서비스명. 제품명만
 * 적으면 누가 데이터 처리자인지 특정되지 않는다.
 */
const AI_PROCESSOR_LABELS: Record<LlmProviderName, string> = {
  gemini: 'Google LLC의 Gemini API'
};

export function aiProcessorLabel(provider: LlmProviderName): string {
  return AI_PROCESSOR_LABELS[provider];
}

export function buildConsentItems(provider: LlmProviderName): readonly ConsentItem[] {
  return [
    {
      key: 'privacy',
      title: '개인정보 수집·이용 동의 (필수)',
      body:
        '진료 준비를 위해 이름, 생년월일, 병원 등록번호, 문진 답변에 포함된 건강 정보를 수집·이용합니다. ' +
        '수집한 정보는 담당 의사의 진료 참고 목적으로만 사용하며, 병원이 정한 보존 기간이 지나면 파기합니다. ' +
        '동의를 거부하실 수 있으나, 동의하지 않으면 사전 문진을 진행할 수 없습니다.'
    },
    {
      key: 'recording',
      title: '음성 녹음 동의 (필수)',
      body:
        '문진 중 말씀하신 음성을 문자로 변환하기 위해 녹음합니다. ' +
        '녹음 파일과 변환된 문자는 비공개 저장소에 보관되며 담당 의사만 확인할 수 있습니다. ' +
        '음성 대신 화면의 글자 입력만 사용하실 수도 있습니다.'
    },
    {
      key: 'ai',
      title: 'AI(외부 LLM API) 처리 동의 (필수)',
      body:
        `문진 대화 내용을 외부 인공지능 서비스(${aiProcessorLabel(provider)})로 전송하여 질문 생성과 기록 초안 작성에 이용합니다. ` +
        '해당 서비스는 국외(미국)에서 운영되므로 개인정보가 국외로 이전됩니다. ' +
        '전송 구간은 암호화되며, AI가 만든 내용은 의사 참고용 초안일 뿐 진단이 아닙니다. ' +
        '최종 판단과 진단은 담당 의사가 합니다.'
    }
  ] as const;
}
