# Realtime Doctor

> 의료진을 위한 항상-위(always-on-top) 임상 보조 오버레이. 진료 중 마이크로 들어오는
> 환자-의사 대화를 실시간 전사하고, 감별진단·의학용어·다음 질문·임상 요약·EMR 딕테이션을
> 7개의 글래스 창에 분산해 동시에 보여줍니다. macOS·Windows 데스크톱 Electron 앱.

⚠️ **의료기기가 아닙니다.** 본 소프트웨어는 임상 보조 정보 도구이며, 진단·치료의
최종 판단은 의료진의 책임입니다.

---

## 1. 핵심 컨셉

진료실 화면 위에 일곱 개의 작은 글래스 패널이 떠 있습니다. 각 패널은 *한 가지 정보*만
보여주고, 의료진은 환자에게 집중하면서 시야 가장자리에서 필요한 데이터만 흘끗 확인합니다.

```
┌──────────────────┐  ┌───────────────┐
│ Transcript       │  │ 감별진단         │  ← 화자별 자막 / Top 5 ICD-10
│ [의사] 어디 ...   │  │ 1. 심근경색 78%  │
│ [환자] 가슴이 ... │  │ 2. 협심증 41%   │
└──────────────────┘  └───────────────┘
┌──────────────────┐  ┌───────────────┐
│ 의학용어         │  │ 다음 질문       │  ← 등장+연관 용어 / 감별 좁히는 질문
└──────────────────┘  └───────────────┘
┌──────────────────┐  ┌───────────────┐
│ 요약             │  │ Dictation      │  ← 6-필드 임상 노트 / SOAP prose
└──────────────────┘  └───────────────┘
┌──────────────────────────────────────┐
│ Dock  [⊟] T D M Q S K  [⚙️] [📐]    │  ← 컨트롤 패널
└──────────────────────────────────────┘
```

---

## 2. 7개 창 상세

| # | 창 | 역할 | 트리거 |
|---|-----|------|--------|
| 1 | **Transcript** | 실시간 자막 + 화자(의사/환자) 라벨 + 타임스탬프 + 화자 토글 | 시작/정지 토글, 마이크 라이브 |
| 2 | **감별진단** | Top 5 후보 + ICD-10 + 신뢰도(%) + 근거 1줄. Red flag 별도 강조 | 발화 누적 후 2.5초 디바운스 |
| 3 | **의학용어** | 등장 용어 + 환자 호소 기반 인접 임상 용어, 한국어(영문) 병기 | 동일 |
| 4 | **다음 질문** | 감별을 좁히는 데 유용한 질문 + rationale | 동일 |
| 5 | **요약** | CC / HPI / 소견 / 검사·약물 / Impression / Plan 6-필드 구조 노트 | 버튼 |
| 6 | **Dictation** | 의무기록 톤 prose. SOAP/APSO/H&P/Narrative 4종 템플릿 + 인라인 편집 + markdown 복사 | 버튼 |
| 7 | **Dock** | 정사각형 ALL 토글 (모두 표시·숨김) + 6창 토글 + 설정 다이얼로그 + 레이아웃 메뉴 | 항상 |

각 창은 드래그로 이동, 가장자리 리사이즈, 타이틀바 슬라이더로 투명도(20~100%) 조절,
─ 버튼으로 개별 최소화 가능. 위치·크기·투명도는 `electron-store`에 영구화.

---

## 3. 전사(STT) 공급자

Dock의 ⚙️ 설정 다이얼로그에서 공급자를 즉시 전환할 수 있습니다. 각 공급자는
**청크 모드**(VAD가 발화 끝을 감지해 한 덩어리씩 POST)와 **스트리밍 모드**
(연속 PCM → partial transcript 이벤트 즉시 수신)로 분류됩니다.

| ID | 라벨 | 모드 | 엔드포인트 | 인증 |
|----|------|------|-----------|------|
| `gemini` | Gemini (gemini-2.5-flash) | **청크** | `generativelanguage.googleapis.com/v1beta/models/.../generateContent` (audio inline) | `x-goog-api-key` |
| `openai` | OpenAI Realtime (gpt-4o-transcribe) | **실시간** | `api.openai.com/v1/realtime/client_secrets` + WebRTC `realtime/calls` (server VAD) | `Authorization: Bearer` |
| `clova-csr` | CLOVA CSR (한국어) | **청크** | `naveropenapi.apigw.ntruss.com/recog/v1/stt?lang=Kor` | `X-NCP-APIGW-API-KEY-ID/KEY` |
| `clova-stream` | CLOVA Speech Streaming | **실시간** | `clovaspeech-gw.ncloud.com:50051` (gRPC bidi) | `Authorization: Bearer <domain secret>` |

청크 모드는 발화 종료 후 1-2초 뒤 자막이 등장, 스트리밍은 말하는 도중 partial이
실시간으로 따라옵니다. 정지 버튼을 누르면 마지막 발화의 전사가 끝날 때까지 대기 후
정리됩니다.

---

## 4. 분석 파이프라인

```
마이크
  ↓ Web Audio API (16kHz mono)
  ↓ 청크: AudioWorklet energy-VAD → WAV → POST
  ↓ 스트림: AudioWorklet 연속 PCM → IPC → 메인 gRPC/WebRTC
공급자 STT
  ↓ text + item_id
analyzer.push(chunk)
  ├─ classifySpeaker (Gemini gemini-2.5-flash) → 의사/환자
  └─ debounced(2.5s) → 누적 transcript
      └─ Gemini generateContent + responseSchema(JSON)
          → 감별진단·의학용어·질문 → 3개 창 broadcast

요약 버튼 → summarizer (6-필드 JSON)
Dictation 정리 버튼 → dictator (템플릿별 sections JSON, 의무기록 톤)
```

화자 라벨링, 분석, 요약, 딕테이션은 모두 Gemini가 처리. STT만 공급자별로 다릅니다.

---

## 5. 기술 스택

- **Electron** 33 (Apple Silicon arm64, Windows x64)
- **electron-vite** 2 (main / preload / renderer 3-way 빌드)
- **React** 18 + **TypeScript** 5
- **Tailwind CSS** 3 + **shadcn/ui** (Button/Card/Badge/ScrollArea/Switch/Separator/Slider/Select/Tooltip/Dialog/DropdownMenu)
- **TanStack Query** 5 (`useMutation`/`useQuery` + IPC 이벤트 브리지)
- **axios** 1 (모든 HTTP 공급자)
- **@grpc/grpc-js** 1.12 + **@grpc/proto-loader** 0.7 (CLOVA Speech NEST 스트리밍)
- **electron-store** 10 (창 bounds, 투명도, 레이아웃 프리셋, 마지막 딕테이션 템플릿, 선택된 공급자)
- **dotenv** 16 (자동 `.env` 로드: 프로젝트 루트 → userData 디렉토리 → CWD 순)

---

## 6. 프로젝트 구조

```
realtime_doctor/
├── package.json
├── electron.vite.config.ts        # 3개(main/preload/renderer) 빌드 + 7개 HTML 엔트리
├── components.json                # shadcn/ui 설정
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.{json,node.json,web.json}
├── .env.example                   # 공급자 키 placeholder
├── build/                         # 아이콘 자산
│   ├── icon-1024.png              # Gemini로 생성
│   ├── icon.iconset/              # macOS 다중 해상도
│   ├── icon.icns                  # macOS 최종
│   └── icon.ico                   # Windows 최종 (to-ico)
├── scripts/
│   ├── gen-icon.mjs               # Gemini 이미지 호출
│   └── gen-ico.mjs                # PNG → ICO
├── src/
│   ├── main/                      # Electron 메인 (Node 24, ESM)
│   │   ├── index.ts               # 7개 창 생성, IPC 전체, 라이프사이클
│   │   ├── windows.ts             # OverlayWindow factory, MAIN_WINDOW_KEYS
│   │   ├── store.ts               # electron-store 스키마
│   │   ├── layouts.ts             # 4 빌트인 레이아웃 (right-stack/left-stack/wide-grid/corner-compact) + custom
│   │   ├── geminiClient.ts        # 공통 axios 인스턴스
│   │   ├── openaiClient.ts        # 동
│   │   ├── geminiTranscriber.ts   # 청크 STT
│   │   ├── openaiTranscriber.ts   # Whisper REST (fallback, 미사용)
│   │   ├── openaiStream.ts        # Realtime client_secret mint
│   │   ├── clovaTranscriber.ts    # CSR REST
│   │   ├── clovaStream.ts         # NEST gRPC bidi 클라이언트 + 이벤트 emitter
│   │   ├── clova-nest.proto       # NEST 프로토콜 정의
│   │   ├── transcribers.ts        # 공급자 메타데이터 + dispatcher
│   │   ├── diarizer.ts            # 화자 분류 (Gemini)
│   │   ├── analyzer.ts            # 누적 + 디바운스 + 감별·용어·질문 (Gemini)
│   │   ├── summarizer.ts          # 6-필드 임상노트 (Gemini)
│   │   ├── dictator.ts            # SOAP/APSO/H&P/Narrative prose (Gemini)
│   │   └── prompts.ts             # 시스템 프롬프트 + JSON Schema
│   ├── preload/
│   │   └── index.ts               # contextBridge로 IPC API 노출
│   ├── renderer/
│   │   ├── transcript/            # 1번 창
│   │   │   ├── App.tsx
│   │   │   ├── useRealtime.ts     # provider mode 분기 디스패처
│   │   │   ├── audioVad.ts        # energy VAD AudioWorklet (청크용)
│   │   │   ├── audioContinuous.ts # 연속 PCM AudioWorklet (스트리밍용)
│   │   │   ├── chunkSession.ts    # VAD + WAV + IPC
│   │   │   ├── streamSession.ts   # OpenAI WebRTC SDP
│   │   │   ├── clovaStreamSession.ts # 연속 PCM → IPC 브리지
│   │   │   ├── wav.ts             # Float32 → WAV(Int16 LE)
│   │   │   ├── main.tsx, index.html
│   │   ├── diagnosis/, terms/, questions/, summary/, dictation/, dock/
│   │   │   └── (각 창 main.tsx, App.tsx, index.html)
│   │   ├── components/ui/         # shadcn 컴포넌트 (자체 보존)
│   │   ├── shared/
│   │   │   ├── OverlayShell.tsx   # 타이틀바(투명도·최소화) + body
│   │   │   ├── queryClient.ts     # React Query + IPC analysis:update 브리지
│   │   │   └── api.d.ts           # window.api 타입
│   │   ├── lib/utils.ts           # cn()
│   │   └── styles/globals.css     # Tailwind + 글래스 토큰
│   └── shared/
│       └── types.ts               # IPC 채널 상수, 공통 타입
└── release/                       # 빌드 산출물 (DMG, win-unpacked, portable zip)
```

---

## 7. 사전 준비

- **Node.js** 22+ (개발 시 24 확인)
- **macOS** 13+ (Apple Silicon) 또는 **Windows** 10+ (x64)
- **API 키 1개 이상**:
  - Google AI Studio (Gemini): https://aistudio.google.com/apikey
  - OpenAI (Realtime + 분석 fallback): https://platform.openai.com/api-keys
  - Naver Cloud Platform (CLOVA CSR / Speech Streaming)

분석·요약·딕테이션은 **Gemini가 처리**하므로 최소 `GEMINI_API_KEY`는 필수. STT만 다른
공급자로 바꾸려면 해당 키도 함께 채워 둡니다.

---

## 8. 설치 & 실행

### 개발 모드

```bash
cp .env.example .env
# .env에 GEMINI_API_KEY 등 채우기
npm install
npm run dev
```

### 빌드 (현재 머신용)

```bash
npm run build        # 컴파일만
npm run dist         # macOS arm64 DMG
npm run dist:universal  # macOS universal (arm64 + x64)
npm run dist:win     # Windows x64 NSIS (Wine 필요)
```

### 타입체크

```bash
npm run typecheck    # main(node) + renderer(web) 양쪽
```

---

## 9. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GEMINI_API_KEY` | (필수) | Google AI Studio 키. STT(`gemini`) + 분석 4종 |
| `GEMINI_TRANSCRIBE_MODEL` | `gemini-2.5-flash` | 청크 STT 모델 |
| `GEMINI_DIARIZER_MODEL` | `gemini-2.5-flash` | 화자 분류 모델 |
| `GEMINI_ANALYZER_MODEL` | `gemini-2.5-flash` | 감별진단·용어·질문 모델 |
| `GEMINI_SUMMARIZER_MODEL` | `gemini-2.5-flash` | 요약 모델 (`gemini-2.5-pro` 권장 가능) |
| `GEMINI_DICTATOR_MODEL` | `gemini-2.5-flash` | 딕테이션 모델 |
| `OPENAI_API_KEY` | (선택) | OpenAI Realtime 사용 시 |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | Realtime transcription 세션 모델 |
| `CLOVA_API_KEY_ID` / `CLOVA_API_KEY` | (선택) | NCP API Gateway 키. CLOVA CSR 청크 사용 시 |
| `CLOVA_SPEECH_SECRET` | (선택) | CLOVA Speech 장문 인식 도메인 Secret. gRPC 스트리밍 활성화 |

빈 값인 공급자는 Dock 설정 다이얼로그에서 비활성(회색) 표시됩니다.

배포된 앱은 `.env`를 다음 순서로 탐색합니다:
1. 앱 번들 루트 (`out/../.env`)
2. `~/Library/Application Support/Realtime Doctor/.env` (macOS) / `%APPDATA%/Realtime Doctor/.env` (Windows)
3. 현재 작업 디렉토리

---

## 10. IPC 채널 (참고)

| 채널 | 방향 | 페이로드 | 용도 |
|------|------|----------|------|
| `transcribe:audio` | renderer→main (invoke) | `{id, base64Wav}` | 청크 STT 트리거 |
| `transcript:chunk` | renderer→main | `{id, text, timestamp}` | 스트림 발화 확정 시 분석기에 push |
| `transcript:label` | main→all | `{id, speaker}` | 화자 라벨 broadcast |
| `transcript:relabel` | renderer→main | 동 | 수동 토글 |
| `transcript:reset` | renderer→main | — | 분석기 상태 초기화 |
| `analysis:update` | main→all | `AnalysisResult` | 디바운스 분석 결과 |
| `summary:request` / `summary:update` | invoke / broadcast | — / `SummaryResult` | 6-필드 임상노트 |
| `dictation:request` / `dictation:update` | invoke / broadcast | `template` / `DictationResult` | 의무기록 prose |
| `stream:mint` | renderer→main (invoke) | — | OpenAI ephemeral session |
| `clova-stream:open` / `audio` / `close` | invoke / send / send | — / Uint8Array / — | CLOVA gRPC 세션 제어 |
| `clova-stream:partial` / `final` / `error` | main→all | `{itemId, text}` | gRPC 응답 |
| `provider:list` / `get` / `set` | invoke | — / — / `id` | 공급자 메타·전환 |
| `layout:list/apply/save-current/delete/set-default/get-default` | invoke | name | 레이아웃 |
| `windows:list-state` / `state` (broadcast) | invoke / event | — / `WindowState[]` | dock 동기화 |
| `windows:toggle-one` / `toggle-all` | send | key / — | 토글 |
| `windows:set-opacity-of` | send | `(key, value)` | 투명도 |

---

## 11. 데이터 처리·프라이버시

- 기본 상태에서 transcript, 분석 결과, 요약·딕테이션은 모두 **메모리 only**. 앱 종료 시 소실.
- **클라우드 동기화는 opt-in**(Dock 설정 다이얼로그 → 계정 탭). 켜면 `sessions`,
  `analyses`, `summaries`, `dictations`를 Supabase에 사용자별로 저장.
- **전사 원문 저장은 별도 opt-in** (동기화가 켜진 상태에서만 활성화 가능).
  켜면 발화 청크 텍스트가 그대로 Supabase에 저장됨 — 환자 식별 정보(PHI) 포함 가능.
- 현재 단계에서 Supabase 테이블의 **RLS는 비활성**. 사용자 격리는 앱 코드가 `user_id` 필터로만 처리.
  publishable key를 가진 누구든 모든 row에 접근 가능하므로 운영 환경 전에 RLS 활성화 필요.
- API 키는 메인 프로세스에서만 보유. 렌더러는 ephemeral session 키만 일시 보유.
- 전사·분석 요청은 각 공급자(Google / OpenAI / Naver) 서버로 전송됨. 각 사의 데이터
  처리 정책 적용 (모델 학습 사용 여부는 각 공급자 정책 확인 필요).

---

## 12. 알려진 제약

- 화자 구분(diarization)은 음향이 아닌 발화 내용 기반 분류이므로 짧거나 모호한 발화는
  빗나갈 수 있음. 화자 칩 클릭으로 즉시 정정 가능 + dock에 ↔ 일괄 swap 버튼.
- 청크 모드의 partial transcript는 없음. 발화 종료 후 1~2초 지연.
- macOS 코드사이닝 미적용 → 첫 실행 시 Gatekeeper 우회 필요 (우클릭 → 열기).
- Windows .exe는 portable zip만 자동 빌드됨. NSIS 인스톨러는 Wine 설치 후 `npm run dist:win`.
- 진료 한 세션의 transcript는 ~18,000자 캡(rolling window). 더 길면 앞쪽이 잘림.
- CLOVA Speech Streaming은 도메인당 동시 15세션 제한.

---

## 13. 면책·안전

- **본 소프트웨어는 의료기기가 아닙니다.** PMDA·KFDA·FDA·CE 인증 없음.
- 출력은 임상 보조 정보이며, 모든 진단·치료 결정은 자격 있는 의료진의 책임입니다.
- 기본적으로 환자 식별 정보(PHI)는 디스크·외부 백업으로 저장되지 않습니다. 단,
  **클라우드 동기화**와 **전사 원문 저장** 옵션을 켠 경우 발화 원문이 Supabase에
  저장되며 §11의 제약이 적용됩니다. 각 공급자 약관·HIPAA·개인정보보호법 준수 여부는
  사용자가 직접 확인해야 합니다.
- 응급 의심 단서(red flag)는 감별진단 창 상단에 강조 표시되나, 진단·이송 판단의
  최종 책임은 의료진에게 있습니다.

---

## 14. 라이선스

내부 사용 목적의 비공개 프로젝트.

---

## 15. Supabase 설정 (로그인 + 진료 기록 동기화)

앱은 시작 시 로그인 게이트가 켜진 상태로 동작합니다. Dock만 보이고, 설정 다이얼로그가
자동으로 열려 계정 탭으로 진입합니다. 로그인 후 6개 오버레이가 나타납니다.

### 환경 변수

`.env`에 다음 두 줄을 채워야 로그인이 활성화됩니다.

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Supabase 대시보드 → Project Settings → API Keys 에서 publishable 키를 복사하세요.

### 이메일 인증 비활성화 (필수)

Supabase 대시보드 → Authentication → Providers → Email → "Confirm email" 토글을 **OFF**.
이 설정 없이는 `signUp`이 즉시 세션을 발급하지 않아 회원가입 후 바로 로그인되지 않습니다.

### 스키마

마이그레이션 `auth_and_clinical_data`가 다음 5개 테이블을 생성합니다.

| 테이블 | 용도 |
|--------|------|
| `sessions` | 진료 세션 메타 (lazy 생성, transcript reset 시 종료) |
| `transcript_chunks` | 발화 청크 (전사 원문 저장 opt-in 시에만 INSERT) |
| `analyses` | 감별·용어·질문 (session 당 1행, debounce마다 upsert) |
| `summaries` | 6-필드 임상 노트 (append-only) |
| `dictations` | SOAP/APSO/H&P/Narrative prose (append-only) |

**RLS는 활성화되지 않습니다** — publishable key를 가진 누구든 row에 접근 가능합니다.
멀티유저 운영 전에 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` 와
`USING (user_id = auth.uid())` 정책 추가가 필요합니다.

---

## 16. 구독·결제 (포트원 정기결제)

계획서: `tasks/subscription-plan.md`. 현재 S1~S3 까지 구현돼 있습니다.

| 단계 | 내용 | 상태 |
|---|---|---|
| S1 | 구독 스키마 + RLS/GRANT + 가입 트리거 (`supabase/migrations/0002_subscriptions.sql`) | 완료 |
| S2 | entitlement Edge Function + Electron 기능 게이트 + 72시간 오프라인 유예 | 완료 |
| S3 | admin-web 결제 페이지 + 빌링키 발급 + 첫 결제 + 다음 주기 예약 1건 | 완료 |
| S4 | 웹훅 + **매 결제 성공 시 재예약** + 예약 누락 감시 크론 | 완료 |
| S5 | 결제 실패 dunning + 해지 | 미구현 |

### 상품 조건

단일 플랜 `standard`. 월 **70,000원 (VAT 별도)**, 실제 청구 **77,000원**.
무료 체험 7일(카드 등록 없음), 기기 2대.

### [HARD] 포트원 예약은 반복되지 않는다

`POST /payments/{id}/schedule` 은 **미래 1건**만 잡습니다. 자동 반복이 아닙니다.
재예약을 놓치면 **에러도, 로그도, 실패한 결제도 없이** 두 번째 달부터 과금이
멈춥니다. 첫 증상은 "매출이 왜 안 늘지?" 입니다.

S4 에서 예약을 만드는 구현을 **한 곳으로 모았습니다**: `admin-web/lib/billing/cycle.ts`
의 `ensureNextSchedule()`. 부르는 곳은 셋입니다.

| 부르는 곳 | 시점 |
|---|---|
| `app/api/billing/complete/route.ts` | 첫 결제 직후 (S3) |
| `app/api/billing/webhook/route.ts` | 결제 성공 웹훅을 받을 때마다 |
| `app/api/billing/watchdog/route.ts` | 매일, 예약이 빠진 구독을 훑어 복구 |

구현이 갈라지면 언젠가 한 곳만 고쳐지고 결과는 다시 "조용한 과금 중단"입니다.

### 웹훅 (`POST /api/billing/webhook`)

Supabase Edge Function 이 아니라 admin-web 에 둡니다. 성공 시 반드시 해야 하는
재예약이 포트원 REST 클라이언트·주기 산술·service_role 클라이언트를 전부 필요로
하는데 그 넷이 이미 admin-web 에 있기 때문입니다. Deno 로 옮기면 같은 것을 한 벌
더 만들게 되고, 그 순간 위 표의 "구현 하나" 원칙이 깨집니다.

- [HARD] **서명 검증이 먼저입니다.** `@portone/server-sdk/webhook` 의 `verify()` 를
  파싱보다, DB 쓰기보다 먼저 통과해야 합니다. 검증 없는 웹훅은 "JSON 하나 POST 하면
  아무 구독이나 켜지는" 구멍, 즉 유료화 전체의 인증 우회입니다.
- 서명 대상은 **원문 바이트**입니다. Next.js Route Handler 는 본문을 미리 파싱하지
  않으므로 `await req.text()` 가 수신 바이트를 그대로 줍니다. 이 라우트는
  `req.json()` 을 부르지 않습니다 — 재직렬화된 문자열로 검증하면 키 순서·공백
  차이로 전부 조용히 실패합니다.
- 멱등성 3겹: `webhook_events.portone_event_id` UNIQUE → 결제 성공 반영은
  `payment_attempts` 를 `status <> 'paid'` 조건부로 갱신했을 때만 →
  `ensureNextSchedule` 의 결정적 paymentId + UNIQUE.
- 웹훅 본문에는 `paymentId` 만 있고 금액·상태가 없습니다. 서버가
  `GET /payments/{id}` 로 직접 확인한 뒤 판정합니다.
- 검증된 요청은 이벤트 기록만 동기로 하고 즉시 200 을 돌려준 뒤, 실제 처리는
  `after()` 로 응답 뒤에 돕니다. DB 가 느려도 포트원 재전송을 유발하지 않습니다.

| 이벤트 | 처리 |
|---|---|
| `Transaction.Paid` | 기간 1개월 전진, `status=active`, `grace_until` 해제, **다음 주기 재예약** |
| `Transaction.Failed` | 실패 기록, `status=past_due`, `grace_until = now + 7일` (재시도 사다리는 S5) |
| `BillingKey.Deleted` | `billing_key`·카드 표시정보 제거. 이미 낸 기간은 유지 |
| 그 외 | `webhook_events` 에 저장하고 200. 에러를 주면 포트원이 영원히 재전송합니다 |

### 주기 산술 규칙 (`admin-web/lib/billing/period.ts`)

1. **다음 주기는 `current_period_end` 에서 이어붙입니다. `now()` 가 아닙니다.**
   결제가 늦게 잡힐 때마다 now() 기준으로 잡으면 늦어진 만큼이 매달 공짜로
   나가고, 어디에도 에러가 남지 않습니다. (예외: 주기가 60일 넘게 밀린 경우에만
   now() 기준으로 재기준하고 경고 로그를 남깁니다.)
2. **말일은 클램프하되 앵커일은 침식되지 않습니다.** 31일 가입자는
   1/31 → 2/28 → **3/31** 로 돌아옵니다. 앵커일을
   `subscriptions.billing_anchor_day` 에 따로 저장하기 때문입니다. 직전 주기
   날짜에서 유추하면 2월에 28일로 잘린 뒤 영원히 28일이 되고, 의사는 자기
   결제일이 옮겨간 걸 모릅니다. 그래서 주기 길이는 28~31일을 오갑니다(월 정액이므로 의도된 동작).
3. 모든 계산은 UTC 기준입니다.

### 예약 누락 감시 (`/api/billing/watchdog`, 매일)

`Bearer BILLING_CRON_SECRET` 로 호출하는 라우트이고, 스케줄은
`admin-web/vercel.json` 의 Vercel Cron (매일 UTC 18:00 = KST 03:00)입니다.
pg_cron 을 쓰지 않은 이유는 이 잡이 탐지만 하지 않고 **복구**하기 때문입니다 —
복구는 포트원 예약 API 호출이라 `PORTONE_API_SECRET` 을 쥔 서버만 할 수 있습니다.

- 대상: `active`/`past_due` + 빌링키 보유 + 해지 예정 아님인데 **미래 예약이 없는** 구독.
- 주기 끝이 이미 지났으면 주기를 전진시키지 않고(받지 않은 돈에 서비스를 열어줄
  수는 없습니다) 가까운 미래로 청구를 잡습니다. 성공하면 웹훅이 정상 경로로 전진시킵니다.
- 멱등: 두 번째 실행은 아무것도 하지 않습니다.
- **실행할 때마다 `subscription_watchdog_runs` 에 행을 남깁니다. 문제를 못 찾았을
  때도 남깁니다.** 이게 없으면 "오늘 이상 없음"과 "이 잡이 3월부터 안 돌고 있음"이
  DB 상 완전히 같은 모습이 됩니다.

### 포트원 콘솔에서 가져와야 하는 값

PG 는 나이스페이·스마트로 어느 쪽이든 됩니다. 코드에 PG 종속 분기가 없고
채널키 하나로 결정됩니다.

| 환경변수 | 콘솔 위치 | 성격 |
|---|---|---|
| `NEXT_PUBLIC_PORTONE_STORE_ID` | 결제연동 > 연동 정보 > 식별코드·API Keys > Store ID (`store-`) | 공개 |
| `NEXT_PUBLIC_PORTONE_CHANNEL_KEY` | 결제연동 > 연동 정보 > 채널 관리 > 해당 채널의 채널 키 (`channel-key-`) | 공개 |
| `PORTONE_API_SECRET` | 결제연동 > 연동 정보 > 식별코드·API Keys > V2 API Secret | **서버 전용** |
| `PORTONE_WEBHOOK_SECRET` | 결제연동 > 연동 정보 > 웹훅 관리에서 엔드포인트 등록 시 발급 (`whsec_`) | **서버 전용** |

그 외 admin-web 에 필요한 값:

| 환경변수 | 설명 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 구독 테이블은 service_role 만 쓸 수 있습니다. **서버 전용** |
| `BILLING_HANDOFF_SECRET` | Electron 자동 로그인 링크 서명용. `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_ORIGIN` | 링크에 박히는 admin-web 주소 (Vercel 은 생략 가능) |
| `BILLING_CRON_SECRET` | 예약 누락 감시 크론 호출용 Bearer 토큰. `openssl rand -base64 32`. Vercel Cron 을 쓰면 `CRON_SECRET` 에 같은 값을 넣습니다 |
| `PORTONE_API_BASE` | 기본 `https://api.portone.io`. 테스트에서 목 서버로 바꿀 때만 |

포트원 콘솔의 웹훅 엔드포인트는 `https://<admin-web 도메인>/api/billing/webhook`
으로 등록하고, `Transaction.Paid` / `Transaction.Failed` / `BillingKey.Deleted`
세 이벤트를 구독합니다.

하나라도 빠지면 `admin-web/instrumentation.ts` 가 **서버 부팅 시** 이름을 대며
실패합니다. 의사가 카드 등록 버튼을 누른 순간에 500 이 뜨는 것보다 낫습니다.

[HARD] `PORTONE_API_SECRET` 과 `SUPABASE_SERVICE_ROLE_KEY` 는 서버 전용입니다.
`NEXT_PUBLIC_` 을 붙이지 말고, `electron.vite.config.ts` 의 `EMBEDDED_ENV_KEYS`
에도 절대 추가하지 마세요(그 목록의 값은 빌드타임에 앱 번들로 인라인됩니다).

Electron 쪽은 `BILLING_PORTAL_URL` 만 admin-web 의 `/billing` 주소로 맞추면 됩니다.

### Electron → 브라우저 자동 로그인

앱에서 "구독하기"를 누르면 `POST /api/billing/handoff` 로 1회용 링크를 받아
기본 브라우저로 엽니다. URL 에 실리는 것은 Supabase 가 발급한 1회용 OTP
해시뿐이고(HMAC 봉투 + **120초** 만료), refresh token 이나 장기 JWT 는 URL 에
들어가지 않습니다. 세션은 서버가 OTP 를 교환할 때 HttpOnly 쿠키로만 설정됩니다.

### 로컬 검증

```bash
supabase start
supabase functions serve --env-file supabase/functions/.env
node scripts/probe-billing.mjs   # S3: 빌링키 발급 / 첫 결제 / 권한 (38 PASS)
node scripts/probe-webhook.mjs   # S4: 웹훅 / 재예약 / 감시 크론 (71 PASS)
```

포트원 HTTP 계층만 목으로 대체되고, 라우트·서명 검증·DB 는 전부 진짜입니다.
`probe-webhook.mjs` 는 `@portone/server-sdk` 가 검증하는 것과 동일한 HMAC 서명을
직접 만들어 보냅니다(미서명·위조 서명·본문 변조 케이스 포함).
