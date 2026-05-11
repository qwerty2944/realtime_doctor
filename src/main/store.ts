import Store from 'electron-store';
import type {
  CloudSyncSettings,
  DictationTemplate,
  TranscribeProviderId
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
