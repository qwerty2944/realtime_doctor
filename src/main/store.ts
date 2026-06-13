import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import {
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  type CloudSyncSettings,
  type DictationTemplate,
  type Language,
  type LocalSaveSettings,
  type ShortcutId,
  type TranscribeProviderId
} from '../shared/types.js';

export type WindowKey =
  | 'transcript'
  | 'diagnosis'
  | 'terms'
  | 'questions'
  | 'summary'
  | 'dictation'
  | 'dock';

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface SavedLayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Schema {
  bounds: Partial<Record<WindowKey, WindowBounds>>;
  opacity: Partial<Record<WindowKey, number>>;
  lastDictationTemplate?: DictationTemplate;
  customLayouts?: Record<string, Partial<Record<WindowKey, SavedLayoutBounds>>>;
  defaultLayout?: string;
  transcribeProvider?: TranscribeProviderId;
  cloudSync: CloudSyncSettings;
  sbAuth?: Record<string, unknown>;
  shortcuts?: Partial<Record<ShortcutId, string>>;
  firstLaunched?: boolean;
  windowsVisibility?: Partial<Record<WindowKey, boolean>>;
  language?: Language;
  windowGroups?: Array<{ id: string; tabs: WindowKey[]; active: WindowKey }>;
  deviceId?: string;
  localSave?: LocalSaveSettings;
}

const DEFAULT_CLOUD_SYNC: CloudSyncSettings = {
  enabled: true,
  saveTranscripts: false,
  saveAudio: false
};

export const store = new Store<Schema>({
  name: 'realtime-doctor',
  defaults: { bounds: {}, opacity: {}, cloudSync: DEFAULT_CLOUD_SYNC }
});

export function getBounds(key: WindowKey): WindowBounds | undefined {
  return store.get('bounds')[key];
}

export function saveBounds(key: WindowKey, bounds: WindowBounds): void {
  const all = store.get('bounds');
  store.set('bounds', { ...all, [key]: bounds });
}

export function getLastDictationTemplate(): DictationTemplate {
  return store.get('lastDictationTemplate') ?? 'soap';
}

export function setLastDictationTemplate(template: DictationTemplate): void {
  store.set('lastDictationTemplate', template);
}

export function getOpacity(key: WindowKey): number {
  return store.get('opacity')[key] ?? 1;
}

export function saveOpacity(key: WindowKey, value: number): void {
  const clamped = Math.max(0.2, Math.min(1, value));
  const all = store.get('opacity');
  store.set('opacity', { ...all, [key]: clamped });
}

export function getTranscribeProvider(): TranscribeProviderId {
  return store.get('transcribeProvider') ?? 'gemini';
}

export function setTranscribeProvider(id: TranscribeProviderId): void {
  store.set('transcribeProvider', id);
}

export function getCloudSync(): CloudSyncSettings {
  const value = store.get('cloudSync') ?? DEFAULT_CLOUD_SYNC;
  return { ...DEFAULT_CLOUD_SYNC, ...value };
}

export function setCloudSync(patch: Partial<CloudSyncSettings>): CloudSyncSettings {
  const next = { ...getCloudSync(), ...patch };
  if (!next.enabled) {
    next.saveTranscripts = false;
    next.saveAudio = false;
  }
  store.set('cloudSync', next);
  return next;
}

export function getShortcuts(): Record<ShortcutId, string> {
  const saved = (store.get('shortcuts') ?? {}) as Partial<Record<ShortcutId, string>>;
  const out = {} as Record<ShortcutId, string>;
  for (const id of SHORTCUT_IDS) {
    out[id] = saved[id] ?? SHORTCUT_DEFAULTS[id];
  }
  return out;
}

export function setShortcut(id: ShortcutId, accel: string): Record<ShortcutId, string> {
  const saved = (store.get('shortcuts') ?? {}) as Partial<Record<ShortcutId, string>>;
  const next = { ...saved, [id]: accel };
  store.set('shortcuts', next);
  return getShortcuts();
}

export function resetShortcuts(): Record<ShortcutId, string> {
  store.set('shortcuts', {});
  return getShortcuts();
}

export function isFirstLaunch(): boolean {
  return !store.get('firstLaunched');
}

export function markLaunched(): void {
  store.set('firstLaunched', true);
}

export function getWindowVisibility(key: WindowKey): boolean {
  const map = store.get('windowsVisibility') ?? {};
  // default: visible. Dock is always visible.
  return map[key] ?? true;
}

export function saveWindowVisibility(key: WindowKey, visible: boolean): void {
  const map = (store.get('windowsVisibility') ?? {}) as Partial<
    Record<WindowKey, boolean>
  >;
  store.set('windowsVisibility', { ...map, [key]: visible });
}

/** 이 설치본의 안정적 기기 식별자. 최초 호출 시 생성 후 영구 보존. */
export function getDeviceId(): string {
  const existing = store.get('deviceId');
  if (existing) return existing;
  const id = randomUUID();
  store.set('deviceId', id);
  return id;
}

const DEFAULT_LOCAL_SAVE: LocalSaveSettings = {
  enabled: true,
  saveAudio: false
};

export function getLocalSave(): LocalSaveSettings {
  return { ...DEFAULT_LOCAL_SAVE, ...(store.get('localSave') ?? {}) };
}

export function setLocalSave(patch: Partial<LocalSaveSettings>): LocalSaveSettings {
  const next = { ...getLocalSave(), ...patch };
  if (!next.enabled) next.saveAudio = false;
  store.set('localSave', next);
  return next;
}

export function getLanguage(): Language | undefined {
  return store.get('language');
}

export function setLanguage(lang: Language): void {
  store.set('language', lang);
}

export function clearLanguage(): void {
  // delete 가 electron-store 의 union 시그너처와 안 맞아 빈 객체 캐스팅으로 우회.
  (store as { delete: (key: keyof Schema) => void }).delete('language');
}
