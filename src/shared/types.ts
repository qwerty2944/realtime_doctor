export const IPC = {
  TranscribeAudio: 'transcribe:audio',
  TranscriptChunk: 'transcript:chunk',
  TranscriptReset: 'transcript:reset',
  TranscriptLabel: 'transcript:label',
  TranscriptRelabel: 'transcript:relabel',
  AnalysisUpdate: 'analysis:update',
  SummaryRequest: 'summary:request',
  SummaryUpdate: 'summary:update',
  DictationRequest: 'dictation:request',
  DictationUpdate: 'dictation:update',
  ProviderList: 'provider:list',
  ProviderGet: 'provider:get',
  ProviderSet: 'provider:set',
  StreamMint: 'stream:mint',
  ClovaStreamOpen: 'clova-stream:open',
  ClovaStreamAudio: 'clova-stream:audio',
  ClovaStreamClose: 'clova-stream:close',
  ClovaStreamPartial: 'clova-stream:partial',
  ClovaStreamFinal: 'clova-stream:final',
  ClovaStreamError: 'clova-stream:error',
  WindowToggleClickThrough: 'window:toggle-click-through',
  WindowSetAlwaysOnTop: 'window:set-always-on-top',
  AuthSignUp: 'auth:signUp',
  AuthSignIn: 'auth:signIn',
  AuthSignOut: 'auth:signOut',
  AuthGetState: 'auth:getState',
  AuthStateChange: 'auth:state-change',
  CloudSyncGet: 'cloudSync:get',
  CloudSyncSet: 'cloudSync:set'
} as const;

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
