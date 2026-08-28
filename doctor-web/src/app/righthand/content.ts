import { ORGANIZATION_ID, absoluteUrl } from '@/lib/site';

/**
 * Copy that the landing page renders AND its structured data describes.
 *
 * It lives here rather than in `page.tsx` for one reason: search engines and
 * answer engines penalise JSON-LD that does not match the visible page, so the
 * two must not be able to drift. Edit the copy once, in this file, and both the
 * screen and the schema follow.
 *
 * [HARD] Nothing may be added to the schema below that is not on the screen.
 * No price (righthand does not publish one), no rating, no review, no customer
 * count, no certification. Those are the claims that turn a citation into a
 * liability for a medical product.
 */

/**
 * These carry no icons on purpose. A decorative glyph above every heading makes
 * four distinct commitments read as one repeated template; the headings say
 * more than a shield outline can.
 */
export const SAFETY = [
  {
    title: '동의 없이는 시작하지 않습니다',
    body: '개인정보 수집·이용, 녹음, 외부 LLM API 처리 — 세 가지 동의를 문진 시작 전에 받고 저장합니다. 녹음에 동의하지 않으면 녹음 기능은 비활성 상태로 남습니다.',
  },
  {
    title: '의사만 승인할 수 있습니다',
    body: '기록의 열람·수정·삭제·승인은 의사 계정만 가능합니다. 진료 후 보충 내용도 항목별로 승인·거부·수정을 거쳐야 반영됩니다.',
  },
  {
    title: '모든 손길이 로그로 남습니다',
    body: '승인·수정·삭제 이력을 감사 로그로 기록합니다. 어떤 초안이 누구의 손을 거쳐 무엇으로 바뀌었는지 나중에 되짚을 수 있습니다.',
  },
  {
    title: '국내에 보관하고 기한이 지나면 지웁니다',
    body: '데이터는 서울 리전에 보관하고 음성 파일은 비공개 버킷에 둡니다. 보존 기간(기본 90일)이 지나면 자동 파기되며, 기간은 병원이 설정합니다.',
  },
];

export const FEATURES = [
  {
    title: '음성 우선, 텍스트는 언제나 폴백',
    body: '고령 환자를 고려해 질문은 TTS로 낭독하고 답변은 STT로 받습니다. 말하기가 어려운 환자는 같은 화면에서 바로 입력할 수 있습니다.',
  },
  {
    title: '진료 중 대화 보충',
    body: '진료 대화를 STT로 받아 의사·환자 화자를 분리하고, 기존 기록에 더할 보충 내용을 항목별 제안으로 올립니다. 화자 라벨이 틀리면 승인 단계에서 고칠 수 있습니다.',
  },
  {
    title: '병원 검사 목록에 맞춘 추천',
    body: '검사 마스터 테이블에 등록된 검사 중에서만 추천합니다. 병원에 없는 검사를 권하는 일이 없도록 목록은 설정에서 직접 편집합니다.',
  },
  {
    title: '문헌 근거 즉시 조회',
    body: '감별진단 옆 “근거 찾기”로 PubMed·웹 검색 결과를 출처 링크와 함께 봅니다. 환자 맥락을 담은 자유 질의도 사이드 패널에서 던질 수 있습니다.',
  },
  {
    title: '데스크 연동',
    body: '데스크에서 문진 링크를 발송하고, 환자가 모르고 비워둔 병원 등록번호를 접수 후 맞춰 넣을 수 있습니다.',
  },
  {
    title: '통계로 남는 진료 기록',
    body: '날짜별 내원 추이, 질환별·주소증별 분포, 레드플래그 발생 건수, 평균 문진 시간을 봅니다. 집계는 비식별로만 표시하고 CSV로 내보낼 수 있습니다.',
  },
];

export const FAQ = [
  {
    q: 'AI가 진단을 내리는 건가요?',
    a: '아닙니다. 진단 확정과 처방 기능은 제품에 없습니다. 감별진단은 우선순위가 매겨진 후보 목록이며, 화면에는 항상 “의사 참고용 초안이며 진단이 아닙니다”라는 고지가 함께 붙습니다.',
  },
  {
    q: '환자가 문진에서 엉뚱한 말을 하면요?',
    a: '원본 대화 전문이 타임스탬프와 함께 그대로 보관됩니다. 초안이 이상하면 어느 대목에서 비롯됐는지 바로 확인할 수 있고, 의사가 수정한 내용이 최종본이 됩니다.',
  },
  {
    q: '환자가 앱을 설치해야 하나요?',
    a: '아닙니다. 접수·예약 시 보내는 카카오톡 링크를 모바일 웹으로 열면 됩니다. 대기실 태블릿에서 키오스크 모드로 같은 화면을 띄우는 방식도 준비하고 있습니다.',
  },
  {
    q: '문진이 길어져 환자가 지치지 않나요?',
    a: '감별진단과 검사를 제시할 수 있다고 판단되면 AI가 문진을 종료하고, 그와 별개로 최대 15턴이라는 상한을 둡니다. 대기 시간 안에 끝나는 것을 기준으로 설계했습니다.',
  },
  {
    q: '안과 말고 다른 과도 되나요?',
    a: '지금은 안과 문진 트리를 갖추고 있습니다. 내과·가정의학과 등으로 넓히는 것은 다음 단계이며, 문진 항목·검사 목록·레드플래그 기준은 병원에 맞게 조정합니다.',
  },
  {
    q: '기존 EMR과 연동되나요?',
    a: '현재는 의사가 검토·승인한 내용을 병원 EMR로 옮겨 적는 구조입니다. 본 시스템은 보조 기록으로 두고, EMR 연동은 다음 단계로 두고 있습니다.',
  },
];

const PAGE_URL = absoluteUrl('/righthand');

/**
 * SoftwareApplication rather than Service: what a clinic gets is a macOS app for
 * the exam room plus a mobile web intake the patient opens from a link — both
 * software, no delivered labour.
 *
 * No `offers`. The subscription price exists in the billing code but is not
 * published on this page, and structured data that states a price the page does
 * not show is a mismatch a crawler can see.
 */
export const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${PAGE_URL}#software`,
  name: 'righthand',
  alternateName: 'righthand 사전 문진',
  url: PAGE_URL,
  description:
    '환자가 대기실에 있는 동안 AI가 음성으로 사전 문진을 마치고, SOAP 초안·감별진단·추천 검사를 진료실 대시보드에 올려 둡니다. 안과 특화. 모든 출력은 의사 참고용 초안입니다.',
  applicationCategory: 'HealthApplication',
  applicationSubCategory: '진료 전 사전 문진(AI 문진) 보조 도구',
  operatingSystem: 'macOS (진료실 데스크톱 앱), 모바일 웹 (환자 문진)',
  inLanguage: 'ko',
  image: absoluteUrl('/icon-1024.png'),
  publisher: { '@id': ORGANIZATION_ID },
  audience: { '@type': 'Audience', audienceType: '의료진' },
  // Verbatim from the hero scope line.
  disambiguatingDescription:
    '안과 사전 문진 · AI 초안. 앱 다운로드에는 의료진 로그인이 필요합니다. 모든 AI 출력은 의사 참고용 초안입니다. 진단 확정·처방 기능은 제공하지 않습니다.',
  featureList: FEATURES.map((feature) => feature.title),
  // The four commitments in the "환자 건강정보를 다루는 제품의 최소 조건" section,
  // reproduced word for word.
  additionalProperty: SAFETY.map((item) => ({
    '@type': 'PropertyValue',
    name: item.title,
    value: item.body,
  })),
};

export const faqPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${PAGE_URL}#faq`,
  inLanguage: 'ko',
  mainEntity: FAQ.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};
