import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBounds,
  getOpacity,
  getWindowVisibility,
  saveBounds,
  type WindowKey
} from './store.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const preloadPath = join(here, '../preload/index.mjs');

export interface OverlaySpec {
  key: WindowKey;
  title: string;
  htmlName: string;
  defaultWidth: number;
  defaultHeight: number;
}

export const OVERLAYS: OverlaySpec[] = [
  {
    key: 'transcript',
    title: 'Transcript',
    htmlName: 'transcript',
    defaultWidth: 380,
    defaultHeight: 320
  },
  {
    // 카드마다 문헌근거가 펼쳐지므로 다른 창보다 세로로 길게 잡는다.
    key: 'diagnosis',
    title: 'Differential',
    htmlName: 'diagnosis',
    defaultWidth: 380,
    defaultHeight: 460
  },
  {
    key: 'terms',
    title: 'Medical Terms',
    htmlName: 'terms',
    defaultWidth: 380,
    defaultHeight: 240
  },
  {
    key: 'questions',
    title: 'Suggested Questions',
    htmlName: 'questions',
    defaultWidth: 380,
    defaultHeight: 260
  },
  {
    key: 'summary',
    title: 'Summary',
    htmlName: 'summary',
    defaultWidth: 380,
    defaultHeight: 320
  },
  {
    key: 'dictation',
    title: 'Dictation',
    htmlName: 'dictation',
    defaultWidth: 420,
    defaultHeight: 380
  },
  {
    // 대기목록은 카드가 세로로 쌓이는 리스트라 다른 창보다 높게 잡는다.
    key: 'patients',
    title: 'Waiting List',
    htmlName: 'patients',
    defaultWidth: 380,
    defaultHeight: 420
  },
  {
    key: 'dock',
    title: 'Dock',
    htmlName: 'dock',
    defaultWidth: 380,
    defaultHeight: 130
  }
];

export const MAIN_WINDOW_KEYS: WindowKey[] = [
  'transcript',
  'diagnosis',
  'terms',
  'questions',
  'summary',
  'dictation',
  'patients'
];

export function defaultStackPositions(): Record<WindowKey, { x: number; y: number }> {
  const display = screen.getPrimaryDisplay().workArea;
  const margin = 16;
  const x = display.x + display.width - 380 - margin;
  let y = display.y + margin;
  const positions: Partial<Record<WindowKey, { x: number; y: number }>> = {};
  for (const spec of OVERLAYS) {
    if (spec.key === 'dock') {
      positions[spec.key] = {
        x: display.x + margin,
        y: display.y + margin
      };
      continue;
    }
    positions[spec.key] = { x, y };
    y += spec.defaultHeight + 12;
  }
  return positions as Record<WindowKey, { x: number; y: number }>;
}

/**
 * 저장된 위치가 지금 화면 구성에서도 손이 닿는 곳인가.
 *
 * 모니터를 빼거나 해상도를 바꾸면 저장된 좌표가 아무 디스플레이에도 걸치지
 * 않을 수 있다. 그 창은 열리긴 하지만 사용자가 잡을 방법이 없다(프레임이 없어
 * OS 의 "창 모으기" 도 기대할 수 없다). 그래서 최소한 이만큼은 어느 작업
 * 영역 안에 보여야 "닿는다"고 본다 — 타이틀바를 잡을 수 있는 최소 면적.
 */
const MIN_VISIBLE_PX = 80;

function intersectionArea(a: Electron.Rectangle, b: Electron.Rectangle): {
  w: number;
  h: number;
} {
  return {
    w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  };
}

/**
 * 손이 닿지 않는 저장 좌표를 주 디스플레이 작업 영역 안으로 되돌린다.
 * 닿는 좌표는 한 픽셀도 건드리지 않는다 — 멀쩡한 배치를 흔들면 안 된다.
 */
export function clampBoundsToDisplays(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  const reachable = displays.some((d) => {
    const i = intersectionArea(bounds, d.workArea);
    return i.w >= MIN_VISIBLE_PX && i.h >= MIN_VISIBLE_PX;
  });
  if (reachable) return bounds;

  const wa = screen.getPrimaryDisplay().workArea;
  // 크기가 작업 영역보다 크면 좌/상단 정렬을 우선한다(잘려도 잡을 수는 있게).
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  const x = Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}

/**
 * 복원할 위치가 하나라도 저장돼 있는가.
 *
 * 시작 시 "레이아웃 프리셋을 적용할지, 사용자가 두고 간 자리를 되살릴지"의
 * 판정 기준. x/y 가 있는 항목만 센다 — 크기만 있는 항목은 위치 정보가 아니다.
 */
export function hasSavedPlacement(): boolean {
  return OVERLAYS.some((spec) => {
    const b = getBounds(spec.key);
    return typeof b?.x === 'number' && typeof b?.y === 'number';
  });
}

/**
 * 시작 시 이 창을 숨긴 채 열어야 하는가.
 *
 * 저장된 사용자 취향(windowsVisibility, 기본값 = 표시)만 본다. **인증 상태는
 * 보지 않는다** — 예전에는 dock 을 뺀 전부를 숨긴 채 열고 로그인해야 보여줬고,
 * 그래서 로그인 전에는 화면에 dock 하나뿐이라 창 토글도 스냅도 대상이 없었다.
 * 시작 시점에는 아직 아무 PHI 도 화면에 없으므로 숨겨서 얻는 보호가 없다.
 * PHI 보호는 로그아웃 경로(hideOverlaysAndClearPHI)가 그대로 담당한다.
 * Dock 은 유일한 조작 수단이므로 항상 보인다.
 */
export function initiallyHiddenFor(key: WindowKey): boolean {
  if (key === 'dock') return false;
  return !getWindowVisibility(key);
}

export function createOverlayWindow(
  spec: OverlaySpec,
  options: { initiallyHidden?: boolean } = {}
): BrowserWindow {
  const saved = getBounds(spec.key);
  const stack = defaultStackPositions()[spec.key];

  // 저장된 좌표가 사라진 모니터를 가리키면 여기서 되돌린다. 창을 만든 뒤
  // 옮기면 한 프레임 동안 화면 밖에 그려지므로 생성 인자 단계에서 고친다.
  const start = clampBoundsToDisplays({
    x: saved?.x ?? stack.x,
    y: saved?.y ?? stack.y,
    width: saved?.width ?? spec.defaultWidth,
    height: saved?.height ?? spec.defaultHeight
  });

  const win = new BrowserWindow({
    title: spec.title,
    x: start.x,
    y: start.y,
    width: start.width,
    height: start.height,
    minWidth: spec.key === 'dock' ? 240 : 280,
    minHeight: spec.key === 'dock' ? 80 : 180,
    show: !options.initiallyHidden,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    hasShadow: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      // [S5-1] preload 는 contextBridge + ipcRenderer 만 쓰고 Node 내장 모듈을
      // 직접 require 하지 않으므로 sandbox 를 켜도 깨지지 않는다. sandbox 는
      // 렌더러가 뚫려도 OS 프로세스 권한을 최소화한다.
      sandbox: true,
      nodeIntegration: false
    }
  });

  // Dock 은 다른 오버레이보다도 항상 위. 같은 screen-saver 레벨이라도
  // relativeLevel 을 +1 해서 z-order 우선순위를 더 높인다.
  win.setAlwaysOnTop(true, 'screen-saver', spec.key === 'dock' ? 1 : 0);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 화면 밖이라 되돌린 좌표는 저장값도 함께 고친다. 안 그러면 다음 실행마다
  // 같은 보정을 반복하고, 저장소에는 영영 닿지 않는 좌표가 남는다.
  if (saved && (saved.x !== start.x || saved.y !== start.y)) {
    saveBounds(spec.key, start);
  }

  const savedOpacity = getOpacity(spec.key);
  if (savedOpacity !== 1) win.setOpacity(savedOpacity);

  const persist = () => {
    if (win.isDestroyed()) return;
    const { x, y, width, height } = win.getBounds();
    saveBounds(spec.key, { x, y, width, height });
  };
  win.on('moved', persist);
  win.on('resized', persist);

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${spec.htmlName}/index.html`);
  } else {
    win.loadFile(join(here, `../renderer/${spec.htmlName}/index.html`));
  }

  return win;
}
