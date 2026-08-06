# RightHand 사전 문진(Pre-visit History Taking) 서비스 — 구현 스펙

> Claude Code 입력용 스펙 문서. 이 문서 하나로 MVP 전체를 구현하는 것을 목표로 한다.

---

## 0. 서비스 개요

AI 에이전트가 의사 진료 전 환자와 음성 기반 문진(history taking)을 수행하고, 그 결과를 SOAP 형식 의무기록 초안 + 감별진단(differential diagnosis) 목록 + 추천 검사 목록으로 정리하여 진료실 의사 대시보드에 표시한다. 진료 중에는 의사-환자 대화를 음성인식(STT)하여 화자 분리 후, 의사 승인을 거쳐 기록을 보충한다.

- **진료과 (1차 타깃)**: 안과 (ophthalmology)
- **포지셔닝**: 모든 AI 출력은 "의사 참고용 초안(draft for physician review)". 진단 확정·처방 기능 없음. 모든 기록의 최종 승인·수정·삭제는 의사 계정만 가능.

## 1. 사용자 및 접점

### 환자
- **Phase 1 (MVP)**: 카카오톡으로 발송되는 웹 링크 (모바일 웹). 당일 접수 환자는 접수 시 문자/카톡으로 링크 발송, 예약 환자는 예약 시 사전 발송.
- **Phase 2**: 대기실 태블릿 전용 앱 (동일 웹앱을 태블릿 키오스크 모드로 실행 — 별도 네이티브 앱 불필요, PWA로 구현).
- 문진 시작 시 입력: 이름, 생년월일, 병원 등록번호(선택 — 모르면 공란, 접수처에서 부여 후 데스크가 입력 가능).

### 의사
- PC 브라우저 대시보드. 이메일+비밀번호 로그인 (Supabase Auth).
- 권한: 기록 열람·승인·수정·삭제·보완은 의사 계정만.

### 데스크(선택적 역할, MVP에 포함)
- 환자에게 문진 링크 발송, 등록번호 매칭 보정.

## 2. 사전 문진 플로우

1. 환자가 링크 접속 → 개인정보·녹음·AI 처리 동의 화면 (필수 체크)
2. 이름/생년월일/등록번호 입력
3. AI 문진 시작:
   - **입력**: 음성 우선 (브라우저 Web Speech API 또는 서버 STT), 실시간 자막으로 텍스트 표시. 텍스트 입력 폴백 제공.
   - **출력**: AI 질문을 텍스트 표시 + TTS 음성 낭독 (Web Speech Synthesis, 고령 환자 고려).
4. 문진 로직 (Claude API 기반):
   - 주소증(chief complaint) 파악 → 안과 문진 트리에 따라 추가 질문
   - OPQRST + 안과 특화 항목: 발병 시점(onset), 편측/양측(laterality), 통증(pain), 시력 변화(visual acuity change), 분비물(discharge), 외상력(trauma history), 콘택트렌즈 착용, 기저질환(당뇨 diabetes, 고혈압 hypertension), 안과 수술력, 복용 약물, 알레르기
   - **종료 조건**: 우선순위 감별진단 3~5개와 그에 맞는 검사 추천이 가능하다고 AI가 판단할 때. 최대 턴 수 안전장치: 15턴.
5. 종료 시 환자에게 "문진이 완료되었습니다. 잠시 후 진료실로 안내됩니다" 표시.

### 레드플래그 (Red Flag) 처리
- 감지 대상 (안과 기본 세트, **의사가 설정 화면에서 편집 가능**):
  - 급성 시력 소실 (acute vision loss)
  - 커튼이 내려오는 듯한 시야 결손 (curtain-like visual field defect — 망막박리 retinal detachment 의심)
  - 심한 안통 + 두통 + 구역 (급성 폐쇄각 녹내장 acute angle-closure glaucoma 의심)
  - 화학물질 눈 접촉 (chemical injury)
  - 외상 후 시력 저하, 번쩍임(photopsia) + 비문증(floaters) 급증
- 감지 시: 대시보드에 즉시 붉은 배너 + 브라우저 알림(Web Push/실시간 소켓), 대기 목록에서 해당 환자 최상단 고정 + 🚨 표시.

## 3. 문진 결과물 (AI 생성)

각 환자 세션마다 생성:
1. **SOAP 초안** (한글 + 영문 의학용어 혼용, 예: "3일 전 시작된 우안 이물감(foreign body sensation, OD)")
   - S: 주소증, 현병력(HPI), 과거력(PMH), 약물, 알레르기
   - O: (사전 문진 단계에서는 "진찰 소견 대기" placeholder)
   - A: 감별진단 후보 나열 (확정 아님 명시)
   - P: 추천 검사 목록
2. **감별진단 목록**: 3~5개, 각각 가능성 근거 1줄 요약, 우선순위 순
3. **추천 검사 목록**: 병원 보유 검사 리스트에서 선택 (아래 §6 검사 마스터 테이블 참조)
4. **원본 대화 전문**: 타임스탬프 포함

## 4. 진료실 대시보드 (의사 PC 웹)

- **대기 목록**: 문진 완료 환자 카드 리스트 (이름, 등록번호, 주소증, 완료 시각, 레드플래그 표시). 실시간 갱신 (Supabase Realtime).
- **환자 상세 (카드 클릭)**: 탭 순서 고정 — ① 문진 요약(SOAP) ② 감별진단 ③ 추천 검사 ④ 원본 대화
- **진료 중 모드**: "진료 시작" 버튼 → 녹음 시작 (환자 동의 상태 표시) → 실시간 화자분리 자막 → "진료 종료" → AI가 기존 SOAP에 대한 보충 diff 제안 → **의사가 항목별 승인/거부/수정 후 반영**
- **설정 페이지**: 레드플래그 항목 편집, 검사 마스터 목록 편집, (추후) 의사별 기록 양식 커스텀

### 4-1. 임상 문헌 검색 (Clinical Evidence Lookup)
- 환자 상세 화면의 감별진단 탭에서 각 진단명 옆 **"근거 찾기" 버튼** → Claude API + 도구(web search, PubMed API)로 즉시 조회:
  - 해당 질환의 최신 진료 가이드라인·리뷰 논문 요약 (제목, 저널, 연도, 링크)
  - 환자의 증상 조합과 해당 진단의 부합도에 대한 근거 요약
- 자유 질의 입력창도 제공: 의사가 "OO 증상에서 XX 감별 포인트는?" 같은 질문을 바로 던지면 문헌 근거와 함께 답변 (사이드 패널 형태, 환자 컨텍스트 자동 포함)
- **PubMed E-utilities API** (무료, 키 불필요) + web search를 기본 소스로 사용. 조회 결과에 출처 링크 필수 표기, "참고용" 고지 포함.
- 조회 이력은 세션에 저장하여 나중에 다시 볼 수 있게 (`evidence_lookups` 테이블).

### 4-2. 통계 (Statistics)
- 대시보드 내 **통계 탭** 신설:
  - **날짜별**: 일/주/월 단위 내원(문진 완료) 환자 수 추이 — 라인 차트
  - **질환별**: 감별진단 1순위(또는 의사 확정 진단) 기준 질환 분포 — 바/파이 차트, 기간 필터
  - **주소증별** 분포, 레드플래그 발생 건수, 평균 문진 소요 시간
- 기간 선택(오늘/이번 주/이번 달/사용자 지정), CSV 내보내기 버튼
- 집계는 SQL 뷰(view)로 구현 (sessions + intake_results 기반). 통계에는 환자 식별정보를 표시하지 않음(비식별 집계).
- 데이터 기반: 의사가 진료 종료 시 **확정 진단(final diagnosis)을 선택/입력하는 필드**를 승인 플로우에 추가 — 이 값이 있으면 통계는 확정 진단 우선, 없으면 AI 1순위 감별진단 사용.

## 5. 진료 중 음성인식 (STT)

- **추천 엔진**: **RTZR(리턴제로) 또는 CLOVA Speech** — 한국어 의료 대화 정확도와 화자분리(speaker diarization) 지원이 핵심. MVP 구현은 OpenAI Whisper API + pyannote 조합도 가능하나, 한국어 실시간+화자분리는 CLOVA Speech 장문 인식 API가 가장 실용적. **구현 시 STT 어댑터 인터페이스로 추상화하여 엔진 교체 가능하게 설계.**
- 방식: 진료 중 실시간 스트리밍 자막(가능한 엔진 사용 시) 또는 진료 종료 후 일괄 처리(폴백). MVP는 **진료 종료 후 일괄 처리**로 시작 (구현 단순, 정확도 높음).
- 화자 분리: 의사/환자 2-speaker diarization 필수. 라벨 오류는 의사가 승인 단계에서 수정 가능.
- 녹음 동의: 문진 시작 시 동의 + 진료실 입장 시 대시보드에 동의 상태 표시. 미동의 시 녹음 기능 비활성.

## 6. 데이터 모델 (Supabase / PostgreSQL)

```
patients        id, name, birth_date, registration_no(nullable), phone, created_at
sessions        id, patient_id, status(intake_in_progress|intake_done|in_consult|completed),
                red_flag(boolean), red_flag_reason, consent_recording, consent_ai, created_at
messages        id, session_id, role(agent|patient), text, audio_url(nullable), ts
intake_results  id, session_id, soap_json, differentials_json, recommended_tests_json, version
consult_records id, session_id, transcript_json(화자분리 포함), supplement_diff_json,
                approved_by(doctor_id), approved_at
doctors         id, email, name, settings_json(레드플래그 커스텀 등)
test_master     id, name_kr, name_en, code(병원 내부 코드), category, active
red_flags       id, doctor_id(null=기본), keyword_pattern, label, active
evidence_lookups id, session_id, doctor_id, query, diagnosis_ref(nullable),
                 result_json(요약+출처링크), created_at
```
- `consult_records`에 `final_diagnosis` 필드 추가 (의사가 승인 시 선택/입력, 통계 집계용)

- **검사 마스터 초기 시드 (안과 예시)**: 시력검사(visual acuity test), 안압검사(tonometry), 세극등검사(slit lamp exam), 안저검사(fundus exam), 산동 안저검사(dilated fundus exam), OCT(optical coherence tomography), 시야검사(visual field test), 각막지형도(corneal topography), 형광안저혈관조영(fluorescein angiography), 눈물막 검사(tear film test). 의사가 설정에서 편집.

## 7. 기술 스택

- **프론트**: Next.js (App Router) + Tailwind — 환자 모바일웹/태블릿 PWA와 의사 대시보드를 하나의 프로젝트, 라우트 분리 (`/intake/*`, `/dashboard/*`)
- **백엔드**: Next.js API Routes + Supabase (Auth, DB, Realtime, Storage-음성파일)
- **LLM**: Claude API (문진 대화, SOAP 생성, 감별진단, 보충 diff 생성)
- **STT**: 어댑터 패턴 (§5), MVP는 일괄 처리
- **배포**: Vercel + Supabase (리전: **서울 ap-northeast-2** — 국내 데이터 보관)
- **기존 RightHand와의 관계**: 별도 서비스로 시작하되 동일 Supabase 프로젝트/조직 내 배치하여 추후 통합 용이하게.

## 8. 보안·규제 요건 (구현에 반영)

- 환자 건강정보는 민감정보(sensitive personal information): 전송 TLS, 저장 시 DB 암호화(Supabase 기본) + 음성파일 비공개 버킷.
- 동의 3종을 문진 시작 전 명시 수집·저장: ① 개인정보 수집·이용 ② 녹음 ③ AI(외부 LLM API) 처리.
- 데이터 보존 기간 설정값(기본 예: 세션 완료 후 90일 자동 파기 — 의사 설정 가능). ※ 의무기록 자체는 병원 EMR에 의사가 옮겨 적는 구조이므로 본 시스템은 보조 기록.
- 모든 AI 출력 화면에 "본 내용은 의사 참고용 초안이며 진단이 아닙니다" 고지 상시 노출.
- 감사 로그(audit log): 승인/수정/삭제 이력 기록.

## 9. MVP 범위와 이후 단계

**MVP (Claude Code 1차 구현)**
- 카톡 링크용 모바일웹 문진 (음성+자막, 텍스트 폴백)
- 안과 문진 로직 + 레드플래그 기본 세트
- SOAP/감별진단/추천검사 생성
- 의사 대시보드 (대기 목록, 상세 4탭, 레드플래그 알림)
- 진료 후 일괄 STT + 화자분리 + 승인 플로우
- 동의 수집, 의사 인증, 감사 로그
- 감별진단별 문헌 근거 조회 (PubMed + web search) 및 자유 질의 사이드 패널
- 통계 탭 (날짜별 내원 추이, 질환별·주소증별 분포, CSV 내보내기)

**Phase 2**
- 태블릿 키오스크 모드, 실시간 스트리밍 STT, 의사별 EMR 양식 커스텀, 카톡 알림톡 자동 발송, 타 진료과(내과·가정의학과) 문진 트리 확장, EMR 연동
