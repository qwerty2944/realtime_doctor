# 관측 (Observability) — 지금 사람이 봐야 할 것

이 제품은 얼마 전까지 **자기 고장을 아무에게도 알리지 않았다.** 키오스크가 멈추거나
`entitlement` 가 500 을 뿜기 시작하면 첫 신호가 진료 중인 의사의 전화였다. 이 문서는
그 자리를 메운 것들이 무엇이고, 채널이 붙기 전까지 사람이 무엇을 어떻게 봐야 하는지를
적는다.

---

## 0. 오늘 볼 것 — URL 하나

```
https://entanglecare.com/api/health
```

**여기 한 곳만 보면 된다.** 이 응답이 제품 상태와 감시자 자신의 상태를 같이 실어 나른다.

읽는 법:

| 볼 곳 | 정상 | 이상이면 |
|---|---|---|
| `status` | `"ok"` | `"degraded"` 는 제품은 돌지만 감시가 반쪽 / `"down"` 은 통계 화면이 동작하지 않음 (HTTP 503) |
| `checks[].ok` | 전부 `true` | `false` 인 항목의 `detail` 이 원인과 다음에 볼 곳을 말한다 |
| `extra.prober.stale` | `false` | **`true` 면 감시가 멈춘 것이다.** 이때는 나머지 화면이 멀쩡해 보여도 아무도 지켜보고 있지 않다 |
| `extra.prober.lastRunStatus` | `"ok"` | 마지막 순회에서 발견된 문제의 요약 |
| `extra.alerting.targetConfigured` | `true` | **`false` = 지금 상태.** 이상은 DB 에 기록되지만 아무에게도 전달되지 않는다 |

터미널 한 줄:

```bash
curl -s https://entanglecare.com/api/health | python3 -m json.tool
```

### 지금(채널 미설정) 기대되는 정상 상태

`status: "degraded"`, 실패 검사는 `alerting` **하나뿐**. 이건 고장이 아니라
"알림 채널이 아직 없다"의 표시다. `alerting` 말고 다른 검사가 실패하면 그건 진짜다.

`admin-web` 표면(`https://entanglecare.com/righthand/api/health`)도 지금은 `degraded`
이고, 실패 검사는 `portone` 과 `watchdog` 둘이다. 앞의 것은 포트원 자격이 아직
없다는 사실이고, 뒤의 것은 그 때문에 감시 크론이 매 실행 중단된다는 사실이다.
**둘 다 자격이 도착하면 함께 사라진다.** 그 전에 이 둘 말고 다른 검사가 실패하면
그건 진짜다.

`degraded` 를 `ok` 로 만들려면 §4 의 환경변수 하나를 채우면 된다. 알림이 아무 데도
안 가는 동안 최상위 상태가 초록으로 보이는 것보다는, 초록이 아닌 편이 낫다고 판단했다 —
이 기능이 없애려는 것이 바로 "초록인데 아무도 안 보고 있음"이기 때문이다.

---

## 1. 표면별 헬스체크 — 무엇을 증명하고 무엇을 증명하지 않는가

각 응답이 `provesWhenOk` / `doesNotProve` 를 스스로 싣고 있다. 코드를 안 열어도
그 한계를 읽을 수 있어야 하기 때문이다. 요약:

| 표면 | URL | 증명한다 | 증명하지 **않는다** |
|---|---|---|---|
| doctor-web | `/api/health` | Supabase 도달, `f_web_stats_*` 네 함수가 **실제 테이블 위에서 실행**됨, 감시자 생사, 알림 대상 유무 | 통계 **숫자가 옳은지**(합성 subject 라 집계는 항상 0), 의사 로그인·쿠키 갱신 경로 |
| admin-web | `/righthand/api/health` | service_role 로 `subscriptions` 도달(=키가 **유효**함), 결제 자격 4종의 **존재**, 결제 주기 감시 크론(watchdog)의 마지막 실행 시각 | 포트원 자격이 **유효한지**, 카드 등록 흐름 전체, `is_admin` 게이트(세션 필요) |
| kiosk | `/righthand/patient/api/health` | 담당 의사 매핑이 실재하는 계정을 가리킴, `redeem_visit_access_code()` 가 실제로 돎, 그 실행이 **아무것도 소모하지 않음** | 유효한 코드가 실제로 진료를 여는지, Gemini 키가 **유효한지** |
| edge:entitlement | `…/functions/v1/entitlement?health=1` | `subscriptions`/`plans` 읽기, **ECDSA 개인키로 실제 서명 1회** | 특정 사용자 판정의 정확성, 앱의 공개키가 짝인지 |
| edge:device | `…/device?health=1` | `devices`/`plans` 읽기 | 기기 수 제한이 옳게 세어지는지 |
| edge:ai-gemini | `…/ai-gemini?health=1` | 게이트가 읽는 `subscriptions`, 계량이 쓰는 `usage_events`, 키 **존재** | `GEMINI_API_KEY` 가 **유효한지** — 만료·한도초과 키도 통과한다 |
| edge:ai-realtime | `…/ai-realtime?health=1` | 위와 동일 | `OPENAI_API_KEY` 가 **유효한지** |

Edge Function 은 게이트웨이 JWT 검증이 켜져 있어 anon 키가 필요하다:

```bash
curl -s "https://yhwvwojjwwlcrvpfxgag.supabase.co/functions/v1/entitlement?health=1" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

### 공통 원칙

- **provider 를 부르지 않는다.** 감시가 매 실행마다 유료 API 를 두드리면 감시 주기가
  곧 비용이 되고, 비싼 감시는 결국 꺼진다. 대신 "키가 유효한지는 모른다"를 명시한다.
- **PHI 를 만들지도 읽지도 않는다.** 존재 확인용 `head` 요청만 쓴다.
- **비밀값을 응답에 담지 않는다.** 환경변수는 이름과 존재 여부만 나간다.
- HTTP 코드: `200` = ok/degraded, `503` = down. degraded 에 503 을 주면 상태 코드만
  보는 감시자가 "완전히 죽음"과 "일부 이상"을 구별할 수 없게 된다.

---

## 2. 프로버 — 어디서 언제 도는가

- 위치: `doctor-web` `/api/ops/probe` (Vercel Cron, `doctor-web/vercel.json`)
- 주기: **하루 1회 UTC 18:00 = KST 03:00**
- 인증: `Authorization: Bearer $CRON_SECRET`

### 왜 admin-web 이 아닌가

원래 이유는 "admin-web 이 배포되지 않아서"였다. 2026-08-07 에 배포됐으므로 그 이유는
사라졌지만 **옮기지 않는다.** 감시자는 감시 대상 중 가장 확실히 살아 있는 곳에 두는
편이 낫고, `entanglecare.com` 을 서비스하는 앱이 그곳이다. admin-web 은 이제 감시
**대상**이다(§1 의 표).

### 크론 두 개, 규칙 하나

| 잡 | 위치 | 경로 | 인증 |
|---|---|---|---|
| ops 프로버 | `doctor-web/vercel.json` | `/api/ops/probe` | `Bearer $CRON_SECRET` |
| 결제 감시 | `admin-web/vercel.json` | `/righthand/api/billing/watchdog` | `Bearer $CRON_SECRET` |

[HARD] **이름은 반드시 `CRON_SECRET`.** Vercel Cron 은 정확히 그 이름의 환경변수가
있을 때만 Bearer 를 붙인다. 값은 프로젝트마다 다르다(한쪽이 새도 다른 쪽이 열리지
않게).

[HARD] **admin-web 의 크론 경로에는 basePath 가 들어간다.** admin-web 은
`NEXT_PUBLIC_BASE_PATH=/righthand` 로 빌드되므로 접두사 없는 `/api/billing/watchdog`
은 404 다. 그리고 404 는 라우트에 닿기 전이라 `subscription_watchdog_runs` 에 아무것도
남기지 않는다 — 시크릿 이름이 틀렸을 때와 **증상이 완전히 같다**(둘 다 "아무 일도
안 일어남"). 둘 다 `admin-web/scripts/assert-cron-secret-name.mjs` 가 빌드에서 막는다.

### 왜 하루 1회뿐인가 — 설계가 아니라 요금제 제약

Vercel 계정이 **Hobby 플랜**이고 Hobby 의 Cron 은 하루 한 번까지만 실행된다. 진료 중에
쓰이는 제품에는 부족하다. 코드 변경 없이 올리는 방법이 둘 있다:

1. **Vercel Pro** 로 올린 뒤 `vercel.json` 의 schedule 을 `*/5 * * * *` 로,
   `OPS_PROBE_INTERVAL_MINUTES` 를 `5` 로 바꾼다.
2. **외부 스케줄러**(cron-job.org 등)로 같은 URL 을 `Authorization: Bearer $CRON_SECRET`
   과 함께 5분마다 친다. 이쪽이 더 낫다 — 감시자가 Vercel **밖**에 있게 되기 때문이다
   (아래 참조).

---

## 3. 프로버가 자기 죽음을 다루는 법

**스케줄 잡은 자기 죽음을 스스로 알릴 수 없다.** 죽은 뒤에는 아무 코드도 돌지 않는다.
우회는 없다. 할 수 있는 두 가지를 둘 다 한다:

1. **사후 보고.** 매 실행이 이전 실행과의 간격을 재서 기대의 1.5배를 넘으면
   `ops_probe_runs.missed_previous_run = true` 로 기록하고 알린다. 멈춤이 **끝난 뒤에는**
   반드시 드러난다. 안에서 할 수 있는 최선이 여기까지다.
2. **상시 노출.** 매 실행이 `expected_next_run_at` 을 기록하고, `ops_probe_status` 뷰가
   그것과 지금을 비교해 `prober_stale` 을 계산한다. `/api/health` 가 그 값을 실어
   나르므로, 프로버가 죽으면 **죽은 그 순간부터** URL 하나로 보인다. 임계값이 뷰 한
   곳에만 있어서 판독자가 늘어도 서로 어긋나지 않는다.

**남는 구멍(숨기지 않는다):** 크론과 헬스체크가 같은 Vercel 계정 위에 있으므로
**Vercel 전체가 죽으면 둘 다 죽는다.** 그 경우를 보려면 감시자가 Vercel 밖에 있어야
한다. §2 의 2번(외부 스케줄러)이 이 구멍까지 같이 막는 유일한 선택지다.

`ops_probe_runs` 는 **이상이 없을 때도** 행을 남긴다(`subscription_watchdog_runs`,
0004 와 같은 원칙). 남기지 않으면 "오늘 전부 정상"과 "이 잡이 3월부터 안 돌고 있음"이
DB 상에서 똑같이 흔적 없음이 된다.

---

## 4. 알림 — 지금은 아무 데도 안 간다

알림 대상은 환경변수 **하나**다:

```
OPS_ALERT_WEBHOOK_URL=<JSON POST 를 받는 URL>
```

Slack/Discord incoming webhook, Google Chat, ntfy, n8n 등 대부분이 그대로 맞는다.
페이로드는 `text`(채팅 앱이 렌더)와 구조화 필드(`surface`, `issue`, `severity`,
`detail`, `runId`)를 **둘 다** 담는다. 채널을 아직 안 정했고, 정하는 일이 코드 변경이
되어서는 안 되므로 SDK 를 붙이지 않았다.

### 설정하지 않으면 — [HARD] 조용히 넘어가지 않는다

가장 쉽게 잘못 만들어지는 방향은 "대상이 없으면 아무 일도 안 하고 성공한 척"이다.
그건 이 기능 전체가 막으려는 실패를 이 기능 안에 다시 심는 짓이다. 그래서 미설정 시
**같은 사실이 다섯 곳에 남는다**:

1. `ops_probe_runs.alert_target_configured = false`
2. `ops_probe_runs.alerts_undeliverable` 에 못 보낸 건수
3. `ops_probe_runs.details.wouldHaveSent` 에 **보냈어야 할 내용 그대로**
4. `ops_probe_runs.alert_error` 에 문장으로 된 이유
5. `/api/health` 의 `alerting` 검사 실패 + 실행 상태 `degraded` 강등

Vercel 런타임 로그에도 `[ops][전달불가]` 로 한 줄씩 남는다.

### 중복 억제

`(surface, issue)` 로 상태를 잡아 같은 문제는 `OPS_ALERT_REPEAT_MINUTES`(기본 24시간)
마다 한 번만 다시 알린다. 억제가 없으면 표면 하나가 깨졌을 때 매 실행마다 같은 알림이
나가고, 소음이 된 채널은 사람이 읽지 않는다 — 알림의 목적 자체가 사라진다.
복구되면 한 번 복구 알림을 보내고 `resolved_at` 을 채운다.

**알림 채널 자체에 대해서는 알리지 않는다.** "보낼 곳이 없다"를 보낼 곳이 없는 채널로
알리는 것은 순환이다. 그 사실은 위 다섯 곳에 이미 있다.

---

## 5. 기록을 직접 읽기 (상태 화면이 생기기 전까지)

`admin-web` 은 배포됐지만 아직 관측 상태 화면을 갖고 있지 않다. 그전까지는 아래
쿼리가 상태 페이지다.
전부 **service_role 전용**이다(anon/authenticated 는 GRANT 도 정책도 없다).

### 한 줄 요약

```sql
select * from public.ops_probe_status;
```

`status`, `age_seconds`(마지막 실행 경과), `seconds_late`(예정 대비 지연, 음수면 아직
안 됨), `prober_stale`, `alert_target_configured`, `open_issue_count`.

### 최근 순회 이력

```sql
select started_at, status, ok_count, degraded_count, down_count,
       missed_previous_run, alert_target_configured, alerts_undeliverable
from public.ops_probe_runs
order by started_at desc
limit 20;
```

`missed_previous_run = true` 인 행은 **그 앞 구간에 감시가 멈춰 있었다**는 뜻이다.

### 어떤 표면이 왜 실패했나

```sql
select r.started_at, s->>'surface' as surface, s->>'status' as status,
       s->>'httpStatus' as http, s->>'issue' as issue, s->>'detail' as detail
from public.ops_probe_runs r,
     lateral jsonb_array_elements(r.details->'surfaces') s
where s->>'status' <> 'ok'
order by r.started_at desc
limit 50;
```

### 보내지 못한 알림의 내용

```sql
select started_at, jsonb_pretty(details->'wouldHaveSent')
from public.ops_probe_runs
where jsonb_array_length(coalesce(details->'wouldHaveSent', '[]'::jsonb)) > 0
order by started_at desc
limit 10;
```

### 아직 안 닫힌 문제

```sql
select surface, issue, first_seen_at, last_seen_at, streak, alert_count, last_detail
from public.ops_probe_alert_state
where resolved_at is null
order by first_seen_at;
```

---

## 6. 손으로 한 바퀴 돌리기

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://entanglecare.com/api/ops/probe | python3 -m json.tool
```

`CRON_SECRET` 은 `doctor-web/.env.local` 과 Vercel 프로젝트 환경변수에 있다.

**[HARD] 이름을 바꾸지 말 것.** Vercel Cron 은 정확히 `CRON_SECRET` 이라는 이름의
환경변수가 있을 때만 `Authorization: Bearer` 를 자동으로 붙인다. 다른 이름을 쓰면 크론이
매 실행 401 을 받고 **아무도 모르게 한 번도 성공하지 못한다.**

---

## 7. 데이터베이스 쪽 (마이그레이션 0017)

| 객체 | 용도 |
|---|---|
| `ops_probe_runs` | 순회 1회당 1행. 이상 없어도 기록 |
| `ops_probe_alert_state` | `(surface, issue)` 중복 억제 원장 |
| `ops_probe_status` | 위 §5 의 한 줄 요약 뷰 |
| `f_ops_stats_probe()` | 통계 함수 네 개를 합성 subject 로 실제 실행 |
| `f_ops_intake_probe(uuid, text)` | 방문 코드 판정을 **롤백되는 서브트랜잭션**에서 실제 실행 |

`f_ops_intake_probe` 가 롤백을 쓰는 이유: `redeem_visit_access_code` 의 실패 경로는
**의도적으로** 무차별 대입 카운터를 남긴다(0009 헤더: "공격자와 함께 되감기는 속도
제한은 속도 제한이 아니다"). 그대로 부르면 헬스체크가 병원의 무차별 대입 예산을
갉아먹고, 주기가 짧아지면 실제 환자가 거절된다 — 감시가 스스로 장애를 만드는 모양이다.
반환값의 `consumedNothing` 이 소모가 없었음을 값으로 증명한다.

권한: 전부 service_role 전용. RLS 켜짐, 정책 없음, `anon`/`authenticated` 는 GRANT 도
없다(0013 의 named-grantee 문제 때문에 `from public` 만으로는 부족해서 이름을 직접 적어
revoke 한다). 0013 의 가드를 파일 끝에서 **다시 실행**해 살아 있는 카탈로그에 대해
확인한다.

---

## 8. 아직 안 된 것

- **알림 채널.** `OPS_ALERT_WEBHOOK_URL` 을 채우기 전까지 알림은 기록만 되고 전달되지
  않는다. 이것이 지금 가장 큰 남은 구멍이다.
- **감시 주기.** 하루 1회는 진료 중 제품에 부족하다(§2).
- **외부 감시자.** Vercel 자체 장애는 현재 구성으로 볼 수 없다(§3).
- **상태 화면.** `admin-web` 은 배포됐지만 관측 화면은 아직 없다. 데이터는 §5 형태로 준비돼 있다.
- **provider 키 유효성.** 유료 호출 없이는 확인할 수 없어 의도적으로 범위 밖이다.
