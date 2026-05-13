export const IPC = {
  TranscribeAudio: 'transcribe:audio',
  TranscriptChunk: 'transcript:chunk',
  TranscriptReset: 'transcript:reset',
  TranscriptLabel: 'transcript:label',
  TranscriptRelabel: 'transcript:relabel',
  AnalysisUpdate: 'analysis:update',
  AnalysisRequest: 'analysis:request',
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
  ShortcutTrigger: 'shortcut:trigger'
} as const;

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

export const SHORTCUT_DEFAULTS: Record<ShortcutId, string> = {
  toggleAll: 'CommandOrControl+Shift+H',
  toggleTranscript: 'CommandOrControl+Shift+1',
  toggleDiagnosis: 'CommandOrControl+Shift+2',
  toggleTerms: 'CommandOrControl+Shift+3',
  toggleQuestions: 'CommandOrControl+Shift+4',
  toggleSummary: 'CommandOrControl+Shift+5',
  toggleDictation: 'CommandOrControl+Shift+6',
  recordStartStop: 'CommandOrControl+Shift+R',
  runAnalyze: 'CommandOrControl+Shift+A',
  runSummary: 'CommandOrControl+Shift+E',
  runDictation: 'CommandOrControl+Shift+W'
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
