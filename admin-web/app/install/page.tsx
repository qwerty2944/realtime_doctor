import Link from 'next/link';
import { PublicFooter, PublicNav } from '@/components/public-nav';

export const dynamic = 'force-static';

const SUPABASE_PUBLIC =
  'https://yqdzxitlmtawznzwpkra.supabase.co/storage/v1/object/public/downloads';
const VERSION = '0.5.6';

const MAC_DMG = `${SUPABASE_PUBLIC}/mac/Realtime-Doctor-${VERSION}-arm64.dmg`;
const WIN_EXE = `${SUPABASE_PUBLIC}/win/Realtime-Doctor-Setup-${VERSION}.exe`;

export default function InstallPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <section className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          다운로드 · v{VERSION} · 최신
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">설치</h1>
        <p className="mt-3 text-sm text-foreground/70">
          본인 기기에 맞는 빌드를 다운로드하세요. 첫 실행 시 마이크 권한과 계정만
          있으면 1분 안에 진료 보조 오버레이가 화면 위에 뜹니다.
        </p>

        {/* What's new in this version */}
        <Card>
          <CardHeader title={`이번 버전 (v${VERSION}) 주요 변경`} />
          <ul className="ml-5 list-disc space-y-2 text-sm text-foreground/75">
            <li>앱 시작 시 Dock만 표시 — 계정 다이얼로그가 자동으로 뜨지 않음</li>
            <li>Cmd/Ctrl 누르고 있으면 모든 오버레이에 단축키 힌트 동시 표시</li>
            <li>Dock은 다른 오버레이보다 항상 위에 — 가려지지 않음</li>
            <li>레이아웃·언어·계정 메뉴: 작은 Dock 안에서 잘리지 않게 자동 확장</li>
            <li>기본 레이아웃: 2×3 격자 + Dock 중앙 하단</li>
            <li>모든 창에 시안 네온 글로우 (포커스된 창은 더 강하게)</li>
          </ul>
        </Card>

        {/* Mac */}
        <Card>
          <CardHeader title="macOS · Apple Silicon" subtitle="M1/M2/M3/M4 · 약 105MB · DMG" />
          <div className="flex flex-wrap gap-2">
            <DownloadButton href={MAC_DMG} primary>
              DMG 다운로드 (v{VERSION})
            </DownloadButton>
          </div>
          <Steps
            steps={[
              'DMG 더블클릭 → Realtime Doctor.app 을 Applications 폴더로 드래그',
              '⚠️ 첫 실행: Finder 에서 앱 우클릭 → "열기" → 경고 창에서 다시 "열기" (서명은 되어 있지만 노터라이즈 미적용)',
              '시스템 설정 → 개인정보 보호 → 마이크 권한 허용',
              'Dock 의 사람 아이콘 클릭 → 회원가입 또는 로그인',
              'Cmd+R 로 녹음 시작 · Cmd+0 으로 모든 창 토글'
            ]}
          />
        </Card>

        {/* Win */}
        <Card>
          <CardHeader title="Windows · x64" subtitle="Windows 10/11 · 약 83MB · NSIS 인스톨러" />
          <div className="flex flex-wrap gap-2">
            <DownloadButton href={WIN_EXE} primary>
              인스톨러 다운로드 (.exe) (v{VERSION})
            </DownloadButton>
          </div>
          <Steps
            steps={[
              `다운로드한 "Realtime Doctor Setup ${VERSION}.exe" 더블클릭`,
              '⚠️ SmartScreen 경고: "추가 정보" → "실행" 클릭 (코드사이닝 미적용)',
              '설치 마법사 진행 → 설치 완료',
              '시작 메뉴에서 Realtime Doctor 실행',
              '마이크 권한 허용',
              'Dock 의 사람 아이콘 클릭 → 회원가입 또는 로그인',
              'Ctrl+R 로 녹음 시작 · Ctrl+0 으로 모든 창 토글'
            ]}
          />
        </Card>

        {/* Requirements */}
        <Card>
          <CardHeader title="필요 조건" />
          <ul className="ml-5 list-disc space-y-2 text-sm text-foreground/70">
            <li>마이크가 연결되어 있고 시스템 권한이 허용된 환경</li>
            <li>한국어 또는 영어 진료 대화 (Dock 의 언어 토글에서 선택)</li>
            <li>안정적인 인터넷 연결 (실시간 전사 + 분석 API 호출)</li>
            <li>최초 1회 회원가입 (이메일·비밀번호)</li>
          </ul>
        </Card>

        {/* Shortcuts */}
        <Card>
          <CardHeader
            title="기본 단축키"
            subtitle="macOS 는 Cmd, Windows 는 Ctrl. 누르고 있으면 모든 창에 힌트가 뜹니다."
          />
          <div className="grid grid-cols-2 gap-2 text-sm text-foreground/75 sm:grid-cols-3">
            <Shortcut keys="⌘0 / Ctrl+0" label="전체 창 토글" />
            <Shortcut keys="⌘1..6 / Ctrl+1..6" label="개별 오버레이 토글" />
            <Shortcut keys="⌘R / Ctrl+R" label="녹음 시작·정지" />
            <Shortcut keys="⌘A / Ctrl+A" label="감별 분석 재실행" />
            <Shortcut keys="⌘E / Ctrl+E" label="요약 재생성" />
            <Shortcut keys="⌘D / Ctrl+D" label="받아쓰기 재생성" />
          </div>
        </Card>

        <div className="mt-10 flex justify-between text-sm">
          <Link href="/" className="text-foreground/50 hover:text-foreground">
            ← 메인
          </Link>
          <Link href="/guide" className="text-accent hover:opacity-80">
            사용법 →
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-6">
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && (
        <p className="mt-1 text-xs text-foreground/50">{subtitle}</p>
      )}
    </div>
  );
}

function DownloadButton({
  href,
  primary,
  children
}: {
  href: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        primary
          ? 'inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-background hover:opacity-90'
          : 'inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-5 py-2.5 text-sm font-medium hover:border-accent/60'
      }
    >
      {children}
    </a>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-2 text-sm text-foreground/70">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <kbd className="font-mono text-[11px] text-foreground/90">{keys}</kbd>
      <span className="text-[11px] text-foreground/55">{label}</span>
    </div>
  );
}
