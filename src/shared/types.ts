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
  /** 플랜 기기 수를 초과해 등록이 거부됐다. 어느 기기를 내릴지 물어야 한다 (S5). */
  DeviceLimitExceeded: 'devices:limit-exceeded',
  /** 고른 기기를 내리고 이 기기를 다시 등록한다 (S5). */
  DevicesReleaseAndRegister: 'devices:release-and-register',
  LocalSaveGet: 'localSave:get',
  LocalSaveSet: 'localSave:set',
  PatientsListWaiting: 'patients:list-waiting',
  PatientsLoadDetail: 'patients:load-detail',
  PatientsSelect: 'patients:select',
  PatientsWaitingChanged: 'patients:waiting-changed',
  /** 나중에 뜬 창이 현재 선택 상태를 스스로 채우기 위한 getter. */
  PatientsGetActive: 'patients:get-active',
  /** 선택된 환자(또는 해제)를 모든 창에 알리는 broadcast. */
  PatientsActiveChanged: 'patients:active-changed',
  /** 진단명 하나의 문헌근거 조회 요청 (invoke). */
  EvidenceRequest: 'evidence:request',
  /** 조회 결과 도착 broadcast — 같은 진단을 띄운 다른 창도 함께 갱신된다. */
  EvidenceUpdated: 'evidence:updated',
  /**
   * 참고문헌을 외부 브라우저로 연다. 범용 URL opener 가 아니라 main 에서
   * pubmed.ncbi.nlm.nih.gov 인지 검증한 뒤에만 shell.openExternal 한다.
   */
  EvidenceOpen: 'evidence:open',
  /** 현재 구독 상태 getter. 캐시된 서명 토큰을 매번 재검증한 결과다. */
  SubscriptionGet: 'subscription:get',
  /** 서버에 다시 물어본다 (사용자가 결제 후 돌아왔을 때 등). */
  SubscriptionRefresh: 'subscription:refresh',
  /** 상태 변화 broadcast. */
  SubscriptionChanged: 'subscription:changed',
  /** 잠긴 상태에서 기능 호출이 차단됐음을 알리는 broadcast. */
  SubscriptionBlocked: 'subscription:blocked',
  /** 결제 페이지를 외부 브라우저로 연다 (admin-web, S3). */
  SubscriptionOpenBilling: 'subscription:open-billing',
  /** 나중에 뜬 창이 현재 글씨 배율을 스스로 채우기 위한 getter. */
  FontScaleGet: 'font-scale:get',
  /** 글씨 배율 변경을 모든 창에 알리는 broadcast. */
  FontScaleChanged: 'font-scale:changed'
} as const;

/**
 * 전역 글씨 배율.
 *
 * 오버레이는 작은 창이라 배율이 무한정 커지면 레이아웃이 깨진다. 0.8~1.6 로
 * 묶고 0.1 단위 고정 스텝으로만 움직인다. webContents.setZoomFactor 는 프레임
 * 없는 투명 창의 opacity 합성과 충돌해서 쓰지 않고, CSS 변수(--font-scale)로
 * 루트 font-size 만 바꾼다.
 */
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.6;
export const FONT_SCALE_STEP = 0.1;
export const FONT_SCALE_DEFAULT = 1;

/** 범위 클램프 + 부동소수 오차 제거(0.1 스텝이라 소수 2자리면 충분). */
export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/** 오버레이 창 식별자 (main 의 WindowKey 와 동일 집합). */
export type OverlayKey =
  | 'transcript'
  | 'diagnosis'
  | 'terms'
  | 'questions'
  | 'summary'
  | 'dictation'
  | 'patients'
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

/** 진료 상태. DB `encounters.status` CHECK 제약과 동일 집합. */
export type EncounterStatus =
  | 'intake_in_progress'
  | 'intake_done'
  | 'in_consult'
  | 'completed';

/** 대기목록에 올라가는 상태 — 문진 완료 후 진료가 아직 안 끝난 것. */
export const WAITING_STATUSES: EncounterStatus[] = ['intake_done', 'in_consult'];

export interface Patient {
  id: string;
  name: string;
  birthDate: string | null;
  registrationNo: string | null;
  phone: string | null;
  createdAt: string;
}

export interface Encounter {
  id: string;
  patientId: string;
  status: EncounterStatus;
  redFlag: boolean;
  redFlagReason: string | null;
  chiefComplaint: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** 키오스크 문진이 만들어 둔 AI 초안. JSON 필드는 스키마가 키오스크 소유라 unknown. */
export interface IntakeResult {
  id: string;
  encounterId: string;
  soap: Record<string, unknown>;
  differentials: unknown[];
  recommendedTests: unknown[];
  version: number;
  createdAt: string;
}

/** 대기목록 한 줄 — encounters + patients + 최신 intake_results 조인 결과. */
export interface WaitingEncounter {
  encounterId: string;
  patientId: string;
  status: EncounterStatus;
  redFlag: boolean;
  redFlagReason: string | null;
  patientName: string;
  registrationNo: string | null;
  chiefComplaint: string | null;
  createdAt: string;
  /** 문진 결과가 생성된 시각. 결과 row 가 없으면 null. */
  completedAt: string | null;
}

/**
 * 대기목록 broadcast 페이로드. Realtime 채널이 끊기면 items 는 마지막으로
 * 성공한 목록 그대로 두고 error 만 채워 보낸다 (UI 는 배너 + 수동 새로고침).
 */
export interface WaitingListUpdate {
  items: WaitingEncounter[];
  error: string | null;
}

export interface PatientDetail {
  patient: Patient;
  encounter: Encounter;
  intakeResult: IntakeResult | null;
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
