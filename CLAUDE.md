# 리얼타임 닥터 (진료 실시간 보조)

## 북극성 단계

**Stage 0 — 결제 불가**(2026-08-03 기준). 단, 포트원 정기결제 구독이 진행 중이라 곧 이동할 수
있다: 계획 `tasks/subscription-plan.md`의 S1~S5(스키마·엔타이틀먼트·빌링키 발급·웹훅/재예약·
dunning/해지/기기제한)까지 구현·프로브 검증 완료, **S6(포트원 테스트 채널 실경로 검증)만 남았다.**
상품은 단일 플랜 `standard` 월 77,000원(70,000 + VAT 7,000), 카드 등록 없는 7일 무료 체험,
기기 2대. PG(나이스페이/스마트로)는 미정이며 채널키 하나로 결정된다 — PG 종속 코드는 없다.
**포트원 실자격증명(storeId/channelKey/API Secret)이 없어 라이브 호출은 아직 못 해봤다.**
실시간 상태는 `STATE.md`, 목표 관제는 `/Users/seungwoolee/Desktop/project/dashboard`
(이 프로젝트는 대시보드에서 `b2b: true` — 병원 도입 세일즈 레인이 열려 있다).
결제를 붙일 때 `dashboard/projects.json`의 `revenue.sources`를 같은 커밋에서 등록해야 하며,
등록하지 않으면 Stage 0에 고정된다.

## 아키텍처 — 4개 클라이언트 + 1개 DB

- `src/` — **Electron 데스크톱 앱**(electron-vite, main/preload/renderer/shared). 의사가 쓰는
  본체. 실시간 음성 전사·분석·요약·구술.
- `kiosk/` — Next.js. 환자가 대기실에서 문진하는 화면. 진입에 **방문 코드**가 필수다.
- `admin-web/` — Next.js(Vercel). 관리 + **결제의 서버측 전부**가 여기 있다.
- `mobile/` — Flutter.
- `supabase/` — Postgres(마이그레이션 0000~0012) + 엣지 함수 `device`, `entitlement`.

데이터 흐름: 키오스크 문진 → Supabase → Electron이 Realtime으로 자동 수신 → 전사·분석 →
근거(PubMed) 부착 → 진료 종료 기록.

### 결제·권한 설계에서 반드시 지킬 것

- **엔타이틀먼트 토큰은 ECDSA P-256/SHA-256 서명.** 개인키는 Edge Function 환경변수에만,
  앱 번들에는 공개키만. HMAC은 "앱이 스스로 토큰을 찍을 수 있어서" 의도적으로 배제됐다.
- **게이트 대상은 AI 기능뿐이다.** 의료 기록 열람(`sessions:*`, `patients:load-detail`,
  `evidence:*`, `localSave:*`)은 결제 상태와 무관하게 항상 열려 있어야 한다. 로그아웃은 잠금이다.
- **웹훅은 admin-web `/api/billing/webhook`이고 Edge Function이 아니다.** 재예약 구현이 두 벌이
  되면 하나만 고쳐지는 날 과금이 조용히 멈추기 때문. 재예약 구현은
  `lib/billing/cycle.ts:ensureNextSchedule()` **하나뿐**이다 — 복제하지 말 것.
- 웹훅 검증은 **원문 바이트**(`req.text()`)로 하고 그 라우트에서 `req.json()`을 부르지 않는다.
  본문의 paymentId만 믿고 금액·상태는 서버가 `GET /payments/{id}`로 직접 확인한다.
- 주기 산술(`lib/billing/period.ts`): 다음 주기는 `now()`가 아니라 `current_period_end`에서
  이어붙이고, 말일은 클램프하되 앵커일은 침식되지 않는다(1/31 → 2/28 → **3/31**). 전부 UTC.
- 결제 실패 유예는 **이미 열려 있으면 연장하지 않는다**(연장하면 유예가 영원해진다).
- 재시도 사다리는 "크론이 한 단씩 늦게 예약"한다. D+1/D+3/D+5를 한꺼번에 잡으면 성공 시
  취소 호출이 전부 성공해야 이중청구를 면하는 구조가 된다.
- 감시 크론(`/api/billing/watchdog`, Vercel Cron)은 **이상이 없을 때도** 실행 기록을 남긴다 —
  "오늘 이상 없음"과 "3월부터 안 돌고 있음"이 같은 모습이 되면 안 되기 때문.

## 검증

유닛 테스트 프레임워크 대신 **`scripts/probe-*.mjs` 행동 프로브**가 검증 수단이다(실제 next
서버 + 포트원 목 서버 + 진짜 HMAC 서명으로 시나리오를 돌린다). 결제 관련 주요 프로브:
`probe-entitlement.mjs`, `probe-gate-driver.mjs`, `probe-billing.mjs`, `probe-webhook.mjs`,
`probe-dunning.mjs`. `node scripts/<이름>.mjs`로 실행한다.

빌드·타입: 루트 `npm run typecheck`(node+web) / `npm run build`(electron-vite) /
`npm run dist`(mac arm64) / `npm run dist:win`. 각 웹 앱은 `cd kiosk|admin-web && npm run
typecheck && npm run build`. Flutter는 `cd mobile && flutter test`.

## 함정

- 마이그레이션 0003 이후는 **로컬 Supabase 스택에만 적용된 것들이 있다** — 원격 적용 상태를
  STATE.md에서 확인하고 배포할 것. `devices` 테이블은 원래 마이그레이션 자체가 없었다.
- Postgres 함수의 PUBLIC EXECUTE는 회수돼 있다(0010). 새 함수를 만들면 같은 처리를 해야 한다.
- 릴리스 빌드에 결제 시크릿이 새는지 `.next/static`와 `out/`을 grep하는 검사가 관례다.

## 관측 (2026-08-07)

제품이 자기 고장을 알리는 경로가 생겼다. 상세는 `OBSERVABILITY.md`.

- **사람이 볼 URL 하나: `https://entanglecare.com/api/health`.** 제품 상태와 감시자 자신의
  상태(`extra.prober.stale`), 알림 대상 유무를 한 응답에 싣는다.
- 헬스체크는 각 표면이 **실제로 실패할 의존성**을 실행한다(통계 함수 4종, 방문 코드 판정,
  ECDSA 서명). provider 는 부르지 않고 PHI 도 만들지 않는다. 각 응답이 `provesWhenOk` /
  `doesNotProve` 를 스스로 싣는다 — 무엇을 증명하지 못하는지 적지 않은 헬스체크는 잘못된
  확신을 판다.
- 프로버는 `doctor-web` `/api/ops/probe`(Vercel Cron, KST 03:00). **admin-web 이 아니다 —
  admin-web 은 미배포이고 배포되지 않은 앱의 크론은 실행되지 않는다.**
- 하루 1회는 Hobby 플랜 상한이지 설계가 아니다. 외부 스케줄러로 같은 URL 을 치면 주기도
  올라가고 "Vercel 자체 장애"까지 볼 수 있다.
- **알림은 아직 아무 데도 안 간다.** `OPS_ALERT_WEBHOOK_URL` 미설정이 현재 상태이고, 그
  사실이 다섯 곳에 기록된다(조용한 no-op 금지). `/api/health` 가 이 때문에 `degraded` 로
  보이는 것이 지금의 정상이다.
- 마이그레이션 0017: `ops_probe_runs`(이상 없어도 기록), `ops_probe_alert_state`(중복 억제),
  `ops_probe_status`(뷰), `f_ops_stats_probe()`, `f_ops_intake_probe()`. 전부 service_role 전용.

## 작업 로그

`STATE.md`가 세션 간 기록이고, 계획은 `tasks/`(todo.md, subscription-plan.md).
