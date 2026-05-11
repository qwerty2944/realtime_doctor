import './wsPolyfill.js';
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';

app.setName('Realtime Doctor');
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
  relabelChunk,
  saveTranscriptChunk,
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
    void saveTranscriptChunk({ ...chunk, speaker: 'unknown' });
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
  void endCurrentSession();
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
  return getTranscribeProvider();
});

ipcMain.handle(IPC.CloudSyncGet, () => getCloudSync());
ipcMain.handle(
  IPC.CloudSyncSet,
  (_event, patch: Partial<CloudSyncSettings>) => setCloudSync(patch)
);
ipcMain.handle(IPC.StreamMint, async () => mintStreamSession());

let clovaStreamSession: ClovaStreamHandle | null = null;
let clovaStreamSenderId: number | null = null;
let clovaSeqId = 0;
let clovaCurrentItemId = '';
let clovaCurrentPartial = '';

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
    broadcast(IPC.ClovaStreamFinal, { itemId, text: finalText });
    if (finalText) {
      const chunk: TranscriptChunk = {
        id: itemId,
        text: finalText,
        timestamp: Date.now()
      };
      analyzer.push({ ...chunk, speaker: 'unknown' });
      void saveTranscriptChunk({ ...chunk, speaker: 'unknown' });
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
    }
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
  clovaSeqId += 1;
  clovaStreamSession.sendAudio(buf, clovaSeqId);
});

ipcMain.on(IPC.ClovaStreamClose, () => {
  if (clovaStreamSession) {
    clovaStreamSession.stop();
    clovaStreamSession = null;
  }
  clovaStreamSenderId = null;
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
  void endCurrentSession();
  clearSessionCache();
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
  void endCurrentSession();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
