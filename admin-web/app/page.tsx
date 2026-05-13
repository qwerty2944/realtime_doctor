import Link from 'next/link';
import { PublicNav, PublicFooter } from '@/components/public-nav';

export const dynamic = 'force-static';

const VERSION = '0.4.5';

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <div className="inline-block rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
          ALWAYS-ON-TOP CLINICAL OVERLAY · v{VERSION}
        </div>
        <h1 className="mt-6 text-5xl font-bold leading-tight tracking-tight">
          진료에 집중하세요.
          <br />
          <span className="bg-gradient-to-r from-accent via-cyan-300 to-emerald-200 bg-clip-text text-transparent">
            나머지는 실시간으로 정리됩니다.
          </span>
        </h1>
        <p className="mt-6 text-base text-foreground/70">
          마이크 하나로 환자-의사 대화를 실시간 전사·화자 분류·감별진단·의학용어·다음
          질문·요약·딕테이션까지 — 일곱 개의 글래스 오버레이가 진료실 화면 위에서
          조용히 도와줍니다.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/install"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background shadow-lg shadow-accent/20 transition-transform hover:scale-[1.02]"
            >
              지금 설치 →
            </Link>
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold transition-colors hover:border-accent/60"
            >
              사용법 보기
            </Link>
          </div>
          <div className="text-[11px] text-foreground/50">
            macOS · Windows · v{VERSION}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-border/40 bg-card/30">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-px overflow-hidden md:grid-cols-3">
          <Feature
            title="실시간 전사"
            body="환자-의사 대화가 화면에 실시간으로 받아 적혀 흐릅니다. 한국어/영어 혼용 발화도 자연스럽게 처리됩니다."
          />
          <Feature
            title="감별·용어·질문"
            body="발화가 누적될 때마다 가능성 높은 감별진단, 등장한 의학용어, 감별을 좁히는 다음 질문이 자동으로 갱신됩니다."
          />
          <Feature
            title="요약·딕테이션"
            body="진료 마무리에 임상 노트와 의무기록 prose를 한 번에. 인라인 편집과 클립보드 복사를 지원합니다."
          />
          <Feature
            title="화자 자동 분류"
            body="발화 내용을 분석해 의사/환자를 자동 분류. 잘못 잡혔으면 클릭 한 번으로 즉시 정정할 수 있습니다."
          />
          <Feature
            title="진료 기록 보관"
            body="진료 세션과 산출물을 안전하게 보관. 다음 진료에서 같은 세션을 불러와 이어서 진행할 수 있습니다."
          />
          <Feature
            title="유연한 오버레이"
            body="일곱 개의 글래스 창이 항상 위에 떠 있어 진료 화면과 동시에 봅니다. 위치·투명도·레이아웃을 자유롭게 조절."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold">바로 사용해 보세요</h2>
        <p className="mt-4 text-sm leading-relaxed text-foreground/70">
          마이크 권한과 Supabase 계정만 있으면 1분 안에 진료 보조 오버레이가 화면
          위에 뜹니다.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/install"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background shadow-lg shadow-accent/20 transition-transform hover:scale-[1.02]"
          >
            설치 페이지로
          </Link>
          <Link
            href="/guide"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold transition-colors hover:border-accent/60"
          >
            사용법 보기
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-background p-6">
      <h3 className="text-sm font-semibold text-accent">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-foreground/70">{body}</p>
    </div>
  );
}
