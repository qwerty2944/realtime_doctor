import DownloadView from '@/app/righthand/doctor/(app)/download/DownloadView';
import { DESKTOP_APP_VERSION } from '@/lib/releases/catalog';

export const metadata = { title: '앱 다운로드' };

/**
 * Desktop app download screen.
 *
 * Sits inside the `(app)` route group, so it inherits the group layout's
 * `requireDoctor()` call and the proxy's redirect for `/righthand/doctor/*`.
 * That is deliberate: it reuses the statistics screen's auth path rather than
 * introducing a second one, and it means an anonymous visitor is bounced to the
 * same login form with `?next=` pointing back here.
 *
 * The gate is not cosmetic. The installers carry the owner's API keys, so every
 * copy has to be attributable to an account -- see the route handler at
 * src/app/api/dashboard/downloads/route.ts and migration 0015.
 */
export default async function DownloadPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="t3 font-semibold text-content-primary">앱 다운로드</h1>
        <p className="mt-1 t-meta text-content-tertiary">
          진료실에서 실행하는 데스크톱 앱 {DESKTOP_APP_VERSION} 버전입니다. 로그인한 계정으로만
          내려받을 수 있고, 내려받은 기록이 남습니다.
        </p>
      </div>

      <DownloadView />
    </main>
  );
}
