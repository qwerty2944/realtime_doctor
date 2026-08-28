import type { Metadata } from 'next';

import DemoIntake from './DemoIntake';

/**
 * 공개 문진 데모. 방문코드 게이트를 거치지 않는다.
 *
 * 운영 문진(`/intake`)은 방문코드로 진료를 특정하고 결과를 저장하지만, 이
 * 화면은 대화 방식을 보여주기만 한다 — 저장도, 환자 식별도 없다. 그래서
 * 아무 인가 없이 열어둬도 남는 것이 없다.
 */
export const metadata: Metadata = {
  title: '문진 도우미 데모',
  description: '대화형 사전 문진 데모 화면입니다. 실제 진료 기록이 아닙니다.',
  // 데모 화면이 검색엔진에 잡힐 이유가 없다(루트 레이아웃과 같은 방침).
  robots: { index: false, follow: false }
};

export default function DemoPage() {
  return <DemoIntake />;
}
