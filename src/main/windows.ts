import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBounds,
  getOpacity,
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

export function createOverlayWindow(
  spec: OverlaySpec,
  options: { initiallyHidden?: boolean } = {}
): BrowserWindow {
  const saved = getBounds(spec.key);
  const stack = defaultStackPositions()[spec.key];

  const win = new BrowserWindow({
    title: spec.title,
    x: saved?.x ?? stack.x,
    y: saved?.y ?? stack.y,
    width: saved?.width ?? spec.defaultWidth,
    height: saved?.height ?? spec.defaultHeight,
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
      sandbox: false,
      nodeIntegration: false
    }
  });

  // Dock 은 다른 오버레이보다도 항상 위. 같은 screen-saver 레벨이라도
  // relativeLevel 을 +1 해서 z-order 우선순위를 더 높인다.
  win.setAlwaysOnTop(true, 'screen-saver', spec.key === 'dock' ? 1 : 0);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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
