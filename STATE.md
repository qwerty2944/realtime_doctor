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

## 알려진 문제

- [HARD] **Supabase 대시보드에서 Email > Confirm email 을 꺼야 한다.**
  앱의 가입 로직은 signUp 직후 signInWithPassword 를 호출하므로, 켜져 있으면 신규 가입자가
  로그인할 수 없다. 2026-08-04 기준 아직 켜져 있음.
- **로컬 맥 빌드는 ~/.zshrc 의 OPENAI_API_KEY 를 굽는다.** dotenv 가 기존 process.env 를
  덮어쓰지 않기 때문. 검증 스크립트(`scripts/ci-assert-embedded.mjs`)가 잡아낸다.
  근본 수정은 electron.vite.config.ts 의 loadDotenv 에 `override: true`.
  당장은 .env 값을 환경에 주입해 빌드하는 것으로 우회한다.
- 로컬 브랜치 `winbuild/v0.6.0` 에는 시크릿 주입 워크플로가 있다. **공개 저장소로 푸시 금지.**
