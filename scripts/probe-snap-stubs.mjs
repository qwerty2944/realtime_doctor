// probe-snap 전용 Electron 스텁.
//
// src/main/windowSnap.ts / windowGroups.ts / store.ts 를 원본 그대로 Node 에서
// 돌리기 위한 최소 대체물이다. BrowserWindow 는 bounds 를 실제로 들고 있고
// 'will-move'/'move'/'moved' 를 발생시키는 가짜 창이다 — 이 프로브의 검증
// 대상(스냅 기하)은 전부 숫자로 관측 가능하므로 이걸로 충분하다.

import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USER_DATA = mkdtempSync(join(tmpdir(), 'rd-snap-probe-'));

/** 1920x1080, 작업영역은 상단 25px 메뉴바를 뺀 영역. */
export const WORK_AREA = { x: 0, y: 25, width: 1920, height: 1055 };

export const screen = {
  getPrimaryDisplay: () => ({ workArea: { ...WORK_AREA } }),
  getDisplayMatching: () => ({ workArea: { ...WORK_AREA } }),
  getCursorScreenPoint: () => ({ ...cursor })
};

let cursor = { x: -10000, y: -10000 };
export function setCursor(x, y) {
  cursor = { x, y };
}

export class FakeWindow extends EventEmitter {
  #b;
  #visible = true;
  #minimized = false;
  destroyed = false;

  constructor(bounds) {
    super();
    this.setMaxListeners(50);
    this.#b = { ...bounds };
  }

  getBounds() {
    return { ...this.#b };
  }

  /** 프로그램적 setBounds — Electron 과 동일하게 'moved'/'resized' 를 쏘지 않는다. */
  setBounds(b) {
    this.#b = { ...this.#b, ...b };
    // 실제 Electron 은 프로그램적 이동에도 'move' 를 발생시킨다. 되먹임 방어를
    // 진짜로 시험하기 위해 여기서도 그대로 쏜다.
    this.emit('move');
  }

  /** 이벤트 없이 위치를 심는다 — 시나리오 초기 배치 전용. */
  place(b) {
    this.#b = { ...this.#b, ...b };
  }

  /** 사용자 드래그 시뮬레이션: will-move → move 를 steps 번, 마지막에 moved. */
  userDrag(dx, dy, { steps = 8, emitMoved = true } = {}) {
    const x0 = this.#b.x;
    const y0 = this.#b.y;
    for (let i = 1; i <= steps; i += 1) {
      this.emit('will-move');
      // 마지막 스텝이 정확히 (dx, dy) 에 떨어지도록 누적 비율로 계산한다.
      this.#b = {
        ...this.#b,
        x: x0 + Math.round((dx * i) / steps),
        y: y0 + Math.round((dy * i) / steps)
      };
      this.emit('move');
    }
    if (emitMoved) this.emit('moved');
  }

  /** 사용자 리사이즈 시뮬레이션. */
  userResize(w, h) {
    this.#b = { ...this.#b, width: w, height: h };
    this.emit('resized');
  }

  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.#visible;
  }
  isMinimized() {
    return this.#minimized;
  }
  hide() {
    this.#visible = false;
  }
  show() {
    this.#visible = true;
  }
  restore() {
    this.#minimized = false;
  }
  focus() {}
  setAlwaysOnTop() {}
  getMinimumSize() {
    return [280, 180];
  }
}

export const BrowserWindow = FakeWindow;

export const app = {
  getVersion: () => '0.0.0-probe',
  getPath: () => USER_DATA,
  getName: () => 'realtime-doctor-probe',
  on: () => undefined,
  whenReady: async () => undefined
};

export const ipcMain = { handle: () => undefined, on: () => undefined };
export const globalShortcut = { register: () => false, unregisterAll: () => undefined };
export const shell = { openExternal: async () => undefined };
export const safeStorage = { isEncryptionAvailable: () => false };

export default { app, ipcMain, BrowserWindow, screen, globalShortcut, shell, safeStorage };

// ── electron-store 대체 ────────────────────────────────────────────────────
// 재시작 시뮬레이션을 위해 프로세스 전역 백킹 스토어를 하나 둔다. 새 Store
// 인스턴스를 만들어도 같은 저장소를 본다 = 디스크에 남는 것과 같은 성질.
export const BACKING = {};

export class ElectronStoreStub {
  constructor(opts = {}) {
    for (const [k, v] of Object.entries(opts.defaults ?? {})) {
      if (!(k in BACKING)) BACKING[k] = v;
    }
  }
  get(key, fallback) {
    return BACKING[key] ?? fallback;
  }
  set(key, value) {
    if (typeof key === 'object') Object.assign(BACKING, key);
    else BACKING[key] = structuredClone(value);
  }
  delete(key) {
    delete BACKING[key];
  }
  get store() {
    return BACKING;
  }
}
