import { type BrowserWindow, screen } from 'electron';
import { store, type WindowKey } from './store.js';

// Dock is intentionally excluded — built-in layouts only reposition main overlays.
const KEYS: WindowKey[] = [
  'transcript',
  'diagnosis',
  'terms',
  'questions',
  'summary',
  'dictation'
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
  diagnosis: 280,
  terms: 240,
  questions: 260,
  summary: 320,
  dictation: 380,
  dock: 130
};

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
        const height = HEIGHTS[k];
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
        const height = HEIGHTS[k];
        result[k] = { x: wa.x + margin, y, width, height };
        y += height + 12;
      }
      return result;
    }
  },
  'wide-grid': {
    description: '상단 2×3 격자 + Dock 중앙 하단 (기본)',
    compute: () => {
      const wa = screen.getPrimaryDisplay().workArea;
      const cols = 3;
      const rows = 2;
      const margin = 16;
      const dockHeight = HEIGHTS.dock;
      const dockWidth = 460;
      const dockGap = 12;
      // 위 격자는 dock 자리 + gap 을 빼고 계산.
      const gridAvailH = wa.height - margin * (rows + 1) - dockHeight - dockGap;
      const cellW = Math.floor((wa.width - margin * (cols + 1)) / cols);
      const cellH = Math.floor(Math.min(360, gridAvailH / rows));
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
