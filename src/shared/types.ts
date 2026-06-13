export const IPC = {
  TranscribeAudio: 'transcribe:audio',
  TranscriptChunk: 'transcript:chunk',
  TranscriptReset: 'transcript:reset',
  TranscriptLabel: 'transcript:label',
  TranscriptRelabel: 'transcript:relabel',
  TranscriptRemove: 'transcript:remove',
  AnalysisUpdate: 'analysis:update',
  AnalysisRequest: 'analysis:request',
  AnalysisPending: 'analysis:pending',
  SummaryRequest: 'summary:request',
  SummaryUpdate: 'summary:update',
  DictationRequest: 'dictation:request',
  DictationUpdate: 'dictation:update',
  ProviderList: 'provider:list',
  ProviderGet: 'provider:get',
  ProviderSet: 'provider:set',
  ProviderChanged: 'provider:changed',
  StreamMint: 'stream:mint',
  RealtimeSessionEnd: 'realtime:session-end',
  ClovaStreamOpen: 'clova-stream:open',
  ClovaStreamAudio: 'clova-stream:audio',
  ClovaStreamClose: 'clova-stream:close',
  ClovaStreamPartial: 'clova-stream:partial',
  ClovaStreamFinal: 'clova-stream:final',
  ClovaStreamError: 'clova-stream:error',
  ClovaStreamMarkHandled: 'clova-stream:mark-handled',
  WindowToggleClickThrough: 'window:toggle-click-through',
  WindowSetAlwaysOnTop: 'window:set-always-on-top',
  WindowFocusChange: 'window:focus-change',
  AuthSignUp: 'auth:signUp',
  AuthSignIn: 'auth:signIn',
  AuthSignOut: 'auth:signOut',
  AuthGetState: 'auth:getState',
  AuthStateChange: 'auth:state-change',
  CloudSyncGet: 'cloudSync:get',
  CloudSyncSet: 'cloudSync:set',
  SessionsListMine: 'sessions:list-mine',
  SessionsLoad: 'sessions:load',
  SessionLoaded: 'session:loaded',
  ShortcutsGet: 'shortcuts:get',
  ShortcutsSet: 'shortcuts:set',
  ShortcutsReset: 'shortcuts:reset',
  ShortcutTrigger: 'shortcut:trigger',
  ShortcutsChanged: 'shortcuts:changed',
  LanguageGet: 'language:get',
  LanguageSet: 'language:set',
  LanguageClear: 'language:clear',
  LanguageChanged: 'language:changed',
  TranscribeFallback: 'transcribe:fallback',
  ModifierHoldSet: 'modifier:hold-set',
  ModifierHoldChanged: 'modifier:hold-changed',
  WindowGroupsGet: 'window-groups:get',
  WindowGroupsState: 'window-groups:state',
  WindowGroupsActivate: 'window-groups:activate',
  WindowGroupsDetach: 'window-groups:detach',
  WindowGroupsHover: 'window-groups:hover',
  DevicesList: 'devices:list',
  DevicesRevoke: 'devices:revoke',
  DeviceRevoked: 'devices:revoked-notice',
  LocalSaveGet: 'localSave:get',
  LocalSaveSet: 'localSave:set'
} as const;

/** 오버레이 창 식별자 (main 의 WindowKey 와 동일 집합). */
export type OverlayKey =
  | 'transcript'
  | 'diagnosis'
  | 'terms'
  | 'questions'
  | 'summary'
  | 'dictation'
  | 'dock';

/** 드래그앤드랍으로 합쳐진 창 탭 그룹. tabs 순서 = 탭바 표시 순서. */
export interface WindowGroupInfo {
  id: string;
  tabs: OverlayKey[];
  active: OverlayKey;
}

export interface DeviceInfo {
  id: string;
  device_id: string;
  name: string;
  platform: string;
  app_version: string;
  status: 'active' | 'revoked';
  created_at: string;
  last_seen_at: string;
  isCurrent: boolean;
}

/** 로컬 디스크 세션 저장 설정 (클라우드 동기화와 독립). */
export interface LocalSaveSettings {
  enabled: boolean;
  saveAudio: boolean;
}

export type SessionSource = 'local' | 'cloud' | 'both';

export type Language = 'ko' | 'en';

export type ShortcutId =
  | 'toggleAll'
  | 'toggleTranscript'
  | 'toggleDiagnosis'
  | 'toggleTerms'
  | 'toggleQuestions'
  | 'toggleSummary'
  | 'toggleDictation'
  | 'recordStartStop'
  | 'runAnalyze'
  | 'runSummary'
  | 'runDictation';

export const SHORTCUT_IDS: ShortcutId[] = [
  'toggleAll',
  'toggleTranscript',
  'toggleDiagnosis',
  'toggleTerms',
  'toggleQuestions',
  'toggleSummary',
  'toggleDictation',
  'recordStartStop',
  'runAnalyze',
  'runSummary',
  'runDictation'
];

// macOS 위주 디자인: Cmd 단일 모디파이어. Win/Linux 에서는 Ctrl 로 매핑되어
// 일부 기본 단축키(Ctrl+W 닫기 등) 와 겹칠 수 있음 — 설정 UI 에서 사용자 변경 가능.
export const SHORTCUT_DEFAULTS: Record<ShortcutId, string> = {
  toggleAll: 'CommandOrControl+0',
  toggleTranscript: 'CommandOrControl+1',
  toggleDiagnosis: 'CommandOrControl+2',
  toggleTerms: 'CommandOrControl+3',
  toggleQuestions: 'CommandOrControl+4',
  toggleSummary: 'CommandOrControl+5',
  toggleDictation: 'CommandOrControl+6',
  recordStartStop: 'CommandOrControl+R',
  runAnalyze: 'CommandOrControl+A',
  runSummary: 'CommandOrControl+E',
  runDictation: 'CommandOrControl+D'
};

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  toggleAll: '전체 창 보이기/숨기기',
  toggleTranscript: '트랜스크라이브 창',
  toggleDiagnosis: '감별진단 창',
  toggleTerms: '의학용어 창',
  toggleQuestions: '다음 질문 창',
  toggleSummary: '요약 창',
  toggleDictation: '받아쓰기 창',
  recordStartStop: '녹음 시작/정지',
  runAnalyze: '감별 분석 새로 실행',
  runSummary: '요약 새로 생성',
  runDictation: '받아쓰기 새로 생성'
};

export interface SessionSummary {
  id: string;
  started_at: string;
  ended_at: string | null;
  transcribe_provider: string | null;
  chunk_count: number;
  preview: string;
  source: SessionSource;
}

export interface LoadedSessionPayload {
  session: {
    id: string;
    started_at: string;
    ended_at: string | null;
    transcribe_provider: string | null;
  };
  chunks: Array<{
    chunk_id: string;
    speaker: Speaker;
    text: string;
    timestamp_ms: number;
  }>;
}

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthState =
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AuthUser };

export interface AuthOpResult {
  ok: boolean;
  error?: string;
}

export interface CloudSyncSettings {
  enabled: boolean;
  saveTranscripts: boolean;
  saveAudio: boolean;
}

export type TranscribeProviderId =
  | 'gemini'
  | 'openai'
  | 'clova-csr'
  | 'clova-stream';
export type TranscribeMode = 'chunk' | 'stream';

export interface TranscribeProviderInfo {
  id: TranscribeProviderId;
  label: string;
  mode: TranscribeMode;
  available: boolean;
  notes?: string;
}

export interface EphemeralSession {
  client_secret: { value: string; expires_at?: number };
  model: string;
}

export type Speaker = 'doctor' | 'patient' | 'unknown';

export interface DifferentialDiagnosis {
  name: string;
  nameEn?: string;
  icd10?: string;
  confidence: number;
  reasoning: string;
}

export interface MedicalTerm {
  term: string;
  termEn?: string;
  definition: string;
  contextQuote?: string;
}

export interface SuggestedQuestion {
  question: string;
  rationale: string;
}

export interface AnalysisResult {
  differentialDiagnoses: DifferentialDiagnosis[];
  medicalTerms: MedicalTerm[];
  suggestedQuestions: SuggestedQuestion[];
  redFlags: string[];
  updatedAt: number;
}

export interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: number;
  speaker?: Speaker;
}

export interface TranscriptLabelEvent {
  id: string;
  speaker: Speaker;
}

export interface SummaryResult {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pertinentFindings: string;
  investigationsMentioned: string;
  clinicalImpression: string;
  plan: string;
  generatedAt: number;
}

export type SummaryStatus =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ready'; result: SummaryResult }
  | { state: 'error'; message: string };

export type DictationTemplate = 'soap' | 'apso' | 'hp' | 'narrative';

export interface DictationSection {
  heading: string;
  body: string;
}

export interface DictationResult {
  template: DictationTemplate;
  sections: DictationSection[];
  generatedAt: number;
}

export type DictationStatus =
  | { state: 'idle' }
  | { state: 'pending'; template: DictationTemplate }
  | { state: 'ready'; result: DictationResult }
  | { state: 'error'; message: string };
