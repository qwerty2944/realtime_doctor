# STATE

## 목표

### 완료: 환자 기능 이식 (M1~M6)
righthand_voice 의 환자 기능을 realtime_doctor(Electron) 에 이식. 계획: `tasks/todo.md`.

### 진행 중: 구독 시스템 (S1~S6)
포트원 정기결제 기반 월 구독. 계획: `tasks/subscription-plan.md`.
상품 조건: 단일 플랜 `standard`, 70,000원 + VAT 7,000 = **77,000원 청구**, 7일 무료 체험
(카드 등록 없음), 기기 2대.

완료 기준:
1. 구독 스키마 + RLS/GRANT + 가입 트리거. 클라이언트가 자기 구독을 위조할 수 없어야 한다.
2. entitlement Edge Function + Electron 기능 게이트 + 72시간 오프라인 유예.
3. admin-web 결제 페이지에서 빌링키 발급 + 첫 결제.
4. 웹훅 수신 + **다음 주기 재예약** + 예약 누락 감시 크론.
5. 결제 실패 dunning + 해지 + 기기 수 제한 연동.
6. 포트원 테스트 채널로 성공/실패/해지/카드만료 전 경로 검증.

## 현재 상태

- **M1~M6 완료** (커밋 전, 워킹 트리). 로컬 Supabase 스택에서 end-to-end 검증 완료:
  키오스크 문진 완주 → DB 저장 → Electron 데이터 계층 → PubMed → Realtime 자동 반영.
- 이후 수정한 버그: 마이그레이션 GRANT 누락(치명적), M5 폰트 단축키 accelerator 문법 오류,
  첫 실행 언어 선택기가 dock 에 잘리던 문제, 전사 창이 대화 대신 과거력을 보여주던 문제.
- 첫 실행 언어 게이트 제거 (기본 한국어). 언어 전환기는 dock 설정에 유지.
- **S1 완료** — `supabase/migrations/0002_subscriptions.sql`. 권한 테스트 4종 전부 차단 확인.
- **S2 완료** (커밋 전) — entitlement Edge Function + Electron 게이트 + 72시간 오프라인 유예.
  - 서명: ECDSA P-256/SHA-256. 개인키는 Edge Function 환경변수(`supabase/functions/.env`,
    gitignore 됨)에만, 공개키만 앱 번들에. HMAC 을 쓰면 앱이 스스로 토큰을 찍을 수 있어 배제.
  - 날짜 우선순위: 행 없음 → 잠금 / `canceled|expired` → 날짜 무관 잠금 / 그 외에는 status 가
    "어느 날짜를 볼지"만 정하고 판정은 날짜가 한다(trialing→trial_ends_at, active→
    current_period_end, past_due→max(period_end, grace_until)). 날짜 null → 잠금.
  - 게이트한 IPC: `stream:mint`, `clova-stream:open`, `transcribe:audio`, `transcript:chunk`,
    `analysis:request`(+단축키), `summary:request`(+단축키), `dictation:request`(+단축키),
    `patients:select`(선택만, 해제는 허용).
  - 열어둔 IPC: `sessions:list-mine`, `sessions:load`, `patients:list-waiting`,
    `patients:load-detail`, `localSave:*`, `evidence:*`, `subscription:*`. 의료 기록 열람은
    결제 상태와 무관하게 항상 가능해야 한다.
  - **로그아웃 = 잠금**으로 정했다. 로그아웃이 게이트를 없애면 게이트가 아니다. 이 앱은
    가입→체험이 전제라 실사용에 영향 없음.
  - 검증: `scripts/probe-entitlement.mjs`(26 PASS, 시나리오 1~5),
    `scripts/probe-gate-driver.mjs`(21 PASS, 시나리오 5~7, 빌드된 main 번들에 IPC 직접 호출).
- **S3 완료** (커밋 전) — admin-web 결제 페이지 + 빌링키 발급 + 첫 결제 + 다음 주기 예약 1건.
  - 새 마이그레이션 `0003_billing_issue_requests.sql` (로컬 스택에만 적용됨). service_role 전용,
    RLS on/정책 0개. S1 의 권한 구조는 손대지 않았다.
  - 라우트: `/api/billing/handoff`(Electron 자동 로그인 링크 발급),
    `/billing/handoff`(OTP→쿠키 교환), `/api/billing/issue-id`, `/api/billing/complete`.
    전부 service_role 클라이언트(`lib/supabase/service.ts`)로만 subscriptions 를 쓴다.
  - 자동 로그인: Supabase `generateLink` 의 1회용 OTP 해시를 HMAC 봉투(**120초**)에 담아 URL 로.
    refresh token / 장기 JWT 는 URL 에 넣지 않는다. 교환은 서버에서, 세션은 HttpOnly 쿠키로만.
  - 빌링키는 **서버가 포트원에 직접 조회**해서 status=ISSUED 와 customer.id 일치를 확인한
    뒤에만 인정한다. 브라우저의 "발급 성공했다"는 주장만으로는 아무것도 활성화되지 않는다.
  - 멱등성 3겹: (1) `billing_issue_requests` 조건부 UPDATE 선점, (2) `payment_attempts.payment_id`
    UNIQUE (paymentId 는 issueId 에서 결정), (3) 포트원의 동일 paymentId 거부.
  - 검증: `scripts/probe-billing.mjs` — 38 PASS. 실제 next 서버 + 포트원 목 서버로
    정상 결제·위조 콜백 3종·이중 제출·결제 거절·권한 7종을 전부 확인했다.
  - PG 는 아직 미정(나이스페이/스마트로). 채널키 하나로 결정되며 PG 종속 코드는 없다.
  - 포트원 실제 자격증명(storeId/channelKey/API Secret)이 없어 **라이브 호출은 못 해봤다.**
- **S4 완료** (커밋 전) — 포트원 웹훅 + 매 결제 성공 시 재예약 + 예약 누락 감시 크론.
  - 새 마이그레이션 `0004_billing_cycle.sql` (로컬 스택에만 적용됨):
    `subscriptions.billing_anchor_day`, `webhook_events.{processing_error,attempt_count}`,
    `subscription_watchdog_runs` 테이블. 전부 service_role 전용. 0002 의 권한 구조는 손대지 않았다.
  - **웹훅 위치: admin-web `/api/billing/webhook`** (Edge Function 아님). 재예약이 포트원
    REST 클라이언트·주기 산술·service_role 클라이언트를 다 필요로 하는데 그 넷이 이미
    admin-web 에 있다. Deno 로 가면 예약 구현이 두 벌이 되고, 갈라진 둘 중 하나만
    고쳐지는 날 과금이 조용히 멈춘다 — S4 가 존재하는 이유가 정확히 그 실패 모드다.
  - **재예약 구현은 하나뿐이다**: `lib/billing/cycle.ts` 의 `ensureNextSchedule()`.
    첫 결제(complete)·성공 웹훅·감시 크론 셋 다 이걸 부른다. complete 의 `TODO(S4)` 는
    제거됐고, 중복 규칙이던 `ids.ts:addOneMonth` 도 지웠다(주기 산술은 period.ts 하나).
  - 서명 검증: `@portone/server-sdk/webhook` 의 `verify()`. **원문 바이트**(`req.text()`)로
    검증하고 이 라우트에서는 `req.json()` 을 부르지 않는다. 검증 실패 시 400 + DB 무접촉.
  - 웹훅 본문에는 paymentId 만 있고 금액·상태가 없다 → 서버가 `GET /payments/{id}` 로
    직접 확인한 뒤 판정한다. 서명이 통과해도 우리가 믿는 건 paymentId 하나뿐이다.
  - 빠른 200: 이벤트 기록(멱등성 선점)만 동기, 실제 처리는 `after()` 로 응답 뒤.
  - 멱등성 3겹: `webhook_events.portone_event_id` UNIQUE → 성공 반영은
    `payment_attempts` 를 `status <> 'paid'` 조건부 갱신했을 때만(이벤트 id 가 달라도
    이중 연장 없음) → `ensureNextSchedule` 의 결정적 paymentId + UNIQUE.
  - **주기 산술 규칙** (`lib/billing/period.ts`): (1) 다음 주기는 `current_period_end` 에서
    이어붙인다, `now()` 가 아니다(늦은 결제마다 며칠씩 공짜로 나가는 걸 막는다. 60일 넘게
    밀린 경우만 now() 로 재기준 + 경고). (2) 말일은 클램프하되 앵커일은 침식되지 않는다 —
    31일 가입자는 1/31 → 2/28 → **3/31**. 앵커일을 `billing_anchor_day` 에 저장하기 때문.
    (3) 전부 UTC.
  - 결제 실패: `past_due` + `grace_until = now+7d`. 이미 열린 유예는 **연장하지 않는다**
    (연장하면 유예가 영원해진다). 재시도 사다리·안내·만료 전환은 S5 이음매로 남겼다.
  - 감시 크론: `/api/billing/watchdog` (Bearer `BILLING_CRON_SECRET`), 스케줄은
    `admin-web/vercel.json` 의 Vercel Cron 매일 UTC 18:00(KST 03:00). pg_cron 이 아닌 이유는
    이 잡이 탐지만이 아니라 **복구**(포트원 예약 API 호출)를 하기 때문 — DB 안에서는 못 한다.
    실행할 때마다 `subscription_watchdog_runs` 에 행을 남긴다. **문제를 못 찾았을 때도**
    남긴다("오늘 이상 없음"과 "3월부터 안 돌고 있음"이 같은 모습이 되면 안 된다).
  - 검증: `scripts/probe-webhook.mjs` — **71 PASS / 0 FAIL**. 실제 next 서버 + 포트원 목 +
    진짜 HMAC 서명으로 9개 시나리오: 성공 웹훅→기간 전진+새 예약 / 동일 이벤트 재전달 /
    미서명·위조서명·타 시크릿·본문변조 4종 거부(DB 무변화) / 실패→past_due+유예 중
    entitlement ENTITLED, 유예 만료 후 NOT ENTITLED / BillingKey.Deleted / 미지원 이벤트 200 /
    크론 탐지·복구·재실행 무동작 / 말일(1/31→2/28→3/31) / **3주기 연속 청구**.
  - 빌드: admin-web typecheck+build, 루트 typecheck+electron-vite build 전부 통과.
    `.next/static` 와 `out/` 에서 결제 시크릿 5종 grep — 0건.
- **S5 완료** (커밋 전) — dunning 사다리 + 유예 만료 전환 + 웹훅 재처리 + 해지 + 기기 수 제한.
  - 새 마이그레이션 `0005_dunning_cancel_devices.sql` (로컬 스택에만 적용됨):
    `subscriptions.{dunning_rung,dunning_started_at,dunning_cycle_end,cancel_requested_at,canceled_at}`,
    `payment_attempts.{portone_schedule_id,attempt_kind,dunning_rung}`,
    `webhook_events.{reprocess_count,last_reprocess_at}`, 그리고 **`devices` 테이블**
    (레포에 마이그레이션이 아예 없어서 로컬 스택에 존재하지 않던 테이블이다).
    0002 의 권한 구조는 손대지 않았다. devices 는 authenticated 에게 자기 행 SELECT 만.
  - **재시도 사다리 구현: "크론이 한 단씩 늦게 예약"** (`lib/billing/dunning.ts`).
    실패 시점에 D+1/D+3/D+5 를 한꺼번에 예약하는 방식을 버렸다 — 그러면 "성공 시
    나머지 취소"가 **취소 호출 2건이 반드시 성공해야 이중청구가 안 나는** 구조가 된다.
    한 단씩 잡으면 미결 재시도가 항상 최대 1건이고, 어느 단에서 성공하면 다음 단은
    애초에 만들어지지 않으므로 취소가 실패할 수도 없다.
    폭풍 방지 3겹: 조건부 UPDATE 로 단 선점 → paymentId 가 (사용자, **주기끝**, 단)
    으로 결정 + UNIQUE → 포트원의 중복 예약 거부. 정기(`rdc_`)와 재시도(`rdr_`)는
    접두사부터 다른 id 공간을 쓴다.
  - **[HARD] 감시 크론 vs dunning 우선순위**: `status='past_due'` 인 구독은 dunning 이
    독점하고, S4 의 연체 복구(+5분 즉시 청구) 경로는 손대지 않는다. 연체 복구는
    "청구 시도 자체가 없었다"는 침묵을 메우는 장치인데 past_due 는 정의상 침묵이
    아니기 때문이다. 크론 sweep 이 status 로 경로를 먼저 가르고(1겹), 양쪽 모두
    "미래 예약이 있으면 무동작"을 확인하며(2겹), paymentId UNIQUE 가 막는다(3겹).
  - **past_due → expired 전환**: 크론이 한다. 조건은 entitlement 의 날짜 판정과
    **정확히 동일**(`now >= max(current_period_end, grace_until)`). 두 판정이
    어긋나면 "화면엔 만료인데 기능은 됨" 또는 "잠겼는데 청구는 계속됨"이 된다.
    이 전환은 판정을 바꾸지 않고 DB 를 사실과 일치시킬 뿐이다.
  - **웹훅 처리 본체를 `lib/billing/webhook-handlers.ts` 로 분리**. `after()` 안에서
    죽은 이벤트(`processing_error is not null and processed_at is null`)를 크론이
    **같은 함수로** 다시 돌린다. 상한 5회, 넘으면 재시도를 멈추고 `webhook_unrecovered`
    로 보고한다(조용히 사라지지 않게). 멱등성은 기존 `status <> 'paid'` 조건부 갱신에
    전적으로 기댄다 — 두 번 재처리해도 기간이 두 번 늘지 않는 것을 검증했다.
  - **해지**: `POST /api/billing/cancel {cancel}`. 순서가 중요하다 — **플래그를 먼저
    세우고 그다음 예약을 철회한다.** 반대면 그 사이 도착한 성공 웹훅이 해지 사실을
    모른 채 다음 주기를 재예약한다. 철회는 `DELETE /payment-schedules`(쿼리스트링
    `requestBody`)이고, 그래서 `payment_attempts.portone_schedule_id` 가 필요하다 —
    예약 id 를 안 남기면 해지해도 카드가 그대로 긁힌다. 자동 환불은 만들지 않았다.
  - **기기 수 제한**: 새 Edge Function `device`(register/heartbeat/list/revoke).
    `devices` 쓰기 권한을 authenticated 에게서 전부 회수했다 — 이전 구조에서는
    커밋된 anon 키로 세 번째 행을 INSERT 하거나 revoked 를 active 로 UPDATE 하면
    그만이었다. 한도 초과 시 **아무 기기도 자동으로 밀어내지 않고** 목록을 돌려주며,
    선택은 **Electron dock 다이얼로그**에서 받는다(그 순간 의사는 새 기기 앞에 서
    있다 — 브라우저로 보내면 가장 마찰이 큰 지점에 마찰을 더한다).
  - 검증: `scripts/probe-dunning.mjs` — **118 PASS / 0 FAIL**. 7개 시나리오:
    전체 dunning 경로(유예 중 내내 UNLOCKED → 만료 시 LOCKED + DB expired) /
    2단에서 회복(월 예약 복구, 미래 예약 정확히 1건) / 크론·dunning 충돌 시 이중청구
    없음(크론 7회 실행) / 웹훅 재처리 + 이중 전진 없음 + 미복구 보고 / 해지(목이
    예약 취소를 기록) / 해지 취소(예약 복구) / 기기 한도(3번째 서버 거부, anon 키
    직접 INSERT·UPDATE 차단, 해제 후 등록, 해지된 기기 하트비트 revoked).
  - 회귀: probe-webhook 71 PASS, probe-billing 41 PASS, probe-entitlement 27 PASS.
    (probe-billing 은 S4 가 추가한 필수 env 2개가 빠져 있어 **S5 이전부터 부팅
    실패**하던 상태였다. 그 두 줄을 채웠다.)
  - 빌드: admin-web typecheck+build, 루트 typecheck+electron-vite build 전부 통과.
    `out/` 와 `.next/static` 에서 시크릿 9종 grep — 0건.
- 실제 Supabase 프로젝트(yqdzxitlmtawznzwpkra)에는 **아직 아무것도 적용하지 않았다.**

### 진행 중: provider 키 서버 이전 (A1~)

목표: API 키를 데스크톱 바이너리에서 걷어내고, 계량을 클라이언트가 건너뛸 수 없게 만든다.

- **A1 완료** (커밋 전) — OpenAI realtime mint + Gemini 요청/응답을 Edge Function 뒤로.
  - **왜**: 키가 번들에 있으면 (1) 빌드를 가진 아무나 소유자 크레딧을 쓰고,
    (2) 유출돼도 전 설치본 재배포 전엔 회수 불가, (3) 사용량이 자진 신고라
    고객당 원가를 모른다. 월 77,000원 상품에서 원가를 모른다 = 마진을 모른다.
  - 새 Edge Function 2개: `ai-realtime`(ephemeral secret 발급), `ai-gemini`
    (`models/*:generateContent` 투명 프록시). 공통 게이트는 `_shared/gate.ts`.
  - **판정 규칙을 `_shared/entitlement.ts` 로 추출**했다. entitlement 함수와
    프록시가 같은 `derive()` 를 쓴다 — 두 벌이 되면 갈라지고, 갈라진 날
    "화면엔 만료인데 API 는 계속 나간다"가 된다. (S5 크론이 만료 전환 조건을
    entitlement 와 글자 그대로 맞춘 것과 같은 이유.)
  - **fail-closed**: 인증 없음 401 / 자격 없음 402 / DB 조회 실패 503 /
    환경변수 누락 500. **전부 provider fetch 이전**이다. entitlement 함수는
    DB 장애 때 5xx 를 주고 앱이 캐시로 버티게 하지만, 프록시에서 "버틴다"는
    곧 "소유자 크레딧을 쓴다"이므로 여기서는 버티지 않는다.
  - **열린 프록시가 아니다**: 경로는 `models/<model>:generateContent` 하나만,
    모델은 `gemini-*` 패턴 + 선택적 `GEMINI_ALLOWED_MODELS` allowlist. 모델을
    앱이 고를 수 있으면 비용 상한이 없다(flash 대신 pro 를 지목하면 그만).
  - **응답은 가공하지 않는다**. E1 의 `supporting_findings` 검증이 스키마
    보존에 기대고 있다 — 필드를 하나 떨어뜨리면 근거가 통째로 미검증이 되거나
    엉뚱한 발화를 가리킨다.
  - 새 마이그레이션 `0016_usage_event_source.sql`: `usage_events.source`
    (`server` | `client`, 기본 `client`). RESTRICTIVE 정책으로 authenticated 는
    `source='server'` 를 INSERT 도 UPDATE 도 못 한다. **SELECT 에는 걸지 않았다** —
    `for all` 로 걸면 admin-web(`authenticated` 로 읽는다)에서 server 행이 통째로
    사라진다.
  - **클라이언트 logUsage 는 남겼다**(`source='client'`). CLOVA(CSR/스트리밍)와
    realtime **세션 길이**는 아직 서버가 볼 수 없어서 — 오디오는 렌더러와 OpenAI
    사이에서 직접 흐른다. 서버는 발급 횟수(`task='mint'`)만 셀 수 있다.
    지우면 CLOVA 사용량이 통째로 사라지고, 구분하지 않으면 믿을 수 있는 행이
    믿을 수 없는 행의 신뢰도를 물려받는다.
  - `openaiClient.ts` / `openaiTranscriber.ts` 삭제. 후자는 호출자가 하나도 없는
    죽은 코드였고, 전자는 그 둘의 유일한 소비처였다.
  - **`transcribers.ts` 의 `available` 을 다시 기준 잡았다.** 예전엔
    `!!process.env.GEMINI_API_KEY` 였다 — 그대로 뒀으면 키가 빠지는 순간
    Gemini/OpenAI 두 공급자가 목록에서 통째로 사라진다.
  - EMBEDDED_ENV_KEYS 3중 미러(`electron.vite.config.ts` / `build-win.yml` /
    `ci-assert-embedded.mjs`)에서 두 키 제거 + `AI_PROXY_URL` 옵션 추가.
    ci-assert 에 **부재 검사**를 넣었다(값 + 이름 양쪽). 나중에 누가 되돌리면
    빌드가 깨진다.
  - 검증: `scripts/probe-ai-proxy.mjs` — 가짜 업스트림 모드 **44 PASS / 0 FAIL**,
    `PROBE_LIVE=1` 실 provider 모드 **45 PASS / 0 FAIL / 7 SKIP**(SKIP 은 호출 카운터가
    없는 검사). 가짜 업스트림으로 **호출 횟수를 세서** 거절 10건 동안 provider
    호출 0회를 확인했다 — "게이트가 앞에 있다"는 코드를 읽어서는 증명되지 않는다.
    실 모드에서는 진짜 Gemini 분석이 감별진단 4건을 냈고 E1 검증기(앱과 같은
    `partitionDifferentials`)가 4건 전부 통과시켰다. 진짜 `ek_` ephemeral secret
    수신 확인.
  - 회귀: probe-entitlement 27 PASS. probe-gate-driver 는 9 FAIL 인데
    **A1 이전 트리에서도 동일하게 9 FAIL** (stash 후 재실행으로 확인) — 이 환경의
    로그인 실패이지 A1 회귀가 아니다.
  - 빌드: 루트 typecheck + electron-vite build 통과. `out/` 전체 39개 파일
    1.4MB 를 스캔해 두 키의 **값과 이름 모두 0건** 확인.
  - **배포 완료** (운영 `yhwvwojjwwlcrvpfxgag`). 순서를 지켰다: 0016 적용 →
    시크릿 → 함수 배포 → 앱 빌드. 거꾸로 하면 새 빌드가 없는 함수를 부른다.
    - 0016 은 `supabase db query --linked -f` 로 넣었다. **`db push` 를 쓰지
      않았다** — 원격 이력이 타임스탬프 version(MCP `apply_migration` 경유)으로
      쌓여 있어 로컬 `0000`~`0016` 과 이름이 하나도 맞지 않는다. push 했으면
      16개를 전부 다시 실행했을 것이다. 같은 이유로 `schema_migrations` 에
      0016 행을 남기지 못했다(0015 도 이미 빠져 있다). 이력표는 이 프로젝트에서
      이미 실제 스키마와 어긋나 있으므로, 다음 마이그레이션도 `db push` 로
      돌리면 안 된다.
    - 시크릿 4종: `GEMINI_API_KEY`, `OPENAI_API_KEY`,
      `GEMINI_ALLOWED_MODELS=gemini-2.5-flash`,
      `OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe`.
      allowlist 를 **비워 두지 않고 flash 하나로 좁혔다.** 비우면 `gemini-*`
      패턴 전체가 열리고, 그러면 자격 있는 사용자 한 명이 pro 를 지목해 월
      77,000원 상품의 원가를 마음대로 올릴 수 있다. 앱이 실제로 쓰는 다섯
      모델은 전부 flash 다.
    - `ai-gemini`/`ai-realtime` 둘 다 ACTIVE, `verify_jwt=true`
      (entitlement/device 와 동일). `_shared` 는 별도 배포 대상이 아니라 각
      함수 번들에 포함된다(각 696kB).
    - `AI_PROXY_URL` 을 루트 `.env` 에 넣었다. 옵션 키라 CI 3중 미러는 이미
      대응돼 있어 수정이 필요 없었다.
    - 운영 검증 30 PASS / 0 FAIL: 미인증 401, 자격 없음 402, allowlist 밖
      모델(`gemini-2.5-pro`) 400 `model_not_allowed`, 실 Gemini 왕복이
      감별진단 4건 → E1 검증기 4건 통과, `ek_` ephemeral secret 599초 만료,
      `usage_events` 에 `source='server'` 2행이 호출자 본인/본인 세션으로 기록,
      거절된 사용자에겐 0행. 프로브 계정과 행은 전부 삭제했다.
  - **이미 나간 0.7.0 빌드는 계속 동작한다** — 그 안의 키는 여전히 유효하고
    Google/OpenAI 를 직접 부른다. A1 은 그 빌드들을 막지 못한다. 실제로 키를
    회수하려면 provider 콘솔에서 키를 **로테이트**해야 하고, 그 순간 0.7.0 은
    AI 기능이 죽는다. 즉 로테이트는 A1 배포가 아니라 **강제 업데이트 정책과 함께**
    해야 하는 별도 결정이다.

- **A2 (미착수)** — CLOVA. 조사 결과는 아래.
  - `clovaTranscriber.ts`(CSR, `POST /recog/v1/stt`)는 ai-gemini 와 같은 모양이라
    프록시가 어렵지 않다. 헤더 2개(`X-NCP-APIGW-API-KEY-ID/-KEY`)와 바이너리
    본문뿐이다.
  - `clovaStream.ts`는 `clovaspeech-gw.ncloud.com:50051` 로 나가는 **gRPC 양방향
    스트림**이다. Supabase Edge Function(Deno)은 아웃바운드 gRPC 스트리밍
    중계에 맞지 않는다 — 옮기려면 오디오를 서버로 다시 태워야 하고, 그건
    프록시가 아니라 **미디어 릴레이**를 새로 만드는 일이다.
  - **NCP 는 OpenAI 같은 단기 키를 주지 않는다.** 공식 문서(gRPC) 확인:
    `Authorization: Bearer ${secretKey}` 이고 secretKey 는 장문인식 도메인에서
    발급받는 **장기 도메인 시크릿**이다. 발급/만료 API 가 없다.
  - 권장: **반쪽만 옮기지 않는다.** CSR 만 프록시하면 스트리밍용
    `CLOVA_SPEECH_SECRET` 은 여전히 번들에 남아 "키를 걷어냈다"는 말이 거짓이
    된다. CLOVA 는 (a) 스트리밍까지 처리할 릴레이를 세우거나 (b) 기본
    공급자에서 내리거나, 둘 중 하나를 정한 뒤에 한 번에 옮긴다.

### 진행 중: 근거 우선 전환 (E1~E4)
계획: `tasks/evidence-first-plan.md`.

- **E1 완료** (커밋 `3f4279b`, `c625831`) — confidence 퍼센트를 검증 가능한 근거로 교체.
  - 스키마: `confidence` 제거, `supporting_findings[] = { finding, source }` 도입.
    `source` 는 프롬프트가 transcript 각 줄에 붙인 `[#N]` 번호다.
  - **검증기는 한 벌**(`src/shared/findings.ts`)이고 main(실시간)과 renderer(환자 모드)가
    같이 쓴다. 두 벌이 되면 한쪽만 고쳐지는 날 지어낸 근거가 그대로 뜬다.
    `SupportingFinding.quote` 는 모델 문장이 아니라 원문에서 꺼낸 값이라
    **미검증 근거가 화면에 뜰 수 없다는 것을 타입으로 보장**한다.
  - analyzer 의 transcript 절삭을 문자열 자르기 → 발화 단위로 바꿨다. 예전 방식은
    `[#N]` 접두사를 중간에서 잘라 번호와 발화를 어긋나게 만든다.
  - 근거 0건 진단은 **버리지 않고** 감별진단 창의 "근거 미확인" 섹션에 남긴다.
    E2 확인 요청 큐로 보낼 이음매에 `TODO(E2)`.
  - 키오스크도 같은 모양을 만들고 `assembleRow` 가 저장 전에 참조를 대조한다.
  - 검증: `scripts/probe-findings.mjs`(로컬 스택, 실제 assembleRow →
    loadPatientDetail → patientDifferentialsPartitioned, 21 PASS),
    `scripts/probe-findings-live.mjs`(실제 gemini-2.5-flash 1회, 5 PASS).
  - **육안 검증 미완료** — 화면 캡처 권한이 없어 근거 클릭 → 전사 창 포커스/강조를
    눈으로 확인하지 못했다. IPC·매퍼·검증기는 실제 코드로 검증됨.

- **B1 완료** (커밋 `8689d11`) — 진료행위 정의 계층. **수가표가 아니다**: 금액·청구코드·
  청구 권유 문구가 들어가지 않는다.
  - `supabase/migrations/0006_care_activities.sql` 의 `care_activity_defs`.
    탐지 규칙(cue_terms / negation_terms / required_speaker / min_distinct_cues /
    min_utterances / min_duration_seconds)이 전부 **컬럼**이다. 어느 항목이 실제로
    새는지는 아직 못 받은 도메인 지식이라, 코드에 항목별 지식을 한 줄도 넣지 않았다.
    항목 추가 = CSV 한 줄 + 로더 실행. 릴리스도 마이그레이션도 필요 없다.
  - RLS + 명시적 GRANT. **authenticated 는 SELECT 만**이고 쓰기는 service_role
    전용이다 — 이것이 검토 게이트의 무결성이다. 클라이언트가 스스로
    `clinical_review_status='reviewed'` 로 올릴 수 있으면 게이트가 아니다
    (0005 의 devices 에서 이미 겪은 실패 모드). 프로브에서 승격·삽입 둘 다 403 확인.
  - 씨드 5종(생활습관 교육/복약 지도/금연 상담/상처 소독/주사)은 **전부
    `unreviewed`**. 로더는 무엇이든 unreviewed 로만 넣고, 규칙이 바뀐 기존 항목은
    검토 상태를 다시 내린다(바뀐 규칙에 대한 검토가 아니므로).
  - `scripts/care-wording.mjs` 가 금지 문구 단일 출처다. 라벨·설명·식별자에
    "청구/수가/급여/삭감" 이 들어오면 적재를 거부한다. 문구가 곧 책임 경계이고
    내부 식별자도 언젠가 화면에 샌다.

- **B2 완료** (커밋 `cefa6c0`) — 탐지 엔진.
  - **규칙 기반이고 LLM 을 쓰지 않는다.** 여기서 지어낸 인용은 감별진단의 지어낸
    인용보다 나쁘다 — 하지 않은 행위의 기록이 되고 그대로 허위청구가 된다.
    규칙은 재현 가능하고 실사에 "어떤 규칙, 어떤 낱말"로 답할 수 있다.
    대가는 재현율(패러프레이즈를 놓친다)이며, 의도한 손실이다.
  - `src/shared/careActivities.ts` **한 벌**을 main 과 renderer 가 같이 쓴다(E1 규칙).
    `quotes` 는 비어 있을 수 없는 배열이고 `timeRange` 는 optional 이 아니라서
    **인용·시각 없는 후보는 값으로 존재할 수 없다.** 인용문은 언제나 발화 원문에서
    꺼내며 엔진은 어떤 문자열도 만들지 않는다. 시각은 실제 `timestamp_ms` 에서만
    나오고, 하나라도 없으면 후보를 버린다(추정 시각 금지).
  - 보수 문턱 3개(서로 다른 단서 수 / 단서 걸린 발화 수 / 실제 경과 시간) + 부정어 +
    화자 조건. 못 넘은 것은 `skipped` 로만 남고 **화면에 올리지 않는다** — 애매한 것을
    "가능성 있음"으로 보여주는 순간 그것이 곧 권유다.
  - `releaseForDisplay()` 가 화면으로 나가는 유일한 문이고, 반환 타입이 리터럴
    `'reviewed'` 라 미검토 후보는 그 타입이 될 수 없다(타입으로 막은 게이트).
    통과하려면 원문 대조도 다시 통과해야 한다.
  - 검증: `scripts/probe-care-activities.mjs` — **28 PASS**. 실제 로컬 스택에 한국어
    진료 대화 14발화를 심고 진짜 엔진으로 돌렸다. 교육 1건 탐지(00:30–04:22, 인용 4건),
    애매한 3종(스치듯 언급/“다음에 하겠다”/환자 질문)은 후보 0건, 타임스탬프를
    걷어내면 같은 대화도 후보 0건, 지어낸 후보 4종(없는 발화 id/문장 바꿔치기/
    시각 부풀리기/인용 0건) 전부 차단, 미검토 정의는 화면 0건.
- **B3 완료** (커밋 `fa2fd4c`) — 화면 노출.
  - **자리: 요약 창 하단**(`src/renderer/summary/CareActivitySection.tsx`). 진료가
    끝난 뒤 한 번 훑는 목록이고, 그 목적으로 여는 창이 이미 요약 창이다.
    감별진단 창은 진료 **중에** 보는 창이라 붙이면 진료 흐름을 끊는다.
    확인요청 큐(questions)는 E2 가 아직 정의되지 않아서 지금 얹으면 큐의
    의미를 이 목록이 먼저 규정해버린다.
  - **끼어들지 않는다.** 모달·알림·자동 창 띄우기 없음. 요약 창이 열려 있을 때만
    조회한다(invoke 1회). 언제 볼지는 의사가 정한다.
  - 각 항목: 행위명 + 시각 구간 + 원문 인용(발화 id 포함) + provenance.
    인용을 누르면 **E1 이 만든 경로를 그대로 쓴다** — `focusUtterance` →
    `IPC.TranscriptFocusUtterance` → main 이 전사 창을 앞으로 꺼내고 broadcast.
    두 번째 메커니즘을 만들지 않았다.
  - **빈 상태를 값으로 만들었다** (`CareActivityDisplayPayload.emptyReason`):
    `none-reviewed` / `no-evidence` / `no-session` / `intake-no-timestamps`.
    씨드 정의가 전부 미검토라 **지금은 아무것도 안 뜨는 것이 정상**이고,
    화면은 "검토된 항목 없음" + 이유를 말한다(고장으로 보이지 않게).
    환자 모드는 "문진 대화에는 시각 정보가 없다"를 정직하게 말한다.
  - 게이트 없음 — 자기 기록 열람이라 S2 의 "기록 열람은 결제와 무관" 규칙을 따른다.
- **B4 완료** (커밋 `8b7a92d`, `fa2fd4c`) — 저장·월 리포트.
  - **저장 결정**(B1/B2 가 남긴 미결): `supabase/migrations/0007_care_activity_candidates.sql`.
    행마다 `engine_version`/`rule_version`/`generated_at` 를 박고 **고쳐 쓰지 않고
    대체(supersede)** 한다. 월 집계는 규칙 버전별로 나뉘므로 규칙이 바뀌면
    지난달 숫자가 조용히 달라지는 대신 **줄이 하나 늘어난다**.
    부분 unique 인덱스가 (세션, 행위)당 유효 행 1개를 강제하고, 그래서 자기참조
    FK 는 `deferrable initially deferred` 다(대체 행 id 를 먼저 찍어야 인덱스를 통과한다).
  - 저장은 **화면에 올린 payload 로만** 한다 — 리포트와 화면이 어긋날 수 없다.
    `clinical_review_status` 는 CHECK 로 `'reviewed'` 고정: 리포트도 사용자 화면이다.
  - 쓰기는 `record_care_activity_candidates()` RPC 하나뿐. authenticated 에게는
    SELECT + EXECUTE 만 주고 INSERT/UPDATE/DELETE 권한을 아예 주지 않았다
    (0005 의 devices 실패 모드). RLS + 명시적 GRANT.
  - **리포트 자리: 앱 안(dock 다이얼로그)**. admin-web 은 아직 미배포이고, 이 숫자를
    보는 사람은 이미 앱을 켜 둔 원장 본인이다. **건수와 CSV 뿐 — 금액·추정 수익 없음.**
  - 검증: `scripts/probe-care-report.mjs` — **ALL PASS**. 미검토 게이트(payload 0건 +
    저장 0건 + emptyReason=none-reviewed), 검토 후 1건 릴리스(인용 4건, 00:30–04:22),
    재스캔 멱등, 클라이언트 UPDATE/INSERT/DELETE 403 3종, 두 달치 집계,
    규칙 v1→v2 변경 시 이번 달만 supersede 되고 **지난달 리포트는 바이트 동일**,
    care.* 문자열 48줄 + 새 컴포넌트 2개 금지 문구 0건.
  - 회귀: `probe-care-activities.mjs` ALL PASS. 루트 typecheck+build, admin-web
    typecheck+build, kiosk typecheck+build 전부 통과.
  - 0007 은 **로컬 스택에만 적용**했다. 실제 프로젝트에는 아직이다.

- **B5 완료** (커밋 `5e13ea0`, `ac2ee7c`) — B4 가 남긴 결함 2개.
  - **결함 1: 월 리포트가 조용히 적게 셌다.** 저장이 요약 창 payload 에 묶여
    있어서, 요약 창을 한 번도 열지 않은 진료는 집계에서 통째로 빠졌다.
    이제 `endCurrentSession()` 이 스캔·저장한다. 별도 생명주기를 만들지 않았다
    (진료가 끝나는 지점은 원래 하나다). **await 하지 않고, 예외를 밖으로
    던지지 않고, 아무것도 띄우지 않는다** — 저장은 끼어드는 일이 아니지만
    표시는 끼어드는 일이다. 실패해도 파생물이라 손실이 영구적이지 않다
    (다음 스캔이 같은 결과를 다시 만든다). 멱등성은 0007 RPC 가 그대로 맡는다.
  - **재스캔**(`backfillCareActivities`, 최근 3개월): 검토가 끝나는 순간
    이전 진료에는 후보가 하나도 없다. 새 규칙을 만들지 않고 같은 스캔 + 같은
    RPC 를 돌리므로 대체(supersede) 규칙이 그대로 적용되고 두 번 세지 않는다.
    **자리는 검토 다이얼로그 안**이다 — 검토 상태가 바뀌는 유일한 화면이고,
    진료 수백 건을 훑는 일을 사용자 모르게 시작하지 않기 위해 버튼으로 뒀다.
  - **결함 2: 아무도 검토 완료로 올릴 수 없었다** (service_role SQL 뿐).
    새 마이그레이션 `0008_care_activity_adoptions.sql`.
    - **[HARD] 검토는 전역이 아니다.** 씨드 정의는 모든 계정이 같이 읽는 공용
      템플릿이라, 정의 행의 플래그 하나로 한 사람의 임상 판단이 다른 의원의
      탐지를 켠다. 채택은 (사람, 정의) 쌍에 붙는다.
      `care_activity_defs.clinical_review_status` 의 `'reviewed'` 는 이제
      **아무에게도 아무것도 열어주지 않는다**(우리 쪽 검수 기록으로만 남긴다).
      전역으로 힘이 남는 값은 `'retired'` 하나 — 거두는 것은 전역이어도 되지만
      켜는 것은 전역이면 안 된다. 판정은 `resolveReviewStatus()` 한 곳뿐.
    - 채택은 **검토한 rule_version 에 묶인다.** 규칙이 바뀌면 검토가 자동으로
      풀린다(로더가 이미 쓰던 규칙과 같다). 화면은 `adoptionStale` 로 "규칙이
      바뀌었다"를 "검토 전"과 구분해 말한다.
    - 철회는 `revoked_at` 만 찍고 `reviewed_at`/`reviewed_by` 와 저장된 후보를
      **건드리지 않는다.** 이후 탐지만 멈춘다.
    - 쓰기는 `set_care_activity_adoption()` RPC 하나뿐(authenticated 는
      SELECT + EXECUTE). RPC 가 소유자를 `auth.uid()` 로 다시 뽑고, 화면에서
      읽은 rule_version 과 현재 값이 다르면 거절한다 — 읽지 않은 규칙이
      승인되는 경로를 만들지 않는다. RLS + 명시적 GRANT.
  - **검토 UI 자리: dock 다이얼로그**(`CareActivityReviewDialog.tsx`). 리포트와
    같은 이유 — admin-web 미배포이고 판단하는 사람은 이미 앱을 켜 둔 원장이다.
    **규칙 전문**(단서어·부정어·화자 조건·문턱 3종·규칙 버전)을 접지 않고 전부
    보여준다. 이름과 스위치만 보여주면 무엇을 승인하는지 모르는 채로 승인한다.
  - **`profiles.is_admin` 로 막지 않았다.** 그 플래그는 admin-web(벤더 콘솔)의
    권한 비트다. 그걸로 막으면 우리가 손대기 전에는 어느 의원도 이 기능을 켤 수
    없다. 결정 범위가 이미 결정한 사람 자신의 계정뿐이라 폭발 반경이 맞다.
  - 검증: `scripts/probe-care-review.mjs` — **ALL PASS**. 요약 창 없이 종료한
    진료가 저장·집계됨 / 이후 요약 창을 열어도 행 그대로 / 재스캔 1차
    inserted=1, 2차 inserted=0·unchanged=2 / **A 의 검토가 B 에게 켜지지 않음**
    (B 화면 unreviewed, 저장 0건, 리포트 0건, A 의 채택 행은 RLS 로 읽지도 못함)
    / 클라이언트 직접 INSERT·타인 명의 INSERT·UPDATE·공용 행 승격 4종 403 /
    철회 후 새 진료 저장 0건, 지난 기록·리포트 그대로 / 규칙 변경 시 검토 자동
    해제 / 검토 payload 에 규칙 전문 전부 / 금지 문구 0건.
  - 회귀: `probe-care-activities.mjs` ALL PASS, `probe-care-report.mjs` ALL PASS
    (둘 다 공용 행 승격만으로는 화면에 나가지 않음을 먼저 단언하도록 갱신).
    루트 typecheck+build, admin-web typecheck+build, kiosk typecheck+build 통과.
  - 0008 은 **로컬 스택에만 적용**했다.

### 진행 중: 공개 배포 대비 (L1~)
계획: `tasks/architecture-and-liability.md` (Lam et al., Nature 655:1129-1132 기반 등급 선언).

- **L1 완료** — 키오스크 접근 통제(4장) + 환자 AI 고지(5장) + 하위 경로 배포(1장).
  - **문제**: M6 은 슬러그(`?k=main`)를 "비밀이 아니라 라우팅 키" 로 설계했고 미배포
    상태에서는 타당했다. 공개 주소에 올라가면 주소를 아는 누구나 문진을 시작할 수
    있고, 그 결과는 **실재하는 의사에게 귀속된 `encounters` 행**이 된다 — 의사가 본
    적 없는 사람과 AI 가 나눈 의료 대화가 그 의사 이름으로 대기목록에 쌓인다.
  - 새 마이그레이션 `0009_visit_access_codes.sql` (로컬 스택에만 적용됨).
    RLS + **명시적 GRANT**, 그리고 **`revoke ... from public`** — 아래 참고.
  - **코드 형식: 7자 / 알파벳 26자 `23456789ACDEFGHJKMNPRTVWXY` / 30분 / 1회용.**
    헷갈리는 짝(0/O, 1/I/L, 2/Z, 5/S, 8/B, U/V, O/Q)을 **양쪽 다** 뺐다 —
    한쪽만 남기면 'O'→'0' 같은 보정이 필요해지고, 그 보정은 오타를 조용히 남의
    코드로 바꿀 수 있다. 양쪽을 빼면 잘못 읽은 글자는 거부될 뿐이다.
    표기는 4-3(`A2CD-4EF`). 생성은 `gen_random_bytes()` + 거부표본(모듈로 편향 제거);
    `random()` 은 시드 PRNG 라 몇 개만 보면 나머지가 예측된다.
  - **80억(2^33)을 안전하게 만드는 것은 길이가 아니라 세 겹의 제한**이다:
    (1) 의사당 분당 실패 20회 — **DB 카운터**다. 프로세스에서 세면 서버리스
    인스턴스 수만큼 허용치가 곱해진다. (2) 의사당 미사용 코드 50개 상한 —
    동시 표적 수를 묶는다. (3) 30분 만료.
    → 한 번에 맞을 확률 ≤ 6.2e-9, 연 1.05e7 시도에서 기대 성공 6.5e-5회.
  - **[HARD] 속도 제한은 실패에만 건다.** 처음엔 카운터가 꽉 차면 전부 거절했는데,
    **프로브가 그게 서비스 거부 지렛대임을 잡아냈다** — 30번 틀린 직후 진짜 QR 이
    거절됐다. 이제 매칭을 먼저 하고 맞는 코드는 카운터와 무관하게 통과한다.
    공격자는 전부 실패이므로 제한은 그대로 걸린다.
  - **[HARD] `revoke all on function ... from public`.** Postgres 는 새 함수의
    EXECUTE 를 PUBLIC 에 기본 부여한다. service_role 에 grant 만 하고 revoke 를
    빠뜨려서 **anon(비로그인 브라우저)이 `redeem_visit_access_code()` 를 직접
    불러 아무 의사나 지목할 수 있었다.** 프로브가 HTTP 200 으로 잡았다.
    SECURITY DEFINER 함수라 사소한 실수가 아니다. 0006~0008 의 RPC 들도 같은
    검토가 필요하다(아래 "다음 할 일").
  - **[HARD] 검증 순서**: 본문 → 슬러그 → **코드 소모** → insert → 토큰 → 모델.
    발급되지 않은 접근은 `patients`/`encounters` 행을 만들지 않고 LLM 쿼터도
    쓰지 않는다. 프로브가 4가지 실패 경우마다 0행·0회를 단언한다.
  - **중단 처리**: 코드는 첫 사용에 소모되고 그때 만든 진료에 묶인다. 만료 전이고
    그 진료가 아직 `intake_in_progress` 면 **같은 코드로 재개**된다(최대 3회).
    거절하면 접수처가 재발급하고 한 방문에 진료 행이 둘 생긴다 — 대기목록에 같은
    환자가 두 번 뜨는 쪽이 더 나쁘다. 재개는 아무것도 만들지 않고, 문진이 끝나는
    순간 코드는 영구히 죽는다(replay 차단).
  - 기존 HMAC 세션 토큰은 그대로다. **코드는 "시작"을 막고 토큰은 "세션"을 나른다** —
    두 번째 세션 메커니즘을 만들지 않았다.
  - **발급 자리: dock 의 QR 버튼**(`VisitCodeDialog.tsx`). 스태프 표면이 이 앱뿐이고
    (admin-web 미배포), 설정 팝오버 **안쪽이 아니라 dock 표면**에 둔 이유는 하루에
    수십 번 눌리는 버튼이기 때문이다 — 두 번 클릭이 되는 순간 접수처는 "그냥
    슬러그로 열어두자" 를 고른다. 큰 글씨 코드 + QR(`qrcode-generator`, SVG).
    **키오스크 주소는 설정값**이고 도메인은 코드 어디에도 없다. 주소가 없으면
    QR 을 그리지 않는다(열리지 않는 QR 은 환자 앞에서 실패한다).
    S2 게이트 `visit-code` 추가 — 새 진료를 여는 행위라 잠긴 계정은 발급할 수 없다.
  - **AI 고지(5장)**: `lib/intake/disclosure.ts` 가 서버에서 만들어 내려보낸다.
    동의 항목 **안이 아니라 위에**, 접지 않고 체크박스 없이. 동의문은 체크되지
    읽히지 않고, "약관 전문 보기" 뒤로 접힌 경고는 경고가 아니다.
    세 문장: (1) 상대는 AI 이고 진단이 아니다 (2) 의사가 진료 전에 읽는다
    (3) 응급 증상이면 멈추고 즉시 직원을 부르라 — **AI 판정을 기다리지 말 것**.
    (3)이 가장 중요하다: 키오스크의 red flag 는 대화가 끝나가야 나오는데 그 사이
    환자는 "위험하면 기계가 알려주겠지" 라고 믿고 앉아 있게 된다.
    서버 payload 로 내려보내는 이유는 **화면 캡처 권한이 없어** 프로브가 문자열로
    단언할 수 있어야 하기 때문이다.
  - **하위 경로**: `NEXT_PUBLIC_BASE_PATH`(경로 조각만, 호스트명 없음). 비우면 루트
    배포라 로컬·기존 프로브가 그대로 돈다. Next 가 링크·정적자원·헤더를 접두하지만
    **`fetch()` 는 접두하지 않아서** `lib/basePath.ts` 의 `apiPath()` 를 거친다 —
    빠뜨리면 로컬은 멀쩡하고 배포에서만 문진 시작이 404 가 된다.
  - `GEMINI_API_BASE` 이음매를 열었다. "거절된 접근은 모델을 부르지 않는다" 를
    **세려면** 호출을 셀 수 있는 곳으로 보낼 수 있어야 한다. 운영에서는 미설정.
  - 검증: `scripts/probe-visit-code.mjs` — **ALL PASS**. 실제 kiosk Next 서버(dev +
    base path 를 준 production 빌드) + 로컬 스택 + 호출을 세는 가짜 Gemini.
    8개 절: 무코드·오타·만료·타 의사 코드 4종 각각 거절 + **patients 0행 ·
    encounters 0행 · 모델 0회** / 정상 완주 → intake_done + intake_results /
    귀속(user_id NOT NULL, A 는 보이고 B 는 RLS 로 안 보임) / replay 차단 + 재개
    + 재개 상한 / 속도 제한(DB 카운터, 20 상한, **꽉 찬 동안에도 진짜 코드 통과**) /
    권한 7종(anon 발급·읽기·소모 함수 호출 차단, 로그인 사용자도 소모 함수 불가,
    B 는 A 의 코드 못 읽음, 직접 INSERT 403, 카운터 비공개) / 고지 문구 5줄이
    코드 화면·QR 화면 양쪽 payload 에 존재 + 의사 uuid 미노출 / basePath 빌드가
    그 경로에서 문진 실제 시작 + 루트 404.
  - 회귀: `probe-care-activities` / `probe-care-report` / `probe-care-review` /
    `probe-findings` 전부 ALL PASS. 루트 typecheck+build, admin-web typecheck+build,
    kiosk typecheck+build(루트·하위 경로 둘 다) 통과.
  - 0009 는 **로컬 스택에만 적용**했다.

- **E3 + 결정 감사 추적 완료** — 사실/해석 분리 + 출처 부착(계획서 E3),
  인계 지점 기록(책임 문서 6장), 그리고 L1 이 남긴 PUBLIC EXECUTE 구멍 정리.
  - **0010 (보안 정리)**: `pg_proc.proacl` 을 **살아 있는 카탈로그에서** 감사했다
    (마이그레이션을 읽는 방식은 애초에 이 실수를 만든 방식이다). PUBLIC EXECUTE
    가 남아 있던 함수 10개 — SECURITY DEFINER 3개(`record_care_activity_candidates`,
    `set_care_activity_adoption`, `is_admin`) + 트리거 함수 3개 +
    `normalize_visit_code` 와 visit_code 상수 6개. 앞의 둘은 내부에서
    `auth.uid()` 를 다시 뽑아 anon 호출이 실패하지만 **막힌 이유가 권한이 아니라
    함수가 스스로 확인했기 때문**이었다. 호출자 소유자를 받는 쪽으로 한 줄만
    바뀌면 그 우연은 조용히 사라진다.
    - 개별 revoke 에 더해 `alter default privileges ... revoke execute on
      functions from public` 로 **기본값 자체를 바꿨다** — 다음 마이그레이션이
      revoke 를 잊어도 안전하도록. 그리고 DO 블록 가드가 PUBLIC EXECUTE 가 하나라도
      남으면 마이그레이션을 실패시킨다(한 번 점검한 목록은 썩는다).
  - **0011 (E3)**: 표를 쪼개지 않고 `intake_results` 를 확장했다. 이유 세 가지 —
    (1) `version` + `unique(encounter_id, version)` 가 **이미 대체 구조**이고
    리더들이 이미 최고 버전을 읽는다, (2) `soap_json.transcript` 를 읽는 독립
    소비자가 셋(patientMode / careActivities / 프로브 4종)이고 그중 하나는
    **일부러 형태에 방어적으로 짜인 리더**다, (3) 자기 완결적인 행이라야
    "그날 화면에 있던 것" 을 조인 없이 복원할 수 있다.
    - **사실 경계는 주석이 아니라 강제다.** `rederive_intake_interpretation()`
      은 **사실을 받는 인자가 없다** — 원본 행에서 직접 읽어 쓴다. 재해석하면서
      기록을 고치는 것이 표현 불가능하다.
    - `facts_fingerprint`(transcript + S 의 sha256)는 **BEFORE INSERT 트리거가**
      계산한다. 사실을 쓴 쪽이 지문까지 주장하면 지문은 아무것도 증명하지 않는다.
    - 출처는 `{engine, provider, model, promptVersion, schemaVersion, generatedAt}`
      이고 **실제로 호출한 프로바이더에서 뽑는다**(상수로 적으면 모델을 바꾼 날
      출처만 옛 이름을 계속 말한다).
    - 구버전 행은 `{engine:'unrecorded'}` 라는 **값**으로 온다. undefined 로 두면
      화면이 침묵하고, 침묵한 출처는 있는 출처와 같은 모양이 된다.
      **반쯤 채워진 출처도 미기록으로 떨어뜨린다** — 부분 출처는 추측이다.
    - 실시간(데스크톱) 분석에도 같은 모양을 붙였다(`analyses.interpretation_provenance`).
      `geminiClient` 에 `GEMINI_API_BASE` 이음매를 열었다 — 진짜 analyzer 를
      돌려보지 않으면 "실시간에도 출처가 붙는가" 를 확인할 방법이 없다.
  - **0012 (결정 감사 추적)**: 기록하는 이벤트 6종과 **각각이 증명하지 않는 것**을
    마이그레이션 주석에 명시했다. `interpretation_presented`(무엇을 보여줬는가 +
    그 순간의 출처를 **복사해서** 얼림 — 조인이면 재해석이 과거를 소급해 바꾼다) /
    `patient_detail_opened`(가장 이른 행 = 상세를 처음 연 시각) /
    `differential_expanded` / `evidence_requested`(독립 확인을 구한 신호 —
    "맹목적 의존이 아니었다" 에 가장 가깝다) / `finding_source_opened` /
    `summary_generated`.
    - **[HARD] 추론하지 않기로 한 것**: 채택/무시/수정 라벨 없음(앱은 의사가 내린
      진단을 받지 않는다 — 특히 "이벤트가 없었으니 무시했다" 는 책임 기록 안에
      법원이 기댈 주장을 우리가 지어 넣는 것이다). 체류 시간·스크롤·포커스·
      마우스 없음(창이 앞에 있는 것은 주의가 아니다). **횟수 없음** — dedupe 키와
      부분 유니크 인덱스가 (진료, 종류, 키)당 한 줄만 남겨서 이 표는 "몇 번" 에
      **답할 수 없다**. 반복 횟수는 의사를 향한 지표다.
    - **append-only 3겹**: anon/authenticated 에 쓰기 권한 없음 → RLS 는 자기 행
      SELECT 만 → 트리거가 UPDATE/DELETE 를 **service_role 과 슈퍼유저까지** 거부.
      운영자가 고칠 수 있는 감사 기록은 감사 기록이 아니다. 법적 삭제만
      `rd.audit_erasure` GUC 로 열어뒀고 PostgREST 클라이언트는 그것을 세울 수 없다.
    - 기록은 **await 하지 않고 던지지 않고 아무것도 띄우지 않는다**(B5 규칙).
  - 검증: `scripts/probe-provenance.mjs` — **ALL PASS**. 실제 kiosk Next 서버 +
    방문 코드 → 문진 완주, 키오스크와 데스크톱이 **같은 가짜 Gemini** 를 쓰고
    진짜 `analyzer` 를 한 번 돌린다. 9개 절: 키오스크 출처 6필드 + DB 계산 지문 /
    거짓 지문 INSERT 를 트리거가 덮어씀 / 실시간 출처가 키 집합까지 동일 /
    재해석 시 원본 soap·differentials **바이트 동일** + 대체 표시 + 지문 동일 +
    해석만 변경 + 이미 대체된 행 재대체 거부 + 출처 없는 재해석 거부 /
    구버전 행이 여전히 렌더(감별진단·근거 인용·요약 전부) + 반쯤 찬 출처는 미기록 /
    이벤트 6종 기록 + 보여준 내용·출처·지문이 얼어붙음 + 처음 연 시각 조회 +
    dedupe(3번 펼쳐도 1줄) + 재열람은 별개 줄 + 금지 컬럼/키 0건 /
    클라이언트·service_role·DB 직결 UPDATE·DELETE 전부 거부 + 삭제 탈출구는 동작 /
    anon 이 새 RPC 6종 전부 거부 + 로그인 사용자도 재해석 RPC 불가 +
    **PUBLIC EXECUTE 0건** / RLS 로 A↔B 격리 + B 가 A 진료에 기록 불가 +
    타 진료 해석을 보여줬다고 기록 불가.
  - 회귀: `probe-findings` / `probe-care-activities` / `probe-care-report` /
    `probe-care-review` / `probe-visit-code` 전부 ALL PASS.
    루트 typecheck+build, kiosk typecheck+build, admin-web typecheck+build 통과.
  - 0010/0011/0012 는 **로컬 스택에만 적용**했다.

## 미해결 실패

- **GUI 육안 검증 미완료.** 이 머신은 화면 캡처·합성 키 입력 권한이 없어
  Cmd+7 오버레이 렌더링, 환자 클릭 시 창 주입, 진단 카드 근거 섹션 표시를
  화면으로 확인하지 못했다. 데이터 계층·매퍼·PubMed 는 실제 코드로 검증됨.
- **포트원 라이브 호출 미검증 (S3).** 콘솔 자격증명이 없어 실제 발급/결제/예약을 한 번도
  태우지 못했다. 목 서버의 응답 형태는 문서 기준이며, 특히 빌링키 조회 응답의
  `methods[].card` 필드명과 `issueId` 포함 여부는 실제 응답으로 한 번 확인해야 한다
  (틀리면 카드 표시가 비고, 검증 로직이 아니라 화면만 영향받는다).
- **결제 화면 육안 검증 미완료 (S3).** 화면 캡처 권한이 없어 `/billing` 렌더링을 눈으로
  확인하지 못했다. 라우트·DB 반영은 실제 서버로 검증됨.
- **실제 Supabase 프로젝트 접근 불가.** `yqdzxitlmtawznzwpkra` 가 현재 로그인 계정에
  안 잡힌다. 0001/0002 마이그레이션이 로컬 스택에만 적용돼 있다.
- ~~0006~0008 의 RPC 에 `revoke ... from public` 이 없다~~ → 0010 에서 **부분** 해결.
  → **0013 에서 완결.** 0010 은 틀린 게 아니라 절반이었다. `revoke ... from public` 은
  ACL 에서 **권한부여자가 빈** 항목(`=X/postgres`)만 지운다. Supabase 는 별도로
  `alter default privileges ... grant execute on functions to anon, authenticated` 를
  깔아두므로 새 함수마다 **이름이 붙은** 항목(`anon=X/postgres`)이 생기고, 이건 PUBLIC
  항목이 아니라서 0010 의 revoke 가 하나도 건드리지 못했다. 운영 프로젝트
  (`yhwvwojjwwlcrvpfxgag`) 실사 결과 public 의 **모든 함수**를 anon/authenticated 가
  EXECUTE 로 들고 있었다 — 0009 가 지키려고 만든 `redeem_visit_access_code` 포함.
  [HARD] 0010 의 가드는 `acl like '=%'` 에 앵커돼 있어 이 부류를 **원리상 볼 수 없고**,
  구멍이 열린 채로 통과했다. 0013 이 허용목록(`public.role_privilege_allowlist`) 기반
  가드로 대체했고, 프로브가 진짜 구멍을 뚫어 가드가 울리는 것까지 확인한다.
- **[HARD] 0013 은 운영에 아직 적용되지 않았다.** 로컬 통과는 "마이그레이션이 적용된다"만
  증명한다 — 로컬 스택의 `pg_default_acl` 은 운영과 달라서(로컬 함수 기본값에는
  anon/authenticated 가 없다) 결함 자체를 재현하지 못한다. 적용 후 반드시
  `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/audit/named-role-privileges.sql`
  를 운영에 돌려 PART 1/C 가 0행인지 확인할 것.
- **`supabase_admin` 의 기본 권한은 닫지 못했다.** `pg_default_acl` 에서
  (supabase_admin, public, functions/tables) 는 여전히 anon/authenticated 를 준다.
  `postgres` 는 supabase_admin 의 멤버가 아니라 `alter default privileges for role
  supabase_admin` 이 애초에 실패한다. 이 레포는 supabase_admin 으로 객체를 만들지
  않으므로 실사용 경로는 없지만, 대시보드에서 손으로 만든 객체는 열린 채 태어날 수 있다.
  → 감사 스크립트의 PART 1/A 가 이걸 매번 보여주고, PART 1/C 가 결과를 잡는다.
- **RLS 미적용 (기존 테이블).** sessions/transcript_chunks/analyses 등은 여전히 RLS off 이고
  anon 키가 커밋돼 있다. 구독 게이트는 이를 우회하도록 설계했지만(서버 판정) 근본 정리는 남아 있다.

## 배포 전 반드시 확인할 것

- 0001 은 **GRANT 포함 버전**을 써야 한다. GRANT 없이 RLS 만 켜면 전 테이블이 조용히 막힌다.
- `supabase/migrations/00000000000000_local_only_legacy_baseline.sql` 는 로컬 테스트 픽스처다.
  **커밋·배포 금지.** (레포에 기존 sessions 테이블의 마이그레이션이 없어서 만든 것.)
- 0002 의 백필은 **기존 유저 전원을 1년 comped `active` 로 만든다.** 의도된 동작이지만
  실제 프로젝트 적용 전에 사업적으로 한 번 확인할 것.
- 0005 의 `devices` 는 `create table if not exists` 다. 실제 프로젝트에는 이 테이블이
  **손으로 만들어져 이미 있으므로** CREATE 는 건너뛰고 RLS/GRANT/정책만 적용된다.
  그 결과 **적용 즉시 클라이언트의 devices 쓰기가 끊긴다** — 구버전 앱을 쓰는 기기는
  기기 등록·하트비트가 조용히 실패한다(사용성은 막히지 않게 fail-open 으로 짜뒀지만,
  원격 해지가 그 기기에 먹지 않는다). 0005 적용과 앱 배포는 같이 나가야 한다.
  `revoked_at` 은 별도 ALTER 로 추가하지만(없으면 해지가 런타임에 실패한다), 나머지
  컬럼 구성이 다를 수 있으므로 적용 전에 실제 스키마를 한 번 대조할 것.

## 다음 할 일

- **[막힘] B 파트에 필요한 도메인 입력.** B1 의 정의는 규칙 구조를 증명하기 위한
  자리표시자이고, 임상 검토를 못 받으면 **한 건도 화면에 뜨지 않는다**(설계상 그렇다).
  사용자에게 받아야 할 것, 우선순위 순:
  1. **대상 진료과 1개.** 새는 항목과 대화 양상이 과마다 다르다. 정의는 과 단위로 쓴다.
  2. **그 과에서 실제로 자주 새는 행위 3~5개.** "청구 항목"이 아니라 "진료실에서
     실제로 하는데 기록이 빠지는 행위"로 말해주면 된다.
  3. **각 행위를 할 때 실제로 쓰는 말.** 단서어가 곧 재현율이다. 지금 씨드된 낱말은
     추측이라 실제 진료실 어휘와 다르면 대부분 놓친다.
  4. **삭감 위험이 큰 행위.** 아예 정의에서 빼거나 `enabled=false` 로 둔다.
  5. **누가 이 화면을 보는가** (원장/원무과/청구 대행). B3 의 배치와 문구가 달라진다.
  6. **씨드 5종의 임상 검토.** 검토자가 확인해줘야 `reviewed` 로 올릴 수 있다.
- **키오스크 공개 배포를 막고 있는 것** (L1 이후):
  1. **도메인 미구매.** `entanglecare.com` 이 없으면 배포 주소도 QR 도 확정되지
     않는다. 코드에는 도메인이 없으므로 구매 후 설정값만 채우면 된다.
  2. **0009 를 실제 프로젝트에 적용.** 0006/0007/0008 과 함께.
  3. **발급 화면 육안 검증 미완료** — 캡처 권한이 없어 dock QR 다이얼로그의
     코드 크기·QR 렌더링을 눈으로 못 봤다. QR 인코딩과 URL 조립은 코드로
     검증됐지만, **실제 카메라로 찍어본 적은 없다.** 배포 전 반드시 한 번.
  4. **접수처 운영 절차가 없다.** "코드를 언제 발급하고 누가 읽어주는가" 는
     제품이 아니라 절차다. 파일럿 의원과 합의해야 한다.
  5. **대기목록 진입 전 접수처 확인 단계**(4장 마지막 줄)는 만들지 않았다.
     코드가 이미 "접수처를 거쳤다" 를 보장하므로 지금은 중복이라고 판단했다.
     파일럿에서 오등록이 관측되면 다시 본다.
  6. ~~E3 + 결정 감사 추적(6장)~~ → 완료. 다만 **추적을 열람할 화면이 없다**
     (범위 밖으로 둔 것이다 — 기록이 먼저다).
- **[막힘] 실제 의원에서 쓰이려면 남은 것** (B5 이후):
  1. **씨드 5종의 임상 검토 내용 자체.** 경로는 B5 로 생겼지만(dock 검토
     다이얼로그), 지금 씨드된 단서어는 우리가 추측으로 쓴 것이다. 원장이
     그 규칙을 읽고 승인할 만한 물건인지가 아직 확인되지 않았다 — 규칙이
     현장 어휘와 다르면 승인해도 대부분 놓친다.
  2. **실제 진료실 어휘.** 단서어가 곧 재현율이다. 여전히 추측이다.
  3. 0006/0007/0008 을 실제 Supabase 프로젝트에 적용.
  4. 요약 창의 목록은 **수동 새로고침이 없다** — 창을 열 때 한 번 조회한다.
     녹취가 이어지는 동안 갱신하려면 재조회 트리거가 필요하다.
  5. 재스캔은 **최근 3개월·최대 200건** 고정이고 진행률 표시가 없다. 건수가
     많은 의원에서는 다이얼로그가 응답 없이 오래 도는 것처럼 보인다.
  6. 육안 검증 미완료(캡처 권한 없음) — 요약 창 섹션, 리포트·검토 다이얼로그
     렌더링.
- **S6**: 포트원 테스트 채널로 전 경로 라이브 검증. S5 가 S6 으로 넘긴 것들:
  - 예약 취소 API 의 실제 규격 확인. `DELETE /payment-schedules?requestBody={json}` 는
    `@portone/server-sdk` 의 구현을 그대로 따라 만들었지만 라이브로 태운 적이 없다.
    특히 **이미 실행된 예약을 취소하려 할 때의 에러 코드**와, 취소된 예약의
    scheduleId 로 같은 paymentId 를 재예약할 수 있는지(해지 취소 경로)를 봐야 한다.
    목에서는 재예약이 되지만 실제 포트원은 paymentId 를 영구 점유할 수 있다.
  - 재시도 예약의 `timeToPay = now+5분` 이 실제로 받아들여지는지. 포트원이 최소
    리드타임을 요구하면 그 값에 맞춰야 한다.
  - 결제 실패 이벤트의 `failure.pgCode` 실제 값. 카드 만료/한도 초과/정지를
    구분해 안내 문구를 나누려면 실제 코드가 필요하다(지금은 전부 같은 문구).
- **dunning 안내 발송(이메일)은 구현하지 않았다.** 계획서 4장의 "앱 배너 + 이메일"
  중 앱 배너는 S2 의 `sub.bannerPastDue` 로 이미 뜨지만, 이메일 발송 경로가 이
  프로젝트에 아직 없다(SMTP/발송 서비스 미정). 상태와 마감 시각은 전부 DB 에 정확히
  남아 있으므로 발송기를 붙이는 것은 독립적인 작업이다.
- `BILLING_PORTAL_URL` 의 도메인은 여전히 자리표시자
  (`https://admin.realtime-doctor.app/billing`)다. 경로 `/billing` 은 이제 실재한다 —
  admin-web 을 배포한 뒤 도메인만 바꾼다.
- 포트원 콘솔 값 3개(storeId / channelKey / V2 API Secret)를 받으면 테스트 채널로
  실제 발급·결제를 한 번 태워본다. 지금까지의 검증은 전부 목 서버 기준이다.
- 배포 전: `supabase secrets set ENTITLEMENT_PRIVATE_KEY=...` 로 운영용 키를 새로 발급하고,
  그 공개키를 앱 `ENTITLEMENT_PUBLIC_KEY` 에 넣는다. 지금 코드에 박힌 공개키는 로컬 개발용이다.
- GUI 육안 검증
- 실제 Supabase 프로젝트에 0001/0002 적용

## 배포 현황 (2026-08-04)

- **새 Supabase 프로젝트**: `yhwvwojjwwlcrvpfxgag` (realtime-doctor, ap-northeast-2).
  구 프로젝트 `yqdzxitlmtawznzwpkra` 는 다른 계정 소유라 접근 불가 — 폐기.
  `righthand-previsit` 은 사용자 승인 하에 삭제 예정 (백업: ~/Desktop/righthand-previsit-backup-20260804.json, PHI 포함).
- 마이그레이션 0000~0005 전부 적용 완료. Edge Function `entitlement`/`device` 배포 완료.
- entitlement 운영 서명 키쌍 신규 발급. 개인키는 Supabase function secret 에만,
  공개키는 .env `ENTITLEMENT_PUBLIC_KEY`. 로컬 개발용 키는 더 이상 쓰지 않는다.
- 프로덕션 스모크 테스트 통과: 가입 → 트리거가 7일 체험 생성 → entitlement 서명 토큰 반환.
- 버전 0.6.0.
- **Windows**: `win-build/v0.6.0/Realtime Doctor Setup 0.6.0.exe` (86,390,975 bytes).
  미러 `mole-bi-com/realtime-doctor-winbuild` run 30850827147. CI 에서 16키 임베딩 검증 통과.
- **데모 계정 발급 (2026-08-05)**: `demo.friend@righthand-demo.com` / 비밀번호는 사용자에게 전달됨.
  user_id `a79fdc6c-f356-413a-b08d-206dd7e3bfeb`. 공개 `/auth/v1/signup` 경로로 가입 →
  트리거가 standard 7일 체험 생성(`trial_ends_at` 2026-08-12). is_admin=false, 기기 2대 한도.
  체험 만료 후에는 잠기므로 계속 쓰려면 `subscriptions.trial_ends_at` 연장 필요.
- **PG 심사용 계정 발급 (2026-08-07)**: `pg-review@entanglecare.com`.
  user_id `25070b96-b890-4f52-b5d8-d997a521c34f`. 이메일 확인됨, 비밀번호 로그인 200 실측.
  standard 7일 체험(`trial_ends_at` 2026-08-14), is_admin=false. 심사가 길어지면 만료 전에
  `trial_ends_at` 연장 필요 — 만료되면 기능이 잠겨 심사자가 빈 화면을 보게 된다.
  환자 데모 데이터도 이 계정에 복제해 넣었다(2026-08-07): `demo.friend` 소유 행을
  `insert ... select` 로 복제하되 **새 id = 기존 id의 첫 hex 자리를 `a` 로 치환**
  (`('a' || substr(id::text,2))::uuid`) — 부모/자식 매핑이 그대로 보존되고 재실행해도
  무동작이다. 두 계정의 행 수가 동일함을 확인했고(환자 4/방문 4/레드플래그 1/문진 4/
  세션 1/전사 6/요약 1/분석 1/구술 1), 소유자 교차 참조 0건을 6개 조인으로 검증했다.
  `facts_fingerprint` 는 복사하지 않고 0011 트리거가 재계산하게 뒀다(4행 전부 채워짐).
- **데모 환자 데이터 시드 (2026-08-05)**: `scripts/seed-demo.sql`(신규, 멱등 — 고정 UUID +
  `on conflict do nothing`, 파일 하단에 주석 처리된 정리 블록). 위 데모 계정 소유로 원격
  프로젝트에 적용 완료: 환자 4(김데모/이시연/박준호/최영자) + encounters 4
  (`intake_done` 2 — 김데모 red_flag, `in_consult` 1, `completed` 1) + intake_results 4
  (키오스크 `soapJsonSchema` 형태, transcript 6턴, 0011 트리거가 facts_fingerprint 채움 —
  4행 전부 확인) + 박준호 방문에 sessions 1/transcript_chunks 6/summaries 1/analyses 1/
  dictations 1. `differentials_json[].supporting_findings[].source`의 `#N`은 실제 환자
  발화 인덱스를 가리키게 맞췄다(어긋나면 감별진단 창이 "근거 미확인"으로 떨어뜨림).
  전부 합성 데이터이며 PHI 없음. RLS 때문에 일반 authenticated 세션으로는 안 들어간다 —
  service_role 또는 SQL 에디터로 실행할 것.

## 키오스크 공개 배포 (2026-08-06)

- **Vercel 프로젝트 `righthand-patient`** (팀 `mole-bi-coms-projects`, Root Directory `kiosk`).
  배포 주소: <https://righthand-patient.vercel.app> — 앱은 `/righthand/patient` 하위 경로에서
  서비스된다. 루트(`/`)와 루트 API 는 404 다(basePath 가 걸려 있으므로 정상).
- 프로덕션 환경변수(이름만): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KIOSK_TOKEN_SECRET`
  (신규 생성), `KIOSK_CLINICIANS`(`main` → `fc0e40fe-…`, entanglecare@gmail.com),
  `GEMINI_API_KEY`, `NEXT_PUBLIC_BASE_PATH=/righthand/patient`.
  `NEXT_PUBLIC_BASE_PATH` 는 **빌드 타임에 번들로 들어간다** — 값을 바꾸면 반드시 재배포.
- DB 는 `yhwvwojjwwlcrvpfxgag` 하나다(`tasks/domain-structure.md` 의 결정).
  0009~0013 이 이미 적용돼 있어 방문 코드 RPC 가 운영에서 동작하는 것을 확인했다.
- 검증: `kiosk/scripts/probe-production.mjs` — **ALL PASS**(실제 배포 + 실제 DB + 실제 Gemini).
  하위 경로 서비스·루트 404·번들이 base path 보유 / AI 고지 5문장 / 무코드·오타 코드 거절 시
  patients 0행·encounters 0행 / 진짜 코드로 완주 → `intake_done` + 귀속 + 동의 3종 +
  `soap_json.transcript`(9턴)·`follow_up_questions`·`medical_terms` + 감별진단 3건 전부
  `name_en` 과 `supporting_findings` 보유 / replay 차단.
  **프로브가 만든 행은 전부 삭제했다** — 담당 의사 앞으로 남은 patients/encounters/
  visit_access_codes/attempts 는 0행이다.
- **모델 호출 0회 단언은 배포에서 못 센다.** 호출을 셀 이음매(`GEMINI_API_BASE`)가
  운영에는 없다. 그 단언은 `scripts/probe-visit-code.mjs`(로컬)가 갖고 있고, 배포에서는
  "거절 뒤 행이 늘지 않았다"로만 확인했다(코드 게이트가 insert 와 모델 호출 **둘 다**
  앞에 있으므로 같은 return 이 둘을 함께 막는다).
- 남은 것: `righthand_voice` 앱에 `/righthand/patient` rewrite 추가 (다른 세션 담당),
  QR/키오스크 주소 설정값을 배포 주소로 지정, 접수처 운영 절차.

## doctor-web 별도 배포 (2026-08-06) — 도메인 전환 직전까지

- **Vercel 프로젝트 `doctor-web`** (팀 `mole-bi-coms-projects`, Root Directory `doctor-web`,
  리전 `icn1`). 배포 주소: <https://doctor-web-cyan.vercel.app>.
  **`entanglecare.com` 은 아직 `app` 프로젝트가 갖고 있다 — 전환은 하지 않았다.**
- **git 연결 성공.** `backup`(`mole-bi-com/realtime-doctor`, private) 에 붙였고
  production branch = `history/v0.6.0-split`. 푸시하면 자동 배포된다.
  (`vercel git connect` → `PATCH /v1/projects/{id}/branch`. `PATCH /v9/projects/{id}` 은
  `link`/`gitRepository` 필드를 거부한다.)
- 프로덕션 환경변수는 **셋뿐**(이름만): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. 신규 프로젝트라
  구 `app` 이 들고 있는 죽은 변수(`GEMINI_*`/`CLOVA_*`/`PUBDATA_*`/`INTAKE_TOKEN_SECRET`
  등)는 애초에 들어오지 않았다.
- **0014 는 운영에 이미 적용돼 있다** (`f_web_stats_*` 4종 + `web_stats_export_audit` 실재).
  살아 있는 카탈로그로 권한 실사: 네 함수의 ACL 은 `authenticated`/`postgres`/`service_role`
  뿐이고 **`anon` 도 PUBLIC(grantee=0) 도 없다.** 0013 의 가드 술어를 `public` 전체에
  SELECT 로 돌려 **0행**. 실측으로도 anon 키 RPC 4종이 전부 `42501 permission denied`
  (함수 내부 `auth.uid()` 검사가 아니라 **권한 계층**에서 막힌다). 후속 마이그레이션 불필요.
- **`/righthand/patient` 는 이제 doctor-web 이 rewrite 로 키오스크에 넘긴다**
  (`next.config.ts`, `beforeFiles`). 경로를 **벗기지 않는다** — 키오스크가
  `NEXT_PUBLIC_BASE_PATH=/righthand/patient` 로 빌드돼 있어 `/` 로 넘기면 404 다.
  검증: 랜딩·`/intake?k=main`·정적 청크가 키오스크 직접 주소와 **sha256 바이트 동일**,
  `/righthand/patient/api/intake/code/check` 가 실제 DB 판정 문구로 400.
- [HARD] **루트 `.vercelignore` 가 doctor-web 첫 빌드를 통째로 망가뜨렸다.** admin-web CLI
  배포용으로 쓰인 패턴들이 앵커되어 있지 않아 `src` 가 `doctor-web/src` 까지 지웠고,
  `/404` 한 장짜리 앱이 배포됐다(모든 경로 404인데 `next.config` 리다이렉트만 살아 있어
  라우팅 문제처럼 보였다). `package-lock.json` 도 같이 사라졌다. 루트 전용 패턴을 `/` 로
  앵커해 고쳤다(커밋 `93b3b58`). **이 파일은 모노레포의 모든 Vercel 프로젝트가 공유한다.**
- 배포 검증(HTTP): `/` 200(Entanglecare 홈), `/righthand` 200, `/righthand/doctor` 307→login,
  `/righthand/doctor/login` 200, `/righthand/doctor/statistics` 307→login,
  `/righthand/patient` 200(키오스크), `/intake` 308→`/righthand/patient`→200,
  `/dashboard` 308→`/righthand/doctor`.
- **통계 화면이 DB 에 실제로 닿는다**: 임시 계정을 만들어 Supabase 세션 쿠키로
  배포된 `/api/dashboard/statistics` 를 호출 → **200 + 집계 JSON**. 프로브 계정은 삭제했고
  고아 profiles/subscriptions 0행, `web_stats_export_audit` 0행.
- 남은 것: **도메인 전환**(`entanglecare.com` 을 `app` → `doctor-web`). 롤백을 위해
  `app` 프로젝트는 손대지 않았다.

## 스테이징 환경 (2026-08-07) — 운영 문서는 `STAGING.md`

배경: 지금까지 마이그레이션과 Edge Function 배포가 전부 운영 DB 로 곧바로 나갔다.
매번 검증했고 되돌릴 방법이 있었지만 그건 주의력이지 안전장치가 아니다.

- **새 Supabase 프로젝트 `ywsdxnpilcesudtyrewt`** (`realtime-doctor-staging`,
  ap-northeast-2). 도구: `scripts/staging/db.mjs` (apply / fingerprint / audit / inventory).
- **`0000`~`0017` 18개 전부를 빈 프로젝트에 처음부터 적용해 성공했다.** 마이그레이션
  이력이 데이터베이스를 무에서 재구성할 수 있다는 첫 실증이다. `db push` 는 쓰지 않는다
  (운영 원격 이력이 타임스탬프 version 이라 파일 번호와 안 맞는다 — A1 기록 참고).
  스테이징의 이력표는 처음부터 파일 번호(`0000`…`0017`)로 맞춰 뒀다.
- **[HARD] 첫 시도는 실패했다.** 프로젝트가 `ACTIVE_HEALTHY` 를 보고한 뒤에도 storage
  서비스의 자체 마이그레이션이 아직 안 끝나 `storage.buckets` 가 없었고, `0000` 이
  거기 INSERT 한다. Management API query 엔드포인트가 **한 트랜잭션**으로 돌려서
  public 테이블 0개로 깨끗이 롤백됐고, 잠시 뒤 재실행하니 전부 통과했다.
  마이그레이션 결함이 아니라 프로비저닝 경합이다.
- **구조 지문 diff = 0줄.** 1225줄(컬럼·테이블+RLS·함수+SECURITY DEFINER·정책·인덱스·
  제약·트리거(public+auth)·테이블/함수 GRANT·확장·시퀀스·enum·`pg_default_acl`)이
  운영과 md5 까지 동일하다. **운영 스키마는 마이그레이션 파일에서 벗어나 있지 않다.**
- **권한 감사 PASS** (0013 verdict, 살아 있는 카탈로그 기준). 감사가 진짜 구멍을 본다는
  것은 스테이징에 일부러 `grant select on ops_probe_runs to anon` 을 넣어 verdict 가
  FAIL 로 뒤집히는 것까지 확인했다(revoke 후 다시 PASS).
- **Edge Function 4종 배포** (`entitlement`/`device`/`ai-gemini`/`ai-realtime`, 전부
  ACTIVE + `verify_jwt=true`). 헬스체크 4개 전부 ok.
- **[HARD] entitlement 서명 키쌍은 스테이징 전용으로 새로 발급했다.** 스테이징이 운영
  앱이 받아들이는 토큰을 찍을 수 있으면 환경 분리가 없는 것과 같다. 합성 계정으로
  실제 토큰을 받아 검증: 스테이징 공개키로 통과, **운영 공개키로 실패**. 공개키는
  `STAGING.md` 에 적어 뒀다. 공급자 키(Gemini/OpenAI)는 같은 값을 쓴다.
- **Vercel preview 를 스테이징에 배선했다.** `doctor-web` 의 Production 4개는 손대지
  않고 Preview 스코프에 4개를 새로 넣었다. 별도 Vercel 프로젝트를 만들지 않은 이유:
  rewrite·리전·루트 `.vercelignore` 가 두 벌이 되면 리허설이 실물과 다른 것을 검증한다.
  검증: `rehearsal/staging-preview` 푸시 → preview 자동 빌드 → **빌드된 클라이언트 번들
  11개에 스테이징 ref 1건 / 운영 ref 0건**, 운영 번들은 정확히 그 거울상.
  preview `/api/health` 의 `prober.everRan=false`(운영은 true)도 서로 다른 DB 라는 신호다.
- 운영 경로 무영향 확인: `entanglecare.com` 의 `/` 200, `/righthand` 200,
  `/righthand/patient` 200(키오스크), `/righthand/doctor/download` 307, `/api/health` 200.
- **미러하지 않는 것**: 실제 PHI, PortOne 자격증명, `app-releases` 버킷, 커스텀 도메인,
  Vercel Cron, `OPS_ALERT_WEBHOOK_URL`, 키오스크 preview. 각각의 이유는 `STAGING.md`.
- **남은 것**: 스테이징의 legacy JWT API 키(anon/service_role)가 이 세션의 터미널
  출력에 노출됐다. 스테이징에는 PHI 가 없고 RLS 가 전 테이블에 켜져 있지만,
  대시보드 Settings > API Keys 에서 legacy 키를 비활성화하는 것을 권한다
  (Management API 로 끄려다 도구 권한에 막혔다). 끄면 Vercel Preview 의
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` 를 새 형식
  (`sb_publishable_` / `sb_secret_`) 으로 바꿔야 한다.

## 알려진 문제

- [해결됨] Email > Confirm email: 2026-08-05 signup 이 세션을 즉시 반환하는 것을 확인 —
  현재 꺼져 있다. (아래 원 기록은 이력으로 남김)
- [HARD] **Supabase 대시보드에서 Email > Confirm email 을 꺼야 한다.**
  앱의 가입 로직은 signUp 직후 signInWithPassword 를 호출하므로, 켜져 있으면 신규 가입자가
  로그인할 수 없다. 2026-08-04 기준 아직 켜져 있음.
- **로컬 맥 빌드는 ~/.zshrc 의 OPENAI_API_KEY 를 굽는다.** dotenv 가 기존 process.env 를
  덮어쓰지 않기 때문. 검증 스크립트(`scripts/ci-assert-embedded.mjs`)가 잡아낸다.
  근본 수정은 electron.vite.config.ts 의 loadDotenv 에 `override: true`.
  당장은 .env 값을 환경에 주입해 빌드하는 것으로 우회한다.
- 로컬 브랜치 `winbuild/v0.6.0` 에는 시크릿 주입 워크플로가 있다. **공개 저장소로 푸시 금지.**

## 창 스냅 (2026-08-05)

- `src/main/windowSnap.ts` — 가장자리 근접 시 흡착, 붙은 창은 클러스터로 함께 이동.
- **우선순위(2026-08-06 재정의)**: 커서가 상대 창 rect 안 → 탭 머지, 아니면 → 스냅.
  기준은 "겹침 여부"가 아니라 **커서 위치**다. 스냅은 겹침을 허용한다:
  바깥 48px(ENGAGE_PX) ~ 안쪽 96px(PENETRATE_PX) 밴드, 공유 변 40px 이상.
- **실사용 실패 두 건 수정 (2026-08-06)**:
  1. 사각지대 — 이웃 안으로 살짝 밀어 넣는 자연스러운 동작에서 스냅(겹침이라 거부)도
     머지(커서가 상대 밖이라 거부)도 발동하지 않았다. 회귀 프로브 `scripts/probe-snap-overlap.mjs`.
  2. **macOS 에서 스냅·머지가 아예 발동 불가였다** — 'moved' 가 "드래그 끝에 한 번"이
     아니라 **이동마다** 온다(실측). 그 신호로 즉시 finishDrag 를 해서 move 카운트가
     DRAG_MOVE_THRESHOLD(4)에 영영 닿지 못했다. 이제 'move'/'moved' 모두 "아직 움직이는 중"
     으로만 쓰고 조용해질 때(스냅 320ms / 머지 250ms) 한 번 판정한다. 플랫폼 분기 제거.
     이 결함은 가짜 창 프로브가 'moved' 를 1회만 쏘는 바람에 가려져 있었다.
- 진단 로그(옵트인): `RD_SNAP_DEBUG=1 npm run dev` → `/tmp/dev.log` 에 드랍마다 후보별
  gap·공유 변·탈락 사유·최종 결정이 남는다. (`RD_SNAP_DEBUG_LOG` 로 경로 변경)
- 실제 Electron 검증: `npx electron scripts/probe-snap-electron.mjs --user-data-dir=$(mktemp -d)`
  — 진짜 이벤트 열을 태운다. 프로브와 현실이 갈라졌던 지점이 바로 여기다.
- 분리는 **명시적 동작**이다: `Control+Alt+D` 또는 타이틀바 Unlink 버튼(클러스터 소속일 때만 표시).
  거리로 분리를 판정하던 초기 구현은 클러스터를 한 번에 96px 밖에 못 옮기게 만들어 폐기했다.
- 사슬 A-B-C 에서 가운데를 빼면 사슬이 끊긴다 — 남은 둘 사이엔 실제로 빈 공간이 있고,
  이어두면 떨어진 창이 보이지 않는 이유로 함께 움직인다.
- 크기는 강제로 맞추지 않는다 (dock 130 vs diagnosis 460 은 의도된 값).

## 시작 시 배치 복원 (기존 결함 수정)

- 시작할 때마다 `applyLayout` 이 무조건 돌아 저장된 창 위치를 덮어쓰고 있었다.
  창 위치·크기 저장이 재시작 시점에 통째로 무력화되던 기존 결함이다 (M5 의 크기 단축키 포함).
- 이제 저장된 위치가 하나도 없을 때만 프리셋을 적용한다. 명시적 레이아웃 적용은 그대로 동작.
- `applyLayout` 이 적용한 좌표를 직접 `saveBounds` 한다 — 프로그램적 `setBounds` 는 `moved` 를
  쏘지 않아서, 이게 없으면 UI 에서 고른 레이아웃이 다음 실행에 사라진다.
- 화면 밖 좌표는 `clampBoundsToDisplays()` 가 되돌린다 (가로·세로 80px 이상 보이면 유지).

## 미해결 — 육안 검증

- 스냅·분리 버튼·감사 추적 IPC 배선은 **화면으로 확인하지 못했다.** 이 머신에 화면 기록 권한이
  없다. 전부 bounds 숫자와 관계 그래프로만 검증됐다.
- 타이틀바가 이미 좁은데 Unlink 아이콘이 하나 더 붙었다 — 좁은 창에서 제목이 더 잘릴 수 있다.

## 창 스냅 — 실기 디버깅에서 드러난 것들 (2026-08-06)

프로브는 통과하는데 실제 앱에서는 동작하지 않았다. 진단 로그(`RD_SNAP_DEBUG=1`)를
붙이고 사용자가 직접 끌어본 기록을 읽어가며 네 번에 걸쳐 고쳤다.

1. **macOS `moved` 는 드래그 끝에 한 번이 아니라 이동마다 온다.** 그 신호로 즉시 드랍
   판정을 하니 매 스텝마다 드래그가 리셋되어 최소 이동 횟수에 영영 닿지 못했다.
   **macOS 에서 스냅은 한 번도 발동한 적이 없었고, 같은 코드 구조인 탭 병합도 죽어 있었다.**
2. **데드존**: 스냅은 겹치지 않은 0~24px 틈에서만 걸리고, 탭 병합은 커서가 상대 창 안에
   있어야 했다. 사람이 창을 붙일 때 하는 동작(이웃 쪽으로 밀어넣기)이 그 사이에 떨어졌다.
   → 겹침 허용(96px 까지 파고들어도 흡착), 밴드 24→48px.
3. **탭 그룹이 스냅에서 통째로 제외돼 있었다.** 병합이 잘 되니 창들이 대부분 그룹이 되고,
   한 번 합친 창은 두 번 다시 붙지 않았다. → 스냅 단위를 창이 아니라 **unit**(홀로 있는 창
   또는 탭 그룹 전체)으로 바꿨다. 대표 키는 `tabs[0]`.
4. **조준하느라 멈추면 드래그가 조각났다.** 320ms 디바운스가 발동하고 각 조각이 최소
   이동 횟수 미달로 버려졌다. → 이벤트 개수 대신 누적 변위, 판정 후에도 세션 유지.
5. **따라오는 창이 드래그 중에는 가만히 있다가 손을 뗄 때 따라잡았다.** → 매 이동
   이벤트마다 절대 좌표로 재계산해 추종. 오프셋 누적이 아니라 재계산이라 표류가 없다.

부수적으로 잡힌 기존 결함:
- 화면 끝에서 클러스터를 끌면 클램프가 리더에게만 걸려 **두 창이 완전히 포개졌다.**
- 변위 0 인 이벤트 20개만으로도 흡착이 발동했다.
- `applyLayout` 이 적용한 좌표를 저장하지 않아 UI 에서 고른 레이아웃이 다음 실행에 사라졌다.
- 시작 시 `applyLayout` 이 무조건 돌아 저장된 창 위치를 전부 덮어썼다(M5 크기 단축키 포함).

## 로그인 전 사용성 (2026-08-06)

- 단축키가 sign-in 콜백에서만 등록돼 **로그인 전에는 Cmd+숫자가 전혀 동작하지 않았다.**
  창 토글·글씨 크기·리사이즈는 유료 기능이 아니므로 시작 시 무조건 등록하도록 바꿨다.
  잠긴 기능은 IPC 단에서 이미 막히므로 눌러도 잠금 안내가 뜬다.
- `windowsVisibility` 는 정의만 있고 읽는 쪽도 쓰는 쪽도 없는 죽은 저장소였다. 배선했다.
  시작 시 저장된 취향대로 복원하고, **sign-out 은 여전히 전부 숨기고 PHI 를 지운다**
  (다만 그 숨김을 취향으로 저장하지는 않는다 — 저장하면 다음 실행이 빈 화면이 된다).
- dock 이 130px 고정이라 S2 구독 배너가 들어오며 세 줄이 되자 잘렸다.
  `windowFit.ts` 로 내용 높이에 맞춰 자동 조절. 사용자가 직접 키운 높이는 줄이지 않는다.

## 도구

- 진단: `RD_SNAP_DEBUG=1 npm run dev` → `/tmp/dev.log`. 드래그당 2줄로 요약된다.
- 라이브 개입 끄기: `RD_SNAP_LIVE=0` (흡착·추종이 함께 꺼진다).
- **main 프로세스 변경은 HMR 로 반영되지 않는다. 반드시 재시작.**

## 원가 가시성 · 키오스크 계량 (2026-08-06)

세 가지를 고쳤다. 전부 "조용한 실패" 계열이다.

### 1. 미산정 모델이 ₩0 으로 읽히던 문제 (admin-web)

`costForRow` 가 가격표에 없는 모델에 대해 0 을 돌려줬다. 제품이
`gemini-3.5-flash-lite` 로 갈아탄 순간(0b137d9) 어드민의 비용 열 전체가 0 이 됐다 —
원가를 보이게 하려고 만든 화면이 기본값 하나에 무력화됐다.

- `costForRow` 는 이제 `number` 가 아니라 `Cost` (`{priced:true,usd}` | `{priced:false,…}`)
  를 돌려준다. 호출자 4개 파일 전부 갱신했다.
- 합계는 `sumCosts()` 로 내고, **미산정 행 수와 라벨을 함께** 돌려준다. 미산정 행을
  말없이 빼면 "0 원" 대신 "실제보다 낮은 금액" 이라는 더 알아채기 어려운 같은 버그가 된다.
- 화면: 행 셀은 `미산정`(fmtCost), 집계 화면 상단에 `UnpricedNotice` 배너,
  사용자 목록·공급자별·모델별 표에 미산정 건수 배지.
- **재발 방지 두 겹**:
  1. 컴파일 타임 — `ACTIVE_GEMINI_MODELS` 가 `satisfies readonly (keyof PRICING.gemini)[]`.
     쓰는 모델을 표에 넣지 않으면 `npm run typecheck` 가 깨진다.
     (검증: 없는 모델을 넣어 TS2322 로 실패하는 것을 확인했다.)
  2. 런타임 — 모델은 환경변수로도 바뀌고 그 경로는 타입 검사를 지나지 않는다. 그래서
     표에 `UNPRICED` 로 **명시**된 모델은 화면이 미산정이라고 말한다.
  즉 표에 없으면 typecheck 가 깨지고, 표에 있는데 단가가 없으면 화면이 말한다.
  어느 쪽도 0 으로 보이지 않는다.
- **남은 것**: `gemini-3.5-flash-lite` 의 실제 단가. `admin-web/lib/pricing.ts` 의
  `TODO(pricing)` 자리에 `UNPRICED` 를 실제 값으로 바꾸면 배지·배너가 저절로 사라진다.
  값을 지어내지 않았다 — 그럴듯한 오답은 0 보다 나쁘다.

### 2. `.mcp.json` 이 삭제된 프로젝트를 가리키고 있었다

`yqdzxitlmtawznzwpkra`(구, 삭제됨) → `yhwvwojjwwlcrvpfxgag`(운영). 그대로 두면 다음
세션의 Supabase MCP 가 죽은 프로젝트를 향한다.

### 3. 키오스크: 모델 정렬 + 사용량 계량

- 키오스크는 자기 `GEMINI_MODEL`(기본 `gemini-3.5-flash`)을 읽어서, 제품 전체가
  flash-lite 로 옮길 때 **혼자 뒤처져 있었다 — 결정이 아니라 사고였다.** 기본값을
  `gemini-3.5-flash-lite` 로 맞췄다. 운영 Vercel 에 `GEMINI_MODEL` 은 설정돼 있지
  않으므로(README 의 환경변수 목록 기준) 재배포만으로 반영된다.
- 키오스크의 Gemini 호출은 `ai-gemini` Edge Function 을 지나지 않는다(서버측 자기 키로
  Google 직접 호출). 서버 전용 키라 유출은 아니지만 **그 돈이 어디에도 기록되지 않았다.**
  이제 호출마다 `usage_events` 에 적는다 — `lib/usage.ts`, Edge 의 `recordUsage` 와 같은 역할.
  - `user_id` = 담당 의사(`encounters.user_id`), `source='server'`(0016 정의상 과금 근거로
    삼아도 되는 행), `platform='kiosk'`, `session_id=null`, task = `kiosk-interview` /
    `kiosk-result`.
  - 재시도한 시도도 각각 한 행. 쓸 수 없는 응답도 토큰은 이미 태웠다.
  - [HARD] 계량 실패는 문진을 깨뜨리지 않는다(전부 삼키고 `console.error`). 다만 조용히
    삼키지 않는다 — 로그가 없으면 "계량되고 있다" 는 착각이 생긴다.
  - 추가 환경변수 없음. 기존 `SUPABASE_SERVICE_ROLE_KEY` 로 쓴다.
- **아직 계량하지 않는 것**: CLOVA STT(`/api/intake/transcribe`). `usage_events` 는
  `provider='clova-csr'` 를 이미 이해하지만 CLOVA 응답에서 과금 단위를 꺼내는 일은
  이번 범위 밖이다.
- 검증: 로컬 Supabase + 로컬 키오스크 + **실제 Gemini** 로 `probe-production.mjs`
  ALL PASS, 그리고 `usage_events` 에 4행(kiosk-interview 3 + kiosk-result 1,
  전부 `gemini-3.5-flash-lite` / `source=server` / 실토큰)이 남는 것을 확인했다.
  프로브가 만든 행은 전부 지웠다.

**주의**: 이 두 변화는 맞물린다. 키오스크 문진 비용이 이제 어드민에 나타나지만,
flash-lite 단가가 없으므로 **"미산정" 으로** 나타난다. 보이지 않던 것이 "0 원" 이 아니라
"모른다" 로 보이는 상태이고, 단가를 채우는 순간 금액이 된다.

## 0.8.0 릴리스 (2026-08-06)

**A1 이 실제로 나간 첫 빌드**다. 이게 필드에 깔려야 provider 키를 로테이트할 수 있다.

### 산출물

| 파일 | bytes | sha256 |
|---|---|---|
| `Realtime Doctor-0.8.0-universal.dmg` | 192,604,784 | `b78d6378b602e5a13ea958ab129d96e9848962cc752aa0d65751f3de40d44687` |
| `Realtime Doctor-0.8.0-arm64.dmg` | 109,794,565 | `5d4bcc9300c808b0208755fb8effebea5ce5ed90293ebb88da88ad4e8c3c4e88` |
| `Realtime Doctor Setup 0.8.0.exe` | 86,460,695 | `d2f1eebe6ff8eb0c1f33fd34cb235b7fe221bb7a81736d2ff377fac00cb62acc` |

맥 빌드는 `release/`, 윈도우는 `win-build/v0.8.0/`. 둘 다 gitignore 돼 있다.

### 맥 빌드 — 함정 두 개는 여전히 실재한다

- **`~/.zshrc` 가 `OPENAI_API_KEY` 를 export 하고 dotenv 는 기존 `process.env` 를
  덮지 않는다.** 실측 확인했다(`'OPENAI_API_KEY' in process.env` → true).
  래퍼 `/tmp/build-mac-080.py` 가 (1) 셸에서 그 키를 **제거**하고 (2) `.env` 를
  나중에 읽어 이기게 한다. 0.8.0 에서는 그 키가 애초에 인라인 목록에 없지만,
  래퍼는 목록이 아니라 환경을 지키므로 되돌아와도 막힌다.
- **Developer ID Application 인증서가 이 머신에 없다** (`security find-identity`:
  Apple Development + Apple Distribution 둘뿐). 공증은 불가능하므로
  `--config.mac.notarize=false` + `CSC_NAME=Apple Development: …(ZR7TZHJVK2)` 로
  **서명은 하되 공증은 하지 않는** 빌드를 냈다. Apple 관련 환경변수는 래퍼가
  지운다 — 남겨두면 electron-builder 가 10분짜리 빌드 끝에서 공증을 시도하다 죽는다.
- `dist:universal` 한 번으로 universal 과 arm64 DMG 가 **둘 다** 나온다
  (`--universal` 이 package.json 의 arm64 타깃에 더해진다). 따로 돌릴 필요 없다.

### [HARD] 키 부재는 `out/` 이 아니라 **배포되는 DMG 안에서** 증명했다

0.7.0 asar 에서 두 키가 실제로 발견된 적이 있어서, 이번엔 `.dmg` 를 마운트해
`app.asar` 를 꺼내 검사했다 (`/tmp/verify-asar.sh`). DMG 2개 × 6748 파일:

- `GEMINI_API_KEY` / `OPENAI_API_KEY` — **값도 이름도 0건**.
- `~/.zshrc` 의 OPENAI 값(=.env 와 다른 값)도 별도로 0건. 위 함정이 실제로
  막혔다는 뜻이다.
- `ENTITLEMENT_PRIVATE_KEY` 이름 0건.
- **양성 대조**: `gemini-3.5-flash-lite` 는 **발견된다**. 이게 없으면 "grep 이
  고장나서 깨끗해 보이는 것"과 구별할 수 없다.
- 서명: `Apple Development: …(ZR7TZHJVK2)`, TeamIdentifier `88CR983RJZ`.
  `spctl` 은 예상대로 `rejected` — 공증이 없기 때문이고 다운로드 페이지가
  이미 이 상황을 안내한다.

### 윈도우 — 미러 CI

- run **31073710817** (`mole-bi-com/realtime-doctor-winbuild`, success).
  미러 `main` 에 force-push 후 `workflow_dispatch`.
- 임베딩 검증: 필수 13키 EMBEDDED, `DEVICE_FUNCTION_URL`/`AI_PROXY_URL` 은
  optional 미설정(런타임 유도), **`GEMINI_API_KEY` / `OPENAI_API_KEY` 는
  `ABSENT (value and name)`**. 부재 검사는 A1 때 이미 들어가 있었다.
- **새로 넣은 검사**: `GEMINI_*_MODEL` 5종이 프록시 allowlist 에 있는 모델인지
  대조한다. 모델 id 가 낡으면 빌드는 완벽해 보이는데 필드에서 모든 AI 호출이
  400 `model_not_allowed` 로 죽는다 — 번들에 빠진 게 없으므로 기존 검사는 전부
  통과한다. CI 로그에서는 GitHub 가 등록된 시크릿 값을 마스킹해 `***` 로 나오므로
  **출력이 아니라 등가 비교만이 실패할 수 있다.** 실제로 로그에 `***` 로 찍혔고
  (= 미러 시크릿 값이 정확히 `gemini-3.5-flash-lite` 라는 뜻) 검사는 통과했다.

### 운영 프록시 allowlist 실측

`GEMINI_ALLOWED_MODELS` 는 flash-lite 로 갱신돼 있다. 프로브 계정으로 실제
`ai-gemini` 를 불러 확인했다: 미인증 401 / `gemini-3.5-flash-lite` **200 (실제
Gemini 응답)** / `gemini-2.5-pro` **400 `model_not_allowed`**. allowlist 가
넓어지지도 않았다. 프로브 계정과 행은 전부 삭제.

### 다운로드 페이지

- 스토리지 `app-releases` (비공개). 새 경로 `mac/0.8.0/…` 2개 + **`win/0.8.0/…` 1개**.
  업로드 후 서버가 보고한 크기가 로컬과 바이트 단위로 일치.
- **버킷 MIME 허용 목록을 넓혀야 했다.** `allowed_mime_types` 가
  `application/x-apple-diskimage` 하나여서 `.exe` 업로드가 거부된다.
  `application/vnd.microsoft.portable-executable` 를 추가했다.
  크기 상한 256 MiB 는 그대로이고 최대 파일이 192.6MB 라 여유가 있다.
- `WINDOWS_BUILD_AVAILABLE` 는 `true` 로 바꾸지 않고 **삭제**했다. "산출물이
  없다"를 말하려고 있던 값이라 영구히 true 인 boolean 은 목록이 이미 말하는
  사실의 두 번째 약한 출처가 된다. `DesktopArtifact.platform` 을 추가해
  아이콘·권장 표시가 윈도우에서도 맞게 했다.
- **0.7.0 은 더 이상 제공하지 않는다. 다만 버킷에서 지우지도 않았다.**
  카탈로그가 서명할 수 있는 유일한 출처(`signDesktopDownload` 는 요청에서 경로를
  받지 않는다)라 항목을 빼는 것만으로 도달 불가가 된다. 바이트를 남긴 이유는
  0.7.0 다운로드마다 남은 감사 행이 그 경로와 digest 를 가리키고 있어서다.
  제공을 끊은 이유는 이 릴리스의 목적 그 자체다 — 0.7.0 설치본은 asar 안에
  소유자 키를 들고 있고, 한 부를 더 나눠주는 것은 회수 불가능한 키를 한 부 더
  나눠주는 것이며 정확히 로테이션을 막고 있는 것이다.
- 윈도우 안내는 **코드 서명이 없다**는 사실을 그대로 적었다
  (`CSC_IDENTITY_AUTO_DISCOVERY=false` 로 빌드된다). SmartScreen 이 막는 것은
  예상된 동작이고, 파일이 맞는지는 SHA-256 이 판정한다.

### 라이브 검증 (entanglecare.com) — 33 PASS / 0 FAIL

`/tmp/probe-download-live.mjs`. 비로그인 POST 401 · 페이지 307→login /
로그인 세션으로 페이지 200, 0.8.0 표기, 세 digest 전부 출력, "준비되지
않았습니다" 문구 사라짐, 0.7.0 미노출 / 세 산출물 전부 서명 URL 발급 /
**win-x64 는 86MB 전체를 받아 해시가 게시값과 일치**, DMG 2개는 head·middle·tail
레인지 GET 이 로컬 파일과 바이트 동일 + 서버가 보고한 전체 길이 일치 /
`web_app_download_audit` 에 3행(전부 `app_version=0.8.0`, digest 일치).
프로브 계정·감사행 전부 삭제, 잔여 0행.

배포 후 경로 확인: `/` 200, `/righthand` 200, `/righthand/patient` 200(키오스크),
`/righthand/doctor/download` 307(비로그인).

### [HARD] 키 로테이션 — 지금 안전한가

**아직 아니다.** 0.8.0 이 *제공*되기 시작했을 뿐, 필드의 0.7.0 설치본은 그대로
살아 있고 그 안의 키로 Google/OpenAI 를 직접 부른다. 로테이트하는 순간 그
설치본들의 AI 기능이 죽는다. 로테이션 전에 필요한 것:

1. **모든 사용자가 0.8.0 이상으로 올라왔다는 확인.** 앱에 강제 업데이트도
   버전 리포팅도 없다 — 지금은 누가 무엇을 쓰는지 셀 방법이 없다.
   (약한 대용: `usage_events.source='client'` 행이 계속 들어오면 구버전이
   살아 있다는 신호지만, 0.8.0 도 CLOVA·realtime 때문에 client 행을 쓴다.)
2. 로테이트 시 **함께 갱신해야 하는 곳** (전부 서버측이고 재배포 불필요):
   - Supabase function secret `GEMINI_API_KEY` (`ai-gemini` 가 읽는다)
   - Supabase function secret `OPENAI_API_KEY` (`ai-realtime` 이 읽는다)
   - 키오스크 Vercel 프로젝트 `righthand-patient` 의 `GEMINI_API_KEY`
     — **키오스크는 프록시를 지나지 않고 자기 키로 Google 을 직접 부른다.**
       여기를 빠뜨리면 문진이 통째로 죽는다. 환경변수 변경 후 **재배포 필요.**
   - 미러 `realtime-doctor-winbuild` 의 `GEMINI_API_KEY`/`OPENAI_API_KEY`
     시크릿은 **이제 워크플로가 읽지 않는다.** 갱신할 필요가 없고, 오히려
     지워도 된다(남아 있으면 언젠가 누가 다시 쓴다).
   - 로컬 `.env` 의 두 키는 프로브·키오스크 로컬 실행용이라 개발자 편의 문제다.
3. CLOVA 3종은 **여전히 번들에 있다**(A2 미착수). "키를 걷어냈다"는 provider
   두 곳에 대해서만 참이다.

## 관측 계층 (2026-08-07) — O1

배경: 제품이 자기 고장을 아무에게도 알리지 않았다. 키오스크가 멈추거나 `entitlement` 가
500 을 뿜기 시작하면 첫 신호가 진료 중인 의사의 전화였다. 운영 문서는 `OBSERVABILITY.md`.

### 만든 것

- **헬스체크 6개.** 각 표면이 **실제로 실패할 의존성**을 실행한다. Node/Deno 생존만
  확인하는 200 은 잘못된 확신을 만들기 때문에 만들지 않았다.
  - `doctor-web /api/health` — Supabase 도달 + `f_ops_stats_probe()` 로 `f_web_stats_*`
    네 함수를 실제 테이블 위에서 실행 + 프로버 생사 + 알림 대상 유무
  - `kiosk /righthand/patient/api/health` — 담당 의사 실재 확인 +
    `f_ops_intake_probe()` 로 `redeem_visit_access_code()` 를 **롤백되는 서브트랜잭션**
    에서 실행(무차별 대입 카운터 무소모, `consumedNothing` 이 값으로 증명)
  - Edge Function 4종 — `GET ?health=1`. 호출자 JWT 검사 **앞**에 둔다(감시가 사용자
    계정 수명에 묶이면 계정이 만료되는 날 감시도 조용히 멈춘다). entitlement 는 ECDSA
    개인키를 import 해 실제로 한 번 서명한다.
  - 공통: provider 호출 없음(감시 주기가 곧 비용이 되면 감시가 꺼진다), PHI 없음,
    비밀값 없음. 각 응답이 `provesWhenOk` / `doesNotProve` 를 스스로 싣는다.
- **프로버** `doctor-web /api/ops/probe` + Vercel Cron(KST 03:00). 6개 표면을 병렬로
  치고 down / degraded / unknown(200 인데 헬스 보고서가 아님) 을 구별한다. 이상이 없어도
  `ops_probe_runs` 에 행을 남긴다(0004 원칙).
- **알림** `OPS_ALERT_WEBHOOK_URL` 하나. `(surface, issue)` 중복 억제 + 복구 알림.
- **마이그레이션 0017** — `ops_probe_runs`, `ops_probe_alert_state`, `ops_probe_status`(뷰),
  `f_ops_stats_probe()`, `f_ops_intake_probe()`. 전부 service_role 전용. 0013 가드를
  파일 끝에서 재실행해 살아 있는 카탈로그로 확인.

### 결정과 근거

- **프로버를 admin-web 이 아니라 doctor-web 에 뒀다.** 기존 크론은 `admin-web/vercel.json`
  에 있지만 **admin-web 은 미배포**다. 배포되지 않은 앱의 크론은 실행되지 않으므로,
  관례를 따랐다면 프로버는 첫날부터 한 번도 안 돌면서 "감시가 붙었다"는 인상만 남겼다.
- **자기 죽음 처리.** 스케줄 잡은 자기 죽음을 스스로 알릴 수 없다(죽으면 코드가 안 돈다).
  둘 다 한다: (1) 실행 간격을 재서 `missed_previous_run` 으로 **사후** 보고,
  (2) `expected_next_run_at` 을 기록하고 `ops_probe_status.prober_stale` 을 `/api/health`
  가 실어 날라 **URL 하나로 상시 노출**. 남는 구멍은 Vercel 자체 장애 — 크론과 헬스체크가
  같은 계정 위라 같이 죽는다. 외부 스케줄러만이 이걸 막는다.
- **`CRON_SECRET` 이라는 이름은 필수다.** Vercel Cron 은 정확히 이 이름일 때만 Bearer 를
  자동으로 붙인다. 미설정 시 프로버는 조용히 통과시키지 않고 503 으로 거절한다.
- **미설정 알림 대상을 조용히 넘기지 않는다.** 다섯 곳에 기록된다
  (`alert_target_configured`, `alerts_undeliverable`, `details.wouldHaveSent` 에 보냈어야
  할 내용 그대로, `alert_error`, `/api/health` 의 `alerting` 검사).
- **알림 채널 자체에 대해서는 알리지 않는다.** "보낼 곳이 없다"를 보낼 곳 없는 채널로
  알리는 것은 순환이다(첫 운영 실행에서 실제로 매 실행 전달불가 1건을 만들었다).

### 검증 (전부 라이브)

- 마이그레이션 0017 라이브 적용. 카탈로그 확인: `ops_*` / `f_ops_*` 에 PUBLIC·anon·
  authenticated 권한 **0건**, RLS 켜짐·정책 0개. PostgREST 로도 anon 은 42501.
- 헬스체크 6개 전부 200/ok. 키오스크를 **잘못된 service_role 키**로 띄운 별도 인스턴스는
  503 + `database`/`intake_rpc` 실패로 정확히 떨어졌다(실패가 실제로 검출된다는 증거).
- 실패 순회: doctor-web·kiosk 404(배포 전) → `down` 2건 기록 + 전달불가 2건 +
  `wouldHaveSent` 에 내용 저장. 재실행 시 억제 2건(중복 억제 동작).
- 로컬 수신기를 붙인 순회에서 웹훅 2건 실제 수신 확인(전달 경로 동작).
- `CRON_SECRET` 미설정 → 503, 잘못된 Bearer → 401.
- 배포 후 순회: 6개 표면 중 5개 ok, doctor-web 만 `alerting` 하나로 degraded.
  `entanglecare.com` 의 `/`, `/righthand`, `/righthand/patient`, `/righthand/doctor/download`
  전부 이전과 동일(200/200/200/307).

### 남은 것

- **알림 채널 미설정** — 지금 가장 큰 구멍. `OPS_ALERT_WEBHOOK_URL` 만 채우면 된다.
  이것 때문에 `/api/health` 가 `degraded` 로 보이는 것이 현재의 정상 상태다.
- **주기 하루 1회** — Vercel Hobby 상한. Pro 이거나 외부 스케줄러면 5분으로 내려간다.
- **외부 감시자 없음** — Vercel 자체 장애를 볼 수 없다.
- **상태 화면** — admin-web 배포 후. 데이터는 `ops_probe_status` 로 준비돼 있다.
- **provider 키 유효성** — 유료 호출 없이 확인 불가라 의도적으로 범위 밖.

### 발견했지만 손대지 않은 것

`admin-web` 의 빌링 감시 크론은 `BILLING_CRON_SECRET` 을 기대하는데, **Vercel Cron 은
`CRON_SECRET` 이라는 이름에만 Bearer 를 자동으로 붙인다.** 두 값이 같지 않으면 그 크론은
배포되는 순간부터 매 실행 401 을 받고 한 번도 성공하지 못한다 — 그리고 그 잡은 자기
실행 기록을 401 이후에 쓰므로 `subscription_watchdog_runs` 도 비어 있어, 증상이
"아무 일도 안 일어남"이다. admin-web 배포 전에 확인할 것.

## admin-web 배포 (2026-08-07) — B1

배경: `admin-web` 은 완성돼 있는데 어디에도 배포되지 않았다. 그래서 (a) 체험 연장·구독
부여·사용량 확인·진료행위 정의 승인 같은 일상 운영이 **에이전트가 운영 DB 에 직접 SQL 을
치는 것**으로만 가능했고 — 세션이 끝나면 사라지고, 사람이 안전하게 할 수 있는 일이 아니다 —
(b) 포트원 결제 페이지가 그 안에 있으므로 **체험이 끝난 의사에게 결제할 방법이 없었다.**

### 배포 결과

- 프로젝트: `realtime-doctor-admin` (팀 `mole-bi-coms-projects`, root `admin-web`,
  git 연결 `backup` = mole-bi-com/realtime-doctor, production branch `history/v0.6.0-split`).
  **push 하면 배포된다** — doctor-web 과 같다.
- 의사(결제): `https://entanglecare.com/righthand/billing`
- 운영자(관리): `https://realtime-doctor-admin.vercel.app/righthand/admin`
- 헬스체크: `https://entanglecare.com/righthand/api/health`

### [HARD] 발견해서 고친 것 — 같은 모양의 침묵 두 개

이전 세션이 "발견했지만 손대지 않은 것"으로 남긴 크론 시크릿 문제는 **실재했고**, 배포
과정에서 **같은 모양의 두 번째 것**이 하나 더 나왔다. 둘 다 증상이 "아무 일도 안 일어남"
이고, 그건 watchdog 이 탐지하려는 조용한 과금 중단과 DB 상에서 구분되지 않는다.

1. **시크릿 이름.** watchdog 이 `BILLING_`+`CRON_SECRET` 을 기대했다. Vercel Cron 은
   정확히 `CRON_SECRET` 인 환경변수에만 Bearer 를 붙인다 → 매 실행 401.
2. **크론 경로.** basePath 를 켠 뒤 `vercel.json` 의 경로가 `/api/billing/watchdog` 이라
   404 였다(라이브로 확인). 404 는 라우트 코드에 닿기 전이라 실행 기록조차 안 남는다.

둘 다 라우트가 실행 기록을 **인증 이후에** 쓰기 때문에 `subscription_watchdog_runs` 가
비어 있는 채로 남는다.

되돌릴 수 없게 만든 장치 (넷, 층이 다르다):

- **상수화** — 라우트가 리터럴이 아니라 `lib/env.ts` 의 `CRON_SECRET_ENV` 를 읽는다.
- **빌드 가드** `admin-web/scripts/assert-cron-secret-name.mjs` (npm `prebuild`, Vercel
  도 `npm run build` 를 부르므로 배포 경로에서 반드시 지나간다). 세 가지를 본다:
  ① 옛 이름이 소스에 다시 나타나면 실패 ② watchdog 이 `CRON_SECRET_ENV` 를 참조하지
  않으면 실패(인증을 통째로 지우는 변경은 ①을 통과한다) ③ 모든 cron path 가
  `NEXT_PUBLIC_BASE_PATH` 로 시작하고 실제 라우트 파일로 해석되는지.
  가드와 `lib/env.ts` 는 금지 문자열을 **조각으로 조립**해서 자기 자신을 잡지 않는다 —
  예외 목록을 두지 않기 위해서다(예외 목록은 "일단 여기 추가"로 무력화된다).
  **세 분기 전부 음성 테스트로 실제 실패시켜 확인했다.**
- **부팅 거부** — 옛 이름이 환경변수에 설정돼 있으면 `assertBootEnv()` 가 던진다.
- **관측** — `/api/health` 가 watchdog 의 마지막 실행 시각을 싣고, ops 프로버가 그것을
  매일 읽는다. 인증이 어떤 이유로든 다시 깨지면 하루 안에 감시 보고서에 뜬다.
  **침묵이 더는 침묵으로 남지 않는 지점이 여기다.**

### URL 결정 — 왜 경로이고 왜 하위도메인이 아닌가

`billing.entanglecare.com` 이 1순위였고 **불가능했다.** entanglecare.com 의 DNS 권한은
Cloudflare 에 있고(NS: odin/roxy.ns.cloudflare.com) 거기에 와일드카드 레코드가 없다.
Vercel DNS 패널의 `*` ALIAS 레코드는 권한이 없어 무의미하다(`dig billing.entanglecare.com`
→ 빈 응답). 레포에서 만들 수 없는 주소를 고르는 것은 "배포했는데 아무도 못 여는" 상태다.

그래서 **한 배포물 + 두 호스트**:

- admin-web 을 `NEXT_PUBLIC_BASE_PATH=/righthand` 로 빌드하고, doctor-web 이
  `/righthand/billing*`, `/righthand/api/billing/*`, `/righthand/api/health`,
  `/righthand/_next/*` 를 재작성한다(키오스크와 같은 패턴).
- `/righthand/admin*` 은 **재작성하지 않는다.** 브랜드 도메인에서 404 다(확인함).
- [HARD] `_next` 재작성이 없으면 페이지는 HTML 만 뜨고 자바스크립트가 통째로 죽는다.
  경로 기반 마운트에 basePath 가 필수인 이유가 이것이다.

**운영자 화면을 지키는 것은 URL 이 아니라 `is_admin` 이다.** 재작성 목록에서 뺀 것은
방어의 한 겹일 뿐이고, 실제 통제는 `lib/admin-gate.ts` 의 서버측 검사다.

### 포트원 자격 없이 배포한 방법

포트원 계정이 아직 없다. 예전에는 그 네 변수가 없으면 부팅이 죽어서 **운영자 화면과
의사 본인 기록까지** 같이 못 떴다. 필수 환경변수를 두 단으로 갈랐다:

- **코어**(Supabase 3종, `BILLING_HANDOFF_SECRET`, `CRON_SECRET`) — 없으면 부팅 실패.
- **포트원 4종** — 없어도 뜬다. 대신 **숨기지 않는다**: 부팅 로그 / `/billing` 의
  "카드 등록은 아직 준비 중입니다" 패널(버튼 자체를 렌더링하지 않는다) / `/api/billing/*`
  의 503(이름만, 값 없음) / `/api/health` 의 `degraded` / watchdog 은 실행 기록을 남긴
  뒤 503 으로 중단.

**자리표시자 값은 넣지 않았다.** 넣으면 결제창이 열리고 PG 가 거절해서, 설정 누락이
의사에게 "내 카드가 거절당했다"로 도착한다.

### 라이브 검증

- **`is_admin` 게이트** — 프로브 계정 2개를 실제로 만들고 실제로 로그인해서
  (@supabase/ssr 의 쿠키 함수를 그대로 써서 세션 쿠키 생성) 배포에 요청:
  비관리자 `/righthand/admin/users` → 307 `/righthand/admin`, `/admin/pricing` → 307.
  관리자 → 둘 다 200. 비관리자도 `/righthand/billing` 은 200(자기 결제 화면이므로 맞다).
  **프로브 계정 2개 삭제 완료, 잔여 profiles/subscriptions 0행.**
- **watchdog 인증** — Vercel 프로젝트에 저장된 `CRON_SECRET` 을 복호화해 **크론이 보낼
  것과 동일한 요청**을 배포에 보냈다: 무인증 401 / 잘못된 Bearer 401 / 올바른 Bearer는
  통과해서 503(포트원 미설정으로 중단)이며 `runId` 를 반환 — 즉 실행 기록이 남는다.
  배포에 등록된 크론 정의도 API 로 확인: `/righthand/api/billing/watchdog`, `0 18 * * *`.
  증명이 끝난 뒤 `CRON_SECRET` 을 `sensitive`(되읽기 불가)로 승격했다(doctor-web 과 동일).
- **경로** — entanglecare.com 의 `/`(200) `/righthand`(200) `/righthand/patient`(200,
  키오스크) `/righthand/doctor/download`(307) `/api/health`(200) 전부 이전과 동일.
  신규: `/righthand/billing`(307→billing/login) `/righthand/billing/login`(200)
  `/righthand/api/health`(200). `/righthand/admin*` → 404.
  `_next` 청크 5개를 브랜드 도메인 경유로 받아 전부 200 + `application/javascript` 확인.
- **ops 프로버** — 수동 순회에서 표면 **7개**(기존 6 + admin-web), 5 ok / 2 degraded.
  admin-web 은 `portone`·`watchdog` 두 검사로 degraded, `wouldHaveSent` 에 기록됨.

### 정리하고 남긴 것

- 삭제: 프로브 계정 2개(+cascade 로 profiles/subscriptions), `subscription_watchdog_runs`
  프로브 4행. **테이블은 다시 0행이다.** 일부러 지웠다 — 남겨 두면 헬스체크가
  "최근에 돌았다"로 읽혀 실제 크론이 처음 도는 KST 03:00 전까지 거짓 안심을 준다.
  지금은 "한 번도 안 돎"이 사실이고 화면에도 그렇게 보인다.
- 남김: `ops_probe_runs` 의 수동 순회 1행(정상적인 감시 기록이라 지우지 않는다).

### [HARD] 키 로테이션 목록에 한 곳 추가됨

`admin-web` 의 세션 재분석 기능(`lib/analyzer.ts`)이 **Gemini 를 프록시 없이 직접**
부른다. 그래서 Vercel 프로젝트 `realtime-doctor-admin` 에 `GEMINI_API_KEY` 가 있다.
위 "키 로테이션" 절의 목록에 이 항목을 더해야 한다(환경변수 변경 후 **재배포 필요**).
근본 해결은 이 호출을 `ai-gemini` 프록시로 옮기는 것이고, 이번 범위 밖이다.

### 남은 것

- **포트원 자격.** 도착하면 `realtime-doctor-admin` 에 네 변수를 넣고 재배포하면 결제가
  열린다. 코드 변경 없음. 웹훅 엔드포인트로 등록할 주소는
  `https://entanglecare.com/righthand/api/billing/webhook`.
- **데스크톱 앱 재빌드.** `BILLING_PORTAL_URL` 과 fallback 상수를 실제 주소로 바꿨지만,
  이미 배포된 설치본은 여전히 죽은 `admin.realtime-doctor.app` 을 연다.
- **관측 상태 화면** — admin-web 에 아직 없다(OBSERVABILITY.md §5 가 대신한다).
- **알림 채널** `OPS_ALERT_WEBHOOK_URL` 미설정 — 여전히 가장 큰 구멍.
