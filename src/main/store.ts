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
  /**
   * 방문 코드 발급이 QR 에 넣을 키오스크 주소 (L1).
   * 여기 값이 있으면 언제나 그것이 이긴다 — 기본값은 비어 있을 때만 쓰인다.
   */
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
 * **기본 주소가 왜 이제 생겼는가.** 예전 기본값은 빈 주소였다 — 자리표시자
 * 도메인을 넣어두면 열리지 않는 QR 이 환자 앞에 나가기 때문이었고, 그 판단은
 * 키오스크가 어디에도 배포돼 있지 않던 시점에서는 옳았다. 지금은 배포 주소가
 * 하나로 확정됐다(`tasks/domain-structure.md`): 모든 의원이 같은 키오스크
 * 배포를 쓰고, 의원을 가르는 것은 주소가 아니라 슬러그다. 그러므로 기본값이
 * 가리키는 곳은 자리표시자가 아니라 **실제로 열리는 주소**다.
 *
 * **왜 소스 상수이고 빌드타임 .env 가 아닌가.**
 *   - 이 값은 의원마다 다르지 않다. 빌드마다도 다르지 않다. 빌드타임 주입은
 *     "빌드마다 다른 값" 을 위한 장치인데 여기엔 그 변동이 없다.
 *   - `EMBEDDED_ENV_KEYS` 는 세 곳(electron.vite.config.ts, Windows CI 워크플로,
 *     scripts/ci-assert-embedded.mjs)에 손으로 복제돼 있다. 키 하나를 늘리면
 *     세 곳을 같이 고쳐야 하고, 안 고치면 CI 가 깨진다. 변하지 않는 상수를
 *     위해 그 부채를 늘리지 않는다.
 *   - 주입이 빠진 빌드에서는 값이 조용히 빈 문자열이 된다. 그건 지금 고치려는
 *     증상(QR 이 안 그려짐) 그 자체다.
 * 의원별 변동은 이미 제자리에 있다 — 다이얼로그의 설정 입력이 그것이고,
 * 아래 병합 규칙이 그 입력을 절대 덮지 않는다.
 *
 * `kioskSlug` 기본값이 `main` 인 이유: 키오스크 배포의 `KIOSK_CLINICIANS` 가
 * `main` 을 계정 소유자에게 매핑한다. 슬러그가 없으면 URL 에 `k` 가 빠지고,
 * 그러면 문진이 누구 앞으로 들어오는지 키오스크가 알 수 없다.
 *
 * [HARD] 이 상수는 **기본값 계층에만** 산다. `shared/visitCode.ts` 의
 * `buildKioskIntakeUrl` 은 여전히 호스트명을 모른다 — 주소는 설정에서 온다는
 * 그 파일의 규칙은 그대로다.
 */
const DEFAULT_KIOSK_URL = 'https://entanglecare.com/righthand/patient';

const DEFAULT_VISIT_CODE: VisitCodeSettings = {
  kioskUrl: DEFAULT_KIOSK_URL,
  kioskSlug: 'main'
};

/**
 * 저장값이 이기고, 빈 값만 기본값으로 채운다.
 *
 * 전개 병합(`{...기본, ...저장}`)만으로는 부족하다. 저장된 설정은 두 키를 항상
 * 함께 쓰기 때문에(`setVisitCodeSettings` 참고), 주소를 입력하지 않고 저장한
 * 사용자의 파일에는 `kioskUrl: ''` 가 **명시적으로** 들어 있다. 전개는 그
 * 빈 문자열로 기본값을 덮는다. 그래서 빈 값 판정을 따로 한다.
 *
 * 반대 방향은 절대 하지 않는다: 이미 자기 주소를 적어둔 사용자의 값은 기본값이
 * 무엇이든 그대로 남는다. 기본값은 빈 칸을 위한 것이지 교정을 위한 것이 아니다.
 */
export function getVisitCodeSettings(): VisitCodeSettings {
  const saved = (store.get('visitCode') ?? {}) as Partial<VisitCodeSettings>;
  const url = saved.kioskUrl?.trim() ?? '';
  const slug = saved.kioskSlug?.trim() ?? '';
  return {
    kioskUrl: url === '' ? DEFAULT_VISIT_CODE.kioskUrl : url,
    kioskSlug: slug === '' ? DEFAULT_VISIT_CODE.kioskSlug : slug
  };
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
