import Link from 'next/link';
import { PublicFooter, PublicNav } from '@/components/public-nav';

export const dynamic = 'force-static';

const SUPABASE_PUBLIC =
  'https://yqdzxitlmtawznzwpkra.supabase.co/storage/v1/object/public/downloads';
const VERSION = '0.4.5';

const MAC_DMG = `${SUPABASE_PUBLIC}/mac/Realtime-Doctor-${VERSION}-arm64.dmg`;
const MAC_DMG_ZIP = `${SUPABASE_PUBLIC}/mac/Realtime-Doctor-${VERSION}-arm64-dmg.zip`;
const WIN_ZIP = `${SUPABASE_PUBLIC}/win/Realtime-Doctor-${VERSION}-win.zip`;

export default function InstallPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <section className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          DOWNLOAD · v{VERSION}
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">설치</h1>
        <p className="mt-3 text-sm text-foreground/70">
          본인 기기에 맞는 빌드를 다운로드한 뒤 안내대로 실행하세요.
        </p>

        {/* Mac */}
        <Card>
          <CardHeader title="macOS · Apple Silicon" subtitle="M1/M2/M3/M4 · 약 105MB" />
          <div className="flex flex-wrap gap-2">
            <DownloadButton href={MAC_DMG} primary>
              DMG 다운로드
            </DownloadButton>
            <DownloadButton href={MAC_DMG_ZIP}>DMG.zip (메신저 첨부용)</DownloadButton>
          </div>
          <Steps
            steps={[
              'DMG 더블클릭 → Realtime Doctor.app 을 Applications 폴더로 드래그',
              '⚠️ 첫 실행: Finder 에서 앱 우클릭 → "열기" → 다시 "열기" (Gatekeeper 우회. 코드 사이닝 미적용 빌드)',
              '시스템 설정 → 개인정보 보호 → 마이크 권한 허용',
              'Dock 의 톱니바퀴(계정) → 회원가입 / 로그인'
            ]}
          />
        </Card>

        {/* Win */}
        <Card>
          <CardHeader title="Windows · x64 portable" subtitle="Windows 10/11 · 약 114MB" />
          <div className="flex flex-wrap gap-2">
            <DownloadButton href={WIN_ZIP} primary>
              Windows ZIP 다운로드
            </DownloadButton>
          </div>
          <Steps
            steps={[
              'ZIP 압축 해제 (Realtime Doctor 폴더가 만들어집니다)',
              'Realtime Doctor.exe 더블클릭',
              '⚠️ SmartScreen 경고: "추가 정보" → "실행" 클릭 (코드 사이닝 미적용 빌드)',
              '마이크 권한 허용',
              'Dock 의 톱니바퀴(계정) → 회원가입 / 로그인'
            ]}
          />
        </Card>

        {/* Requirements */}
        <Card>
          <CardHeader title="필요 조건" />
          <ul className="ml-5 list-disc space-y-2 text-sm text-foreground/70">
            <li>마이크가 연결되어 있고 시스템 권한이 허용된 환경</li>
            <li>한국어 또는 영어 진료 대화</li>
            <li>안정적인 인터넷 연결 (실시간 전사 + 분석 API 호출)</li>
            <li>최초 1회 회원가입(이메일·비밀번호)</li>
          </ul>
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
