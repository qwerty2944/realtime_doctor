import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import {
  FONT_SCALE_DEFAULT,
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  clampFontScale,
  type CloudSyncSettings,
  type DictationTemplate,
  type Language,
  type LocalSaveSettings,
  type ShortcutId,
  type TranscribeProviderId,
  type VisitCodeSettings
} from '../shared/types.js';

export type WindowKey =
  | 'transcript'
  | 'diagnosis'
  | 'terms'
  | 'questions'
  | 'summary'
  | 'dictation'
  | 'patients'
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
  /**
   * 창 가장자리 스냅 관계 (windowSnap.ts). a 의 `edge` 쪽이 b 에 붙어 있다.
   * 없어진 창을 가리키는 낡은 항목은 복원 시 조용히 버려진다.
   */
  windowSnaps?: Array<{
    a: WindowKey;
    b: WindowKey;
    edge: 'left' | 'right' | 'top' | 'bottom';
  }>;
  deviceId?: string;
  localSave?: LocalSaveSettings;
  /** 전역 글씨 배율 (모든 창 공용). */
  fontScale?: number;
  /**
   * 서명된 entitlement 토큰 캐시 (S2).
   *
   * 사용자가 편집 가능한 파일이므로 여기 있는 값은 신뢰하지 않는다 --
   * subscription.ts 가 읽을 때마다 서명·만료를 다시 검증한다.
   * lastServerTimeMs 는 시계 되돌리기 방어용 단조 증가 값.
   */
  entitlement?: { token: unknown; lastServerTimeMs: number };
  /** 방문 코드 발급이 QR 에 넣을 키오스크 주소 (L1). 도메인은 코드에 박지 않는다. */
  visitCode?: VisitCodeSettings;
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

/** 저장된 글씨 배율. 없거나 범위를 벗어나면 기본값으로 보정한다. */
export function getFontScale(): number {
  const saved = store.get('fontScale');
  if (typeof saved !== 'number') return FONT_SCALE_DEFAULT;
  return clampFontScale(saved);
}

export function setFontScale(value: number): number {
  const next = clampFontScale(value);
  store.set('fontScale', next);
  return next;
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

/**
 * 방문 코드 설정 (L1).
 *
 * 기본값은 **빈 주소**다. 자리표시자 도메인을 기본값으로 넣어두면 설정하지
 * 않은 의원에서 열리지 않는 QR 이 환자 앞에 나가고, 그 실패는 접수처가
 * 원인을 알 수 없다. 비어 있으면 화면이 "주소를 먼저 설정하세요" 를 말한다.
 */
const DEFAULT_VISIT_CODE: VisitCodeSettings = { kioskUrl: '', kioskSlug: null };

export function getVisitCodeSettings(): VisitCodeSettings {
  return { ...DEFAULT_VISIT_CODE, ...(store.get('visitCode') ?? {}) };
}

export function setVisitCodeSettings(
  patch: Partial<VisitCodeSettings>
): VisitCodeSettings {
  const merged = { ...getVisitCodeSettings(), ...patch };
  const slug = merged.kioskSlug?.trim().toLowerCase() ?? '';
  const next: VisitCodeSettings = {
    kioskUrl: merged.kioskUrl.trim().replace(/\/+$/, ''),
    // 슬러그 형식은 키오스크의 KIOSK_CLINICIANS 규칙과 같다. 형식이 깨진 값을
    // 저장하면 발급은 성공하고 사용만 조용히 실패한다.
    kioskSlug: /^[a-z0-9][a-z0-9_-]{0,30}$/.test(slug) ? slug : null
  };
  store.set('visitCode', next);
  return next;
}

/**
 * 기본 언어.
 *
 * 국내 전용 앱이라 최초 실행 시 언어를 묻지 않고 한국어로 시작한다.
 * (외국인 환자용 언어 전환은 dock 설정 UI 에 그대로 남아 있다.)
 */
export const DEFAULT_LANGUAGE: Language = 'ko';

/** 저장된 언어가 실제로 있는지. 기본값 보정 전 상태를 알아야 할 때 쓴다. */
export function hasStoredLanguage(): boolean {
  return store.get('language') !== undefined;
}

/** 저장된 언어. 없으면 기본값(한국어). 절대 undefined 를 돌려주지 않는다. */
export function getLanguage(): Language {
  return store.get('language') ?? DEFAULT_LANGUAGE;
}

export function setLanguage(lang: Language): void {
  store.set('language', lang);
}

/** 언어 선택을 기본값으로 되돌린다. (더 이상 "미선택" 상태는 존재하지 않는다.) */
export function clearLanguage(): void {
  store.set('language', DEFAULT_LANGUAGE);
}
