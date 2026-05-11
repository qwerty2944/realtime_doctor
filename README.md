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
