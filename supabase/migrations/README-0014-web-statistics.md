# `0014_web_statistics.sql` — 배경 노트

`0014`만 유일하게 별도 노트를 갖는 이유는, 이 파일이 다른 저장소(`righthand_voice`)에서
작성되고 **거기서 이미 프로덕션에 적용된 뒤** 이쪽으로 옮겨 왔기 때문입니다. 옮기면서
사라질 뻔한 결정들을 여기에 남깁니다.

## 상태

- 대상 DB: **`yhwvwojjwwlcrvpfxgag`** (`realtime-doctor`, ap-northeast-2) — 이 저장소의
  마이그레이션 히스토리가 가리키는 바로 그 실 운영 DB입니다.
- **이미 적용됨.** 이 파일의 이동은 기록 정리(bookkeeping)이며, 다시 실행할 일이 없습니다.
- 번호 `0014`는 비어 있음을 확인하고 골랐습니다: 이 디렉토리의 최고 번호가 `0013`이고,
  git 히스토리 전체에도 `0014*`가 추가된 적이 없습니다.
- 파일은 멱등합니다(`create table if not exists`, `create or replace`, 자기 allowlist
  키에 대한 delete-then-insert). 재실행은 no-op입니다.

## 롤백 스크립트의 위치

되돌리기 스크립트는 `supabase/migrations/`가 아니라 **`supabase/rollback/0014_web_statistics_down.sql`**
에 있습니다. 마이그레이션 디렉토리에 두면 이름순으로 적용하는 도구가 `0014`를 만든 직후
곧바로 지워 버립니다.

되돌리면 `web_stats_export_audit`이 **내용째** 사라집니다 — 대시보드가 사용된 뒤라면 먼저
백업하세요. 그 외에 네이티브 앱이 소유한 객체는 하나도 건드리지 않습니다.

## 무엇을 만드는가

**테이블 하나** — `public.web_stats_export_audit`. 의사가 통계 CSV를 내보냈다는 사실을
기록합니다(user id, 기간 양끝, 행 수). PHI 없음. `service_role` 전용이며 `authenticated`
에게는 아무 권한도 주지 않습니다 — 감사 대상이 쓸 수 있는 감사 기록은 감사 기록이
아닙니다. 웹은 이 기록에 실패하면 다운로드를 내주지 않으므로, 테이블이 없으면 내보내기가
"덜 기록되는" 게 아니라 아예 고장 납니다.

**함수 넷** — `f_web_stats_summary`, `f_web_stats_daily`, `f_web_stats_diagnosis`,
`f_web_stats_chief_complaint`. 모두 `(date, date)`, Asia/Seoul 기준 양끝 포함 범위이며
앱 자신의 `encounters` + `intake_results` 위에서 집계합니다. 앱 테이블의 웹 전용 복사본은
하나도 만들지 않습니다.

## [HARD] 의사별 범위 제한

함수들은 `SECURITY DEFINER`라서 `encounters`의 RLS가 **적용되지 않습니다.** 각 함수 안에
쓰인 `e.user_id = auth.uid()` 술어가 한 의사의 숫자를 다른 의사에게서 떼어 놓는 **유일한**
장치입니다. 지우지 마세요. 이 테이블들에 그 조건 없이 닿는 코드 경로도 만들지 마세요.

## [HARD] `0013`과의 상호작용

`0013`은 실행될 때마다 `public.role_privilege_allowlist`를 처음부터 다시 만듭니다
(`delete from public.role_privilege_allowlist`, `0013:101`). **`0014` 이후에 `0013`을 다시
적용하면 `0014`가 넣은 네 행이 지워지고, 그다음 `0013`의 가드가 `0014`가 남긴 네 개의 함수
권한을 구멍으로 보고 실패합니다.** `0013`을 다시 돌렸다면 곧바로 `0014`도 다시 도세요.

## `web_` / `f_web_` 접두어를 쓰고 `web` 스키마를 쓰지 않은 이유

1. `supabase-js`는 PostgREST를 거치고, PostgREST는 프로젝트의 *exposed schemas* 설정에
   등록된 스키마만 서비스합니다. 그건 SQL이 아니라 API 설정이라, `web` 스키마는 누군가
   대시보드 필드를 바꾸기 전까지 웹 앱에게 보이지 않습니다 — 마이그레이션이 표현할 수도
   검증할 수도 없는 의존성입니다.
2. `0013`의 권한 가드는 `public`만 감사합니다. `public` 밖의 객체는 가드를 빠져나가고,
   감사를 빠져나가는 것은 안전 속성이 아닙니다.

또한 `sessions`, `patients`, `intake_results`, `evidence_lookups`, `profiles`는 이 프로젝트에
이미 **다른 의미로** 존재합니다. 접두어 덕분에 충돌이 구조적으로 불가능합니다.

## 남겨 두는 지표 결정 (다시 발견하지 않도록)

- **`confirmed_count`는 0이 아니라 없습니다.** 웹 쪽 출처였던 `consult_records.final_diagnosis`
  는 이 프로젝트에 없고, 대응물도 없습니다: `summaries.clinical_impression`은 LLM 출력
  (`src/main/sessions.ts:660`), `dictations.sections`는 생성된 문서, 그리고
  `clinical_decision_events`(`0012`)는 개념 자체를 거부합니다 — 그 헤더의 `[HARD]`:
  *"No 'adopted' / 'overrode' / 'ignored' flag. The app never learns the clinician's own
  diagnosis, so any such label would be inferred."* 영원히 0을 가리키는 타일은 타일이 없는
  것보다 나쁜 답이라 대시보드·CSV·SQL 세 군데에서 모두 뺐습니다.
- **`avg_duration_seconds`는 `min(intake_results.created_at) - encounters.created_at`입니다.**
  encounter 행은 환자가 시작할 때(`kiosk/app/api/intake/start/route.ts:142`), 첫 결과 행은
  문진이 끝나는 순간 `intake_done`으로 올리기 직전에(`kiosk/lib/intake/result.ts:216-251`)
  쓰이므로 그 차이가 문진의 실제 경과 시간입니다. 최신 행이 아니라 `min()`인 이유:
  `0011`의 재해석은 한참 뒤에 새 행을 넣기 때문에, 그걸 쓰면 문진 길이가 아니라 기록의
  나이를 보고하게 됩니다. `web_messages` 테이블을 만들지 않은 이유도 여기 있습니다 —
  키오스크는 대화 전문을 의도적으로 `intake_results.soap_json.transcript`에 넣습니다
  (`kiosk/lib/intake/interview.ts:20`).
- **"최신 해석"은 최고 `version`이 아니라 `superseded_at is null`입니다.** `0011`이 웹의
  `unique(session_id, version)` 규칙을 명시적 supersession으로 바꾸면서 바로 이 술어를 위해
  `intake_results_current_idx on (encounter_id, version desc) where superseded_at is null`을
  만들었습니다.

## 함께 오지 않은 것

`righthand_voice/app/supabase/migrations/`(`0001_init.sql` … `0014_consult_realtime.sql`)는
웹이 쓰던 **자체 Supabase 프로젝트**를 대상으로 한 파일들이고, 그 프로젝트는 삭제됐습니다.
그 안의 여러 파일이 `sessions`, `patients`, `intake_results`, `evidence_lookups`, `profiles`
를 만드는데, 모두 이 프로젝트에 **다른 의미로** 이미 존재합니다. 이쪽으로 옮기지 않았고,
어디에도 두지 않았습니다.
