# Realtime Doctor — mobile

iOS + Android Flutter 앱. 데스크탑 Electron 앱의 모바일 컴패니언 + 자체 캡쳐 (한국어 CLOVA Stream, 영어 OpenAI Realtime stub).

## 아키텍처

Layer-first Clean Architecture:

```
lib/
  app/                  # MaterialApp + GoRouter + theme
  core/                 # error · result · utils · constants
  infrastructure/       # env · supabase · network · audio · storage (외부 클라이언트)
  data/                 # DTO · datasources · mappers · repository impls
  domain/               # entity · repository 인터페이스 · use case
  presentation/         # shell · auth · capture · sessions · settings · common
  l10n/                 # app_ko.arb · app_en.arb
  generated/            # gen-l10n / build_runner 산출 (gitignore)
```

의존성 방향: `presentation → domain ← data → infrastructure`. `domain` 은 어느 layer 도 import 하지 않는다.

## 기술 스택

- **Riverpod 2 (codegen)** — DI + 상태관리. `@riverpod` 마커.
- **go_router 14** — ShellRoute + BottomNav + auth gate.
- **Supabase Flutter 2** — Auth + PostgREST + Storage.
- **Retrofit + Dio** — Gemini API.
- **record + just_audio** — 마이크 + 재생.
- **flutter_screenutil** — 해상도 대응.
- **gen-l10n** — i18n (ko/en).
- **freezed**·**json_serializable** — codegen 의존성으로 deps 에 두되 v1 DTO 는 plain Dart.

## 셋업

### 1. Flutter SDK

`fvm` 사용. 프로젝트 폴더 안에 `.fvmrc` 가 있어 자동 핀.

```bash
fvm install stable
fvm use stable
```

### 2. 의존성 + codegen

```bash
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter gen-l10n
```

### 3. 환경변수

`.env.example` 를 `.env` 로 복사 후 값을 채운다:

```
SUPABASE_URL=https://yqdzxitlmtawznzwpkra.supabase.co
SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...
CLOVA_SPEECH_SECRET=...
OPENAI_API_KEY=...
```

### 4. 실행

```bash
fvm flutter run -d iphone       # iOS 시뮬레이터
fvm flutter run -d android      # Android 에뮬레이터
```

## 빌드

```bash
fvm flutter build ipa            # iOS (signing 필요)
fvm flutter build apk --release  # Android APK
fvm flutter build appbundle      # Android AAB
```

## 상태

v1:
- Supabase 로그인 / 로그아웃 / 회원가입.
- 세션 목록 + 상세 (transcript / 감별진단 / 요약 / 받아쓰기 / 오디오 5탭).
- 캡쳐 화면 + 마이크 권한 prompt. CLOVA Stream / OpenAI Realtime WS 는 v1 stub.
- 언어 토글 (한↔영) → UI + LLM 프롬프트 + 화자 라벨 갱신.

v1.x follow-up:
- CLOVA Speech Streaming gRPC frame 포팅 (Electron `clovaStream.ts` 참조).
- OpenAI Realtime ephemeral key 발급 Supabase Edge Function.
- 누적 PCM → WAV → Supabase storage 업로드.
- 실기기 TestFlight / Play Internal.
