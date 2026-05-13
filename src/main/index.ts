import './wsPolyfill.js';
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';

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
  IPC,
  type AnalysisResult,
  type CloudSyncSettings,
  type Speaker,
  type TranscriptChunk,
  type TranscriptLabelEvent
} from '../shared/types.js';
import { analyzer } from './analyzer.js';
import { setAuthCallbacks } from './auth.js';
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
import {
  appendDictation,
  appendSummary,
  clearSessionCache,
  endCurrentSession,
  getCurrentSessionId,
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
  getCloudSync,
  getLastDictationTemplate,
  getTranscribeProvider,
  saveOpacity,
  setCloudSync,
  setLastDictationTemplate,
  setTranscribeProvider,
  store,
  type WindowKey
} from './store.js';
import { summarizeConversation } from './summarizer.js';
import { MAIN_WINDOW_KEYS, OVERLAYS, createOverlayWindow } from './windows.js';
import type {
  DictationTemplate,
  TranscribeProviderId
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
  void upsertAnalysis(result);
});

ipcMain.handle(
  IPC.TranscribeAudio,
  async (_event, payload: { id: string; base64Wav: string }) => {
    if (!payload?.base64Wav) return '';
    const text = await transcribeAudio(payload.base64Wav);
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

ipcMain.on(IPC.TranscriptReset, () => {
  analyzer.reset();
  void flushStreamSessionAudio().finally(() => {
    void endCurrentSession();
  });
});

ipcMain.handle(IPC.DictationRequest, async (_event, template: DictationTemplate) => {
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
});

ipcMain.handle('dictation:get-last-template', () => getLastDictationTemplate());

ipcMain.handle(IPC.AnalysisRequest, () => {
  analyzer.runNow();
  return { ok: true };
});

ipcMain.handle(IPC.SummaryRequest, async () => {
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

ipcMain.handle('layout:list', () => listLayouts());

ipcMain.handle('layout:apply', (_event, name: string) => {
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
  const result = await mintStreamSession();
  openaiSessionStartedAt = Date.now();
  return result;
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
  if (clovaStreamSession) {
    clovaStreamSession.stop();
    clovaStreamSession = null;
  }
  const handle = await openClovaStream();
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

ipcMain.on('windows:toggle-one', (_event, key: WindowKey) => {
  const win = windows.get(key);
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized() || !win.isVisible()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.minimize();
  }
});

ipcMain.on('windows:toggle-all', () => {
  const mains = MAIN_WINDOW_KEYS.map((k) => windows.get(k)).filter(
    (w): w is BrowserWindow => !!w && !w.isDestroyed()
  );
  const anyShown = mains.some((w) => w.isVisible() && !w.isMinimized());
  // Use hide()/show() instead of minimize()/restore() so all windows toggle
  // instantly together, without per-window macOS minimize animations.
  if (anyShown) {
    for (const w of mains) {
      if (w.isVisible() && !w.isMinimized()) w.hide();
    }
  } else {
    for (const w of mains) {
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) w.show();
      w.setAlwaysOnTop(true, 'screen-saver');
    }
  }
  broadcastWindowState();
});

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

function revealOverlays(): void {
  for (const key of MAIN_WINDOW_KEYS) {
    const win = windows.get(key);
    if (!win || win.isDestroyed()) continue;
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
  void flushStreamSessionAudio().finally(() => {
    void endCurrentSession().finally(() => {
      clearSessionCache();
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
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    applyDockIcon();
    app.dock?.show();
  }
  for (const spec of OVERLAYS) {
    const initiallyHidden = spec.key !== 'dock';
    const win = createOverlayWindow(spec, { initiallyHidden });
    windows.set(spec.key, win);
    win.on('minimize', () => broadcastWindowState());
    win.on('restore', () => broadcastWindowState());
    win.on('show', () => broadcastWindowState());
    win.on('hide', () => broadcastWindowState());
  }

  // Only auto-apply a layout if the user has explicitly set one; otherwise
  // rely on per-window saved bounds so dragged positions persist.
  const explicitDefault = store.get('defaultLayout');
  if (explicitDefault) {
    applyLayout(explicitDefault, windows as Map<WindowKey, BrowserWindow>);
  }

  setAuthCallbacks({
    broadcast,
    onSignedIn: revealOverlays,
    onSignedOut: hideOverlaysAndClearPHI
  });

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
