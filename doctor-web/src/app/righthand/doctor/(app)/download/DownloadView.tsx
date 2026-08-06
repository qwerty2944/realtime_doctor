'use client';

/**
 * Installer list, platform hint and first-launch instructions.
 *
 * The buttons never hold a URL. Clicking POSTs to /api/dashboard/downloads,
 * which re-checks the session, records the grant and returns a URL valid for two
 * minutes; only then does the browser navigate to it.
 */

import { useState, useSyncExternalStore } from 'react';
import { Apple, Download, MonitorDown, ShieldAlert, Terminal } from 'lucide-react';

import { Button } from '@/components/ui';
import {
  DESKTOP_APP_VERSION,
  DESKTOP_ARTIFACTS,
  DESKTOP_ARTIFACT_KEYS,
  formatFileSize,
  type DesktopArtifactKey,
} from '@/lib/releases/catalog';

/**
 * `unknown` until the effect runs: `navigator` does not exist during the server
 * render, and guessing would make the first paint disagree with the second.
 */
type Platform = 'unknown' | 'mac' | 'windows' | 'other';

/**
 * Operating system only.
 *
 * Apple Silicon is deliberately NOT detected. Safari and Chrome both report
 * "Intel Mac OS X" on M-series hardware, so any arch guess would be wrong for a
 * large share of visitors. Instead macOS leads with the universal build, which
 * runs on both, and the smaller Apple-Silicon-only file stays available for
 * anyone who knows they want it.
 */
function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return 'mac';
  if (/Win/.test(ua)) return 'windows';
  return 'other';
}

/**
 * Read the platform through `useSyncExternalStore` rather than an effect.
 *
 * The value is client-only, so the server snapshot is `unknown` and the first
 * client paint matches it; React then re-renders with the real value. The
 * snapshot getter must be referentially stable across calls or React re-renders
 * forever, hence the memo.
 */
const platformStore = {
  subscribe: () => () => {},
  getServerSnapshot: (): Platform => 'unknown',
  getSnapshot: (() => {
    let cached: Platform | undefined;
    return (): Platform => (cached ??= detectPlatform());
  })(),
};

const QUARANTINE_COMMAND = 'xattr -dr com.apple.quarantine "/Applications/Realtime Doctor.app"';

export default function DownloadView() {
  const platform = useSyncExternalStore(
    platformStore.subscribe,
    platformStore.getSnapshot,
    platformStore.getServerSnapshot,
  );
  const [pending, setPending] = useState<DesktopArtifactKey | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleDownload = async (key: DesktopArtifactKey) => {
    setPending(key);
    setError('');

    try {
      const response = await fetch('/api/dashboard/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact: key }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : '다운로드 링크를 받지 못했습니다. 잠시 후 다시 시도해 주세요.';
        setError(message);
        return;
      }

      const { url } = (await response.json()) as { url: string };
      // The URL is redeemed immediately and never stored. Navigating starts the
      // transfer; Storage checks the signature when the request begins, so the
      // two-minute lifetime does not limit how long a 184MB download may take.
      window.location.assign(url);
    } catch (caught) {
      console.error('[download] Failed to request a download URL.', caught);
      setError('네트워크 오류로 다운로드를 시작하지 못했습니다. 연결을 확인해 주세요.');
    } finally {
      setPending(null);
    }
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(QUARANTINE_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the command is printed in full next to
      // the button, so there is nothing to recover and nothing to report.
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Platform hint */}
      {platform === 'windows' ? (
        <p className="t6 text-content-secondary">
          Windows로 접속하셨습니다. 아래{' '}
          <b className="font-semibold text-content-primary">Windows 64비트</b> 파일을 받으시면 됩니다.
        </p>
      ) : null}

      {platform === 'mac' ? (
        <p className="t6 text-content-secondary">
          Mac으로 접속하셨습니다. 아래 <b className="font-semibold text-content-primary">공용(Universal)</b>{' '}
          파일을 받으시면 됩니다.
        </p>
      ) : null}

      {error !== '' ? (
        <p role="alert" className="t6 rounded-xl bg-status-danger-weak px-4 py-3 text-status-danger">
          {error}
        </p>
      ) : null}

      {/* Installers */}
      <section className="flex flex-col gap-3">
        <h2 className="t5 font-semibold text-content-primary">설치 파일</h2>

        <ul className="flex flex-col gap-3">
          {DESKTOP_ARTIFACT_KEYS.map((key) => {
            const artifact = DESKTOP_ARTIFACTS[key];
            const isRecommended =
              (platform === 'mac' && key === 'mac-universal') ||
              (platform === 'windows' && key === 'win-x64');
            const PlatformIcon = artifact.platform === 'mac' ? Apple : MonitorDown;

            return (
              <li
                key={key}
                className="flex flex-col gap-4 rounded-xl border border-line-default bg-surface-default p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlatformIcon aria-hidden="true" className="size-4 text-content-tertiary" />
                      <span className="t5 font-semibold text-content-primary">{artifact.label}</span>
                      {isRecommended ? (
                        <span className="t-caption rounded-full bg-action-weak px-2 py-0.5 font-semibold text-action">
                          권장
                        </span>
                      ) : null}
                    </div>
                    <p className="t6 text-content-secondary">{artifact.description}</p>
                    <p className="t7 text-content-tertiary">
                      버전 {DESKTOP_APP_VERSION} · {formatFileSize(artifact.sizeBytes)} ·{' '}
                      {artifact.sizeBytes.toLocaleString('ko-KR')} bytes
                    </p>
                  </div>

                  <Button
                    variant={isRecommended ? 'primary' : 'secondary'}
                    loading={pending === key}
                    disabled={pending !== null && pending !== key}
                    onClick={() => void handleDownload(key)}
                  >
                    <Download aria-hidden="true" className="size-4" />
                    다운로드
                  </Button>
                </div>

                {/* Digest. Printed in full so it can be compared, not summarised. */}
                <div className="flex flex-col gap-1 border-t border-line-default pt-3">
                  <span className="t-caption font-semibold text-content-tertiary">SHA-256</span>
                  <code className="t7 break-all font-mono text-content-secondary">
                    {artifact.sha256}
                  </code>
                </div>
              </li>
            );
          })}
        </ul>

      </section>

      {/* Verifying the download */}
      <section className="flex flex-col gap-3 rounded-xl border border-line-default bg-surface-default p-5">
        <h2 className="t5 font-semibold text-content-primary">받은 파일 확인하기 (선택)</h2>
        <p className="t6 text-content-secondary">
          내려받은 파일이 위에 적힌 것과 같은 파일인지 확인하려면, 터미널에서 아래 명령을 실행하고
          출력된 값이 그 파일의 SHA-256과 같은지 비교하세요.
        </p>
        <div className="flex flex-col gap-1">
          <span className="t-caption font-semibold text-content-tertiary">macOS (터미널)</span>
          <pre className="t7 overflow-x-auto rounded-lg bg-surface-canvas px-4 py-3 font-mono text-content-secondary">
            shasum -a 256 ~/Downloads/Realtime\ Doctor-{DESKTOP_APP_VERSION}-universal.dmg
          </pre>
        </div>
        <div className="flex flex-col gap-1">
          <span className="t-caption font-semibold text-content-tertiary">
            Windows (PowerShell)
          </span>
          <pre className="t7 overflow-x-auto rounded-lg bg-surface-canvas px-4 py-3 font-mono text-content-secondary">
            Get-FileHash &quot;$env:USERPROFILE\Downloads\Realtime Doctor Setup{' '}
            {DESKTOP_APP_VERSION}.exe&quot; -Algorithm SHA256
          </pre>
        </div>
      </section>

      {/* First launch */}
      <section className="flex flex-col gap-4 rounded-xl border border-status-warning bg-status-warning-weak p-5 text-orange-900">
        <div className="flex items-start gap-3">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-1">
            <h2 className="t5 font-semibold">
              macOS에서 처음 실행할 때: 공증(notarization)되지 않은 앱입니다
            </h2>
            <p className="t6">
              이 macOS 빌드는 Apple 공증을 받지 않았습니다. 그래서 아이콘을 그냥 두 번 눌러 실행하면
              &ldquo;확인되지 않은 개발자&rdquo; 경고와 함께 열리지 않습니다. 고장이 아니라 예상된
              동작입니다.
            </p>
          </div>
        </div>

        <ol className="flex list-decimal flex-col gap-2 pl-9 t6">
          <li>내려받은 .dmg를 열고 앱을 응용 프로그램 폴더로 옮깁니다.</li>
          <li>
            응용 프로그램 폴더에서 앱 아이콘을{' '}
            <b className="font-semibold">우클릭(또는 Control+클릭) → 열기</b>를 선택합니다.
          </li>
          <li>
            같은 경고가 다시 뜨면 이번에는 <b className="font-semibold">열기</b> 버튼이 있습니다. 한 번만
            이렇게 열면 다음부터는 두 번 눌러 실행됩니다.
          </li>
        </ol>

        <div className="flex flex-col gap-2 border-t border-status-warning pt-4">
          <div className="flex items-start gap-3">
            <Terminal aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p className="t6">
              그래도 열리지 않고 &ldquo;손상되었기 때문에 열 수 없습니다&rdquo;가 나오면, 터미널에서 아래
              명령으로 격리 속성을 지운 뒤 다시 실행하세요.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="t7 min-w-0 flex-1 overflow-x-auto rounded-lg bg-surface-default px-4 py-3 font-mono text-content-secondary">
              {QUARANTINE_COMMAND}
            </code>
            <Button variant="secondary" size="sm" onClick={() => void handleCopyCommand()}>
              {copied ? '복사됨' : '복사'}
            </Button>
          </div>
        </div>
      </section>

      {/*
        Windows first launch. The installer is built with
        CSC_IDENTITY_AUTO_DISCOVERY=false and carries no Authenticode signature,
        so SmartScreen will interrupt it. Saying so plainly is the point: a
        doctor who is told to expect the warning can tell it apart from a real
        one, and the SHA-256 above is what actually settles the question.
      */}
      <section className="flex flex-col gap-4 rounded-xl border border-status-warning bg-status-warning-weak p-5 text-orange-900">
        <div className="flex items-start gap-3">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-1">
            <h2 className="t5 font-semibold">
              Windows에서 처음 실행할 때: 코드 서명이 없는 설치 파일입니다
            </h2>
            <p className="t6">
              이 Windows 설치 파일에는 아직 코드 서명 인증서가 없습니다. 그래서 실행하면 Windows가
              &ldquo;Windows의 PC 보호&rdquo; 파란 화면으로 한 번 막습니다. 고장이 아니라 예상된
              동작입니다. 이 파일이 맞는지는 위의 SHA-256 값으로 확인하실 수 있습니다.
            </p>
          </div>
        </div>

        <ol className="flex list-decimal flex-col gap-2 pl-9 t6">
          <li>
            내려받은 <b className="font-semibold">Realtime Doctor Setup {DESKTOP_APP_VERSION}.exe</b>{' '}
            를 실행합니다.
          </li>
          <li>
            파란 경고 화면이 뜨면 <b className="font-semibold">추가 정보</b>를 누릅니다.
          </li>
          <li>
            아래에 나타나는 <b className="font-semibold">실행</b> 버튼을 누르면 설치가 계속됩니다.
          </li>
        </ol>
      </section>
    </div>
  );
}
