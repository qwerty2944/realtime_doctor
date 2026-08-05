import { contextBridge, ipcRenderer } from 'electron';
import type {
  CareActivityBackfillResult,
  CareActivityDefinitionView,
  CareActivityDisplayPayload,
  MonthlyCareActivityReport
} from '../shared/careActivities.js';
import {
  IPC,
  type AnalysisResult,
  type AuthOpResult,
  type AuthState,
  type CloudSyncSettings,
  type DeviceInfo,
  type DeviceLimitNotice,
  type DictationStatus,
  type DictationTemplate,
  type EphemeralSession,
  type EvidenceStatus,
  type EvidenceUpdate,
  type IssueVisitCodeResult,
  type VisitCodeSettings,
  type Language,
  type LoadedSessionPayload,
  type LocalSaveSettings,
  type OverlayKey,
  type PatientDetail,
  type SessionSummary,
  type ShortcutId,
  type Speaker,
  type SubscriptionBlockedNotice,
  type SubscriptionState,
  type SummaryStatus,
  type TranscribeProviderId,
  type TranscribeProviderInfo,
  type TranscriptChunk,
  type TranscriptLabelEvent,
  type WaitingEncounter,
  type WaitingListUpdate,
  type WindowGroupInfo
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
  removeUtterance(id: string): void {
    ipcRenderer.send(IPC.TranscriptRemove, id);
  },
  resetTranscript(): void {
    ipcRenderer.send(IPC.TranscriptReset);
  },
  /** 감별진단 근거 클릭 — main 이 전사 창을 꺼낸 뒤 전 창에 알린다 (E1). */
  focusUtterance(utteranceId: string): void {
    ipcRenderer.send(IPC.TranscriptFocusUtterance, utteranceId);
  },
  /** 전사 창이 강조·스크롤할 발화 id 를 받는다 (E1). */
  onFocusUtterance(handler: (utteranceId: string) => void): () => void {
    const listener = (_e: unknown, utteranceId: string) => handler(utteranceId);
    ipcRenderer.on(IPC.TranscriptFocusUtterance, listener);
    return () => ipcRenderer.removeListener(IPC.TranscriptFocusUtterance, listener);
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
  /** size 를 주면 그 크기 이상으로 창을 넓힌다 (없으면 팝오버 기본치). */
  popoverEnter(size?: { width: number; height: number }): void {
    ipcRenderer.send('window:popover-enter', size);
  },
  popoverLeave(): void {
    ipcRenderer.send('window:popover-leave');
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
  onWindowFocusChange(handler: (key: string | null) => void): () => void {
    const listener = (_e: unknown, key: string | null) => handler(key);
    ipcRenderer.on(IPC.WindowFocusChange, listener);
    return () => ipcRenderer.removeListener(IPC.WindowFocusChange, listener);
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
  onAnalysisPending(handler: (pending: boolean) => void): () => void {
    const listener = (_e: unknown, pending: boolean) => handler(pending);
    ipcRenderer.on(IPC.AnalysisPending, listener);
    return () => ipcRenderer.removeListener(IPC.AnalysisPending, listener);
  },
  requestAnalysis(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(IPC.AnalysisRequest);
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
  markClovaItemHandled(itemId: string): void {
    ipcRenderer.send(IPC.ClovaStreamMarkHandled, itemId);
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
  },
  listMySessions(): Promise<SessionSummary[]> {
    return ipcRenderer.invoke(IPC.SessionsListMine);
  },
  loadSession(sessionId: string): Promise<LoadedSessionPayload | null> {
    return ipcRenderer.invoke(IPC.SessionsLoad, sessionId);
  },
  onSessionLoaded(
    handler: (payload: LoadedSessionPayload) => void
  ): () => void {
    const listener = (_e: unknown, payload: LoadedSessionPayload) =>
      handler(payload);
    ipcRenderer.on(IPC.SessionLoaded, listener);
    return () => ipcRenderer.removeListener(IPC.SessionLoaded, listener);
  },
  shortcuts: {
    get(): Promise<Record<ShortcutId, string>> {
      return ipcRenderer.invoke(IPC.ShortcutsGet);
    },
    set(
      id: ShortcutId,
      accel: string
    ): Promise<{ ok: boolean; shortcuts: Record<ShortcutId, string> }> {
      return ipcRenderer.invoke(IPC.ShortcutsSet, id, accel);
    },
    reset(): Promise<{ ok: boolean; shortcuts: Record<ShortcutId, string> }> {
      return ipcRenderer.invoke(IPC.ShortcutsReset);
    },
    onChange(
      handler: (map: Record<ShortcutId, string>) => void
    ): () => void {
      const listener = (_e: unknown, payload: Record<ShortcutId, string>) =>
        handler(payload);
      ipcRenderer.on(IPC.ShortcutsChanged, listener);
      return () => ipcRenderer.removeListener(IPC.ShortcutsChanged, listener);
    },
    onTrigger(handler: (id: ShortcutId) => void): () => void {
      const listener = (_e: unknown, payload: { id: ShortcutId }) =>
        handler(payload.id);
      ipcRenderer.on(IPC.ShortcutTrigger, listener);
      return () => ipcRenderer.removeListener(IPC.ShortcutTrigger, listener);
    }
  },
  language: {
    get(): Promise<Language | null> {
      return ipcRenderer.invoke(IPC.LanguageGet);
    },
    set(
      lang: Language
    ): Promise<{ ok: boolean; language: Language; provider: TranscribeProviderId }> {
      return ipcRenderer.invoke(IPC.LanguageSet, lang);
    },
    clear(): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke(IPC.LanguageClear);
    },
    onChange(handler: (lang: Language | null) => void): () => void {
      const listener = (_e: unknown, lang: Language | null) => handler(lang);
      ipcRenderer.on(IPC.LanguageChanged, listener);
      return () => ipcRenderer.removeListener(IPC.LanguageChanged, listener);
    }
  },
  onTranscribeFallback(
    handler: (evt: { reason: string; from: string; to: string }) => void
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { reason: string; from: string; to: string }
    ) => handler(payload);
    ipcRenderer.on(IPC.TranscribeFallback, listener);
    return () => ipcRenderer.removeListener(IPC.TranscribeFallback, listener);
  },
  modifier: {
    setHeld(held: boolean): void {
      ipcRenderer.send(IPC.ModifierHoldSet, held);
    },
    onChange(handler: (held: boolean) => void): () => void {
      const listener = (_e: unknown, held: boolean) => handler(held);
      ipcRenderer.on(IPC.ModifierHoldChanged, listener);
      return () => ipcRenderer.removeListener(IPC.ModifierHoldChanged, listener);
    }
  },
  getWindowKey(): Promise<OverlayKey | null> {
    return ipcRenderer.invoke('window:get-key');
  },
  windowGroups: {
    get(): Promise<WindowGroupInfo[]> {
      return ipcRenderer.invoke(IPC.WindowGroupsGet);
    },
    activate(key: OverlayKey): void {
      ipcRenderer.send(IPC.WindowGroupsActivate, key);
    },
    detach(key: OverlayKey): void {
      ipcRenderer.send(IPC.WindowGroupsDetach, key);
    },
    onChange(handler: (groups: WindowGroupInfo[]) => void): () => void {
      const listener = (_e: unknown, payload: WindowGroupInfo[]) =>
        handler(payload);
      ipcRenderer.on(IPC.WindowGroupsState, listener);
      return () => ipcRenderer.removeListener(IPC.WindowGroupsState, listener);
    },
    onHover(handler: (target: OverlayKey | null) => void): () => void {
      const listener = (_e: unknown, target: OverlayKey | null) =>
        handler(target);
      ipcRenderer.on(IPC.WindowGroupsHover, listener);
      return () => ipcRenderer.removeListener(IPC.WindowGroupsHover, listener);
    }
  },
  devices: {
    list(): Promise<DeviceInfo[]> {
      return ipcRenderer.invoke(IPC.DevicesList);
    },
    revoke(rowId: string): Promise<AuthOpResult> {
      return ipcRenderer.invoke(IPC.DevicesRevoke, rowId);
    },
    onRevokedNotice(handler: (payload: { message: string }) => void): () => void {
      const listener = (_e: unknown, payload: { message: string }) =>
        handler(payload);
      ipcRenderer.on(IPC.DeviceRevoked, listener);
      return () => ipcRenderer.removeListener(IPC.DeviceRevoked, listener);
    },
    /** 한도 초과로 고른 기기를 내리고 이 기기를 다시 등록한다 (S5). */
    releaseAndRegister(
      rowId: string
    ): Promise<{ ok: boolean; error?: string; devices?: DeviceInfo[] }> {
      return ipcRenderer.invoke(IPC.DevicesReleaseAndRegister, rowId);
    },
    onLimitExceeded(handler: (payload: DeviceLimitNotice) => void): () => void {
      const listener = (_e: unknown, payload: DeviceLimitNotice) => handler(payload);
      ipcRenderer.on(IPC.DeviceLimitExceeded, listener);
      return () => ipcRenderer.removeListener(IPC.DeviceLimitExceeded, listener);
    }
  },
  patients: {
    listWaiting(): Promise<WaitingEncounter[]> {
      return ipcRenderer.invoke(IPC.PatientsListWaiting);
    },
    loadDetail(encounterId: string): Promise<PatientDetail | null> {
      return ipcRenderer.invoke(IPC.PatientsLoadDetail, encounterId);
    },
    select(encounterId: string | null): Promise<PatientDetail | null> {
      return ipcRenderer.invoke(IPC.PatientsSelect, encounterId);
    },
    onWaitingChange(handler: (payload: WaitingListUpdate) => void): () => void {
      const listener = (_e: unknown, payload: WaitingListUpdate) => handler(payload);
      ipcRenderer.on(IPC.PatientsWaitingChanged, listener);
      return () => ipcRenderer.removeListener(IPC.PatientsWaitingChanged, listener);
    },
    /** 나중에 뜬 창이 현재 선택 상태를 스스로 채울 때 사용. */
    getActive(): Promise<PatientDetail | null> {
      return ipcRenderer.invoke(IPC.PatientsGetActive);
    },
    onActiveChange(handler: (detail: PatientDetail | null) => void): () => void {
      const listener = (_e: unknown, detail: PatientDetail | null) => handler(detail);
      ipcRenderer.on(IPC.PatientsActiveChanged, listener);
      return () => ipcRenderer.removeListener(IPC.PatientsActiveChanged, listener);
    }
  },
  evidence: {
    /** 진단명 하나의 PubMed 근거. 캐시 히트면 즉시, 아니면 조회 후 반환. */
    request(diagnosis: string, diagnosisEn?: string | null): Promise<EvidenceStatus> {
      return ipcRenderer.invoke(IPC.EvidenceRequest, { diagnosis, diagnosisEn });
    },
    onUpdate(handler: (payload: EvidenceUpdate) => void): () => void {
      const listener = (_e: unknown, payload: EvidenceUpdate) => handler(payload);
      ipcRenderer.on(IPC.EvidenceUpdated, listener);
      return () => ipcRenderer.removeListener(IPC.EvidenceUpdated, listener);
    },
    /** 외부 브라우저로 열기. PubMed 주소가 아니면 main 이 거절하고 false. */
    open(url: string): Promise<boolean> {
      return ipcRenderer.invoke(IPC.EvidenceOpen, url);
    }
  },
  subscription: {
    /** 현재 상태. main 이 캐시된 서명 토큰을 재검증한 결과를 돌려준다. */
    get(): Promise<SubscriptionState> {
      return ipcRenderer.invoke(IPC.SubscriptionGet);
    },
    /** 서버에 다시 물어본다 (결제 후 돌아왔을 때 등). */
    refresh(): Promise<SubscriptionState> {
      return ipcRenderer.invoke(IPC.SubscriptionRefresh);
    },
    /** 결제 페이지를 외부 브라우저로 연다. 주소 검증은 main 이 한다. */
    openBilling(): Promise<boolean> {
      return ipcRenderer.invoke(IPC.SubscriptionOpenBilling);
    },
    onChange(handler: (state: SubscriptionState) => void): () => void {
      const listener = (_e: unknown, state: SubscriptionState) => handler(state);
      ipcRenderer.on(IPC.SubscriptionChanged, listener);
      return () => ipcRenderer.removeListener(IPC.SubscriptionChanged, listener);
    },
    /** 잠긴 상태에서 기능 호출이 차단됐을 때. */
    onBlocked(handler: (notice: SubscriptionBlockedNotice) => void): () => void {
      const listener = (_e: unknown, notice: SubscriptionBlockedNotice) =>
        handler(notice);
      ipcRenderer.on(IPC.SubscriptionBlocked, listener);
      return () => ipcRenderer.removeListener(IPC.SubscriptionBlocked, listener);
    }
  },
  fontScale: {
    /** 창이 뜬 직후 현재 배율을 채우기 위한 getter. */
    get(): Promise<number> {
      return ipcRenderer.invoke(IPC.FontScaleGet);
    },
    onChange(handler: (scale: number) => void): () => void {
      const listener = (_e: unknown, scale: number) => handler(scale);
      ipcRenderer.on(IPC.FontScaleChanged, listener);
      return () => ipcRenderer.removeListener(IPC.FontScaleChanged, listener);
    }
  },
  careActivities: {
    /**
     * 이번 진료에서 기록된 행위 (B3).
     *
     * 화면에 올릴 수 있는 항목만 온다 — 임상 검토를 마친 정의에서 나왔고
     * 원문 대조를 통과한 것들이다. 비어 있으면 그 이유가 함께 온다.
     */
    scan(): Promise<CareActivityDisplayPayload> {
      return ipcRenderer.invoke(IPC.CareActivitiesScan);
    },
    /** 월 단위 집계 (B4). month 는 'YYYY-MM'. */
    report(month: string): Promise<MonthlyCareActivityReport> {
      return ipcRenderer.invoke(IPC.CareActivitiesReport, month);
    },
    /**
     * 검토 화면용 정의 목록 (B5).
     *
     * 규칙 전문이 담겨 온다. `def.reviewStatus` 는 **이 계정 기준**이며,
     * 다른 계정의 검토 여부는 여기 담기지도 않고 영향도 주지 않는다.
     */
    definitions(): Promise<CareActivityDefinitionView[]> {
      return ipcRenderer.invoke(IPC.CareActivitiesDefs);
    },
    /** 검토 표시·철회 (B5). 이 계정에만 적용된다. */
    setReview(input: {
      activityCode: string;
      ruleVersion: number;
      reviewed: boolean;
      note?: string | null;
    }): Promise<{ ok: true } | { ok: false; error: string }> {
      return ipcRenderer.invoke(IPC.CareActivitiesSetReview, input);
    },
    /** 지난 진료 재스캔 (B5). 저장만 하고 아무 창도 띄우지 않는다. */
    backfill(months: number): Promise<CareActivityBackfillResult> {
      return ipcRenderer.invoke(IPC.CareActivitiesBackfill, months);
    }
  },
  visitCode: {
    /**
     * 방문 코드 한 개 발급 (L1).
     *
     * 평문 코드는 **이 응답에만** 존재한다. 저장하지 않으므로 다시 보려면
     * 새로 발급해야 한다. 화면도 이 값을 오래 들고 있지 않는다.
     */
    issue(): Promise<IssueVisitCodeResult> {
      return ipcRenderer.invoke(IPC.VisitCodeIssue);
    },
    /** 키오스크 주소·슬러그. 주소는 설정값이고 코드에 도메인을 박지 않는다. */
    getSettings(): Promise<VisitCodeSettings> {
      return ipcRenderer.invoke(IPC.VisitCodeSettingsGet);
    },
    setSettings(patch: Partial<VisitCodeSettings>): Promise<VisitCodeSettings> {
      return ipcRenderer.invoke(IPC.VisitCodeSettingsSet, patch);
    }
  },
  localSave: {
    get(): Promise<LocalSaveSettings> {
      return ipcRenderer.invoke(IPC.LocalSaveGet);
    },
    set(patch: Partial<LocalSaveSettings>): Promise<LocalSaveSettings> {
      return ipcRenderer.invoke(IPC.LocalSaveSet, patch);
    }
  }
};

export type RealtimeDoctorApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
