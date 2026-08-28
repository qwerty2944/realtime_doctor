# RightHand 보안 전수감사 — 2026-08-10

7단계 full-read 감사 (rd-security-audit). 6개 서브시스템을 전체 읽고 이 제품의 불변식 10개와 대조.
**모든 발견은 리포트 단계이며, 수정은 사람 승인 후 별도로 적용한다.**

## 심각도순 발견 목록

### HIGH

- **[S6-1] CLOVA 시크릿 3종이 릴리스 번들에 평문 임베드** — `electron.vite.config.ts:24-32`.
  DMG/EXE 소지자 = NCP 키 소지자(asar extract). Gemini/OpenAI는 Edge 프록시+서버 게이트로 보호되지만
  CLOVA는 클라이언트 직결이라 서버 백스톱이 없다 → 유출 시 소유자 명의 과금, 회수는 전 설치본 재배포뿐.
  INV-8 위반. 수정: CLOVA를 Edge Function/gRPC 릴레이 뒤로, CI FORBIDDEN_KEYS에 추가.

- **[S5-1] 모든 BrowserWindow에 네비게이션/윈도우오픈 정책 없음 + sandbox:false** — `src/main/windows.ts:204-231`.
  `will-navigate`/`setWindowOpenHandler`/`web-contents-created` 가드가 코드 전체에 부재.
  오버레이는 전사·PubMed 텍스트·환자 문진(전부 비신뢰 입력)을 렌더한다. 주입/클릭으로 원격 origin 이동 시
  그 페이지가 preload 브리지(`window.api`: auth/sessions/patient-detail/billing IPC)를 그대로 얻는다.
  수정: 전역 `web-contents-created` 핸들러로 외부 이동 차단 + PubMed allowlist 경유, sandbox:true.

- **[S2-1] 엔타이틀먼트 공개키가 런타임 process.env + 하드코딩 fallback → 게이트 우회(빌드 조건부)** —
  `src/main/subscription.ts:84-86`, `index.ts:206-225`. 빌드 시 키가 임베드 안 된 릴리스에서는
  공격자가 `~/.realtime-doctor.env`에 자기 공개키를 넣고 self-signed 토큰을 캐시에 심으면 영구 entitled.
  CI 가드(`ci-assert-embedded.mjs`)가 유일한 방어선. **주의: 서버 게이트(`_shared/gate.ts`, 402 fail-closed)가
  AI 과금은 독립 차단하므로, 이 우회는 "UI/기록 기능 잠금해제"이지 무료 AI 컴퓨트는 아니다.**
  수정: 공개키를 덮어쓸 수 없는 모듈 상수로 컴파일, 보안 키는 user-writable dotenv에서 로드 금지.

### MEDIUM

- **[S6-2] 임베드 가드가 Windows CI 전용 — mac `dist` 경로에 미연결** — `package.json:16-18`.
  로컬 mac 빌드 머신의 `.env`에 실 API 키가 있는 상태에서 누가 EMBEDDED_ENV_KEYS를 되돌리면
  mac DMG는 가드 없이 시크릿을 싣는다. 수정: `dist`/`dist:universal`에 `ci-assert-embedded.mjs` 선행.

- **[S2-2] 클록 롤백 기준값이 평문 electron-store → 72h 오프라인 유예 무력화** — `subscription.ts:100-118`.
  OS 시계를 되돌리고 `lastServerTimeMs`를 같이 낮추면 무기한 오프라인 자격. 서명 위조는 아니라 온라인 시 자가교정.
  수정: keychain 기반 저장 또는 서명된 issuedAt 최신값 기준 롤백 거부.

- **[S1-1] usage_events: 클라이언트가 자기 server-metered 행을 DELETE 가능** — `0016_usage_event_source.sql:78-96`.
  RESTRICTIVE 정책이 insert/update만 제한, DELETE는 0000의 owner permissive 정책에 열림.
  서버 계측을 "생성은 못 건너뛰지만 사후 삭제는 가능". 수정: `for delete using (source='client')` RESTRICTIVE 추가.

- **[S1-2] evidence_lookups: 무제약 INSERT되는 교차-임상의 공유 캐시** — `0001_patients_encounters.sql:220-229`.
  `with check(true)`+`using(true)`. 악성 계정이 흔한 진단명에 위조 citations를 심으면 타 임상의 진료 시점에
  "근거"로 표시(임상 콘텐츠 오염). 수정: 채우기를 service_role RPC로, authenticated는 SELECT만.

- **[S3-1] 핸드오프 OTP가 봉투 TTL(120s) 무관하게 Supabase 기본 만료(~1h) 동안 직접 사용 가능** —
  `lib/billing/handoff.ts:19-27`. URL의 token_hash를 anon key로 Supabase verifyOtp 직접 호출 시 봉투 우회.
  수정: OTP 만료 단축 또는 URL엔 서버 저장 1회용 nonce만.

- **[S3-2] ensureNextSchedule 복구 경합 → 해지한 카드가 청구됨** — `lib/billing/cycle.ts:74-123`.
  동시 두 호출자가 실패 UPDATE로 schedule_id 유실 → revokeUpcomingSchedules가 못 찾음 → 포트원 예약은 실재.
  수정: 포트원 "이미 예약됨"을 실패 아닌 already로, 실패 UPDATE를 조건부로.

- **[S4-1] ModelOutputError.rawOutput(문진 결과 전문)이 서버 로그로 유출 가능** — `kiosk/lib/llm/types.ts:93-100`.
  util.inspect가 rawOutput(SOAP·감별진단·환자답변 파생)을 통째 로그. 수정: message만 로그, rawOutput non-enumerable.

- **[S4-2] SolAPI 실패 응답 전문 로깅 → 환자 전화번호 로그 잔류** — `kiosk/lib/notify/solapi.ts:137-152`.
  수정: statusCode/statusMessage만.

- **[S4-3] Electron 로컬 세션 평문 저장(transcript JSON + WAV)** — `src/main/localSessions.ts:78,217`.
  공용/도난 PC에서 OS 계정만 뚫리면 진료 전체 노출. 수정: safeStorage 암호화 또는 FDE 전제 명시 + 사인아웃 정리.

### LOW / LOW-MEDIUM

- **[S1-3]** intake_results 클라이언트 UPDATE/DELETE가 supersession/불변성 무력화 — `0001:172-215`. fingerprint 재계산이라 사후변조 미탐지. 수정: authenticated를 INSERT+SELECT로, 재파생은 RPC만.
- **[S1-4]** is_admin 계정이 타 사용자 행 SIUD 가능(설계 확인 필요) — `0000:394-400`. (S1-1과 결합 시 admin이 누구 usage든 삭제)
- **[S3-3]** revokeUpcomingSchedules가 billing_key null일 때 철회 시도 없이 성공 표기 — `dunning.ts:187-207`.
- **[S3-4]** 유예 lapse~watchdog 사이 Failed 이벤트가 7일 유예 재발급(INV-6 엣지) — `dunning.ts:119-134`.
- **[S5-2]** 결제 상태변경 라우트 CSRF 방어가 SameSite 쿠키 단일 의존(Origin/토큰 없음) — `cancel/route.ts`, `complete/route.ts`.
- **[S6-3]** 빌드타임 dotenv 우선순위 함정 — 셸 env가 `.env`를 조용히 이김, 스트립/경고 없음 — `electron.vite.config.ts:5,53-57`.
- **[S4-4~6]** PubMed에 진단명 쿼리스트링 전송, analyzer/clova 에러가 진단명·provider 본문을 로그(로컬 한정).

## 불변식 → 프로브 커버리지

| 불변식 | 판정 | 증명 프로브 |
|---|---|---|
| INV-1 ECDSA 서명 | PASS | probe-entitlement (단, "공개키 스왑" 케이스 없음 = S2-1 미증명) |
| INV-2 게이트 범위 | PASS | probe-gate, probe-gate-driver |
| INV-3 웹훅 원문검증 | PASS | probe-webhook (시나리오 3) |
| INV-4 재예약 단일구현 | PASS | 구조적 |
| INV-5 주기 산술 | PASS | probe-webhook (시나리오 8) |
| INV-6 유예 비연장 | PASS(엣지 S3-4 미증명) | probe-dunning |
| INV-7 RLS/EXECUTE | PASS | 마이그레이션 내 aclexplode 가드 |
| INV-8 번들 무시크릿 | **FAIL** | (S6-1 CLOVA, S6-2 가드공백) |
| INV-9 방문코드 | PASS | probe-visit-code |
| INV-10 옵스 프로브 | PASS | 코드 검증 |

**어느 프로브도 안 치는 경로**: S2-1(키 스왑), S2-2(클록 롤백), S3-1(봉투 밖 OTP), S3-2(복구 경합), S3-3(키 없는 철회).

## 교차 서브시스템 체인

1. **S5-1 + preload 브리지**: 렌더러가 원격 origin으로 이동하면 `window.api`로 PHI 조회·결제 IPC까지 접근 → 단일 최고위험.
2. **S6-1 + 서버 게이트 부재(CLOVA)**: Gemini/OpenAI와 달리 CLOVA는 직결이라 임베드 키 유출이 곧 과금 유출.
3. **S2-1 + S6-3**: 둘 다 user-writable dotenv(userData/home)를 신뢰하는 같은 뿌리 → 한 번에 고칠 수 있음.
4. **S1-1 + S1-4**: admin 계정이 임의 사용자의 server usage 행 삭제 가능.

## 잘 되어 있는 것

엔타이틀먼트 서버 백스톱(402 fail-closed)으로 클라이언트 우회해도 AI 과금은 못 함. 웹훅 원문검증·멱등 3겹.
방문코드 서버측 판정+레이트리밋(실패만 카운트). 옵스 프로브 PHI 무접촉. ECDSA 개인키 앱 코드 부재.
다운로드 서명 URL은 enum 키만(경로조작 불가). git에 실 .env 미추적, 웹 번들 시크릿 0건.
