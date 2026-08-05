import { type BrowserWindow, screen } from 'electron';
import { store, type WindowKey } from './store.js';

// Dock is intentionally excluded — built-in layouts only reposition main overlays.
const KEYS: WindowKey[] = [
  'transcript',
  'diagnosis',
  'terms',
  'questions',
  'summary',
  'dictation',
  'patients'
];

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Layout = Partial<Record<WindowKey, LayoutBounds>>;

export interface LayoutInfo {
  name: string;
  builtin: boolean;
  isDefault: boolean;
}

interface BuiltinPreset {
  description: string;
  compute(): Layout;
}

const HEIGHTS: Record<WindowKey, number> = {
  transcript: 320,
  // 문헌근거 섹션이 붙으면서 세로로 길어졌다 (windows.ts OVERLAYS 와 동일 값).
  diagnosis: 460,
  terms: 240,
  questions: 260,
  summary: 320,
  dictation: 380,
  patients: 420,
  dock: 130
};

/** 창 최소 크기 (windows.ts createOverlayWindow 의 minWidth/minHeight 와 동일). */
const MIN_CELL_W = 280;
const MIN_CELL_H = 180;

/**
 * 세로 스택이 작업 영역을 넘치면 각 창 높이를 비례 축소한다.
 * 창이 7개가 되면서 기본 높이 합(2200px 이상)이 대부분의 화면을 넘기 때문에,
 * 축소하지 않으면 아래쪽 창이 화면 밖으로 밀려난다. 최소 높이 아래로는
 * 줄이지 않으므로 아주 낮은 화면에서는 겹칠 수 있다(밖으로 나가는 것보다 낫다).
 */
function scaleStackHeight(height: number, availH: number, gap: number): number {
  const total = KEYS.reduce((sum, k) => sum + HEIGHTS[k], 0) + gap * (KEYS.length - 1);
  if (total <= availH) return height;
  return Math.max(MIN_CELL_H, Math.floor(height * (availH - gap * (KEYS.length - 1)) / (total - gap * (KEYS.length - 1))));
}

const BUILTINS: Record<string, BuiltinPreset> = {
  'right-stack': {
    description: '우측 세로 스택 (기본)',
    compute: () => {
      const wa = screen.getPrimaryDisplay().workArea;
      const margin = 16;
      const result: Layout = {};
      let y = wa.y + margin;
      for (const k of KEYS) {
        const width = k === 'dictation' ? 420 : 380;
        const height = scaleStackHeight(HEIGHTS[k], wa.height - margin * 2, 12);
        const x = wa.x + wa.width - width - margin;
        result[k] = { x, y, width, height };
        y += height + 12;
      }
      return result;
    }
  },
  'left-stack': {
    description: '좌측 세로 스택',
    compute: () => {
      const wa = screen.getPrimaryDisplay().workArea;
      const margin = 16;
      const result: Layout = {};
      let y = wa.y + margin;
      for (const k of KEYS) {
        const width = k === 'dictation' ? 420 : 380;
        const height = scaleStackHeight(HEIGHTS[k], wa.height - margin * 2, 12);
        result[k] = { x: wa.x + margin, y, width, height };
        y += height + 12;
      }
      return result;
    }
  },
  'wide-grid': {
    description: '상단 격자 + Dock 중앙 하단 (기본)',
    compute: () => {
      const wa = screen.getPrimaryDisplay().workArea;
      const margin = 16;
      const dockHeight = HEIGHTS.dock;
      const dockWidth = 460;
      const dockGap = 12;

      // 창 개수가 늘면(6 → 7) 고정 2×3 격자로는 마지막 창이 화면 밖으로
      // 밀려난다. 열 수 후보를 훑어 셀이 최소 크기를 만족하는 첫 배치를
      // 고르고, 전부 실패하면 면적이 가장 큰 배치로 떨어뜨린다.
      const cell = (cols: number) => {
        const rows = Math.ceil(KEYS.length / cols);
        // 위 격자는 dock 자리 + gap 을 빼고 계산.
        const availH = wa.height - margin * (rows + 1) - dockHeight - dockGap;
        return {
          cols,
          rows,
          width: Math.floor((wa.width - margin * (cols + 1)) / cols),
          height: Math.floor(Math.min(360, availH / rows))
        };
      };
      const candidates = [3, 4, 5].map(cell);
      const chosen =
        candidates.find((c) => c.width >= MIN_CELL_W && c.height >= MIN_CELL_H) ??
        candidates.reduce((best, c) =>
          c.width * c.height > best.width * best.height ? c : best
        );
      const { cols, width: cellW, height: cellH } = chosen;

      const result: Layout = {};
      KEYS.forEach((k, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        result[k] = {
          x: wa.x + margin + c * (cellW + margin),
          y: wa.y + margin + r * (cellH + margin),
          width: cellW,
          height: cellH
        };
      });
      // Dock 은 가운데 아래.
      result.dock = {
        x: wa.x + Math.floor((wa.width - dockWidth) / 2),
        y: wa.y + wa.height - dockHeight - margin,
        width: dockWidth,
        height: dockHeight
      };
      return result;
    }
  },
  'corner-compact': {
    description: '우측 상단 컴팩트 스택',
    compute: () => {
      const wa = screen.getPrimaryDisplay().workArea;
      const width = 300;
      const height = 160;
      const margin = 8;
      const x = wa.x + wa.width - width - margin;
      const result: Layout = {};
      let y = wa.y + margin;
      for (const k of KEYS) {
        result[k] = { x, y, width, height };
        y += height + margin;
      }
      return result;
    }
  }
};

export function listLayouts(): LayoutInfo[] {
  const customs = store.get('customLayouts', {} as Record<string, Layout>);
  const defaultName = store.get('defaultLayout');
  const builtinList: LayoutInfo[] = Object.keys(BUILTINS).map((name) => ({
    name,
    builtin: true,
    isDefault: defaultName === name
  }));
  const customList: LayoutInfo[] = Object.keys(customs).map((name) => ({
    name,
    builtin: false,
    isDefault: defaultName === name
  }));
  return [...builtinList, ...customList];
}

export function resolveLayout(name: string): Layout | null {
  if (BUILTINS[name]) return BUILTINS[name].compute();
  const customs = store.get('customLayouts', {} as Record<string, Layout>);
  return customs[name] ?? null;
}

export function getDefaultLayoutName(): string {
  return store.get('defaultLayout') ?? 'right-stack';
}

export function setDefaultLayout(name: string | null): void {
  if (name == null) store.delete('defaultLayout');
  else store.set('defaultLayout', name);
}

export function saveCurrentLayout(
  name: string,
  windows: Map<WindowKey, BrowserWindow>
): void {
  if (BUILTINS[name]) {
    throw new Error(`'${name}' is a built-in preset and cannot be overwritten.`);
  }
  const layout: Layout = {};
  for (const [k, w] of windows) {
    if (!w.isDestroyed()) {
      const b = w.getBounds();
      layout[k] = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  }
  const customs = store.get('customLayouts', {} as Record<string, Layout>);
  store.set('customLayouts', { ...customs, [name]: layout });
}

export function deleteLayout(name: string): void {
  if (BUILTINS[name]) {
    throw new Error(`Cannot delete built-in preset '${name}'.`);
  }
  const customs = store.get('customLayouts', {} as Record<string, Layout>);
  if (!(name in customs)) return;
  const next = { ...customs };
  delete next[name];
  store.set('customLayouts', next);
  if (store.get('defaultLayout') === name) store.delete('defaultLayout');
}

export function applyLayout(
  name: string,
  windows: Map<WindowKey, BrowserWindow>
): boolean {
  const layout = resolveLayout(name);
  if (!layout) return false;
  for (const [k, b] of Object.entries(layout)) {
    const w = windows.get(k as WindowKey);
    if (!w || w.isDestroyed() || !b) continue;
    if (w.isMinimized()) w.restore();
    w.setBounds(b);
    if (!w.isVisible()) w.show();
  }
  return true;
}
