import './wsPolyfill.js';
import { app, BrowserWindow, ipcMain, nativeImage, screen, shell } from 'electron';

app.setName('Realtime Doctor');
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Realtime Doctor',
    applicationVersion: app.getVersion()
  });
}
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_STEP,
  IPC,
  type AnalysisResult,
  type CloudSyncSettings,
  type DictationResult,
  type EvidenceStatus,
  type Language,
  type LocalSaveSettings,
  type ShortcutId,
  type Speaker,
  type SummaryResult,
  type TranscriptChunk,
  type TranscriptLabelEvent
} from '../shared/types.js';
import {
  registerAllShortcuts,
  setShortcutDispatch,
  unregisterAllShortcuts
} from './shortcuts.js';
import { analyzer } from './analyzer.js';
import { getCurrentUser, setAuthCallbacks } from './auth.js';
import { initDeviceAuth, listDevices, revokeDevice } from './device.js';
import { classifySpeaker } from './diarizer.js';
import { generateDictation } from './dictator.js';
import {
  applyLayout,
  deleteLayout as deleteLayoutFn,
  getDefaultLayoutName,
  listLayouts,
  saveCurrentLayout,
  setDefaultLayout
} from './layouts.js';
import { openClovaStream, type ClovaStreamHandle } from './clovaStream.js';
import { isPubmedUrl, lookupEvidence } from './evidence.js';
import {
  clearPatientState,
  getActiveDetail,
  listWaitingEncounters,
  loadPatientDetail,
  selectEncounter,
  subscribeWaitingChanges,
  type WaitingSubscription
} from './patients.js';
import {
  appendDictation,
  appendSummary,
  clearSessionCache,
  endCurrentSession,
  getCurrentSessionId,
  deleteChunkRow,
  linkSessionToEncounter,
  listMySessions,
  loadSession,
  logUsage,
  relabelChunk,
  saveTranscriptChunk,
  setCurrentSessionId,
  uploadChunkAudio,
  uploadSessionAudio,
  upsertAnalysis
} from './sessions.js';
import {
  listProviders,
  mintStreamSession,
  transcribeAudio
} from './transcribers.js';
import {
  DEFAULT_LANGUAGE,
  clearLanguage,
  getCloudSync,
  getFontScale,
  getLanguage,
  getLastDictationTemplate,
  getLocalSave,
  getShortcuts,
  getTranscribeProvider,
  hasStoredLanguage,
  markLaunched,
  resetShortcuts,
  saveBounds,
  saveOpacity,
  setCloudSync,
  setFontScale,
  setLastDictationTemplate,
  setLocalSave,
  setShortcut,
  setTranscribeProvider,
  store,
  type WindowKey
} from './store.js';
import { applyLanguage, preferredProviderFor } from './language.js';
import {
  ensureEntitled,
  getSubscriptionState,
  initSubscription,
  openBillingPage,
  refreshEntitlement,
  setSubscriptionUser
} from './subscription.js';
import { summarizeConversation } from './summarizer.js';
import { getSupabase } from './supabaseClient.js';
import {
  activateTab,
  attachGroupDragHandlers,
  detachTab,
  dissolveAllGroups,
  getGroupsState,
  initWindowGroups,
  isHiddenGroupMember,
  restoreGroups,
  syncGroupBounds
} from './windowGroups.js';
import { MAIN_WINDOW_KEYS, OVERLAYS, createOverlayWindow } from './windows.js';
import type {
  DictationTemplate,
  TranscribeProviderId,
  WaitingEncounter
} from '../shared/types.js';

const here = dirname(fileURLToPath(import.meta.url));

interface EnvDiagnostics {
  candidates: { path: string; exists: boolean }[];
  loadedFrom: string[];
  keysPresent: Record<string, boolean>;
}

let envDiagnostics: EnvDiagnostics = {
  candidates: [],
  loadedFrom: [],
  keysPresent: {}
};

function envCandidates(): string[] {
  return [
    join(here, '../../.env'),
    join(app.getPath('userData'), '.env'),
    join(process.cwd(), '.env'),
    join(app.getPath('home'), '.realtime-doctor.env')
  ];
}

function loadEnvFiles(): void {
  const cands = envCandidates();
  const candidates = cands.map((p) => ({ path: p, exists: existsSync(p) }));
  const loadedFrom: string[] = [];
  for (const c of candidates) {
    if (c.exists) {
      const res = loadDotenv({ path: c.path });
      if (!res.error) loadedFrom.push(c.path);
    }
  }
  if (loadedFrom.length === 0) loadDotenv();

  const trackKeys = [
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'CLOVA_API_KEY_ID',
    'CLOVA_API_KEY',
    'CLOVA_SPEECH_SECRET'
  ];
  const keysPresent: Record<string, boolean> = {};
  for (const k of trackKeys) keysPresent[k] = !!process.env[k];
  envDiagnostics = { candidates, loadedFrom, keysPresent };

  // Surface to stdout/stderr for terminal launches.
  console.log('[env] candidates:', candidates);
  console.log('[env] loadedFrom:', loadedFrom);
  console.log('[env] keysPresent:', keysPresent);
}

const windows = new Map<string, BrowserWindow>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

analyzer.on((result: AnalysisResult) => {
  broadcast(IPC.AnalysisUpdate, result);
  broadcast(IPC.AnalysisPending, false);
  void upsertAnalysis(result);
});

ipcMain.handle(
  IPC.TranscribeAudio,
  async (_event, payload: { id: string; base64Wav: string }) => {
    if (!payload?.base64Wav) return '';
    // [게이트] 새 진료 녹음 수신. 렌더러 버튼이 아니라 여기서 막아야 우회가 안 된다.
    if (!ensureEntitled('record').ok) return '';
    const before = getTranscribeProvider();
    const text = await transcribeAudio(payload.base64Wav);
    const after = getTranscribeProvider();
    if (before !== after) {
      // transcribeAudio 가 stream-only provider 를 chunk 호환 provider 로 강등.
      // 다른 창의 UI 상태를 동기화하고 fallback 배너를 띄운다.
      broadcast(IPC.ProviderChanged, after);
      broadcast(IPC.TranscribeFallback, {
        reason: `${before} stream session failed before producing transcripts — switched to ${after} chunk mode`,
        from: 'realtime',
        to: `${after}-chunk`
      });
    }
    if (!text) return '';
    const chunk: TranscriptChunk = {
      id: payload.id,
      text,
      timestamp: Date.now()
    };
    analyzer.push({ ...chunk, speaker: 'unknown' });
    void (async () => {
      const audioPath = await uploadChunkAudio(chunk.id, payload.base64Wav);
      await saveTranscriptChunk({ ...chunk, speaker: 'unknown' }, { audioPath });
    })();
    classifySpeaker({
      text,
      history: analyzer.history().slice(0, -1).map((h) => ({
        speaker: h.speaker,
        text: h.text
      }))
    }).then((speaker) => {
      analyzer.relabel(chunk.id, speaker);
      void relabelChunk(chunk.id, speaker);
      const event: TranscriptLabelEvent = { id: chunk.id, speaker };
      broadcast(IPC.TranscriptLabel, event);
    });
    return text;
  }
);

ipcMain.on(IPC.TranscriptChunk, async (_event, chunk: TranscriptChunk) => {
  if (!chunk?.text) return;
  // [게이트] 스트림 모드가 만들어낸 발화도 결국 이 경로로 들어온다.
  if (!ensureEntitled('record').ok) return;
  const initialSpeaker: Speaker = chunk.speaker ?? 'unknown';
  analyzer.push({ ...chunk, speaker: initialSpeaker });
  void saveTranscriptChunk({ ...chunk, speaker: initialSpeaker });

  if (!chunk.speaker || chunk.speaker === 'unknown') {
    const speaker = await classifySpeaker({
      text: chunk.text,
      history: analyzer.history().slice(0, -1).map((h) => ({
        speaker: h.speaker,
        text: h.text
      }))
    });
    analyzer.relabel(chunk.id, speaker);
    void relabelChunk(chunk.id, speaker);
    const event: TranscriptLabelEvent = { id: chunk.id, speaker };
    broadcast(IPC.TranscriptLabel, event);
  }
});

ipcMain.on(IPC.TranscriptRelabel, (_event, payload: TranscriptLabelEvent) => {
  if (!payload?.id || !payload.speaker) return;
  analyzer.relabel(payload.id, payload.speaker as Speaker);
  void relabelChunk(payload.id, payload.speaker as Speaker);
  broadcast(IPC.TranscriptLabel, payload);
});

ipcMain.on(IPC.TranscriptRemove, (_event, id: string) => {
  if (!id) return;
  analyzer.remove(id);
  void deleteChunkRow(id);
});

ipcMain.on(IPC.TranscriptReset, () => {
  analyzer.reset();
  void flushStreamSessionAudio().finally(() => {
    void endCurrentSession().finally(() => {
      restorePreferredProvider();
    });
  });
});

async function runDictationNow(template: DictationTemplate): Promise<{ state: string; result?: DictationResult; message?: string }> {
  // [게이트] IPC 핸들러와 전역 단축키 두 경로가 모두 여기로 모인다.
  const gate = ensureEntitled('dictation');
  if (!gate.ok) {
    const message = gate.error ?? '구독이 필요합니다.';
    broadcast(IPC.DictationUpdate, { state: 'error', message });
    return { state: 'error', message };
  }
  const t: DictationTemplate = template ?? 'soap';
  setLastDictationTemplate(t);
  broadcast(IPC.DictationUpdate, { state: 'pending', template: t });
  try {
    const result = await generateDictation(
      analyzer.history().map((h) => ({ speaker: h.speaker, text: h.text })),
      t
    );
    broadcast(IPC.DictationUpdate, { state: 'ready', result });
    void appendDictation(result);
    return { state: 'ready', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    broadcast(IPC.DictationUpdate, { state: 'error', message });
    return { state: 'error', message };
  }
}

async function runSummaryNow(): Promise<{ state: string; result?: SummaryResult; message?: string }> {
  // [게이트] IPC 핸들러와 전역 단축키 두 경로가 모두 여기로 모인다.
  const gate = ensureEntitled('summary');
  if (!gate.ok) {
    const message = gate.error ?? '구독이 필요합니다.';
    broadcast(IPC.SummaryUpdate, { state: 'error', message });
    return { state: 'error', message };
  }
  broadcast(IPC.SummaryUpdate, { state: 'pending' });
  try {
    const result = await summarizeConversation(
      analyzer.history().map((h) => ({ speaker: h.speaker, text: h.text }))
    );
    broadcast(IPC.SummaryUpdate, { state: 'ready', result });
    void appendSummary(result);
    return { state: 'ready', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    broadcast(IPC.SummaryUpdate, { state: 'error', message });
    return { state: 'error', message };
  }
}

ipcMain.handle(IPC.DictationRequest, async (_event, template: DictationTemplate) =>
  runDictationNow(template)
);

ipcMain.handle('dictation:get-last-template', () => getLastDictationTemplate());

ipcMain.handle(IPC.AnalysisRequest, () => {
  // [게이트] 감별진단 실행.
  const gate = ensureEntitled('analysis');
  if (!gate.ok) return { ok: false, error: gate.error };
  broadcast(IPC.AnalysisPending, true);
  analyzer.runNow();
  return { ok: true };
});

ipcMain.handle(IPC.SummaryRequest, async () => runSummaryNow());

// ── 전역 글씨 배율 ──────────────────────────────────────────────────────
/** 저장 + 전 창 broadcast. 렌더러는 :root 의 --font-scale 만 갈아끼운다. */
function applyFontScale(value: number): void {
  broadcast(IPC.FontScaleChanged, setFontScale(value));
}

function stepFontScale(delta: number): void {
  applyFontScale(getFontScale() + delta);
}

// 나중에 뜬 창이 현재 배율을 스스로 채우기 위한 getter (PatientsGetActive 와 동일 패턴).
ipcMain.handle(IPC.FontScaleGet, () => getFontScale());

// ── 창 크기 단축키 ──────────────────────────────────────────────────────
const WINDOW_RESIZE_STEP = 40;

/**
 * 포커스된 오버레이 창의 크기를 한 스텝 조절한다. 포커스된 오버레이가 없으면
 * 아무것도 하지 않는다 (엉뚱한 창을 건드리지 않기 위해).
 */
function resizeFocusedWindow(deltaW: number, deltaH: number): void {
  const win = BrowserWindow.getFocusedWindow();
  if (!win || win.isDestroyed()) return;
  const key = windowKeyOf(win);
  if (!key) return;

  const prev = win.getBounds();
  const [minW, minH] = win.getMinimumSize();
  const wa = screen.getDisplayMatching(prev).workArea;

  const width = Math.min(Math.max(prev.width + deltaW, minW), wa.width);
  const height = Math.min(Math.max(prev.height + deltaH, minH), wa.height);
  if (width === prev.width && height === prev.height) return;

  // 커진 쪽이 작업영역 밖으로 밀려나면 안쪽으로 당긴다.
  let x = prev.x;
  let y = prev.y;
  if (x + width > wa.x + wa.width) x = wa.x + wa.width - width;
  if (y + height > wa.y + wa.height) y = wa.y + wa.height - height;
  if (x < wa.x) x = wa.x;
  if (y < wa.y) y = wa.y;

  const next = { x, y, width, height };
  win.setBounds(next);
  // 프로그램적 setBounds 는 'resized'(사용자 조작) 이벤트를 발생시키지 않으므로
  // windows.ts 의 persist 핸들러에 기대지 않고 직접 저장한다.
  saveBounds(key, next);
  // 임시 확장(팝오버/언어 선택기) 중이었다면, 이 단축키는 사용자가 의도적으로
  // 정한 크기이므로 확장 해제 시 되돌리지 않도록 알린다.
  noteDeliberateResize(win, next);
  // 탭 그룹은 같은 bounds 를 공유한다 — 숨은 멤버까지 맞춰 desync 를 막는다.
  for (const member of syncGroupBounds(key, next)) saveBounds(member, next);
  broadcastWindowState();
}

function dispatchShortcut(id: ShortcutId): void {
  switch (id) {
    case 'toggleAll':
      toggleAllMainWindows();
      return;
    case 'toggleTranscript':
      toggleOneWindow('transcript');
      return;
    case 'toggleDiagnosis':
      toggleOneWindow('diagnosis');
      return;
    case 'toggleTerms':
      toggleOneWindow('terms');
      return;
    case 'toggleQuestions':
      toggleOneWindow('questions');
      return;
    case 'toggleSummary':
      toggleOneWindow('summary');
      return;
    case 'toggleDictation':
      toggleOneWindow('dictation');
      return;
    case 'togglePatients':
      toggleOneWindow('patients');
      return;
    case 'recordStartStop': {
      const tr = windows.get('transcript');
      if (tr && !tr.isDestroyed()) {
        if (tr.isMinimized()) tr.restore();
        if (!tr.isVisible()) tr.show();
        tr.setAlwaysOnTop(true, 'screen-saver');
        tr.focus();
      }
      broadcast(IPC.ShortcutTrigger, { id });
      return;
    }
    case 'runAnalyze':
      // [게이트] 단축키도 IPC 와 같은 판정을 받는다.
      if (!ensureEntitled('analysis').ok) return;
      analyzer.runNow();
      return;
    case 'runSummary':
      void runSummaryNow();
      return;
    case 'runDictation':
      void runDictationNow(getLastDictationTemplate());
      return;
    case 'fontIncrease':
      stepFontScale(FONT_SCALE_STEP);
      return;
    case 'fontDecrease':
      stepFontScale(-FONT_SCALE_STEP);
      return;
    case 'fontReset':
      applyFontScale(FONT_SCALE_DEFAULT);
      return;
    case 'windowWiden':
      resizeFocusedWindow(WINDOW_RESIZE_STEP, 0);
      return;
    case 'windowNarrow':
      resizeFocusedWindow(-WINDOW_RESIZE_STEP, 0);
      return;
    case 'windowTaller':
      resizeFocusedWindow(0, WINDOW_RESIZE_STEP);
      return;
    case 'windowShorter':
      resizeFocusedWindow(0, -WINDOW_RESIZE_STEP);
      return;
  }
}

function broadcastShortcuts(): void {
  broadcast(IPC.ShortcutsChanged, getShortcuts());
}

// 세션 끝나면 fallback 으로 떨어졌더라도 다음 세션은 다시 primary realtime 시도.
function restorePreferredProvider(): void {
  const lang = getLanguage();
  if (!lang) return;
  const preferred = preferredProviderFor(lang);
  if (getTranscribeProvider() === preferred) return;
  setTranscribeProvider(preferred);
  broadcast(IPC.ProviderChanged, preferred);
}

ipcMain.handle(IPC.ShortcutsGet, () => getShortcuts());
ipcMain.handle(IPC.ShortcutsSet, (_event, id: ShortcutId, accel: string) => {
  const next = setShortcut(id, accel);
  registerAllShortcuts();
  broadcastShortcuts();
  return { ok: true, shortcuts: next };
});
ipcMain.handle(IPC.ShortcutsReset, () => {
  const next = resetShortcuts();
  registerAllShortcuts();
  broadcastShortcuts();
  return { ok: true, shortcuts: next };
});

ipcMain.on(
  IPC.WindowToggleClickThrough,
  (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }
);

ipcMain.on(IPC.WindowSetAlwaysOnTop, (event, on: boolean) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.setAlwaysOnTop(on, 'screen-saver');
});

function windowKeyOf(win: BrowserWindow | null): WindowKey | null {
  if (!win) return null;
  for (const [k, w] of windows) {
    if (w === win) return k as WindowKey;
  }
  return null;
}

interface WindowState {
  key: WindowKey;
  title: string;
  minimized: boolean;
  visible: boolean;
  opacity: number;
}

function snapshotWindows(): WindowState[] {
  const result: WindowState[] = [];
  for (const spec of OVERLAYS) {
    const win = windows.get(spec.key);
    if (!win || win.isDestroyed()) continue;
    result.push({
      key: spec.key,
      title: spec.title,
      minimized: win.isMinimized(),
      visible: win.isVisible(),
      opacity: win.getOpacity()
    });
  }
  return result;
}

function broadcastWindowState(): void {
  broadcast('windows:state', snapshotWindows());
}

ipcMain.on('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});

// 팝오버(dropdown/dialog) 나 전체화면 성격의 화면(언어 선택기) 이 열릴 때 창이
// 작아서 잘리지 않도록 일시적으로 창 크기를 확장하고, 닫히면 원래 크기로 복귀한다.
// 같은 창에서 여러 개가 중첩되어도 안전하도록 depth 를 센다.
interface TempExpandState {
  /** 확장 전 bounds — leave 시 여기로 되돌린다. */
  prev: Electron.Rectangle;
  /** 우리가 마지막으로 적용한 bounds — 사용자 조작 감지 기준선. */
  applied: Electron.Rectangle;
  /** 중첩 확장 깊이. 0 이 되는 순간에만 복귀. */
  depth: number;
  /** 확장 중 사용자가 직접 크기를 바꿨으면 복귀하지 않는다. */
  userResized: boolean;
  /** 확장 중 사용자 이동/리사이즈를 추적하는 리스너 (leave 시 해제). */
  onUserBounds: () => void;
}
const tempExpandStates = new Map<number, TempExpandState>();
const POPOVER_MIN_W = 520;
const POPOVER_MIN_H = 560;

/**
 * 창을 최소 targetW x targetH 이상으로 (줄이지 않고) 키운다. depth 를 올리며,
 * 최초 확장 시점의 bounds 를 기억해 둔다.
 */
function tempExpandEnter(win: BrowserWindow, targetW: number, targetH: number): void {
  const cur = win.getBounds();
  const existing = tempExpandStates.get(win.id);
  if (existing) {
    existing.depth += 1;
  } else {
    const onUserBounds = () => {
      // 확장 중 사용자가 창을 직접 옮기거나 크기를 바꾼 경우.
      // (프로그램적 setBounds 는 'moved'/'resized' 를 발생시키지 않는다.)
      const st = tempExpandStates.get(win.id);
      if (!st || win.isDestroyed()) return;
      const now = win.getBounds();
      if (now.width !== st.applied.width || now.height !== st.applied.height) {
        // 사용자가 의도적으로 정한 크기 — 복귀로 덮어쓰지 않는다.
        st.userResized = true;
        st.prev = { ...now };
      } else {
        // 이동만 했으면 복귀 위치도 같은 만큼 따라간다.
        st.prev = {
          ...st.prev,
          x: st.prev.x + (now.x - st.applied.x),
          y: st.prev.y + (now.y - st.applied.y)
        };
      }
      st.applied = now;
      // windows.ts 의 persist 가 확장된 bounds 를 저장했을 수 있으므로,
      // 실제로 복귀될 bounds 로 덮어써 확장 상태가 영구화되는 것을 막는다.
      const key = windowKeyOf(win);
      if (key) saveBounds(key, st.prev);
    };
    tempExpandStates.set(win.id, {
      prev: { ...cur },
      applied: { ...cur },
      depth: 1,
      userResized: false,
      onUserBounds
    });
    win.on('moved', onUserBounds);
    win.on('resized', onUserBounds);
  }

  const wa = screen.getDisplayMatching(cur).workArea;
  const wantW = Math.min(targetW, wa.width - 32);
  const wantH = Math.min(targetH, wa.height - 32);
  if (cur.width >= wantW && cur.height >= wantH) return;
  const nextW = Math.max(cur.width, wantW);
  const nextH = Math.max(cur.height, wantH);
  // 화면 밖으로 나가지 않게 클램프.
  let nextX = cur.x;
  let nextY = cur.y;
  if (nextX + nextW > wa.x + wa.width) nextX = wa.x + wa.width - nextW - 8;
  if (nextY + nextH > wa.y + wa.height) nextY = wa.y + wa.height - nextH - 8;
  if (nextX < wa.x) nextX = wa.x + 8;
  if (nextY < wa.y) nextY = wa.y + 8;
  const next = { x: nextX, y: nextY, width: nextW, height: nextH };
  win.setBounds(next);
  const st = tempExpandStates.get(win.id);
  if (st) st.applied = { ...next };
}

/**
 * 임시 확장 중에 다른 코드(창 크기 단축키 등)가 프로그램적으로 크기를 바꾼 경우,
 * 그 값을 사용자가 의도한 크기로 채택한다. 확장 해제가 이를 되돌리면 안 된다.
 */
function noteDeliberateResize(win: BrowserWindow, next: Electron.Rectangle): void {
  const st = tempExpandStates.get(win.id);
  if (!st) return;
  st.userResized = true;
  st.prev = { ...next };
  st.applied = { ...next };
}

/** depth 를 내리고, 0 이 되면 확장 전 bounds 로 복귀. */
function tempExpandLeave(win: BrowserWindow): void {
  const st = tempExpandStates.get(win.id);
  if (!st) return;
  st.depth -= 1;
  if (st.depth > 0) return;
  tempExpandStates.delete(win.id);
  win.off('moved', st.onUserBounds);
  win.off('resized', st.onUserBounds);
  if (st.userResized) return; // 사용자가 정한 크기 유지
  win.setBounds(st.prev);
}

ipcMain.on(
  'window:popover-enter',
  (event, size?: { width?: number; height?: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    // size 가 오면 렌더러가 실제 레이아웃에서 잰 값이므로 그걸 쓰고,
    // 없으면 팝오버 기본치를 쓴다.
    tempExpandEnter(
      win,
      Math.round(size?.width ?? POPOVER_MIN_W),
      Math.round(size?.height ?? POPOVER_MIN_H)
    );
  }
);
ipcMain.on('window:popover-leave', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  tempExpandLeave(win);
});

ipcMain.on('window:set-opacity', (event, value: number) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const clamped = Math.max(0.2, Math.min(1, value));
  win.setOpacity(clamped);
  const key = windowKeyOf(win);
  if (key) saveOpacity(key, clamped);
});

ipcMain.handle('window:get-opacity', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win?.getOpacity() ?? 1;
});

// ── 창 탭 그룹 (드래그앤드랍 머지) ──────────────────────────────────────
ipcMain.handle(IPC.WindowGroupsGet, () => getGroupsState());
ipcMain.on(IPC.WindowGroupsActivate, (_event, key: WindowKey) => {
  activateTab(key);
  broadcastWindowState();
});
ipcMain.on(IPC.WindowGroupsDetach, (_event, key: WindowKey) => {
  detachTab(key);
  broadcastWindowState();
});
// 렌더러가 자기 창 key 를 알 수 있게.
ipcMain.handle('window:get-key', (event) =>
  windowKeyOf(BrowserWindow.fromWebContents(event.sender))
);

// ── 기기인증 ────────────────────────────────────────────────────────────
ipcMain.handle(IPC.DevicesList, async () => {
  const user = getCurrentUser();
  if (!user) return [];
  return listDevices(user.id);
});
ipcMain.handle(IPC.DevicesRevoke, async (_event, rowId: string) => {
  const user = getCurrentUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  return revokeDevice(user.id, rowId);
});

// ── 로컬 저장 설정 ──────────────────────────────────────────────────────
ipcMain.handle(IPC.LocalSaveGet, () => getLocalSave());
ipcMain.handle(IPC.LocalSaveSet, (_event, patch: Partial<LocalSaveSettings>) =>
  setLocalSave(patch)
);

ipcMain.handle('layout:list', () => listLayouts());

ipcMain.handle('layout:apply', (_event, name: string) => {
  // 레이아웃은 모든 창을 개별 위치로 재배치하므로 탭 그룹과 양립 불가 — 해체.
  dissolveAllGroups();
  return applyLayout(name, windows as Map<WindowKey, BrowserWindow>);
});

ipcMain.handle('layout:save-current', (_event, name: string) => {
  saveCurrentLayout(name, windows as Map<WindowKey, BrowserWindow>);
  return listLayouts();
});

ipcMain.handle('layout:delete', (_event, name: string) => {
  deleteLayoutFn(name);
  return listLayouts();
});

ipcMain.handle('layout:set-default', (_event, name: string | null) => {
  setDefaultLayout(name);
  return listLayouts();
});

ipcMain.handle('layout:get-default', () => getDefaultLayoutName());

ipcMain.handle(IPC.ProviderList, () => listProviders());
ipcMain.handle(IPC.ProviderGet, () => getTranscribeProvider());
ipcMain.handle(IPC.ProviderSet, (_event, id: TranscribeProviderId) => {
  setTranscribeProvider(id);
  const current = getTranscribeProvider();
  broadcast(IPC.ProviderChanged, current);
  return current;
});

// 언어는 항상 값이 있다 — "미선택" 상태는 더 이상 존재하지 않는다.
ipcMain.handle(IPC.LanguageGet, () => getLanguage());
ipcMain.handle(IPC.LanguageSet, (_event, lang: Language) => {
  const provider = applyLanguage(lang);
  markLaunched();
  broadcast(IPC.LanguageChanged, lang);
  broadcast(IPC.ProviderChanged, provider);
  return { ok: true, language: lang, provider };
});
// 언어 초기화 = 기본값(한국어) 복귀. 언어 선택 화면으로 되돌아가지 않는다.
ipcMain.handle(IPC.LanguageClear, () => {
  clearLanguage();
  const lang = getLanguage();
  const provider = applyLanguage(lang);
  broadcast(IPC.LanguageChanged, lang);
  broadcast(IPC.ProviderChanged, provider);
  return { ok: true };
});

ipcMain.handle(IPC.CloudSyncGet, () => getCloudSync());
ipcMain.handle(
  IPC.CloudSyncSet,
  (_event, patch: Partial<CloudSyncSettings>) => setCloudSync(patch)
);

ipcMain.handle(IPC.SessionsListMine, () => listMySessions(30));

ipcMain.handle(IPC.SessionsLoad, async (_event, sessionId: string) => {
  const loaded = await loadSession(sessionId);
  if (!loaded) return null;
  // analyzer 를 그 세션 chunks 로 복원
  analyzer.reset();
  for (const c of loaded.chunks) {
    analyzer.push({
      id: c.chunk_id,
      text: c.text,
      timestamp: c.timestamp_ms,
      speaker: c.speaker
    });
  }
  setCurrentSessionId(loaded.session.id);
  // 분석/요약/딕테이션 broadcast 로 다른 창 갱신
  if (loaded.analysis) broadcast(IPC.AnalysisUpdate, loaded.analysis);
  if (loaded.latestSummary)
    broadcast(IPC.SummaryUpdate, { state: 'ready', result: loaded.latestSummary });
  if (loaded.latestDictation)
    broadcast(IPC.DictationUpdate, { state: 'ready', result: loaded.latestDictation });
  // transcript 창에 chunks 전달
  const payload = {
    session: loaded.session,
    chunks: loaded.chunks
  };
  broadcast(IPC.SessionLoaded, payload);
  return payload;
});
let openaiSessionStartedAt: number | null = null;
ipcMain.handle(IPC.StreamMint, async () => {
  // [게이트] 실시간 전사 세션 발급 = 녹음 시작. provider fallback 보다 먼저 막는다
  // (여기서 throw 하면 렌더러가 fallback 을 시도하지만 그 경로도 게이트에 걸린다).
  const gate = ensureEntitled('record');
  if (!gate.ok) throw new Error(gate.error ?? '구독이 필요합니다.');
  try {
    const result = await mintStreamSession();
    openaiSessionStartedAt = Date.now();
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[fallback] stream mint failed → switch to gemini chunk:', reason);
    setTranscribeProvider('gemini');
    broadcast(IPC.ProviderChanged, 'gemini');
    broadcast(IPC.TranscribeFallback, {
      reason,
      from: 'realtime',
      to: 'gemini-chunk'
    });
    throw err;
  }
});

ipcMain.on(IPC.RealtimeSessionEnd, () => {
  if (openaiSessionStartedAt === null) return;
  const duration_ms = Date.now() - openaiSessionStartedAt;
  openaiSessionStartedAt = null;
  void logUsage({
    provider: 'openai-realtime',
    task: 'realtime-session',
    model: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe',
    duration_ms
  });
});

let clovaStreamSession: ClovaStreamHandle | null = null;
let clovaStreamSenderId: number | null = null;
let clovaSeqId = 0;
let clovaCurrentItemId = '';
let clovaCurrentPartial = '';
// renderer가 idle timer 로 client-side에서 final 처리한 itemId들. CLOVA 가 늦게
// 진짜 final 을 보내도 중복 row 가 생기지 않도록 final 핸들러에서 본 후 skip.
const handledClovaItemIds = new Set<string>();

// CLOVA stream 모드용 세션 전체 PCM 누적기. saveAudio 플래그 무관하게 항상 누적
// (메모리 비용 작음). 세션 종료 시 sessions.uploadSessionAudio 가 saveAudio 체크.
const CLOVA_SAMPLE_RATE = 16000;
let streamPcmChunks: Buffer[] = [];
let streamSessionIdAtStart: string | null = null;

function resetStreamPcm(): void {
  streamPcmChunks = [];
  streamSessionIdAtStart = null;
}

function pcm16ToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function flushStreamSessionAudio(opts: { resetBuffer: boolean } = { resetBuffer: true }): Promise<void> {
  if (streamPcmChunks.length === 0) return;
  const sessionId = streamSessionIdAtStart ?? getCurrentSessionId();
  const pcm = Buffer.concat(streamPcmChunks);
  if (opts.resetBuffer) resetStreamPcm();
  if (!sessionId) return;
  const wav = pcm16ToWav(pcm, CLOVA_SAMPLE_RATE);
  await uploadSessionAudio(sessionId, wav);
}

function newClovaItemId(): string {
  clovaSeqId += 1;
  return `clova_${Date.now()}_${clovaSeqId}`;
}

ipcMain.handle(IPC.ClovaStreamOpen, async (event) => {
  // [게이트] CLOVA 스트림 열기 = 녹음 시작.
  {
    const gate = ensureEntitled('record');
    if (!gate.ok) throw new Error(gate.error ?? '구독이 필요합니다.');
  }
  if (clovaStreamSession) {
    clovaStreamSession.stop();
    clovaStreamSession = null;
  }
  let handle: ClovaStreamHandle;
  try {
    handle = await openClovaStream();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[fallback] CLOVA stream open failed → switch to gemini chunk:', reason);
    setTranscribeProvider('gemini');
    broadcast(IPC.ProviderChanged, 'gemini');
    broadcast(IPC.TranscribeFallback, {
      reason,
      from: 'realtime',
      to: 'gemini-chunk'
    });
    throw err;
  }
  clovaStreamSession = handle;
  clovaStreamSenderId = event.sender.id;
  clovaSeqId = 0;
  clovaCurrentItemId = newClovaItemId();
  clovaCurrentPartial = '';

  handle.on('partial', (text) => {
    clovaCurrentPartial = text;
    broadcast(IPC.ClovaStreamPartial, {
      itemId: clovaCurrentItemId,
      text
    });
  });
  handle.on('final', (text) => {
    const finalText = text.trim();
    const itemId = clovaCurrentItemId;
    const alreadyHandled = handledClovaItemIds.has(itemId);
    broadcast(IPC.ClovaStreamFinal, { itemId, text: finalText });
    if (finalText && !alreadyHandled) {
      const chunk: TranscriptChunk = {
        id: itemId,
        text: finalText,
        timestamp: Date.now()
      };
      analyzer.push({ ...chunk, speaker: 'unknown' });
      void saveTranscriptChunk({ ...chunk, speaker: 'unknown' });
      void logUsage({
        provider: 'clova-stream',
        task: 'transcribe',
        model: 'clova-stream',
        chars: finalText.length
      });
      classifySpeaker({
        text: finalText,
        history: analyzer.history().slice(0, -1).map((h) => ({
          speaker: h.speaker,
          text: h.text
        }))
      }).then((speaker) => {
        analyzer.relabel(chunk.id, speaker);
        void relabelChunk(chunk.id, speaker);
        const evt: TranscriptLabelEvent = { id: chunk.id, speaker };
        broadcast(IPC.TranscriptLabel, evt);
      });
    } else if (finalText && alreadyHandled) {
      // 사용량은 어차피 발화 했으니 기록 (analyzer/transcript 는 client side 가 이미 처리)
      void logUsage({
        provider: 'clova-stream',
        task: 'transcribe',
        model: 'clova-stream',
        chars: finalText.length
      });
    }
    handledClovaItemIds.delete(itemId);
    clovaCurrentItemId = newClovaItemId();
    clovaCurrentPartial = '';
  });
  handle.on('error', (err) => {
    broadcast(IPC.ClovaStreamError, { message: err.message });
  });
  handle.on('close', () => {
    if (clovaStreamSession === handle) clovaStreamSession = null;
  });

  return { ok: true };
});

ipcMain.on(IPC.ClovaStreamAudio, (_event, chunk: Uint8Array) => {
  if (!clovaStreamSession || !chunk) return;
  const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (streamSessionIdAtStart === null) {
    streamSessionIdAtStart = getCurrentSessionId();
  }
  streamPcmChunks.push(buf);
  clovaSeqId += 1;
  clovaStreamSession.sendAudio(buf, clovaSeqId);
});

ipcMain.on(IPC.ClovaStreamMarkHandled, (_event, itemId: string) => {
  if (typeof itemId !== 'string' || !itemId) return;
  handledClovaItemIds.add(itemId);
  // client 가 이 itemId 를 final 로 승격했으면 main 도 즉시 다음 발화로 advance
  // 시켜야 그 다음 partial 이 새 itemId 로 와서 기존 row 를 덮어쓰지 않음.
  if (itemId === clovaCurrentItemId) {
    clovaCurrentItemId = newClovaItemId();
    clovaCurrentPartial = '';
  }
});

ipcMain.on(IPC.ClovaStreamClose, () => {
  if (clovaStreamSession) {
    clovaStreamSession.stop();
    clovaStreamSession = null;
  }
  clovaStreamSenderId = null;
  // 정지 시점에 누적된 PCM 을 upsert 업로드한다. 버퍼는 비우지 않아서
  // 사용자가 같은 세션에서 다시 시작을 누르면 추가 PCM 이 이어 붙고
  // 다음 정지 때 더 긴 WAV 로 같은 경로에 덮어쓴다. 같은 세션 내
  // 다중 녹음이 하나의 session.wav 로 누적되는 결과.
  void flushStreamSessionAudio({ resetBuffer: false });
});

// silence unused warning
void clovaStreamSenderId;
void clovaCurrentPartial;

ipcMain.handle('windows:list-state', () => snapshotWindows());

function toggleOneWindow(key: WindowKey): void {
  const win = windows.get(key);
  if (!win || win.isDestroyed()) return;
  // 탭 그룹의 숨은 멤버면 개별 show 대신 그룹 내 활성 탭으로 전환.
  if (isHiddenGroupMember(key)) {
    activateTab(key);
    broadcastWindowState();
    return;
  }
  if (win.isMinimized() || !win.isVisible()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.minimize();
  }
}

function toggleAllMainWindows(): void {
  const mains = MAIN_WINDOW_KEYS.map((k) => windows.get(k)).filter(
    (w): w is BrowserWindow => !!w && !w.isDestroyed()
  );
  const anyShown = mains.some((w) => w.isVisible() && !w.isMinimized());
  if (anyShown) {
    for (const w of mains) {
      if (w.isVisible() && !w.isMinimized()) w.hide();
    }
  } else {
    for (const key of MAIN_WINDOW_KEYS) {
      const w = windows.get(key);
      if (!w || w.isDestroyed()) continue;
      // 탭 그룹의 숨은 멤버는 활성 탭 뒤에 숨어 있어야 하므로 show 하지 않음.
      if (isHiddenGroupMember(key)) continue;
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) w.show();
      w.setAlwaysOnTop(true, 'screen-saver');
    }
  }
  broadcastWindowState();
}

ipcMain.on('windows:toggle-one', (_event, key: WindowKey) => toggleOneWindow(key));
ipcMain.on('windows:toggle-all', () => toggleAllMainWindows());

ipcMain.on('app:quit', () => {
  app.quit();
});

ipcMain.on('windows:set-opacity-of', (_event, key: WindowKey, value: number) => {
  const win = windows.get(key);
  if (!win || win.isDestroyed()) return;
  const clamped = Math.max(0.2, Math.min(1, value));
  win.setOpacity(clamped);
  saveOpacity(key, clamped);
  broadcastWindowState();
});

// Cmd/Ctrl 누름 상태를 모든 창의 ShortcutHint 에 동기화. 포커스된 창에서만
// keydown/keyup 이 들어오므로, 한 창이 메인에 알리면 메인이 전 창에 재방송한다.
let modifierHeld = false;
ipcMain.on(IPC.ModifierHoldSet, (_event, held: boolean) => {
  const next = !!held;
  if (modifierHeld === next) return;
  modifierHeld = next;
  broadcast(IPC.ModifierHoldChanged, next);
});

function revealOverlays(): void {
  for (const key of MAIN_WINDOW_KEYS) {
    const win = windows.get(key);
    if (!win || win.isDestroyed()) continue;
    if (isHiddenGroupMember(key)) continue;
    win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
  }
  broadcastWindowState();
}

function hideOverlaysAndClearPHI(): void {
  for (const key of MAIN_WINDOW_KEYS) {
    const win = windows.get(key);
    if (!win || win.isDestroyed()) continue;
    if (win.isVisible()) win.hide();
  }
  analyzer.reset();
  // 환자 정보도 PHI — 구독을 끊고 캐시된 목록까지 비운다.
  clearPatientState();
  lastWaiting = [];
  waitingSub = null;
  linkSessionToEncounter(null);
  broadcast(IPC.PatientsWaitingChanged, { items: [], error: null });
  // 선택된 환자 상세도 PHI — 각 창의 캐시를 비우도록 null 을 방송한다.
  broadcast(IPC.PatientsActiveChanged, null);
  void flushStreamSessionAudio().finally(() => {
    void endCurrentSession().finally(() => {
      clearSessionCache();
      restorePreferredProvider();
    });
  });
  broadcastWindowState();
}

function applyDockIcon(): void {
  if (process.platform !== 'darwin') return;
  const candidates = [
    join(here, '../../build/icon.icns'),
    join(here, '../../build/icon-1024.png'),
    join(process.resourcesPath ?? '', 'icon.icns')
  ];
  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      app.dock?.setIcon(img);
      return;
    }
  }
}

app.whenReady().then(() => {
  loadEnvFiles();

  // 최초 실행: 언어를 묻지 않고 기본값(한국어)을 그대로 저장하고 시작한다.
  // 이미 언어를 고른 기존 사용자는 그 선택이 그대로 유지된다.
  if (!hasStoredLanguage()) {
    applyLanguage(DEFAULT_LANGUAGE);
    markLaunched();
  }

  // 저장된 provider 가 .env 변경 등으로 더 이상 available 하지 않으면
  // preferredProviderFor 로 자동 보정.
  const savedLang = getLanguage();
  {
    const cur = getTranscribeProvider();
    const stillAvail = listProviders().find((p) => p.id === cur)?.available;
    if (!stillAvail) setTranscribeProvider(preferredProviderFor(savedLang));
  }

  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    applyDockIcon();
    app.dock?.show();
  }
  initWindowGroups({
    windows: windows as Map<WindowKey, BrowserWindow>,
    broadcast,
    onGroupsChanged: () => broadcastWindowState()
  });

  for (const spec of OVERLAYS) {
    const initiallyHidden = spec.key !== 'dock';
    const win = createOverlayWindow(spec, { initiallyHidden });
    windows.set(spec.key, win);
    attachGroupDragHandlers(win, spec.key);
    win.on('minimize', () => broadcastWindowState());
    win.on('restore', () => broadcastWindowState());
    win.on('show', () => broadcastWindowState());
    win.on('hide', () => broadcastWindowState());
    win.on('focus', () => broadcast(IPC.WindowFocusChange, spec.key));
    win.on('blur', () => {
      // 다음 윈도우가 곧 focus 잡지 않으면 null 로 클리어.
      setTimeout(() => {
        const anyFocused = [...windows.values()].some(
          (w) => !w.isDestroyed() && w.isFocused()
        );
        if (!anyFocused) broadcast(IPC.WindowFocusChange, null);
      }, 30);
    });
  }

  // 기본 레이아웃 — 사용자가 명시한 defaultLayout 이 있으면 그것을, 없으면
  // 'wide-grid' (2×3 격자 + Dock 중앙 하단) 를 적용. 격자 + dock 을 함께
  // 재배치하므로 시작 화면이 일관됨.
  const explicitDefault = store.get('defaultLayout');
  applyLayout(
    explicitDefault ?? 'wide-grid',
    windows as Map<WindowKey, BrowserWindow>
  );

  // 레이아웃 적용 뒤 저장된 탭 그룹 복원 (활성 탭 위치 기준으로 멤버 숨김).
  restoreGroups();

  setShortcutDispatch(dispatchShortcut);

  initDeviceAuth({
    broadcast,
    forceSignOut: async () => {
      await getSupabase()?.auth.signOut();
    }
  });

  initSubscription({ broadcast });

  setAuthCallbacks({
    broadcast,
    onSignedIn: () => {
      revealOverlays();
      registerAllShortcuts();
      broadcastShortcuts();
      startWaitingSubscription();
      // 로그인 직후 갱신. 여기서 실패해도 잠그지 않는다 — refreshEntitlement 가
      // 네트워크 장애와 미구독을 구분해 캐시로 버틴다.
      const user = getCurrentUser();
      setSubscriptionUser(user?.id ?? null);
      void refreshEntitlement('signin');
    },
    onSignedOut: () => {
      hideOverlaysAndClearPHI();
      unregisterAllShortcuts();
      broadcastShortcuts();
      setSubscriptionUser(null);
    }
  });

  // 앱 시작 시 갱신. setAuthCallbacks 가 저장된 세션을 복원하면 onSignedIn 이
  // 다시 한 번 호출되지만, refreshEntitlement 의 in-flight 병합이 중복을 막는다.
  {
    const user = getCurrentUser();
    if (user) {
      setSubscriptionUser(user.id);
      void refreshEntitlement('startup');
    }
  }

  app.on('activate', () => {
    if (windows.size === 0) {
      for (const spec of OVERLAYS) {
        const initiallyHidden = spec.key !== 'dock';
        windows.set(spec.key, createOverlayWindow(spec, { initiallyHidden }));
      }
    }
  });
});

app.on('before-quit', () => {
  void flushStreamSessionAudio();
  void endCurrentSession();
  unregisterAllShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
