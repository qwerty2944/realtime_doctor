# 환자 목록 / 대기목록 / 문헌근거 / 폰트·창 단축키 개발 계획

대상: realtime_doctor (Electron), Windows 버전 우선 검증.
참조 소스: righthand_voice (Next.js 웹앱) — 코드를 공유하지 않고 **참고·이식**만 한다.

## 확정된 결정 (사용자)

1. 두 앱은 완전 별도. realtime_doctor 자체 Supabase에 환자 스키마를 새로 만든다.
2. 환자 선택 시 → 기존 창들에 데이터만 채워진다 (새 상세 창 없음, 레이아웃 변경 없음).
3. 감별진단 문헌근거 → righthand의 PubMed 조회 로직을 Electron main으로 포팅.
4. 문진 키오스크까지 포팅한다 (환자 유입 경로 확보).
5. 대기목록은 새 오버레이 창(8번째)으로 추가.
6. 단축키: 전역 글씨 크기 확대/축소/리셋 + 창 크기 조절.

## 아키텍처 전제 (합의 필요 없음, 근거 명시)

**문진 키오스크는 Electron 안에 넣지 않는다.** 환자가 태블릿/폰에서 여는 화면이므로 웹이어야 한다.
righthand의 `/intake` 라우트 트리 + `lib/intake/`, `lib/llm/`, `lib/stt/`를 **별도 Next.js 앱으로 분리 포크**해서
realtime_doctor의 Supabase를 바라보게 한다. Electron은 그 결과를 읽기만 한다.
→ 이렇게 하면 문진 로직을 재작성하지 않고, Electron 쪽은 순수하게 읽기 소비자가 된다.

## 스키마 (realtime_doctor Supabase, 신규 마이그레이션)

righthand의 `0001_init.sql`을 축약 이식:

- `patients` — id, user_id(소유 의사), name, birth_date, registration_no, phone, created_at
- `encounters` — id, patient_id FK, status(`intake_in_progress|intake_done|in_consult|completed`),
  red_flag, red_flag_reason, chief_complaint, created_at, completed_at
- `intake_results` — encounter_id FK, soap_json, differentials_json, recommended_tests_json, version
- `evidence_lookups` — 진단명별 PubMed 조회 결과 캐시
- 기존 `sessions`(녹취)에 `encounter_id` nullable 컬럼 추가 → 녹취와 환자를 연결
- Realtime publication에 `encounters` 추가 + `replica identity full`
  (righthand `0005_realtime.sql` 참조)

RLS: 현재 realtime_doctor는 RLS가 꺼져 있다(`src/main/supabaseClient.ts:7` 주석). 이번 라운드에서
환자 개인정보 테이블이 처음 들어가므로 **이 테이블들만이라도 RLS를 켜는 것을 강력 권고**한다.
(기존 테이블 RLS 정리는 별개 작업으로 남김.)

## 작업 단위

### M1. 스키마 + 데이터 계층
- 마이그레이션 작성 및 적용
- `src/main/patients.ts` 신규: 대기목록 조회(joined select), 환자 상세 로드,
  Realtime 구독 → 변경 시 IPC broadcast
- `src/shared/types.ts`에 `Patient`, `WaitingEncounter`, `IntakeResult` 타입 + IPC 채널 추가
- 정렬 규칙은 righthand `lib/dashboard/sessions.ts:60` `compareWaiting` 이식
  (red flag 상단 고정 → 대기 오래된 순)

### M2. 대기목록 오버레이 창 (8번째)
righthand `WaitingList.tsx` UI를 shadcn/Tailwind로 재구성. 창 추가 체크리스트:
1. `src/renderer/patients/{index.html,main.tsx,App.tsx}`
2. `electron.vite.config.ts:51-59` rollup input 추가
3. `OverlayKey` (`src/shared/types.ts:66-73`), `WindowKey` (`src/main/store.ts:14-21`)
4. `OVERLAYS` (`src/main/windows.ts:22`), `MAIN_WINDOW_KEYS` (`:74`)
5. `layouts.ts` `KEYS`(:5) + `HEIGHTS`(:34), `windowGroups.ts` `GROUPABLE`(:25)
6. 단축키 `togglePatients` Cmd+7 — `SHORTCUT_IDS/DEFAULTS/LABELS` + `dispatchShortcut`(`src/main/index.ts:310`)
7. dock 버튼 `ORDER/META/TOGGLE_ID` (`src/renderer/dock/App.tsx:82-104`)
8. i18n `window.patients` (`locales/{ko,en}.ts`)

갱신 방식은 righthand와 동일: Realtime 이벤트는 **알림용**으로만 쓰고 전체 재조회
(조인된 환자명·주소를 이벤트가 안 실어주므로). 채널 끊김 시 에러 배너 + 수동 새로고침.

### M3. 환자 선택 → 기존 창 데이터 주입
- main에 `activePatientId` 상태 + `IPC.PatientSelected` broadcast
- transcript / diagnosis / terms / questions / summary 창이 선택된 환자의
  `intake_results`를 react-query 캐시에 반영
- 선택 해제(환자 없음) 상태도 정의 — 현재의 실시간 녹취 모드로 복귀
- 사인아웃 시 PHI 클리어 경로(`hideOverlaysAndClearPHI` `src/main/index.ts:902`)에 환자 상태도 포함

### M4. 감별진단 문헌근거
- `DifferentialDiagnosis` 타입(`src/shared/types.ts:228-234`)에 `references[]` 추가
- righthand `lib/evidence/pubmed.ts`를 `src/main/evidence.ts`로 포팅, `evidence_lookups` 캐시 사용
- `src/renderer/diagnosis/App.tsx` 카드에 근거 섹션 추가 (제목/저널/연도/PMID 링크,
  클릭 시 외부 브라우저 open)
- 창 기본 크기를 세로로 긴 비율로 조정 (`windows.ts:30`) + `layouts.ts` HEIGHTS 반영

### M5. 글씨 크기 · 창 크기 단축키
- 글씨: `src/renderer/styles/globals.css`에 `--font-scale` root 변수 도입,
  단축키 Cmd+= / Cmd+- / Cmd+Shift+0(리셋) → main에서 전 창 broadcast → 각 렌더러가 root에 적용.
  electron-store에 `fontScale` 키 추가. (righthand `globals.css:152-188` 타입 스케일이 참고 모델)
- 창 크기: 포커스된 창의 width/height를 단축키로 증감 (`setBounds`), 기존 bounds 저장 경로
  (`windows.ts:147-153`)에 그대로 태움

### M6. 문진 키오스크 (별도 앱)
- righthand `app/src/app/intake/**`, `lib/intake/`, 관련 API 라우트를 새 저장소/디렉토리로 포크
- Supabase 접속 대상을 realtime_doctor 프로젝트로 교체, 테이블명을 M1 스키마에 맞춤
- 완료 시 `encounters.status = 'intake_done'` → Realtime → Electron 대기목록에 자동 등장
- 배포는 Vercel 기준 (righthand `DEPLOY.md` 참조)

## 순서

M1 → M2 → M3 을 먼저 끝내고 Windows에서 화면 검증. M4/M5는 독립적이라 병렬 가능.
M6은 가장 크고 나머지와 결합도가 낮으므로 마지막.

## 미결 / 확인 필요

- 문진 키오스크 포크를 realtime_doctor 저장소 안에 둘지, 별도 저장소로 뺄지
- 환자 개인정보 테이블 RLS를 이번에 켤지 (권고: 켠다)
- Windows 빌드는 비공개 미러 `mole-bi-com/realtime-doctor-winbuild`의 GitHub Actions에서 수행
