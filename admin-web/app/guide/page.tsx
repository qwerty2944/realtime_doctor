import Link from 'next/link';
import { PublicFooter, PublicNav } from '@/components/public-nav';

export const dynamic = 'force-static';

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <section className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          USER GUIDE
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">사용법</h1>
        <p className="mt-3 text-sm text-foreground/70">
          처음 실행 ~ 일상 진료 흐름까지 한눈에.
        </p>

        <Step
          n={1}
          title="회원가입 / 로그인"
          body={
            <>
              앱 실행 후 Dock 의 <Pill>👤 계정</Pill> 아이콘 클릭 → 회원가입 또는
              로그인. 첫 가입 시 비밀번호 6자 이상. 로그인 전에는 다른 6 개 창이
              표시되지 않습니다.
            </>
          }
        />

        <Step
          n={2}
          title="전사(STT) 공급자 선택"
          body={
            <>
              Dock 의 <Pill>⚙ Transcribe Provider</Pill> 아이콘 → 공급자 선택.
              <ul className="ml-5 mt-3 list-disc space-y-1 text-sm text-foreground/70">
                <li>
                  <b>Gemini (청크)</b> — 발화 후 1–2 초 지연. 기본값.
                </li>
                <li>
                  <b>OpenAI Realtime (실시간)</b> — partial 즉시 표시. 정확도
                  높음.
                </li>
                <li>
                  <b>CLOVA CSR (청크)</b> — 한국어 단문.
                </li>
                <li>
                  <b>CLOVA Speech Streaming (실시간)</b> — 한국어 장문 실시간.
                  권장.
                </li>
              </ul>
            </>
          }
        />

        <Step
          n={3}
          title="진료 시작"
          body={
            <>
              Transcript 창 헤더의 <Pill>🎙 시작</Pill> 버튼 → 마이크가 켜지고
              발화가 누적됩니다. 발화가 끝나면 자동으로 의사/환자가 분류되고,
              감별진단·의학용어·다음 질문이 옆 창들에 갱신됩니다.
            </>
          }
        />

        <Step
          n={4}
          title="화자 정정"
          body={
            <>
              잘못 분류된 발화의 <Pill>의사</Pill> / <Pill>환자</Pill> 칩을
              클릭하면 즉시 토글됩니다. Transcript 헤더의 <Pill>↔</Pill> 버튼은
              전체 의사 ↔ 환자 일괄 교체.
            </>
          }
        />

        <Step
          n={5}
          title="요약 · 딕테이션 생성"
          body={
            <>
              Summary 창의 <Pill>생성</Pill> 버튼 → 6 필드 임상 노트 (CC / HPI /
              소견 / 검사·약물 / Impression / Plan).
              <br />
              Dictation 창의 템플릿 선택 (SOAP / APSO / H&P / Narrative) →{' '}
              <Pill>생성</Pill>. 결과 인라인 편집 · 우측 상단 <Pill>📋</Pill> 로
              markdown 복사.
            </>
          }
        />

        <Step
          n={6}
          title="세션 종료 / 새 세션"
          body={
            <>
              Transcript 헤더의 <Pill>↻ 새 세션</Pill> 버튼 → 현재 세션이
              종료되고 transcript / 분석이 비워집니다. 다음 발화부터 새 세션.
            </>
          }
        />

        <Step
          n={7}
          title="이전 세션 이어서 하기"
          body={
            <>
              Transcript 헤더의 <Pill>📁</Pill> 버튼 → 본인 세션 목록 다이얼로그
              → 선택하면 그 세션의 transcript / 분석 / 요약 / 딕테이션이
              복원되고 새 발화는 그 세션에 이어집니다.
              <br />
              <em className="text-yellow-300/80">조건</em>: 계정 다이얼로그의{' '}
              <Pill>전사 원문 저장</Pill> 토글이 ON 이었던 세션만 복원 가능합니다.
            </>
          }
        />

        <Step
          n={8}
          title="레이아웃"
          body={
            <>
              Dock 의 <Pill>레이아웃</Pill> 메뉴 → 4 가지 빌트인 (우측 스택 /
              좌측 스택 / 상단 격자 / 컴팩트 코너) 또는 직접 배치 후{' '}
              <Pill>현재 위치를 저장</Pill>.
            </>
          }
        />

        <Step
          n={9}
          title="클라우드 동기화 옵션"
          body={
            <>
              계정 다이얼로그 → 3 단계 토글:
              <ul className="ml-5 mt-3 list-disc space-y-1 text-sm text-foreground/70">
                <li>
                  <b>클라우드 동기화</b> — 세션 / 분석 / 요약 / 딕테이션을 DB에
                  저장. 기본 ON.
                </li>
                <li>
                  <b>전사 원문 저장</b> — 발화 텍스트를 DB에 저장. 기본 OFF
                  (PHI). 세션 불러오기를 쓰려면 ON.
                </li>
                <li>
                  <b>음성 파일 업로드</b> — 진료 중 음성 원본을 Storage 에 저장.
                  기본 OFF (PHI).
                </li>
              </ul>
            </>
          }
        />

        <Step
          n={10}
          title="단축 컨트롤"
          body={
            <>
              Dock 좌상단 <Pill>👁</Pill> 버튼 → 6 개 오버레이 모두 표시/숨김.
              개별 창은 Dock 의 작은 아이콘 6 개로 토글. 타이틀바 슬라이더로
              투명도 (20–100%) 조절.
            </>
          }
        />

        <div className="mt-12 flex justify-between text-sm">
          <Link href="/install" className="text-accent hover:opacity-80">
            ← 설치
          </Link>
          <Link href="/" className="text-foreground/50 hover:text-foreground">
            메인 →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function Step({
  n,
  title,
  body
}: {
  n: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 font-mono text-sm font-bold text-accent">
        {n}
      </div>
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="text-sm leading-relaxed text-foreground/75">{body}</div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded bg-white/10 px-1.5 py-0.5 text-xs font-medium text-foreground/85">
      {children}
    </span>
  );
}
