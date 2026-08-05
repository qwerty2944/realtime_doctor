# 문진 키오스크 (realtime_doctor kiosk)

환자가 진료 **전에** 태블릿/폰에서 직접 작성하는 사전 문진 웹앱입니다.
AI가 대화형으로 병력을 청취하고, 그 결과를 realtime_doctor의 Supabase에 기록합니다.
문진이 끝나면 Realtime 이벤트를 통해 Electron 앱의 **대기목록에 환자가 자동으로 나타납니다.**

이 앱은 realtime_doctor 저장소 안에 있지만 **독립된 npm 프로젝트**입니다.
루트(Electron)나 `admin-web/`과 의존성을 공유하지 않습니다.

- 참조 원본: RightHand(`righthand_voice`)의 `/intake` 라우트 트리 — 문진에 필요한 부분만 이식했습니다.
  의사 대시보드, 통계, 설정, 약물 점검, 수가 모듈은 가져오지 않았습니다.
- Electron 쪽은 이 앱이 쓴 결과를 **읽기만** 합니다.

---

## 무엇을 쓰는가 (데이터 흐름)

```
환자 태블릿  ──▶  /intake?k=<슬러그>
                     │  (동의 → 환자 정보 → AI 문진 → 완료)
                     ▼
             /api/intake/start ──▶ patients + encounters(status=intake_in_progress)
             /api/intake/turn  ──▶ encounters.red_flag (턴마다 갱신)
                     │
                  문진 종료
                     ▼
             intake_results(soap_json, differentials_json, recommended_tests_json)
             encounters.status = 'intake_done', chief_complaint 채움
                     │
                     ▼  Supabase Realtime (publication: supabase_realtime)
             Electron 대기목록에 환자 등장
```

스키마의 정본은 `../supabase/migrations/0001_patients_encounters.sql` 입니다.

> **주의:** RightHand의 `sessions` 테이블은 여기서 **`encounters`** 입니다.
> realtime_doctor에는 이미 다른 의미의 `sessions` 테이블(녹취 세션)이 있습니다. 혼동하지 마세요.

---

## 담당 의사 귀속 (token → clinician) — 가장 중요한 부분

`encounters.user_id`는 **NOT NULL**이고 RLS 정책은 `user_id = auth.uid()`입니다.
즉 진료를 볼 의사의 auth user id가 행에 들어 있지 않으면 **그 행은 아무에게도 보이지 않습니다.**
문진을 마친 환자가 대기목록에서 영영 사라지는, 조용하고 최악인 실패입니다.

그런데 환자는 로그인하지 않습니다(카카오톡 링크로 들어온 어르신에게 계정은 없습니다).
따라서 "이 문진은 누구 것인가"는 환자가 아니라 **접속 경로**가 알려줘야 합니다.
두 겹으로 나눠 처리합니다.

### 1겹: 키오스크 슬러그 (URL `?k=`)

태블릿은 `https://<배포주소>/intake?k=main` 을 엽니다.
`main`은 비밀이 아니라 **라우팅 키**입니다. 서버에서만 `KIOSK_CLINICIANS` 매핑을 통해
의사 uuid로 번역됩니다. 의사 uuid 자체는 **절대 브라우저로 내려가지 않습니다.**

```jsonc
// KIOSK_CLINICIANS
{ "main": "<김의사의 auth user uuid>", "annex": "<이의사의 auth user uuid>" }
```

- 슬러그만으로 할 수 있는 일은 "그 의사 앞으로 문진을 시작"뿐이고, 읽기 권한은 0입니다.
- 슬러그가 **하나뿐이면** `?k=`를 생략해도 그 하나가 쓰입니다.
- 슬러그가 **둘 이상인데** `?k=`가 없으면 시작을 거부합니다.
  어느 의사인지 임의로 고르는 것보다 접수처에 물어보는 편이 안전하기 때문입니다.
- 모르는 슬러그, 잘못된 uuid, 형식이 깨진 JSON은 **서버 부팅 시점에** 이름을 대며 실패합니다.
  (`instrumentation.ts` → `lib/intake/kiosk.ts`)

의사 uuid 확인: Supabase 대시보드 → Authentication → Users → 해당 계정의 **UID**.

### 2겹: 세션 토큰 (HMAC)

`/api/intake/start`가 발급하고, 이후 모든 요청(`turn`, `transcribe`)에 필요합니다.

```
형식: v1.<만료 epoch 초>.<hex hmac>
MAC 입력: v1 | encounterId | clinicianId | 만료시각
```

- 증명하는 것은 딱 하나 — "이 진료가 만들어질 때 이 사람이 그 자리에 있었다".
  읽기 권한은 주지 않고 2시간 뒤 만료됩니다.
- 검증할 때 **`clinicianId`는 클라이언트가 보낸 값이 아니라 DB의 `encounters.user_id`에서
  다시 읽습니다.** 그래서 토큰은 자기가 발급된 그 진료·그 의사 조합을 벗어날 수 없습니다.
- 만료 시각은 평문이지만 MAC이 덮으므로 클라이언트가 늘릴 수 없습니다.
- 비교는 `timingSafeEqual`입니다(`===`는 처음 다른 바이트 위치를 흘립니다).
- 토큰은 컴포넌트 상태에만 있습니다. localStorage나 URL에 절대 쓰지 않으므로
  탭보다 오래 살지 않고 공유된 브라우저 기록으로 새지 않습니다.

이 토큰이 없으면 `encounterId`가 곧 베어러 자격증명이 되어, id를 알아낸 사람이
남의 문진에 답변을 덧붙일 수 있습니다.

---

## 환경변수

전체 목록과 설명은 `.env.example`에 있습니다. `kiosk/.env.local`로 복사해서 채우세요.
`kiosk/.env*`는 gitignore되어 있습니다(`.env.example`만 예외).

| 변수 | 필수 | 설명 |
|---|---|---|
| `SUPABASE_URL` | ✅ | Supabase 프로젝트 URL. 루트 `.env`의 같은 이름과 동일한 값. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **서버 전용.** RLS를 우회하는 서비스 롤 키. 루트의 `SUPABASE_PUBLISHABLE_KEY`와 다릅니다. |
| `KIOSK_TOKEN_SECRET` | ✅ | 세션 토큰 서명용 HMAC 키. `openssl rand -hex 32` |
| `KIOSK_CLINICIANS` | ✅ | 키오스크 슬러그 → 의사 uuid JSON 매핑. 위 "담당 의사 귀속" 참고. |
| `GEMINI_API_KEY` | ✅ | 문진 질문 생성 및 결과 초안 작성. (`GOOGLE_API_KEY`도 인식) |
| `LLM_PROVIDER` | | 현재 `gemini`만 지원, 기본값도 `gemini`. 환자 동의서의 처리자 이름이 여기서 나옵니다. |
| `GEMINI_MODEL` | | 기본 `gemini-3.5-flash`. 강제 도구 호출을 지키는 모델이어야 합니다. |
| `CLOVA_SPEECH_INVOKE_URL` | | 음성 입력용. **둘 다** 설정해야 녹음 버튼이 나타납니다. |
| `CLOVA_SPEECH_SECRET` | | 없으면 글자 입력만으로 문진이 정상 동작합니다. |

**필수 항목이 하나라도 비어 있으면 서버는 부팅을 거부하고 빠진 변수 이름을 전부 출력합니다.**
요청 도중에 조용히 실패하지 않습니다.

```
[kiosk] 필수 환경변수가 없어 서버를 시작할 수 없습니다: SUPABASE_URL, KIOSK_TOKEN_SECRET
kiosk/.env.example 을 참고해서 .env.local (또는 배포 플랫폼의 환경변수)에 설정하세요.
```

> `SUPABASE_SERVICE_ROLE_KEY`에 **절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요.**
> 붙는 순간 클라이언트 번들에 인라인되어 모든 환자가 DB 전체 권한을 갖게 됩니다.
> 이 앱에는 `NEXT_PUBLIC_*` 변수가 하나도 없고, 모든 DB 접근은 API 라우트 뒤에 있습니다.

> 셸에서 `export KIOSK_CLINICIANS={"main":"..."}` 처럼 **따옴표 없이** 쓰면
> 셸이 큰따옴표를 먹어 JSON이 깨집니다. 반드시 작은따옴표로 감싸세요.

---

## 로컬 실행

```bash
cd kiosk
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000
```

접속: <http://localhost:3000/intake?k=main>

```bash
npm run typecheck   # tsc --noEmit
npm run build       # next build
npm start           # 프로덕션 서버
```

> **DB 마이그레이션이 먼저입니다.** `../supabase/migrations/0001_patients_encounters.sql`을
> 대상 Supabase 프로젝트에 적용하기 전까지 문진을 끝까지 진행하면 insert 단계에서 실패합니다.
> 코드는 그 마이그레이션 파일 그대로를 기준으로 작성되어 있습니다.
> 로컬 스택(`supabase start` + `supabase db reset`)에서 전 구간을 검증했습니다.
> 실제 프로젝트에는 아직 적용되지 않았습니다.

---

## 배포 (Vercel 기준)

이 디렉토리가 별도 프로젝트이므로 **Root Directory를 `kiosk`로 지정**해야 합니다.

1. Vercel에서 저장소를 임포트하고 **Root Directory → `kiosk`** 설정
2. Framework Preset: Next.js (자동 감지)
3. Environment Variables에 위 표의 필수 항목 전부 입력
   (`KIOSK_CLINICIANS`는 JSON 문자열 그대로 붙여넣기)
4. 배포 후 로그에 `[kiosk] Ready. Registered kiosks: main` 이 찍히는지 확인
5. 병원 태블릿의 홈 화면/키오스크 모드 URL을 `https://<배포주소>/intake?k=<슬러그>`로 지정

`/intake`는 `force-dynamic`이고 `Cache-Control: no-store`가 붙습니다.
태블릿을 공유해도 앞 환자의 화면이 복원되지 않습니다.

---

## 산출 JSON 형태 (Electron이 읽는 계약)

Electron 파서: `../src/renderer/shared/patientMode.ts`

### `intake_results.differentials_json`

```jsonc
[
  {
    "rank": 1,                       // index 0 이 항상 최우선 (서버에서 재정렬)
    "name_kr": "망막박리",
    "name_en": "Retinal detachment", // M4 PubMed 조회의 검색어. 한글/약어 금지.
    "rationale": "커튼처럼 시야가 가려진다는 진술과 부합"
  }
]
```

### `intake_results.soap_json`

```jsonc
{
  "s": { "chief_complaint": "…", "hpi": "…", "pmh": "…", "medications": "…", "allergies": "…" },
  "o": "진찰 소견 대기",             // 항상 고정 문구 (모델이 만들지 않음)
  "a": "… \n\n위 목록은 감별진단 후보이며 확정 진단 아님. …",
  "p": "…",

  // Electron questions 창이 읽음
  "follow_up_questions": [
    { "question": "시야 결손이 상측인지 하측인지 확인", "rationale": "망막박리 위치 감별" }
  ],

  // Electron terms 창이 읽음
  "medical_terms": [
    { "term": "비문증", "term_en": "Floaters", "definition": "눈앞에 먼지나 벌레 같은 것이 떠다녀 보이는 증상입니다." }
  ],

  // 문진 대화 전문 (아래 "판단" 참고)
  "transcript": [{ "role": "agent", "text": "…" }, { "role": "patient", "text": "…" }]
}
```

`follow_up_questions` / `medical_terms`는 **`soap_json` 안**에 있습니다.
`patientMode.ts`의 `patientQuestions()` / `patientTerms()`가 SOAP 객체에서 찾기 때문입니다.
**`patientMode.ts`는 수정하지 않았습니다** — 기존 파서가 받아들이는 키를 그대로 생성했습니다.

### `intake_results.recommended_tests_json`

```jsonc
[{ "name_kr": "안저검사", "name_en": "Fundoscopy", "reason": "망막 열공 확인" }]
```

RightHand에는 병원 검사 카탈로그(`test_master`)가 있어 `test_id`/`code`를 붙였지만
이 스키마에는 없으므로 검사 코드는 생성하지 않습니다(존재하지 않는 코드를 접수처가
진짜로 취급할 위험이 있습니다).

---

## 구조

```
kiosk/
├── app/
│   ├── layout.tsx, globals.css, page.tsx     # 루트 폰트 18px, 대기실 홈
│   ├── intake/
│   │   ├── page.tsx                          # 서버: 키오스크 해석 + 동의문 생성
│   │   ├── IntakeFlow.tsx                    # 4단계 상태 기계, 대화 기록 보유
│   │   ├── ConsentStep.tsx / PatientInfoStep.tsx
│   │   ├── InterviewStep.tsx                 # 반이중 음성 + 항상 보이는 글자 입력
│   │   ├── CompleteStep.tsx / ui.tsx / useSpeechSynthesis.ts
│   └── api/intake/{start,turn,transcribe}/route.ts
├── lib/
│   ├── env.ts                                # 부팅 시 일괄 검증
│   ├── api.ts, supabase/admin.ts             # 서비스 롤 클라이언트
│   ├── intake/
│   │   ├── kiosk.ts   ★ 슬러그 → 담당 의사
│   │   ├── token.ts   ★ HMAC 세션 토큰
│   │   ├── schemas.ts # zod: 요청 / 모델 출력 / 저장 컬럼
│   │   ├── prompts.ts, interview.ts, result.ts
│   │   ├── redFlags.ts, negation.ts, consent.ts, birthDate.ts, limits.ts
│   ├── llm/{index,types,schema,gemini}.ts    # 강제 도구 호출
│   └── stt/clova.ts                          # 선택 기능
└── instrumentation.ts                        # 부팅 시 환경변수/매핑 검증
```

---

## 설계상의 판단

- **대화를 DB에 쌓지 않습니다.** RightHand는 매 턴을 `messages` 테이블에 append했지만
  이 스키마에는 그 테이블이 없습니다. 새 테이블을 추가하는 대신 대화는 클라이언트가
  들고 있다가 매 턴 되돌려 보내고, 문진이 끝나면 전문을 `soap_json.transcript`에 저장합니다.
  환자가 조작할 수 있는 것은 "자기 증상을 뭐라고 말했는가"뿐이며(원래 자유 입력입니다),
  토큰이 진료·의사에 묶여 있어 남의 진료에는 쓸 수 없습니다. 요청 크기는 zod가 막습니다.
  사라지는 것은 "미완료 문진의 중간 상태"뿐입니다.
- **red flag 규칙이 상수입니다.** RightHand는 `red_flags` 테이블 + 의사별 on/off를 썼습니다.
  의사가 규칙을 편집할 UI가 아직 없는 상태에서 테이블만 만들면 영원히 비어 있는 테이블이
  되고, 그건 규칙이 없는 것과 같습니다. 편집 UI가 생기면 `lib/intake/redFlags.ts`의
  `BUILTIN_RED_FLAGS`를 테이블 조회로 바꾸면 됩니다.
- **동의는 `encounters` 행에 저장됩니다.** RightHand의 `sessions`와 같은 세 가지 동의
  (`consent_privacy` / `consent_recording` / `consent_ai`)에 `consented_at`을 더해
  `/api/intake/start`가 진료 행과 함께 기록합니다. 동의 저장에 실패하면 진료 자체가
  만들어지지 않습니다 — 동의 없는 문진 기록을 남기지 않기 위해서입니다.
  (환자가 아니라 진료에 붙는 이유: 동의는 방문마다 받고, 그 방문 기록과 함께 보존해야 합니다.)
- **Anthropic 프로바이더를 가져오지 않았습니다.** realtime_doctor에는 Anthropic 키가 없고,
  `@anthropic-ai/sdk` 의존성을 추가할 이유가 없었습니다. 프로바이더 인터페이스는 그대로라
  나중에 파일 하나 추가로 되살릴 수 있습니다.
- **audit_logs를 가져오지 않았습니다.** 대상 스키마에 테이블이 없어 `console.error`로 대체했습니다.
