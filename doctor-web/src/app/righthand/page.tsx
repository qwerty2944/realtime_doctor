import type { Metadata } from 'next';
import Link from 'next/link';
// Icons only appear where they encode state or action — the listening
// indicator, the red-flag alert, the evidence lookup, the CTA and the FAQ
// disclosure. Nothing here is decoration above a heading.
import { ArrowRight, BookOpen, ChevronDown, Mic, ShieldAlert } from 'lucide-react';

import JsonLd from '@/components/JsonLd';
import { ORGANIZATION_ID, absoluteUrl } from '@/lib/site';

const PAGE_PATH = '/righthand';
const PAGE_TITLE = 'righthand — 진료 전에 도착하는 문진 기록';
const PAGE_DESCRIPTION =
  '환자가 대기실에 있는 동안 AI가 음성으로 사전 문진을 마치고, SOAP 초안·감별진단·추천 검사를 진료실 대시보드에 올려 둡니다. 안과 특화. 모든 출력은 의사 참고용 초안입니다.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    type: 'website',
    url: absoluteUrl(PAGE_PATH),
    siteName: 'Entanglecare',
    locale: 'ko_KR',
    title: PAGE_TITLE,
    description:
      'AI 음성 사전 문진으로 SOAP 초안·감별진단·추천 검사를 진료 전에 준비합니다. 안과 특화.',
    images: [{ url: '/icon-1024.png', width: 1024, height: 1024, alt: 'righthand' }],
  },
};

const CONTACT_MAILTO =
  'mailto:entanglecare@gmail.com?subject=righthand%20%EB%8F%84%EC%9E%85%20%EB%AC%B8%EC%9D%98';

/** Two-line lockup from `public/brand/righthand-icon.svg`, set inline for nav/footer use. */
function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight text-content-primary ${className}`}>
      right<span className="text-action">hand</span>.
    </span>
  );
}

function DemoButton({ className = '', label = '데모 요청' }: { className?: string; label?: string }) {
  return (
    <a
      href={CONTACT_MAILTO}
      className={`inline-flex items-center gap-2 rounded-full bg-action px-6 py-3 font-semibold text-white hover:bg-action-pressed ${className}`}
    >
      {label}
      <ArrowRight aria-hidden="true" className="size-4" />
    </a>
  );
}

const NAV_LINKS = [
  { href: '#how', label: '작동 방식' },
  { href: '#product', label: '화면' },
  { href: '#specialty', label: '안과 문진' },
  { href: '#safety', label: '안전과 규제' },
];

/**
 * Numbers here describe the product's own mechanics (spec §2, §3, §6, §8) — not
 * customer counts or outcomes we have not measured.
 */
const FACTS = [
  { value: '15턴', label: '문진 상한', note: '대기 시간 안에 끝나도록 턴 수를 제한합니다' },
  { value: '3~5개', label: '우선순위 감별진단', note: '각각 근거 한 줄과 함께 정리됩니다' },
  { value: '10종', label: '안과 검사 매핑', note: '병원 보유 검사 목록에서만 추천합니다' },
  { value: '0건', label: '시스템이 내리는 확정 진단', note: '진단·처방 기능은 아예 없습니다' },
];

const BEFORE = [
  '“어디가 불편해서 오셨어요?”부터 다시 시작',
  '발병 시점·편측·외상력을 한 문장씩 되묻는 시간',
  '차팅을 하면서 환자 얼굴 대신 모니터를 봄',
  '위험 신호는 문진이 끝나갈 무렵에야 드러남',
];

const AFTER = [
  '들어오기 전에 SOAP 초안을 이미 읽은 상태',
  '되물을 것은 확인 한 번, 나머지는 진찰에 사용',
  '첫 60초를 눈을 맞추고 진찰하는 데 씀',
  '레드플래그는 대기 목록 최상단에서 먼저 보임',
];

const STEPS = [
  {
    n: '1',
    title: '카톡 링크로 사전 문진',
    body: '접수·예약 시 환자에게 링크를 보냅니다. 환자는 모바일 웹에서 동의 3종을 확인한 뒤 AI와 음성으로 대화합니다. 질문은 화면에 크게 표시되고 음성으로도 낭독됩니다.',
  },
  {
    n: '2',
    title: 'AI가 초안을 정리',
    body: 'AI가 감별진단 3~5개와 그에 맞는 검사를 제시할 수 있다고 판단하면 문진을 종료합니다. SOAP 초안, 감별진단, 추천 검사, 타임스탬프가 붙은 원본 대화 전문이 함께 만들어집니다.',
  },
  {
    n: '3',
    title: '진료실에서 검토·승인',
    body: '환자가 진료실에 들어오기 전에 대시보드에 카드가 도착합니다. 의사는 초안을 읽고 수정·승인하며, 그 이력은 감사 로그로 남습니다. 최종 판단은 언제나 의사에게 있습니다.',
  },
];

/** Static mock of the patient-facing voice intake screen. */
function IntakePreview() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto flex w-full max-w-xs flex-col gap-5 rounded-3xl border border-line-default bg-surface-default p-6"
    >
      <div className="flex items-center justify-between">
        <span className="t-caption font-medium text-content-tertiary">문진 4 / 15</span>
        <span className="t-caption rounded-full bg-status-success-weak px-2.5 py-1 font-medium text-status-success">
          동의 완료
        </span>
      </div>
      <p className="t3 font-semibold text-content-primary">
        시야가 가려진 느낌이 한쪽 눈에만 있나요, 양쪽 모두인가요?
      </p>
      <div className="flex items-center gap-2 rounded-2xl bg-action-weak px-4 py-3">
        <Mic aria-hidden="true" className="size-4 shrink-0 text-action" />
        <span className="t6 text-action">듣고 있습니다…</span>
      </div>
      <p className="t6 rounded-2xl bg-surface-canvas px-4 py-3 text-content-secondary">
        “왼쪽 눈만요. 이틀 전부터 아래쪽이 가려요.”
      </p>
      <p className="t-caption text-content-tertiary">
        말하기가 어려우면 직접 입력할 수 있습니다.
      </p>
    </div>
  );
}

/** Static mock of a dashboard card — divs only, no screenshot to fall out of date. */
function DashboardPreview() {
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-col gap-4 rounded-2xl border border-line-default bg-surface-default p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="t5 font-semibold text-content-primary">김○○ · 68세</span>
          <span className="t7 text-content-tertiary">등록번호 20260806-014 · 문진 완료 2분 전</span>
        </div>
        <span className="t-caption rounded-full bg-action-weak px-2.5 py-1 font-medium text-action">
          검토 대기
        </span>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-status-danger-weak px-3.5 py-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-danger" />
        <p className="t7 text-content-secondary">
          <span className="font-semibold text-status-danger">레드플래그</span> · 좌안 커튼 모양 시야
          결손 + 광시증(photopsia) — 망막박리 감별 필요
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-surface-canvas p-4">
        <span className="t-caption font-semibold tracking-wide text-content-tertiary">
          SOAP 초안
        </span>
        <dl className="flex flex-col gap-2.5">
          <div className="flex gap-3">
            <dt className="t7 w-4 shrink-0 font-bold text-action">S</dt>
            <dd className="t7 text-content-secondary">
              2일 전 시작된 좌안 시야 결손(OS), 통증 없음. 3주 전부터 비문증 증가.
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="t7 w-4 shrink-0 font-bold text-action">O</dt>
            <dd className="t7 text-content-tertiary">진찰 소견 대기</dd>
          </div>
          <div className="flex gap-3">
            <dt className="t7 w-4 shrink-0 font-bold text-action">A</dt>
            <dd className="t7 text-content-secondary">
              열공성 망막박리(rhegmatogenous RD) 의심, 후유리체박리(PVD) 감별 — 확정 아님
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="t7 w-4 shrink-0 font-bold text-action">P</dt>
            <dd className="t7 text-content-secondary">산동 안저검사, 시야검사, OCT 권고</dd>
          </div>
        </dl>
      </div>

      <p className="t-caption text-content-tertiary">
        본 내용은 의사 참고용 초안이며 진단이 아닙니다.
      </p>
    </div>
  );
}

/** Static mock of the differential list with its evidence side panel. */
function EvidencePreview() {
  const rows = [
    { rank: '1', name: '열공성 망막박리 (rhegmatogenous RD)', why: '커튼 모양 시야 결손 + 광시증·비문증 급증' },
    { rank: '2', name: '후유리체박리 (PVD)', why: '비문증 선행, 시야 결손 범위가 제한적일 때' },
    { rank: '3', name: '유리체 출혈 (vitreous hemorrhage)', why: '당뇨 병력, 통증 없는 급성 시야 흐림' },
  ];
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-col gap-4 rounded-2xl border border-line-default bg-surface-default p-5 sm:p-6"
    >
      <span className="t-caption font-semibold tracking-wide text-content-tertiary">감별진단</span>
      <ol className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.rank}
            className="flex items-start gap-3 rounded-xl bg-surface-canvas px-4 py-3"
          >
            <span className="t7 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-action-weak font-bold text-action">
              {row.rank}
            </span>
            <div className="flex flex-col gap-1">
              <span className="t6 font-semibold text-content-primary">{row.name}</span>
              <span className="t7 text-content-tertiary">{row.why}</span>
            </div>
          </li>
        ))}
      </ol>
      {/* Separated by a rule, not a second box — a bordered panel inside a
          bordered panel reads as a nested card. */}
      <div className="flex flex-col gap-2 border-t border-line-default pt-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 shrink-0 text-action" />
          <span className="t7 font-semibold text-content-primary">근거 찾기</span>
        </div>
        <p className="t7 text-content-secondary">
          PubMed와 웹 검색에서 해당 질환의 최신 가이드라인·리뷰를 불러오고, 제목·저널·연도·링크를
          함께 표시합니다.
        </p>
      </div>
    </div>
  );
}

const TREE_GROUPS = [
  {
    label: '주소증에서 시작',
    items: ['발병 시점(onset)', '경과·악화 요인(OPQRST)', '편측/양측(laterality)', '통증 유무'],
  },
  {
    label: '안과 특화 항목',
    items: ['시력 변화', '분비물', '외상력', '콘택트렌즈 착용', '안과 수술력', '광시증·비문증'],
  },
  {
    label: '배경 정보',
    items: ['당뇨(diabetes)', '고혈압(hypertension)', '복용 약물', '알레르기'],
  },
];

const RED_FLAGS = [
  '급성 시력 소실',
  '커튼 모양 시야 결손',
  '심한 안통 + 두통 + 구역',
  '화학물질 눈 접촉',
  '외상 후 시력 저하',
  '광시증 + 비문증 급증',
];

// Copy shared with the page's structured data. See `./content` -- the JSON-LD is
// generated from these same arrays so the schema cannot drift from the screen.
import { FAQ, FEATURES, SAFETY, faqPageJsonLd, softwareApplicationJsonLd } from './content';


export default function RightHandLandingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface-canvas">
      <header className="sticky top-0 z-10 border-b border-line-default bg-surface-canvas/90 backdrop-blur">
        <nav className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/righthand" className="t4">
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-6 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="t6 text-content-secondary hover:text-content-primary"
              >
                {link.label}
              </a>
            ))}
          </div>
          <a
            href={CONTACT_MAILTO}
            className="t6 ml-auto rounded-full bg-action px-4 py-2 font-semibold text-white hover:bg-action-pressed"
          >
            데모 요청
          </a>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:py-28">
          <div className="flex flex-col items-start gap-6">
            <h1 className="t1 font-bold tracking-tight text-content-primary sm:t0 lg:t-display">
              진료실 문이 열리기 전에
              <br />
              기록은 이미 준비돼 있습니다
            </h1>
            <p className="t4 max-w-xl text-content-secondary">
              환자가 대기실에 있는 동안 AI가 음성으로 사전 문진을 마칩니다. 의사는 첫 60초를 처음부터
              묻는 데 쓰는 대신, 읽고 확인하고 진찰하는 데 씁니다.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <DemoButton className="t5" />
              <Link
                href="/righthand/doctor/download"
                className="t5 rounded-full border border-line-strong px-6 py-3 font-semibold text-content-primary hover:bg-surface-default"
              >
                데스크톱 앱 다운로드
              </Link>
              <Link
                href="/righthand/doctor/login"
                className="t5 font-semibold text-content-secondary hover:text-content-primary"
              >
                의사 대시보드 로그인
              </Link>
            </div>
            {/* The scope line sits under the headline, not above it as a
                kicker — the headline carries its own weight. */}
            <p className="t7 text-content-tertiary">
              안과 사전 문진 · AI 초안. 앱 다운로드에는 의료진 로그인이 필요합니다. 모든 AI 출력은
              의사 참고용 초안입니다. 진단 확정·처방 기능은 제공하지 않습니다.
            </p>
          </div>
          <DashboardPreview />
        </section>

        {/* Product mechanics, not achievement metrics — so the value sits on
            the same line as what it measures instead of towering over it. */}
        <section className="border-y border-line-default bg-surface-default">
          <dl className="mx-auto grid w-full max-w-6xl gap-x-8 gap-y-7 px-6 py-10 sm:grid-cols-2 lg:grid-cols-4">
            {FACTS.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-1">
                <dt className="flex items-baseline gap-2">
                  <span className="t3 font-bold tracking-tight text-content-primary">
                    {fact.value}
                  </span>
                  <span className="t6 font-medium text-content-secondary">{fact.label}</span>
                </dt>
                <dd className="t7 text-content-tertiary">{fact.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <h2 className="t2 max-w-2xl text-balance font-bold tracking-tight text-content-primary lg:t1">
            달라지는 건 진료의 첫 60초입니다
          </h2>
          {/* Two columns of one comparison, so only the "after" side is
              surfaced — matching boxes would flatten them to equal weight. */}
          <div className="mt-12 grid gap-6 md:grid-cols-2 md:gap-8">
            <div className="flex flex-col gap-4 py-6 md:pr-8">
              <span className="t6 font-semibold text-content-tertiary">지금</span>
              <ul className="flex flex-col gap-3">
                {BEFORE.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-content-disabled"
                    />
                    <span className="t6 text-content-tertiary">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl bg-action-weak p-6 sm:p-8">
              <span className="t6 font-semibold text-action">righthand와 함께</span>
              <ul className="flex flex-col gap-3">
                {AFTER.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-action"
                    />
                    <span className="t6 text-content-secondary">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how" className="border-y border-line-default bg-surface-tinted">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
            <h2 className="t2 max-w-2xl text-balance font-bold tracking-tight text-content-primary lg:t1">
              접수부터 진료실까지, 세 단계
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((step) => (
                <li key={step.n} className="flex flex-col gap-3 border-t border-line-strong pt-5">
                  {/* The order is real information here, so the ordinal stays —
                      but as part of the step title, not a standalone marker. */}
                  <h3 className="t4 font-semibold text-content-primary">
                    <span className="text-action">{step.n}</span>
                    <span className="ml-3">{step.title}</span>
                  </h3>
                  <p className="t6 text-content-secondary">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="product" className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <h2 className="t2 max-w-2xl text-balance font-bold tracking-tight text-content-primary lg:t1">
            환자가 보는 화면, 의사가 보는 화면
          </h2>

          <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div className="flex flex-col gap-4">
              <h3 className="t3 font-semibold text-content-primary lg:t2">
                질문 하나가 화면 전체를 차지합니다
              </h3>
              <p className="t5 text-content-secondary">
                한 번에 한 질문만 보여 주고, 그 질문을 음성으로도 읽어 줍니다. 답은 말로 해도 되고
                직접 입력해도 됩니다. 진행 정도와 동의 상태는 화면 위에 늘 떠 있습니다.
              </p>
              <span className="t7 font-semibold text-action">환자 · 모바일 웹</span>
            </div>
            <IntakePreview />
          </div>

          <div className="mt-20 grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
            <EvidencePreview />
            <div className="flex flex-col gap-4 lg:order-first">
              <h3 className="t3 font-semibold text-content-primary lg:t2">
                후보와 근거를 같은 화면에서
              </h3>
              <p className="t5 text-content-secondary">
                감별진단은 3~5개로 좁혀 우선순위 순으로, 각각 왜 그렇게 봤는지 한 줄과 함께 옵니다.
                “근거 찾기”를 누르면 PubMed와 웹 검색 결과가 출처 링크와 함께 붙습니다. 조회 이력은
                세션에 남아 나중에 다시 볼 수 있습니다.
              </p>
              <p className="t6 text-content-secondary">
                문진 요약(SOAP) · 감별진단 · 추천 검사 · 원본 대화 — 네 개 탭의 순서는 고정입니다.
                어느 환자를 열어도 같은 자리에 같은 것이 있습니다.
              </p>
              <span className="t7 font-semibold text-action">의사 · PC 대시보드</span>
            </div>
          </div>
        </section>

        <section id="specialty" className="border-y border-line-default bg-surface-default">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
            <h2 className="t2 max-w-2xl text-balance font-bold tracking-tight text-content-primary lg:t1">
              범용 문진이 아니라 안과 문진입니다
            </h2>
            <p className="t5 mt-5 max-w-2xl text-content-secondary">
              주소증을 잡은 다음 안과 문진 트리를 따라 들어갑니다. 아래는 실제로 다루는 항목입니다.
            </p>

            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {TREE_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-4">
                  <h3 className="t6 font-semibold text-content-primary">{group.label}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <li
                        key={item}
                        className="t7 rounded-full border border-line-default bg-surface-canvas px-3 py-1.5 text-content-secondary"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Elevation declared once: the danger tint carries it, no border
                on top of it. */}
            <div className="mt-14 flex flex-col gap-5 rounded-2xl bg-status-danger-weak p-6 sm:p-10">
              <div className="flex items-center gap-2.5">
                <ShieldAlert aria-hidden="true" className="size-5 shrink-0 text-status-danger" />
                <h3 className="t3 font-semibold tracking-tight text-content-primary">
                  이 여섯 가지는 대기 목록을 앞지릅니다
                </h3>
              </div>
              <ul className="flex flex-wrap gap-2">
                {RED_FLAGS.map((flag) => (
                  <li
                    key={flag}
                    className="t6 rounded-full bg-surface-default px-3.5 py-1.5 font-medium text-content-primary"
                  >
                    {flag}
                  </li>
                ))}
              </ul>
              <p className="t6 text-content-secondary">
                감지되면 대기 목록 최상단에 고정하고 대시보드에 즉시 알립니다. 병원마다 다른 기준은
                설정 화면에서 직접 편집합니다.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
          <h2 className="t2 max-w-2xl text-balance font-bold tracking-tight text-content-primary lg:t1">
            진료 흐름을 바꾸지 않고, 앞단만 덜어냅니다
          </h2>
          {/* Six capabilities read as one list, separated by rules. Six boxed
              cards would make the page structure the thing you notice. */}
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="flex flex-col gap-2.5 border-t border-line-default pt-5"
              >
                <h3 className="t5 font-semibold text-content-primary">{feature.title}</h3>
                <p className="t6 text-content-secondary">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="safety" className="border-y border-line-default bg-surface-default">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
            <h2 className="t2 max-w-2xl text-balance font-bold tracking-tight text-content-primary lg:t1">
              환자 건강정보를 다루는 제품의 최소 조건
            </h2>
            <p className="t5 mt-5 max-w-2xl text-content-secondary">
              민감정보를 다루는 이상, 편의보다 먼저 지켜야 하는 것들이 있습니다.
            </p>
            {/* Denser than the feature list on purpose: these are commitments,
                so each title gets a full column of its own and more air. */}
            <dl className="mt-14 flex flex-col">
              {SAFETY.map((item) => (
                <div
                  key={item.title}
                  className="grid gap-x-10 gap-y-3 border-t border-line-default py-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
                >
                  <dt className="t4 font-semibold text-content-primary text-balance">
                    {item.title}
                  </dt>
                  <dd className="t6 text-content-secondary">{item.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-24">
          <h2 className="t2 font-bold tracking-tight text-content-primary lg:t1">자주 받는 질문</h2>
          <div className="mt-10 flex flex-col">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group border-b border-line-default py-5 first:border-t"
              >
                <summary className="t5 flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-content-primary marker:content-none">
                  {item.q}
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-content-tertiary transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="t6 mt-3 text-content-secondary">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-20 lg:pb-28">
          <div className="flex flex-col items-start gap-6 rounded-3xl bg-content-primary px-8 py-14 sm:px-14">
            <h2 className="t2 max-w-2xl font-bold tracking-tight text-white lg:t1">
              우리 병원에 맞는 문진, 같이 만들어 봅니다
            </h2>
            <p className="t5 max-w-xl text-grey-300">
              진료과와 문진 항목, 검사 목록, 레드플래그 기준을 병원에 맞게 조정합니다. 실제 문진
              화면과 대시보드를 함께 보시는 데모를 잡아 드리겠습니다.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href={CONTACT_MAILTO}
                className="t5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-content-primary hover:bg-grey-100"
              >
                데모 요청
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <span className="t6 text-grey-400">entanglecare@gmail.com</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line-default">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10">
          <Wordmark className="t4" />
          <span className="t7 text-content-tertiary">© 2026 righthand</span>
        </div>
      </footer>
    </div>
  );
}
