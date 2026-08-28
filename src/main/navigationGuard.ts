import type { App, Event, Shell, WebContents } from 'electron';

/**
 * 네비게이션 잠금 (S5-1).
 *
 * 오버레이는 전사·PubMed 텍스트·환자 문진 — 전부 비신뢰 입력 — 을 렌더한다.
 * 이 중 하나가 원격 origin 으로 창을 이동시키면, 그 페이지는 preload 브리지
 * (`window.api`: auth/sessions/patient-detail/billing IPC)를 그대로 상속받아
 * PHI 조회와 결제 IPC 까지 손에 넣는다. 그래서 전역 web-contents-created 가드로
 * 로컬 origin 밖으로의 이동과 새 창 열기를 전부 막는다.
 *
 * electron 에 런타임 의존하지 않는다(타입만 import). 판정 로직(isLocalNavigation)을
 * electron 런타임 없이 프로브에서 그대로 검증할 수 있어야 하기 때문이다
 * (scripts/probe-navigation-guard.mjs).
 */

/**
 * 이 이동이 로컬(신뢰) origin 안인가.
 *
 * 신뢰 대상은 둘뿐이다:
 *   - file:// (패키지된 renderer/*.html)
 *   - dev 서버 origin (ELECTRON_RENDERER_URL). dev 에서만 존재한다.
 * 그 외 http(s) 원격 origin 은 전부 차단한다. 파싱 불가 URL 도 차단(fail-closed).
 */
export function isLocalNavigation(target: string, devOrigin: string | null): boolean {
  try {
    const u = new URL(target);
    if (u.protocol === 'file:') return true;
    if (devOrigin) {
      const dev = new URL(devOrigin);
      return u.origin === dev.origin;
    }
    return false;
  } catch {
    return false;
  }
}

/** 로그에 전체 URL(비신뢰 텍스트/쿼리 포함)을 남기지 않도록 origin 만 뽑는다. */
function safeOrigin(target: string): string {
  try {
    return new URL(target).origin;
  } catch {
    return '(unparseable)';
  }
}

export interface NavigationGuardDeps {
  app: App;
  shell: Pick<Shell, 'openExternal'>;
  /** 새 창 요청을 외부 브라우저로 흘려보내도 되는 주소인가 (예: PubMed allowlist). */
  isAllowedExternal: (url: string) => boolean;
  /** dev 서버 origin. 패키지 빌드에서는 null. */
  devOrigin: string | null;
}

/**
 * 모든 window 가 로드되기 전에 app ready 시점에 단 한 번 등록한다.
 * 이후 생성되는 모든 WebContents 에 자동 적용된다.
 */
export function installNavigationGuard(deps: NavigationGuardDeps): void {
  const { app, shell, isAllowedExternal, devOrigin } = deps;

  app.on('web-contents-created', (_event: Event, contents: WebContents) => {
    // 새 창은 언제나 거부한다. 다만 허용 목록(PubMed)에 든 http(s) 주소는
    // 앱 창을 만드는 대신 외부 브라우저로 연다 — evidence 링크가 그대로 동작한다.
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternal(url)) void shell.openExternal(url);
      return { action: 'deny' as const };
    });

    const block = (e: Event, url: string): void => {
      if (!isLocalNavigation(url, devOrigin)) {
        e.preventDefault();
        console.warn('[nav] 로컬 origin 밖으로의 이동을 차단했습니다:', safeOrigin(url));
      }
    };

    contents.on('will-navigate', block);
    contents.on('will-redirect', block);
  });
}
