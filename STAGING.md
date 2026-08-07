# STAGING — 리허설 환경 운영 규칙

이 문서가 존재하는 이유는 하나다. **지금까지 모든 마이그레이션과 Edge Function 배포는
운영 데이터베이스에 곧바로 적용됐다.** 매번 검증했고 매번 되돌릴 방법이 있었지만, 그건
주의력이지 안전장치가 아니다. 그 데이터베이스에는 이제 실제 환자 데이터, 결제 키,
임상 감사 추적이 들어 있다. 이 문서는 "먼저 연습할 곳"을 절차로 고정한다.

## 두 프로젝트

| | 운영 (production) | 스테이징 (staging) |
|---|---|---|
| Supabase ref | `yhwvwojjwwlcrvpfxgag` | `ywsdxnpilcesudtyrewt` |
| 이름 | `realtime-doctor` | `realtime-doctor-staging` |
| 리전 | ap-northeast-2 | ap-northeast-2 |
| 데이터 | 실제 환자·결제·감사 기록 | 합성 데이터만 |
| Vercel 환경 | Production | Preview |
| 도메인 | `entanglecare.com` | Vercel preview URL (배포마다 다름) |

스테이징은 `0000`~`0017` 전체를 **빈 프로젝트에 처음부터 적용해서** 만들었다. 즉
스테이징의 존재 자체가 "마이그레이션 이력이 데이터베이스를 무에서 재구성할 수 있다"는
증명이다. 그 성질을 잃지 않으려면 아래 순서를 지켜야 한다.

## [HARD] 순서

```
마이그레이션 작성
  → 스테이징에 적용        (실패하면 여기서 끝난다. 운영은 아직 모른다)
  → 구조 지문 diff 로 확인  (운영과 어긋나는 것이 의도한 차이인지 본다)
  → 권한 감사 통과 확인     (0013 verdict = PASS)
  → 운영에 적용
  → 운영에서 같은 세 검사를 다시
```

거꾸로 하면 스테이징은 "운영을 따라 만든 사본"이 되고, 사본은 아무것도 리허설하지
못한다 — 운영에서 이미 통과한 것만 통과한다.

### [HARD] `supabase db push` 를 쓰지 않는다

운영(`yhwvwojjwwlcrvpfxgag`)의 원격 이력표는 타임스탬프 version 으로 쌓여 있어 로컬
파일 번호(`0000`~`0017`)와 하나도 맞지 않는다. `db push` 를 하면 18개를 전부 다시
실행한다. 대신 `scripts/staging/db.mjs` 를 쓴다 — Management API 의 query 엔드포인트를
쓰고, 그 엔드포인트는 **파일 하나를 한 트랜잭션**으로 돌린다(실패한 마이그레이션이
절반만 남지 않는다).

스테이징의 이력표는 처음부터 파일 번호(`0000`…`0017`)로 맞춰 두었다. 운영의 어긋난
이력을 스테이징까지 물려받게 할 이유가 없다.

## 적용하기

```bash
# 전제: supabase login (SUPABASE_ACCESS_TOKEN 이 환경에 있어야 한다)

# 스테이징에 전체 체인을 적용 (빈 프로젝트를 처음부터 세울 때)
node scripts/staging/db.mjs apply ywsdxnpilcesudtyrewt

# 새 마이그레이션 한 장만 적용 (기존 데이터베이스에 이어붙일 때)
supabase db query --db-url "$STAGING_DB_URL" -f supabase/migrations/0018_xxx.sql
```

`apply` 는 멱등하다 — 이 레포의 마이그레이션은 전부 `if not exists` / `create or replace`
로 쓰여 있고, 이력표 삽입은 `on conflict do nothing` 이다. 다시 돌려도 no-op 이다.

> **[HARD] `0013` 을 다시 돌렸다면 `0014` 도 곧바로 다시 돌린다.** `0013` 은 실행될 때마다
> `role_privilege_allowlist` 를 비우고 다시 채우므로 `0014` 가 넣은 네 행이 사라지고,
> 그다음 `0013` 의 가드가 `0014` 의 함수 권한을 구멍으로 보고 실패한다.
> (`supabase/migrations/README-0014-web-statistics.md`)

## 검증하기

### 1. 구조 diff — 운영이 마이그레이션 파일에서 벗어났는가

```bash
node scripts/staging/db.mjs fingerprint yhwvwojjwwlcrvpfxgag > /tmp/prod.txt
node scripts/staging/db.mjs fingerprint ywsdxnpilcesudtyrewt > /tmp/staging.txt
diff -u /tmp/prod.txt /tmp/staging.txt
```

빈 diff = 운영 스키마가 마이그레이션 파일이 만드는 것과 정확히 같다. 지문이 보는 것:
컬럼 · 테이블(+RLS 플래그) · 함수(+SECURITY DEFINER) · 정책 · 인덱스 · 제약 ·
트리거(`public` + `auth.users`) · 테이블 GRANT · 함수 GRANT · 확장 · 시퀀스 · enum ·
기본 권한(`pg_default_acl`).

**행 데이터는 보지 않는다.** 운영의 PHI 를 읽지 않기 위해서다. 그래서 이 diff 는
"스키마가 같다"만 말하고 "데이터가 같다"는 말하지 않는다 — 후자는 애초에 목표가 아니다.

### 2. 권한 감사 — 살아 있는 카탈로그 기준

```bash
node scripts/staging/db.mjs audit ywsdxnpilcesudtyrewt   # VERDICT: PASS 여야 한다
node scripts/staging/db.mjs audit yhwvwojjwwlcrvpfxgag
```

기준은 `supabase/audit/named-role-privileges.sql` 하나이고, 그 파일은 자기 허용목록을
복사하지 않고 `public.role_privilege_allowlist`(0013 이 채운다)를 읽는다. 검사 항목:
PUBLIC EXECUTE 0건, 허용목록 밖의 `anon`/`authenticated` 함수 EXECUTE 0건, PUBLIC 이 닿는
릴레이션 0건, 허용목록 밖의 `anon`/`authenticated` 테이블 권한 0건.

이 감사가 실제로 구멍을 본다는 것은 스테이징에서 일부러 뚫어 확인했다
(`grant select on public.ops_probe_runs to anon` → PART C 1행 + verdict FAIL → revoke 후 다시 PASS).

### 3. 테이블 인벤토리 · 헬스체크

```bash
node scripts/staging/db.mjs inventory ywsdxnpilcesudtyrewt

# Edge Function 4종 (PUBLISHABLE 은 스테이징 publishable key)
for f in entitlement device ai-gemini ai-realtime; do
  curl -s -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $PUBLISHABLE" \
    "https://ywsdxnpilcesudtyrewt.supabase.co/functions/v1/$f?health=1" | head -c 200; echo
done
```

## Edge Function 과 시크릿

스테이징에 배포된 함수: `entitlement`, `device`, `ai-gemini`, `ai-realtime` (전부
`verify_jwt=true`, 운영과 동일).

```bash
supabase functions deploy entitlement --project-ref ywsdxnpilcesudtyrewt --use-api
supabase secrets list --project-ref ywsdxnpilcesudtyrewt
```

시크릿 5종: `ENTITLEMENT_PRIVATE_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_ALLOWED_MODELS`, `OPENAI_TRANSCRIBE_MODEL`.

### [HARD] 서명 키는 반드시 분리한다

`ENTITLEMENT_PRIVATE_KEY` 는 스테이징 전용으로 **새로 발급한 ECDSA P-256 키쌍**이다.
운영 키를 재사용하면 스테이징이 운영 앱이 받아들이는 토큰을 찍을 수 있고, 그러면
환경 분리가 존재하지 않는 것과 같다.

스테이징 공개키 (SPKI base64, 앱에는 넣지 않는다 — 스테이징 토큰 검증용):

```
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3hwcVSri0PgqCLwCDrvKdDWaLxuukqxschbpVJ3UJyItq+Bsd6LFMlkHQmpoCiUASUWN4HCp2Nq5pUL501LWxg==
```

분리 증명 방법 — 스테이징에서 실제 토큰을 하나 받아 두 공개키로 검증한다.
스테이징 공개키로는 통과하고 운영 공개키(`.env` 의 `ENTITLEMENT_PUBLIC_KEY`)로는 실패해야
한다. 서명 대상 문자열은 `supabase/functions/entitlement/index.ts` 의 `canonicalize()` 와
앱의 `src/main/subscriptionToken.ts` 가 공유하는 15줄 규격이다.

**공급자 키(Gemini/OpenAI)는 운영과 같은 값을 쓴다.** 리허설에서 확인하려는 것은
게이트·판정·경로이지 공급자 계정 분리가 아니고, 키를 나누면 스테이징에서만 나는 400 이
게이트 문제인지 키 문제인지 구별되지 않는다. 다만 스테이징 호출도 **같은 계정에
과금된다** — `GEMINI_ALLOWED_MODELS` 는 운영과 동일하게 `gemini-3.5-flash-lite` 하나로
좁혀 두었다.

## 웹 표면 — Vercel Preview

`doctor-web` 는 `backup`(`mole-bi-com/realtime-doctor`)에 git 연결돼 있고 production
branch 는 `history/v0.6.0-split` 이다. **그 브랜치에 푸시하면 운영이 배포된다.**

Vercel 은 환경변수를 Production / Preview / Development 로 나눠 갖는다. 스테이징 배선은
그 분리를 그대로 쓴다 — 별도 Vercel 프로젝트를 만들지 않았다. 프로젝트를 나누면
`next.config.ts` 의 rewrite, 리전, 루트 `.vercelignore` 같은 것들이 두 벌이 되고, 갈라진
둘 중 하나만 고쳐지는 날 리허설이 실물과 다른 것을 검증하게 된다.

| 변수 | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 운영 프로젝트 | 스테이징 프로젝트 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 운영 anon | 스테이징 anon |
| `SUPABASE_SERVICE_ROLE_KEY` | 운영 service_role | 스테이징 service_role |
| `CRON_SECRET` | 운영 값 | 스테이징 전용 값 |

```bash
cd doctor-web
npx vercel env ls --scope mole-bi-coms-projects     # 두 환경이 각각 4개씩
```

### 리허설하는 법

```bash
git switch -c rehearsal/<주제>
# ... 변경 ...
git push backup rehearsal/<주제>
# Vercel 이 자동으로 preview 를 만든다. 그 preview 는 스테이징 Supabase 를 본다.
```

`history/v0.6.0-split` 은 건드리지 않았으므로 `entanglecare.com` 은 그대로다.
운영으로 내보낼 때만 `history/v0.6.0-split` 에 머지하고 푸시한다.

> `NEXT_PUBLIC_*` 는 **빌드 타임에 번들로 들어간다.** Preview 변수를 바꿨다면
> 재배포해야 반영된다. 기존 preview URL 은 옛 값을 들고 있다.

## [HARD] 일부러 미러하지 않는 것

스테이징은 운영의 사본이 아니다. 아래는 **의도적으로** 빠져 있다.

| 빠진 것 | 이유 |
|---|---|
| **실제 환자 데이터(PHI)** | 환자 데이터를 복사하는 순간 스테이징이 두 번째 PHI 보관소가 된다. 접근 통제도 감사 추적도 운영만큼 지키지 않을 곳이다. 데이터가 필요하면 **합성 행을 만든다** — `scripts/seed-demo.sql` 이 그 용도이고 전부 지어낸 사람이다. |
| **PortOne (결제)** | 스토어/채널/API 시크릿을 넣지 않았다. 넣으면 스테이징의 리허설이 실제 카드에 실제 예약을 건다. 결제 경로 검증은 PortOne 자체의 테스트 채널에서 하는 일이고 (S6), 그건 스테이징과 독립적인 축이다. 결과: 스테이징에서 `billing_*` / `webhook_events` / `payment_attempts` 는 스키마만 있고 늘 비어 있다. |
| **`app-releases` 스토리지 버킷** | 데스크톱 설치 파일 수백 MB. 복사해도 검증되는 것은 "파일 복사가 됐다"뿐이고, 다운로드 경로에서 실제로 확인해야 하는 것(서명 URL 발급 · digest 일치 · `web_app_download_audit` 기록)은 버킷 내용이 아니라 코드다. 대신 그 코드 경로는 합성 객체 하나로 리허설할 수 있다. |
| **`entanglecare.com` 도메인** | preview 는 Vercel 이 주는 주소를 쓴다. 스테이징에 커스텀 도메인을 붙이면 운영 도메인 설정과 두 벌이 되고, 무엇보다 검색엔진과 사용자에게 두 번째 진짜처럼 보이는 주소가 생긴다. |
| **Vercel Cron** | Vercel 은 production 배포에서만 크론을 돌린다. preview 의 `/api/ops/probe` 는 `CRON_SECRET` Bearer 로 **손으로** 칠 수 있다. 스테이징이 스스로 감시 알림을 쏘지 않는 것은 의도한 것이다 — 두 환경이 같은 웹훅으로 알리면 어느 쪽이 아픈지 구별되지 않는다. |
| **`OPS_ALERT_WEBHOOK_URL`** | 위와 같은 이유. 스테이징은 알리지 않는다. |
| **`righthand-patient` (키오스크)** | 이번 범위 밖. 키오스크는 CLI 배포이고 자체 Vercel 프로젝트라 preview 환경을 따로 배선해야 한다. 지금 스테이징을 보는 웹 표면은 `doctor-web` preview 하나다. |

## 알려진 차이 (리허설 충실도의 한계)

- **스테이징에는 `care_activity_defs` 씨드 5종이 없다.** 그건 마이그레이션이 아니라
  로더(`scripts/load-care-activities.mjs`)가 넣는 데이터다. B 파트를 리허설하려면 먼저
  로더를 돌려야 한다.
- **`plans` 1행과 `role_privilege_allowlist` 60행만 들어 있다.** 둘 다 마이그레이션이
  넣는 행이고, 운영과 같다.
- **Auth 설정(이메일 확인 등)은 마이그레이션이 표현하지 못한다.** 대시보드 설정이라
  구조 지문에 잡히지 않는다. 운영은 Confirm email 이 꺼져 있다 (STATE.md). 가입 흐름을
  리허설하려면 스테이징에서도 같은 상태인지 확인할 것.
- **스테이징 프로젝트가 `ACTIVE_HEALTHY` 를 보고한 뒤에도 `storage` 스키마는 아직
  준비되지 않을 수 있다.** `0000` 이 `storage.buckets` 에 INSERT 하므로 그 창에서
  적용하면 실패한다. 실패는 트랜잭션째 롤백되므로 잠시 뒤 다시 돌리면 된다.
