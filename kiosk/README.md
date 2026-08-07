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
환자 태블릿  ──▶  /intake?k=<슬러그>&c=<방문 코드>
                     │  (코드 → 고지·동의 → 환자 정보 → AI 문진 → 완료)
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

## 방문 코드 (L1) — 문진을 시작할 수 있는 유일한 열쇠

**슬러그만으로는 문진을 시작할 수 없습니다.** 이 앱은 공개 주소에서 서비스되고,
주소를 아는 누구나 문진을 시작할 수 있으면 그 결과는 실재하는 의사에게 귀속된
`encounters` 행이 됩니다 — 의사가 본 적 없는 사람과 AI 가 나눈 의료 대화가 그
의사 이름으로 대기목록에 쌓입니다. 근거: `../tasks/architecture-and-liability.md` 4장.

그래서 접수처가 **방문마다 코드를 발급**하고, 그 코드가 있어야 시작됩니다.

| 항목 | 값 | 이유 |
|---|---|---|
| 형식 | 7자, 알파벳 `23456789ACDEFGHJKMNPRTVWXY` | 소리내 읽거나 받아적을 때 헷갈리는 짝(0/O, 1/I/L, 2/Z, 5/S, 8/B, U/V, O/Q)을 **양쪽 다** 제외. 잘못 읽은 글자는 다른 유효한 코드가 되지 않고 그냥 거부됩니다. |
| 표기 | `A2CD-4EF` (4-3) | 불러주기·받아적기 쉬움. 하이픈·공백·소문자는 서버가 알아서 정리합니다. |
| 수명 | 30분 | 접수대에서 태블릿까지 걸어가는 시간. 그 이상은 책상에 살아 있는 자격증명을 남기는 것입니다. |
| 사용 | 1회 (진료 1건) | 문진이 끝나면 영구히 죽습니다. |

**26^7 = 80억(2^33)이 짧지 않은 이유** — 세 겹으로 추측을 막습니다:

1. **분당 실패 20회** (의사 단위, DB 카운터). 프로세스 안에서 세면 서버리스
   인스턴스 수만큼 허용치가 곱해지므로 DB 에서 셉니다.
   **한도는 실패에만 걸립니다** — 진짜 코드는 카운터가 꽉 차 있어도 통과합니다.
   그러지 않으면 속도 제한이 곧 서비스 거부 지렛대가 됩니다.
2. **미사용 코드 50개 상한** (의사 단위). 동시에 존재하는 표적 수를 묶습니다.
3. **30분 만료.** 살아 있는 코드만 맞힐 가치가 있습니다.

→ 한 번 찍어 맞을 확률 ≤ 50/8.03e9 = 6.2e-9. 분당 20회면 연 1.05e7회,
기대 성공 6.5e-5회/년(약 15,000년에 한 번)이고 그동안 매분이 기록에 남습니다.

**중단하면 어떻게 되나.** 코드는 첫 사용 때 소모되고 그때 만들어진 진료에
묶입니다. 환자가 중간에 자리를 뜨거나 태블릿이 새로고침되면 **같은 코드로 그
진료에 다시 들어갈 수 있습니다**(만료 전 · 그 진료가 아직 `intake_in_progress`
일 때 · 최대 3회). 거절해 버리면 접수처가 코드를 다시 발급하고 한 방문에 진료
행이 둘 생깁니다 — 대기목록에 같은 환자가 두 번 뜨는 쪽이 실제로 더 나쁩니다.
재개는 아무것도 만들지 않고, 문진이 끝나는 순간 코드는 영구히 죽습니다.

**발급은 데스크톱 앱**(dock 의 QR 아이콘)에서 합니다. 스태프가 쓰는 표면이
그것뿐입니다(admin-web 은 미배포). 큰 글씨 코드와 QR(`/intake?k=…&c=…`)이 함께
뜹니다. 평문 코드는 **어디에도 저장되지 않습니다** — 다시 보려면 새로 발급합니다.

스키마와 판정 로직 전부: `../supabase/migrations/0009_visit_access_codes.sql`.
판정은 DB 함수 하나(`redeem_visit_access_code`)에만 있고, 키오스크는 그것을
부르기만 합니다. `service_role` 만 부를 수 있습니다.

> **[HARD] 코드 검증은 `patients`/`encounters` insert 보다 먼저, 모델 호출보다
> 먼저 끝납니다.** 발급되지 않은 접근은 진료 행을 만들지 않고 LLM 쿼터도 쓰지
> 않습니다. `app/api/intake/start/route.ts` 의 주석 순서 참고.

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
`main`은 비밀이 아니라 **라우팅 키**입니다(그리고 위의 방문 코드가 생긴 지금도
여전히 그렇습니다 — 슬러그는 "누구 앞으로" 를 정하고, 시작할 수 있게 하는 것은
코드입니다). 서버에서만 `KIOSK_CLINICIANS` 매핑을 통해
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
| `NEXT_PUBLIC_BASE_PATH` | | 하위 경로 배포. 예 `/righthand/patient`. 비우면 루트 배포(로컬 개발 기본값). **경로 조각만** — 호스트명은 넣지 않습니다. |
| `GEMINI_API_BASE` | | Gemini 엔드포인트 override. 사내 프록시용. 운영에서는 설정하지 않습니다. |
| `GEMINI_API_KEY` | ✅ | 문진 질문 생성 및 결과 초안 작성. (`GOOGLE_API_KEY`도 인식) |
| `LLM_PROVIDER` | | 현재 `gemini`만 지원, 기본값도 `gemini`. 환자 동의서의 처리자 이름이 여기서 나옵니다. |
| `GEMINI_MODEL` | | 기본 `gemini-3.5-flash-lite` — 루트 `.env.example` 의 다섯 `GEMINI_*_MODEL` 과 같은 모델. 강제 도구 호출을 지키는 모델이어야 합니다. **설정하지 않는 편을 권장**합니다(배포에 박아두면 기본값 변경이 반영되지 않습니다). |
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
> 이 앱에서 브라우저로 나가는 `NEXT_PUBLIC_*` 변수는 `NEXT_PUBLIC_BASE_PATH`
> **하나뿐**이고, 담고 있는 것은 공개 URL 의 경로 조각입니다(비밀이 아닙니다).
> 모든 DB 접근은 여전히 API 라우트 뒤에 있습니다.

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

문진을 시작하려면 **방문 코드가 필요합니다.** 로컬에서는 데스크톱 앱의 dock
QR 버튼으로 발급하거나, SQL 로 직접 발급합니다:

```sql
-- 해당 의사로 로그인한 세션에서 (Supabase Studio 의 SQL 에디터는 postgres 롤이라
-- auth.uid() 가 없습니다. 앱이나 프로브 경로를 쓰는 편이 확실합니다.)
select public.issue_visit_access_code('main');
```

`scripts/probe-visit-code.mjs` 가 발급 → 시작 → 완주 전 구간을 자동으로 돕니다.

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

## 사용량 계량 (`usage_events`)

키오스크는 자기 서버측 `GEMINI_API_KEY` 로 Google 을 직접 호출합니다(데스크톱처럼
`ai-gemini` Edge Function 을 경유하지 않습니다). 서버 전용 키이므로 유출은 아니지만,
그렇게 쓴 돈이 어디에도 기록되지 않으면 문진 원가가 어드민 화면에서 통째로 사라집니다.
그래서 모델 호출마다 `public.usage_events` 에 한 행을 적습니다 — Edge Function 의
`recordUsage`(`supabase/functions/_shared/gate.ts`)와 같은 역할입니다.

| 컬럼 | 값 |
|---|---|
| `user_id` | **담당 의사** auth user id (`encounters.user_id` 에서 읽은 값). 환자는 계정이 없고, 이 컬럼은 NOT NULL 입니다. |
| `task` | `kiosk-interview`(질문 생성) / `kiosk-result`(결과 초안). 데스크톱 task 와 섞이지 않도록 접두사를 붙입니다. |
| `source` | `server` — 프로바이더 호출을 한 서버가 직접 적은 행입니다(0016 의 정의). 과금 근거로 삼아도 됩니다. |
| `platform` | `kiosk` |
| `session_id` | 항상 `null`. `sessions` 는 데스크톱 녹음 세션이라 문진에는 대응물이 없습니다. |
| 토큰 | Gemini 응답의 `usageMetadata` 그대로. 값이 없으면 0 이 아니라 `null`("모른다")입니다. |

재시도한 시도도 각각 한 행씩 남습니다 — 쓸 수 없는 응답도 토큰은 이미 태웠습니다.

[HARD] **계량 실패는 문진을 깨뜨리지 않습니다.** `lib/usage.ts` 가 모든 오류를 삼키고
`console.error` 로만 남깁니다. 다만 조용히 삼키지는 않습니다 — 로그가 없으면
"계량되고 있다" 는 착각이 생기고, 그건 계량이 없는 것보다 나쁩니다.

추가 환경변수는 필요 없습니다. 이미 있는 `SUPABASE_SERVICE_ROLE_KEY` 로 씁니다
(서비스 롤은 RLS 를 우회하므로 0016 의 `source='client'` 제한에 걸리지 않습니다).

**아직 계량되지 않는 것**: CLOVA STT(`/api/intake/transcribe`). `usage_events` 는
`provider='clova-csr'` 행을 이미 이해하지만, CLOVA 응답에서 과금 단위(청크 수/시간)를
꺼내는 일은 이번 변경 범위 밖입니다.

## 배포 (Vercel 기준)

이 디렉토리가 별도 프로젝트이므로 **Root Directory를 `kiosk`로 지정**해야 합니다.

1. Vercel에서 저장소를 임포트하고 **Root Directory → `kiosk`** 설정
2. Framework Preset: Next.js (자동 감지)
3. Environment Variables에 위 표의 필수 항목 전부 입력
   (`KIOSK_CLINICIANS`는 JSON 문자열 그대로 붙여넣기)
4. 배포 후 로그에 `[kiosk] Ready. Registered kiosks: main` 이 찍히는지 확인
5. **하위 경로 배포라면 `NEXT_PUBLIC_BASE_PATH` 를 설정** (예 `/righthand/patient`).
   Next 가 링크·정적자원·헤더 규칙을 접두하고, 클라이언트의 `fetch` 는
   `lib/basePath.ts` 의 `apiPath()` 가 접두합니다. 값을 바꾸면 **다시 빌드**해야
   합니다(빌드 타임에 번들로 들어갑니다).
6. 병원 태블릿의 홈 화면/키오스크 모드 URL을 `https://<배포주소>/intake?k=<슬러그>`로 지정
   (코드는 환자가 첫 화면에서 입력하거나, 데스크톱 앱의 QR 로 전달합니다)

`/intake`는 `force-dynamic`이고 `Cache-Control: no-store`가 붙습니다.
태블릿을 공유해도 앞 환자의 화면이 복원되지 않습니다.

### 현재 배포 (2026-08-06)

| 항목 | 값 |
|---|---|
| Vercel 프로젝트 | `righthand-patient` (팀 `mole-bi-coms-projects`, Root Directory `kiosk`) |
| 배포 주소 | `https://righthand-patient.vercel.app` |
| 앱 경로 | `https://righthand-patient.vercel.app/righthand/patient` |
| DB | `yhwvwojjwwlcrvpfxgag` (데스크톱 앱과 **같은** 프로젝트) |
| 키오스크 슬러그 | `main` → `entanglecare@gmail.com` |

루트(`/`)는 404 입니다. `NEXT_PUBLIC_BASE_PATH` 가 걸려 있으면 Next 가 그 경로에서만
서비스하기 때문이고, 이것이 의도된 동작입니다.

### 도메인 앞단 (`entanglecare.com/righthand/patient`)

도메인과 `/righthand` 네임스페이스는 `righthand_voice/app`(Vercel 프로젝트 `app`)이
갖고 있습니다. 그 앱의 `next.config.ts` 에 rewrite 하나를 넣어 이 배포로 넘깁니다.

```ts
// righthand_voice/app/next.config.ts
async rewrites() {
  return [
    // 키오스크는 realtime_doctor/kiosk 의 별도 Vercel 배포다.
    // NEXT_PUBLIC_BASE_PATH=/righthand/patient 로 빌드돼 있어서
    // **경로를 벗기지 않고 그대로** 넘긴다 — 벗기면 저쪽에서 404 다.
    {
      source: '/righthand/patient',
      destination: 'https://righthand-patient.vercel.app/righthand/patient'
    },
    {
      source: '/righthand/patient/:path*',
      destination: 'https://righthand-patient.vercel.app/righthand/patient/:path*'
    }
  ];
}
```

`next.config.ts` 에 `/righthand/patient` 로 보내는 **redirect 가 이미 있다면 지워야
합니다.** redirect 가 rewrite 보다 먼저 걸리면 브라우저가 되돌아오며 루프가 됩니다.

정적 자원(`/righthand/patient/_next/*`)과 API(`/righthand/patient/api/*`)가 전부
`:path*` 에 들어가므로 규칙은 위의 두 줄이면 충분합니다.

### 배포 검증

```bash
# 실제 배포 + 실제 DB + 실제 Gemini 를 상대로 돈다. 만든 행은 스스로 지운다.
KIOSK_URL=https://righthand-patient.vercel.app \
KIOSK_BASE_PATH=/righthand/patient \
KIOSK_CLINICIAN_ID=<의사 uuid> \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
node kiosk/scripts/probe-production.mjs
```

`scripts/probe-visit-code.mjs`(저장소 루트)는 로컬 스택 전용이고 모델 호출 횟수까지
셉니다. 배포 프로브는 그 이음매가 없어 "거절 뒤 행이 늘지 않았다" 까지만 셉니다.

---

## 산출 JSON 형태 (Electron이 읽는 계약)

Electron 파서: `../src/renderer/shared/patientMode.ts`

### `intake_results.differentials_json`

**정규형이고, DB 가 강제한다** (`0018` 의 `intake_results_differentials_canonical`).
아래 다섯 키가 전부이고 다른 키는 하나도 허용되지 않는다 — `name`/`nameEn`/`nameKr`
같은 camelCase 는 물론이고, 아직 아무도 생각하지 않은 여섯 번째 철자도 거절된다.
기준 선언은 `../src/shared/differentials.ts` 의 `INTAKE_DIFFERENTIAL_KEYS` 이고,
이 파일·zod 스키마·SQL 제약·통계 함수가 어긋나면 `npm run check:differentials`
(루트 `build` 가 부른다) 가 빌드를 세운다.

```jsonc
[
  {
    "rank": 1,                       // index 0 이 항상 최우선 (서버에서 재정렬)
    "name_kr": "망막박리",           // 필수·공백 불가. 통계가 이 키로 집계한다.
    "name_en": "Retinal detachment", // 필수. M4 PubMed 조회의 검색어. 한글/약어 금지.
    "rationale": "커튼처럼 시야가 가려진다는 진술과 부합",
    // E1 근거. 서버가 실제 대화와 대조해 통과한 것만 남기므로 빈 배열일 수 있다.
    "supporting_findings": [
      { "finding": "커튼처럼 가려진다", "source": "#3" }
    ]
  }
]
```

> 데스크톱 실시간 분석이 쓰는 `analyses.differential_diagnoses` 는 camelCase
> (`name`/`nameEn`/`icd10`/`reasoning`/`supportingFindings`)이고 **일부러 다르다** —
> 진행 중인 진료의 해석이라 `rank` 가 없고 진료 언어를 따른다. 근거는 `0018` 헤더.
> 그쪽 출력을 이 컬럼으로 넘길 때는 `toIntakeDifferentials()` 를 지난다.

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
│   │   ├── page.tsx                          # 서버: 키오스크 해석 + 고지·동의문 + ?c= 사전확인
│   │   ├── IntakeFlow.tsx                    # 5단계 상태 기계, 대화 기록 보유
│   │   ├── VisitCodeStep.tsx  ★ 방문 코드 입력 (QR 로 들어오면 건너뜀)
│   │   ├── AiDisclosure.tsx   ★ AI 고지 — 접지 않고 항상 펼쳐진다
│   │   ├── ConsentStep.tsx / PatientInfoStep.tsx
│   │   ├── InterviewStep.tsx                 # 반이중 음성 + 항상 보이는 글자 입력
│   │   ├── CompleteStep.tsx / ui.tsx / useSpeechSynthesis.ts
│   └── api/intake/{start,turn,transcribe,code/check}/route.ts
├── lib/
│   ├── env.ts                                # 부팅 시 일괄 검증
│   ├── api.ts, basePath.ts, supabase/admin.ts # 서비스 롤 클라이언트 / 하위 경로
│   ├── intake/
│   │   ├── kiosk.ts   ★ 슬러그 → 담당 의사
│   │   ├── token.ts   ★ HMAC 세션 토큰
│   │   ├── visitCode.ts       ★ 코드 표기 규칙 (판정하지 않는다)
│   │   ├── visitCodeServer.ts ★ 코드 소모/확인 — DB 함수 호출 층
│   │   ├── disclosure.ts      ★ AI 고지 문구 (서버에서 만들어 내려보낸다)
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

- **AI 고지를 동의 항목 안에 넣지 않았습니다.** 동의문은 체크되지 읽히지
  않습니다 — 전문은 "약관 전문 보기" 뒤로 접혀 있고, 접힌 경고는 경고가
  아닙니다. 책임등급 문서 5장이 요구하는 것은 **평이한 말로, 처음 보는
  화면에** 있는 세 문장이라, 동의 목록 **위에** 체크박스 없이 항상 펼쳐 둡니다.
  문구는 서버에서 만들어 내려보냅니다(`lib/intake/disclosure.ts`) — 고지가
  실제로 화면 payload 에 들어갔는지가 검증 대상이어야 하고, 이 머신에는 화면
  캡처 권한이 없어서 프로브가 문자열로 단언할 수 있어야 하기 때문입니다.
- **코드 확인(`/api/intake/code/check`)과 소모(`/api/intake/start`)는 같은 DB
  함수의 같은 경로**를 씁니다(`p_consume` 만 다릅니다). 인가 판정을 두 벌로
  만들면 갈라진 둘 중 하나만 고쳐지는 날이 옵니다. 확인 단계를 따로 둔 이유는,
  코드 오타를 환자가 이름·생년월일을 적기 **전에** 잡기 위해서입니다.
