import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AnalysisResult,
  type AuthOpResult,
  type AuthState,
  type CloudSyncSettings,
  type DictationStatus,
  type DictationTemplate,
  type EphemeralSession,
  type Speaker,
  type SummaryStatus,
  type TranscribeProviderId,
  type TranscribeProviderInfo,
  type TranscriptChunk,
  type TranscriptLabelEvent
} from '../shared/types.js';

const api = {
  transcribeAudio(payload: { id: string; base64Wav: string }): Promise<string> {
    return ipcRenderer.invoke(IPC.TranscribeAudio, payload);
  },
  pushTranscriptChunk(chunk: TranscriptChunk): void {
    ipcRenderer.send(IPC.TranscriptChunk, chunk);
  },
  relabelSpeaker(id: string, speaker: Speaker): void {
    const payload: TranscriptLabelEvent = { id, speaker };
    ipcRenderer.send(IPC.TranscriptRelabel, payload);
  },
  resetTranscript(): void {
    ipcRenderer.send(IPC.TranscriptReset);
  },
  setClickThrough(ignore: boolean): void {
    ipcRenderer.send(IPC.WindowToggleClickThrough, ignore);
  },
  setAlwaysOnTop(on: boolean): void {
    ipcRenderer.send(IPC.WindowSetAlwaysOnTop, on);
  },
  minimizeWindow(): void {
    ipcRenderer.send('window:minimize');
  },
  setOpacity(value: number): void {
    ipcRenderer.send('window:set-opacity', value);
  },
  getOpacity(): Promise<number> {
    return ipcRenderer.invoke('window:get-opacity');
  },
  listLayouts(): Promise<
    Array<{ name: string; builtin: boolean; isDefault: boolean }>
  > {
    return ipcRenderer.invoke('layout:list');
  },
  applyLayout(name: string): Promise<boolean> {
    return ipcRenderer.invoke('layout:apply', name);
  },
  saveCurrentLayout(name: string): Promise<
    Array<{ name: string; builtin: boolean; isDefault: boolean }>
  > {
    return ipcRenderer.invoke('layout:save-current', name);
  },
  deleteLayout(name: string): Promise<
    Array<{ name: string; builtin: boolean; isDefault: boolean }>
  > {
    return ipcRenderer.invoke('layout:delete', name);
  },
  setDefaultLayout(name: string | null): Promise<
    Array<{ name: string; builtin: boolean; isDefault: boolean }>
  > {
    return ipcRenderer.invoke('layout:set-default', name);
  },
  getDefaultLayout(): Promise<string> {
    return ipcRenderer.invoke('layout:get-default');
  },
  listWindowStates(): Promise<
    Array<{
      key: string;
      title: string;
      minimized: boolean;
      visible: boolean;
      opacity: number;
    }>
  > {
    return ipcRenderer.invoke('windows:list-state');
  },
  toggleWindow(key: string): void {
    ipcRenderer.send('windows:toggle-one', key);
  },
  toggleAllWindows(): void {
    ipcRenderer.send('windows:toggle-all');
  },
  setOpacityOf(key: string, value: number): void {
    ipcRenderer.send('windows:set-opacity-of', key, value);
  },
  onWindowsStateChange(
    handler: (
      payload: Array<{
        key: string;
        title: string;
        minimized: boolean;
        visible: boolean;
        opacity: number;
      }>
    ) => void
  ): () => void {
    const listener = (
      _e: unknown,
      payload: Array<{
        key: string;
        title: string;
        minimized: boolean;
        visible: boolean;
        opacity: number;
      }>
    ) => handler(payload);
    ipcRenderer.on('windows:state', listener);
    return () => ipcRenderer.removeListener('windows:state', listener);
  },
  onAnalysisUpdate(handler: (payload: AnalysisResult) => void): () => void {
    const listener = (_e: unknown, payload: AnalysisResult) => handler(payload);
    ipcRenderer.on(IPC.AnalysisUpdate, listener);
    return () => ipcRenderer.removeListener(IPC.AnalysisUpdate, listener);
  },
  requestSummary(): Promise<SummaryStatus> {
    return ipcRenderer.invoke(IPC.SummaryRequest);
  },
  onSummaryUpdate(handler: (payload: SummaryStatus) => void): () => void {
    const listener = (_e: unknown, payload: SummaryStatus) => handler(payload);
    ipcRenderer.on(IPC.SummaryUpdate, listener);
    return () => ipcRenderer.removeListener(IPC.SummaryUpdate, listener);
  },
  requestDictation(template: DictationTemplate): Promise<DictationStatus> {
    return ipcRenderer.invoke(IPC.DictationRequest, template);
  },
  onDictationUpdate(handler: (payload: DictationStatus) => void): () => void {
    const listener = (_e: unknown, payload: DictationStatus) => handler(payload);
    ipcRenderer.on(IPC.DictationUpdate, listener);
    return () => ipcRenderer.removeListener(IPC.DictationUpdate, listener);
  },
  getLastDictationTemplate(): Promise<DictationTemplate> {
    return ipcRenderer.invoke('dictation:get-last-template');
  },
  listTranscribeProviders(): Promise<TranscribeProviderInfo[]> {
    return ipcRenderer.invoke(IPC.ProviderList);
  },
  getTranscribeProvider(): Promise<TranscribeProviderId> {
    return ipcRenderer.invoke(IPC.ProviderGet);
  },
  setTranscribeProvider(id: TranscribeProviderId): Promise<TranscribeProviderId> {
    return ipcRenderer.invoke(IPC.ProviderSet, id);
  },
  onTranscribeProviderChange(
    handler: (id: TranscribeProviderId) => void
  ): () => void {
    const listener = (_e: unknown, id: TranscribeProviderId) => handler(id);
    ipcRenderer.on(IPC.ProviderChanged, listener);
    return () => ipcRenderer.removeListener(IPC.ProviderChanged, listener);
  },
  mintStreamSession(): Promise<EphemeralSession> {
    return ipcRenderer.invoke(IPC.StreamMint);
  },
  endRealtimeSession(): void {
    ipcRenderer.send(IPC.RealtimeSessionEnd);
  },
  quitApp(): void {
    ipcRenderer.send('app:quit');
  },
  openClovaStream(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(IPC.ClovaStreamOpen);
  },
  sendClovaAudio(chunk: Uint8Array): void {
    ipcRenderer.send(IPC.ClovaStreamAudio, chunk);
  },
  closeClovaStream(): void {
    ipcRenderer.send(IPC.ClovaStreamClose);
  },
  onClovaPartial(
    handler: (payload: { itemId: string; text: string }) => void
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { itemId: string; text: string }
    ) => handler(payload);
    ipcRenderer.on(IPC.ClovaStreamPartial, listener);
    return () => ipcRenderer.removeListener(IPC.ClovaStreamPartial, listener);
  },
  onClovaFinal(
    handler: (payload: { itemId: string; text: string }) => void
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { itemId: string; text: string }
    ) => handler(payload);
    ipcRenderer.on(IPC.ClovaStreamFinal, listener);
    return () => ipcRenderer.removeListener(IPC.ClovaStreamFinal, listener);
  },
  onClovaError(
    handler: (payload: { message: string }) => void
  ): () => void {
    const listener = (_e: unknown, payload: { message: string }) =>
      handler(payload);
    ipcRenderer.on(IPC.ClovaStreamError, listener);
    return () => ipcRenderer.removeListener(IPC.ClovaStreamError, listener);
  },
  onTranscriptLabel(
    handler: (payload: TranscriptLabelEvent) => void
  ): () => void {
    const listener = (_e: unknown, payload: TranscriptLabelEvent) =>
      handler(payload);
    ipcRenderer.on(IPC.TranscriptLabel, listener);
    return () => ipcRenderer.removeListener(IPC.TranscriptLabel, listener);
  },
  auth: {
    getState(): Promise<AuthState> {
      return ipcRenderer.invoke(IPC.AuthGetState);
    },
    signUp(email: string, password: string): Promise<AuthOpResult> {
      return ipcRenderer.invoke(IPC.AuthSignUp, { email, password });
    },
    signIn(email: string, password: string): Promise<AuthOpResult> {
      return ipcRenderer.invoke(IPC.AuthSignIn, { email, password });
    },
    signOut(): Promise<AuthOpResult> {
      return ipcRenderer.invoke(IPC.AuthSignOut);
    },
    onStateChange(handler: (state: AuthState) => void): () => void {
      const listener = (_e: unknown, payload: AuthState) => handler(payload);
      ipcRenderer.on(IPC.AuthStateChange, listener);
      return () => ipcRenderer.removeListener(IPC.AuthStateChange, listener);
    }
  },
  cloudSync: {
    get(): Promise<CloudSyncSettings> {
      return ipcRenderer.invoke(IPC.CloudSyncGet);
    },
    set(patch: Partial<CloudSyncSettings>): Promise<CloudSyncSettings> {
      return ipcRenderer.invoke(IPC.CloudSyncSet, patch);
    }
  }
};

export type RealtimeDoctorApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
