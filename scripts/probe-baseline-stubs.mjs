// probe-baseline 전용 스텁 모듈.
//
// src/main/*.ts 를 Electron 없이 Node 에서 그대로 불러오기 위한 최소 대체물이다.
// 여기 있는 것은 Electron 런타임 껍데기뿐이고, 검증 대상인 sessions.ts /
// device.ts / auth.ts 코드는 손대지 않은 원본을 그대로 쓴다.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USER_DATA = mkdtempSync(join(tmpdir(), 'rd-probe-'));

export const app = {
  getVersion: () => '0.0.0-probe',
  getPath: (name) => (name === 'userData' ? USER_DATA : USER_DATA),
  getName: () => 'realtime-doctor-probe',
  on: () => undefined,
  whenReady: async () => undefined
};

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
  removeHandler: () => undefined
};

export const BrowserWindow = class {};
export const globalShortcut = { register: () => false, unregisterAll: () => undefined };
export const shell = { openExternal: async () => undefined };
export const safeStorage = { isEncryptionAvailable: () => false };

export const __userDataDir = USER_DATA;

export default { app, ipcMain, BrowserWindow, globalShortcut, shell, safeStorage };

// electron-store 대체. 파일 IO 없이 메모리에만 둔다 -- 이 프로브가 확인하려는
// 것은 DB 스키마이지 설정 영속화가 아니다.
export class ElectronStoreStub {
  #bag;
  constructor(opts = {}) {
    this.#bag = { ...(opts.defaults ?? {}) };
  }
  get(key) {
    return this.#bag[key];
  }
  set(key, value) {
    if (typeof key === 'object') Object.assign(this.#bag, key);
    else this.#bag[key] = value;
  }
  delete(key) {
    delete this.#bag[key];
  }
  get store() {
    return this.#bag;
  }
}
