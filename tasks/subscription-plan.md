# 구독 시스템 계획 (포트원 정기결제)

## 확정된 결정 (사용자)

1. 카드 자동결제 (포트원 빌링키)
2. 의사 1명당 월 정액, 기기 수는 플랜으로 제한
3. 카드 등록 없는 무료 체험
4. 결제·계정 화면은 admin-web에 두고, Electron은 외부 브라우저로 연다

## 의사의 실제 여정

```
앱 설치 → 회원가입 → 체험 시작(카드 없음, 즉시 전 기능)
   → 만료 D-7 부터 dock 에 배너 → "구독하기" 클릭
   → 기본 브라우저로 admin-web 결제 페이지 열림 (자동 로그인 토큰 동반)
   → 포트원 결제창에서 카드 등록 (빌링키 발급)
   → 서버가 즉시 1회 결제 + 다음 달 예약
   → 앱이 구독 상태 재조회 → 잠금 해제
   → 이후 매달 자동 결제, 실패 시 재시도·안내, 최종 실패 시 잠금
```

핵심은 **의사가 앱을 떠나 있는 시간이 결제창 한 번뿐**이라는 것. 결제 후 앱으로 돌아오면
이미 풀려 있어야 한다.

## 이미 있는 것 (재사용)

- Supabase 이메일/비밀번호 인증 (`src/main/auth.ts`), 세션은 electron-store 에 보관
- 기기 등록 / 하트비트 / 원격 해지 (`src/main/device.ts`, `devices` 테이블)
  → 플랜별 기기 수 제한의 토대. 초과 시 가장 오래된 기기를 revoke 하거나 사용자에게 선택시킨다.
- `usage_events` 테이블 → 사용량 리포트·이상 사용 탐지에 사용 (과금 단위는 아님)
- admin-web (Next.js) → 결제·구독 관리 화면을 여기에 붙인다

## 없는 것 (이번에 만든다)

현재 코드베이스 전체에 subscription / plan / billing / trial / 결제 관련 코드가 **하나도 없다.**
즉 지금은 가입만 하면 누구나 전 기능을 무제한으로 쓴다.

---

## [HARD] 보안 전제

- [HARD] 구독 상태 판정은 **절대 클라이언트에서 하지 않는다.** 현재 이 프로젝트는 RLS 가 꺼져 있고
  anon 키가 코드에 커밋돼 있다 (`src/main/supabaseClient.ts:7`). 이 상태로 구독 테이블을 두면
  클라이언트가 자기 구독을 직접 UPDATE 할 수 있어 게이트가 무의미하다.
- [HARD] 구독 테이블은 RLS 를 켜고 **클라이언트에 SELECT 만 허용**한다. INSERT/UPDATE 는
  service_role (Edge Function / 웹훅) 전용.
- [HARD] 포트원 API Secret 과 Supabase service-role 키는 서버에만 둔다. Electron 번들과
  브라우저 번들 어느 쪽에도 들어가면 안 된다. (`electron.vite.config.ts` 가 .env 를 빌드타임에
  인라인하므로 특히 주의 — 결제 관련 키는 그 목록에 추가하지 말 것.)
- [HARD] RLS 를 켤 때 GRANT 를 함께 준다. M1 에서 이걸 빠뜨려 전 테이블이 막혔던 전례가 있다.

---

## 스키마

```
plans            code(pk), name, price_krw, device_limit, active
subscriptions    user_id(pk, fk auth.users), plan_code, status, trial_ends_at,
                 current_period_start, current_period_end, cancel_at_period_end,
                 billing_key, portone_customer_id, grace_until, created_at, updated_at
payment_attempts id, user_id, payment_id(unique), scheduled_for, attempted_at,
                 amount_krw, status, failure_code, failure_message, raw_json
webhook_events   id, portone_event_id(unique), type, payload_json, processed_at
```

`subscriptions.status`: `trialing | active | past_due | canceled | expired`

- `billing_key` 는 포트원이 발급한 참조값(카드번호 아님)이지만 결제 수단 식별자이므로
  RLS 로 보호하고 클라이언트에는 내려보내지 않는다 (마스킹된 카드 표시용 필드를 따로 둔다).
- `payment_attempts.payment_id` 에 unique 를 걸어 **웹훅 중복 수신을 멱등 처리**한다.
  포트원 웹훅은 재전송될 수 있다.
- `webhook_events` 는 감사 로그 겸 중복 방지.

가입 시 `subscriptions` 행을 자동 생성한다 (status=`trialing`, trial_ends_at=now()+N일).
DB 트리거로 걸어야 한다 — 앱에서 만들면 앱을 안 거치고 가입한 계정이 무료 무제한이 된다.

---

## 권한 판정 (entitlement)

Supabase Edge Function `entitlement` 하나로 통일한다. 앱이 이걸 호출하면
**짧은 수명의 서명된 토큰**을 돌려준다.

```
{ userId, status, plan, deviceLimit, expiresAt, issuedAt, sig }
```

- 앱은 이 토큰을 electron-store 에 캐시하고, 서명과 `expiresAt` 을 검증해 기능을 연다.
- 호출 시점: 앱 시작 시, 로그인 직후, 그리고 기존 device 하트비트에 얹어 주기적으로.
  하트비트가 이미 돌고 있으므로 새 타이머를 만들지 않는다.

### 오프라인 유예 — 반드시 정해야 하는 부분

진료실 네트워크가 잠깐 끊겼다고 앱이 죽으면 안 되고, 반대로 랜선을 뽑으면 영구 무료가 돼도 안 된다.

- 서명 토큰의 유효기간을 **72시간**으로 둔다. 그 안에는 오프라인이어도 정상 동작.
- 72시간이 지나도록 갱신에 실패하면 잠금. 잠금 화면에 "인터넷 연결 후 다시 시도" 안내.
- 시계 조작 방어: 마지막으로 관측한 서버 시각을 저장해두고, 로컬 시계가 그보다 뒤로 가면
  토큰을 무효 처리한다.

### 잠금의 범위 — 안전 관련 결정

- [HARD] 잠금은 **새 진료 시작(녹음·분석·문진 수신)을 막는 것**까지다.
  이미 저장된 진료 기록의 **열람·내보내기는 항상 허용**한다. 의료 기록을 결제 상태로
  인질 잡으면 안 되고, 실무적으로도 분쟁 소지가 크다.

---

## 결제 흐름 (포트원 V2)

### 1. 빌링키 발급 — admin-web, 브라우저

`@portone/browser-sdk/v2` 의 `requestIssueBillingKey({ storeId, channelKey, billingKeyMethod: 'CARD', issueId, customer })`.
`issueId` 는 서버가 발급한 1회용 값으로 재사용을 막는다.

### 2. 즉시 1회 결제 + 다음 주기 예약 — 서버

발급 완료 콜백을 서버가 검증한 뒤:
- 첫 결제를 즉시 실행
- `POST https://api.portone.io/payments/{paymentId}/schedule` 로 다음 결제를 예약
  (`payment.billingKey`, `orderName`, `customer.id`, `amount.total`, `currency: KRW`,
  `productType: DIGITAL`, `timeToPay` ISO8601)

**중요**: 포트원의 schedule 은 예약 1건만 잡는다. 자동으로 매달 반복되지 않는다.
따라서 **결제 성공 웹훅을 받을 때마다 다음 달을 새로 예약**해야 한다. 이걸 놓치면
두 번째 달부터 조용히 과금이 멈춘다 — 실패해도 아무 에러가 안 나므로 발견이 늦다.
안전망으로 "다음 예약이 없는 active 구독"을 매일 훑는 크론을 둔다.

### 3. 웹훅 수신

Edge Function 으로 받고 `@portone/server-sdk` 의 웹훅 검증을 거친다. 서명 검증 없는
엔드포인트는 누구나 구독을 활성화할 수 있는 구멍이다.

| 이벤트 | 처리 |
|---|---|
| 결제 성공 | `current_period_*` 갱신, status=`active`, **다음 달 예약 생성** |
| 결제 실패 | status=`past_due`, `grace_until` 설정, 재시도 예약, 안내 발송 |
| BillingKey.Deleted | 결제수단 없음 처리, 재등록 유도 |

### 4. 결제 실패 대응 (dunning)

카드 만료·한도 초과는 정상적으로 발생한다.

- D+0 실패 → `past_due`, 유예 시작, 앱 배너 + 이메일
- D+1, D+3, D+5 재시도
- 유예 7일 경과까지 미해결 → `expired`, 잠금
- 유예 중에는 **기능을 막지 않는다.** 카드 하나 만료됐다고 진료 중에 앱이 멈추면 안 된다.

### 5. 해지·환불

- 해지는 `cancel_at_period_end` 로 처리 — 이미 낸 기간은 끝까지 쓴다.
- 중도 환불은 자동화하지 않는다. 관리자가 포트원 콘솔에서 처리하고 상태를 수동 조정한다.
  월 정액 규모에서 환불 자동화는 투자 대비 효용이 낮다.

---

## Electron 쪽 변경

- `src/main/subscription.ts` (신규): entitlement 조회·캐시·서명 검증, 만료 판정
- 기능 게이트: 녹음 시작 / 분석 / 요약 / 구술 / 문진 수신 진입점에서 확인.
  게이트를 **UI 버튼에만** 걸면 IPC 를 직접 호출해 우회할 수 있으므로 main 의 핸들러에서 막는다.
- dock 에 구독 상태 표시 + 체험 D-7 배너 + "구독하기" 버튼 → `shell.openExternal` 로 admin-web
- 로그인 직후 entitlement 조회 실패 시의 동작을 정의 (네트워크 오류와 미구독을 구분해야 한다.
  둘을 같이 취급하면 서버 장애가 전원 잠금이 된다 — 네트워크 오류는 캐시된 토큰으로 버틴다.)

## admin-web 쪽 변경

- 로그인(기존 Supabase 인증 재사용) — Electron 에서 넘어올 때 매직링크나 1회용 토큰으로 자동 로그인
- 구독 페이지: 현재 플랜/상태/다음 결제일, 카드 등록·변경, 결제 내역, 영수증, 해지
- 기기 관리: 등록 기기 목록 + 해지 (기존 `devices` 재사용)

---

## 순서

1. **S1 스키마 + RLS + GRANT + 가입 트리거** — 먼저 깔아야 나머지가 붙는다
2. **S2 entitlement Edge Function + Electron 게이트 + 오프라인 유예** — 결제 없이도
   체험/만료 로직만으로 검증 가능하다. 여기까지가 "돈을 받을 준비"의 핵심
3. **S3 admin-web 결제 페이지 + 빌링키 발급 + 첫 결제**
4. **S4 웹훅 + 다음 주기 예약 + 예약 누락 감시 크론**
5. **S5 dunning + 해지 + 기기 수 제한 연동**
6. **S6 테스트**: 포트원 테스트 채널로 성공/실패/해지/카드만료 전 경로

S2 까지만 해도 신규 가입자에게 체험을 주고 만료시킬 수 있다. S3 부터 실제 수납이 된다.

## 확정된 상품 조건

| 항목 | 값 |
|---|---|
| 플랜 | 단일 플랜 (`standard`) |
| 월 요금 | 70,000원 (VAT 별도) → **실제 청구 77,000원** |
| 무료 체험 | 7일, 카드 등록 없음 |
| 기기 수 | 2대 |

### 부가세 표기 — 국내 B2B SaaS 관행에 따름

의사는 사업자이고 부가세를 매입세액으로 공제받는다. 그래서 국내 B2B SaaS 는 거의 예외 없이
**"월 70,000원 (VAT 별도)"** 로 표기하고 결제는 77,000원을 청구한다. 이 방식을 따른다.

- `plans.price_krw = 70000`, `vat_krw = 7000`, 포트원 `amount.total = 77000`
- 가격이 노출되는 모든 곳(랜딩, admin-web 결제 페이지, 앱 배너)에 "VAT 별도" 를 함께 적는다.
  결제창 금액과 표기 금액이 다르면 이탈과 문의가 생긴다.
- 결제 직전 화면에는 **77,000원을 최종 결제 금액으로 명시**한다.

> 소비자 대상이었다면 반대로 부가세 포함 표기(총액표시제)가 맞다. 이 서비스는 사업자 대상이라
> 별도 표기를 택했다. 총 매출을 70,000원으로 잡을 생각이었다면 이 결정을 뒤집어야 한다
> (그 경우 순매출은 63,636원이 된다).

### 남은 항목

- 사업자(병원) 대상 세금계산서 요구 — 카드 결제 영수증으로 갈음. 별도 계산서 발행은 이번 범위 제외
