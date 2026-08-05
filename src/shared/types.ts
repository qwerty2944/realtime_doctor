export const IPC = {
  TranscribeAudio: 'transcribe:audio',
  TranscriptChunk: 'transcript:chunk',
  TranscriptReset: 'transcript:reset',
  TranscriptLabel: 'transcript:label',
  TranscriptRelabel: 'transcript:relabel',
  TranscriptRemove: 'transcript:remove',
  /**
   * 감별진단 근거를 눌렀다 (E1). main 이 전사 창을 앞으로 꺼낸 뒤 같은 이름으로
   * 전 창에 broadcast 하고, 전사 창이 해당 발화를 강조·스크롤한다.
   */
  TranscriptFocusUtterance: 'transcript:focus-utterance',
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
  /**
   * 이번 진료에서 기록된 행위 조회 (B3, invoke).
   *
   * 응답에는 `releaseForDisplay()` 를 통과한 항목만 담긴다 — 임상 검토 전
   * 정의는 여기까지 오지 못한다. 비어 있을 때는 왜 비었는지가 함께 온다.
   */
  CareActivitiesScan: 'care-activities:scan',
  /** 월 단위 행위 기록 집계 (B4, invoke). 금액은 담기지 않는다. */
  CareActivitiesReport: 'care-activities:report',
  /**
   * 검토 화면용 정의 목록 (B5, invoke).
   *
   * 규칙 전문(단서어·부정어·화자 조건·문턱 세 개)이 그대로 담긴다 — 검토자는
   * 임상 책임을 지는 사람이라 무엇을 승인하는지 전부 봐야 한다.
   */
  CareActivitiesDefs: 'care-activities:defs',
  /** 검토 표시·철회 (B5, invoke). 이 계정에만 적용된다. */
  CareActivitiesSetReview: 'care-activities:set-review',
  /** 지난 진료 재스캔 (B5, invoke). 저장만 하고 화면을 띄우지 않는다. */
  CareActivitiesBackfill: 'care-activities:backfill',
  /**
   * 방문 코드 발급 (L1, invoke).
   *
   * 접수처가 환자 한 명의 이번 방문에 대해 발급하는 단기 코드다. 평문 코드는
   * 이 응답에만 존재하고 어디에도 저장되지 않는다 — 다시 보려면 새로 발급한다.
   */
  VisitCodeIssue: 'visit-code:issue',
  /** 키오스크 주소·슬러그 설정 조회/저장 (L1, invoke). */
  VisitCodeSettingsGet: 'visit-code:settings-get',
  VisitCodeSettingsSet: 'visit-code:settings-set',
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

/**
 * 플랜 기기 수 초과 안내 (S5).
 *
 * 서버(`device` Edge Function)가 등록을 거부하면서 함께 돌려준 목록이다.
 * 앱은 이 목록에서 하나를 골라 내리고 다시 등록을 시도한다 -- **자동으로
 * 밀어내지 않는다.** 진료실 데스크톱이 조용히 끊기면 다음 날 아침 진료 직전에
 * 알게 된다.
 */
export interface DeviceLimitNotice {
  limit: number;
  devices: DeviceInfo[];
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
  | 'togglePatients'
  | 'recordStartStop'
  | 'runAnalyze'
  | 'runSummary'
  | 'runDictation'
  | 'fontIncrease'
  | 'fontDecrease'
  | 'fontReset'
  | 'windowWiden'
  | 'windowNarrow'
  | 'windowTaller'
  | 'windowShorter';

export const SHORTCUT_IDS: ShortcutId[] = [
  'toggleAll',
  'toggleTranscript',
  'toggleDiagnosis',
  'toggleTerms',
  'toggleQuestions',
  'toggleSummary',
  'toggleDictation',
  'togglePatients',
  'recordStartStop',
  'runAnalyze',
  'runSummary',
  'runDictation',
  'fontIncrease',
  'fontDecrease',
  'fontReset',
  'windowWiden',
  'windowNarrow',
  'windowTaller',
  'windowShorter'
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
  togglePatients: 'CommandOrControl+7',
  recordStartStop: 'CommandOrControl+R',
  runAnalyze: 'CommandOrControl+A',
  runSummary: 'CommandOrControl+E',
  runDictation: 'CommandOrControl+D',
  // Cmd+0 은 toggleAll 이 이미 쓰므로 리셋은 Cmd+Shift+0.
  // Electron 의 accelerator 는 구두점을 글자 그대로 받는다. 'Equal'/'Minus' 는
  // 유효한 키 이름이 아니라서 globalShortcut.register 가 통째로 던지고, 글씨
  // 크기 단축키가 조용히 하나도 등록되지 않는다.
  fontIncrease: 'CommandOrControl+=',
  fontDecrease: 'CommandOrControl+-',
  fontReset: 'CommandOrControl+Shift+0',
  // 창 크기는 Cmd 조합이 이미 0~7/R/A/E/D/=/-/Shift+0 으로 포화라 Ctrl+Alt 대역 사용.
  windowWiden: 'Control+Alt+Right',
  windowNarrow: 'Control+Alt+Left',
  windowTaller: 'Control+Alt+Down',
  windowShorter: 'Control+Alt+Up'
};

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  toggleAll: '전체 창 보이기/숨기기',
  toggleTranscript: '트랜스크라이브 창',
  toggleDiagnosis: '감별진단 창',
  toggleTerms: '의학용어 창',
  toggleQuestions: '다음 질문 창',
  toggleSummary: '요약 창',
  toggleDictation: '받아쓰기 창',
  togglePatients: '대기목록 창',
  recordStartStop: '녹음 시작/정지',
  runAnalyze: '감별 분석 새로 실행',
  runSummary: '요약 새로 생성',
  runDictation: '받아쓰기 새로 생성',
  fontIncrease: '글씨 크게',
  fontDecrease: '글씨 작게',
  fontReset: '글씨 크기 초기화',
  windowWiden: '창 너비 늘리기',
  windowNarrow: '창 너비 줄이기',
  windowTaller: '창 높이 늘리기',
  windowShorter: '창 높이 줄이기'
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

/**
 * 이 환자에게서 실제로 관찰된 근거 한 줄 (E1).
 *
 * **검증을 통과한 것만 이 타입이 된다.** `utteranceId` 와 `quote` 는 모델이
 * 아니라 검증기(`src/shared/findings.ts`)가 원문에서 직접 꺼내 채운다. 모델이
 * 댄 참조가 실재하지 않으면 애초에 이 타입의 값이 만들어지지 않는다 — 화면에
 * 미검증 근거가 뜰 수 없다는 것을 타입으로 보장한다.
 *
 * 문헌근거(`EvidenceReference`, M4)와는 다른 축이다. 이쪽은 "이 환자가 뭐라고
 * 했는가", 저쪽은 "이 진단을 일반적으로 어떻게 판단하는가"다.
 */
export interface SupportingFinding {
  /** 모델이 요약한 관찰. 예: "3일 전부터 우안 통증". */
  finding: string;
  /** 모델이 쓴 원본 참조 문자열. 감사 목적으로 그대로 보관한다. */
  source: string;
  /** 검증기가 해석한 발화 id. 전사 창이 이 id 로 해당 발화를 찾는다. */
  utteranceId: string;
  /** 검증기가 원문에서 그대로 가져온 발화 텍스트. 모델이 쓴 문장이 아니다. */
  quote: string;
}

/** 근거를 하나도 검증하지 못한 이유. */
export type UnverifiedReason =
  /** 모델이 근거를 아예 대지 않았다 (구버전 문진 기록 포함). */
  | 'no-findings'
  /** 근거를 댔지만 가리킨 발화가 원문에 없었다. */
  | 'unresolved-source';

/**
 * 검증 가능한 근거가 하나도 남지 않은 감별진단 (E1).
 *
 * 조용히 버리지 않는다 — 내려간 감별진단은 그 자체로 임상 정보다.
 * 감별진단 창의 "근거 미확인" 섹션에 흐리게 따로 표시한다.
 */
export interface UnverifiedDifferential {
  diagnosis: DifferentialDiagnosis;
  reason: UnverifiedReason;
  /** 모델이 댔지만 원문에서 찾지 못한 참조 문자열들. */
  rejectedSources: string[];
}

export interface DifferentialDiagnosis {
  name: string;
  nameEn?: string;
  icd10?: string;
  reasoning: string;
  /**
   * 이 환자에게서 관찰된 근거 (E1). 검증을 통과한 항목만 들어 있고, 하나도
   * 남지 않은 진단은 여기까지 오지 않고 `UnverifiedDifferential` 로 빠진다.
   * 구버전 저장 데이터를 읽을 수 있어야 하므로 optional.
   */
  supportingFindings?: SupportingFinding[];
  /**
   * PubMed 조회로 붙는 문헌근거. LLM 분석 결과에는 없다(모델이 인용을 지어내지
   * 않도록 프롬프트에서 제외했다) — 그래서 optional.
   */
  references?: EvidenceReference[];
}

/** PubMed 논문 한 편. 전부 PubMed 가 돌려준 값이며 모델이 만든 값이 아니다. */
export interface EvidenceReference {
  pmid: string;
  title: string;
  journal: string | null;
  year: number | null;
  /** 항상 https://pubmed.ncbi.nlm.nih.gov/{pmid}/ 형태. */
  url: string;
}

export type EvidenceStatus =
  | { state: 'loading' }
  | { state: 'ready'; references: EvidenceReference[]; cached: boolean }
  | { state: 'error'; message: string };

/** 근거 broadcast 페이로드. diagnosis 는 요청에 쓰인 표시용 진단명. */
export interface EvidenceUpdate {
  diagnosis: string;
  status: EvidenceStatus;
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
  /**
   * 근거 검증에서 내려온 감별진단 (E1). 구버전 저장 결과에는 없으므로 optional.
   * TODO(E2): 확인 요청 큐가 생기면 이 목록이 그쪽으로도 흘러가야 한다.
   */
  unverifiedDiagnoses?: UnverifiedDifferential[];
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

// ── 구독 (S2) ──────────────────────────────────────────────────────────────

/**
 * 실효 구독 상태.
 *
 * `trialing | active | past_due | expired | canceled | none` 은 서버가 서명한
 * 값 그대로다. `signed-out` 과 `unknown` 은 클라이언트 사정(로그아웃, 검증
 * 실패, 캐시 없음)이며 서버가 보내는 값이 아니다.
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'canceled'
  | 'none'
  | 'signed-out'
  | 'unknown';

export interface SubscriptionState {
  /** 새 진료를 시작할 수 있는가. 이 값 하나만 게이트가 본다. */
  entitled: boolean;
  status: SubscriptionStatus;
  plan: string | null;
  deviceLimit: number;
  trialEndsAt: string | null;
  periodEnd: string | null;
  /** 자격이 유지되는 마지막 시각. 남은 일수의 근거. */
  coverageEnd: string | null;
  daysRemaining: number | null;
  /** live = 방금 서버에서 받음, cache = 캐시로 버티는 중, none = 토큰 없음. */
  source: 'live' | 'cache' | 'none';
  /** 마지막 갱신이 네트워크/서버 문제로 실패했는가. 미구독과 구분해야 한다. */
  offline: boolean;
  /** 사유 코드 (서버 판정 근거 또는 클라이언트 검증 실패 코드). */
  reason: string;
  checkedAt: string;
}

export interface SubscriptionBlockedNotice {
  action: 'record' | 'analysis' | 'summary' | 'dictation' | 'patient-intake';
  state: SubscriptionState;
  message: string;
}

/** 계획서 확정 요금. 표기는 VAT 별도, 실제 청구는 총액. */
export const PLAN_PRICE_KRW = 70000;
export const PLAN_VAT_KRW = 7000;
export const PLAN_TOTAL_KRW = PLAN_PRICE_KRW + PLAN_VAT_KRW;

/** 체험 만료 배너를 띄우기 시작하는 남은 일수 (계획서: D-7). */
export const TRIAL_BANNER_DAYS = 7;


// ---------------------------------------------------------------------------
// 방문 코드 (L1)
// ---------------------------------------------------------------------------

/**
 * 키오스크 배포 주소와 이 앱이 쓰는 키오스크 슬러그.
 *
 * [HARD] 주소는 **설정값**이다. 코드 어디에도 도메인을 박지 않는다 —
 * `entanglecare.com` 은 아직 구매 전이고, 배포 주소가 바뀔 때마다 릴리스를
 * 다시 내는 구조를 만들지 않는다.
 */
export interface VisitCodeSettings {
  /** 예: `https://example.com/righthand/patient`. 빈 문자열이면 QR 을 그리지 않는다. */
  kioskUrl: string;
  /** 태블릿이 여러 대일 때 코드를 한 대에 묶는다. null 이면 이 의사의 어느 키오스크든 된다. */
  kioskSlug: string | null;
}

export interface IssuedVisitCode {
  /** 표준형(대문자, 하이픈 없음). 서버로 다시 보낼 일이 없고 화면 표기에만 쓴다. */
  code: string;
  /** 화면·구두 전달용 `A2CD-4EF`. */
  formatted: string;
  expiresAt: string;
  ttlSeconds: number;
  /** QR 에 넣을 URL. 키오스크 주소가 설정되지 않았으면 null. */
  url: string | null;
}

export type VisitCodeIssueError =
  | 'signed-out'
  /** 미사용 코드가 한도까지 쌓였다. 발급이 아니라 운영 문제라 문장이 다르다. */
  | 'too-many-live'
  | 'failed';

export type IssueVisitCodeResult =
  | { ok: true; issued: IssuedVisitCode }
  | { ok: false; error: VisitCodeIssueError };
