---
name: flutter-design
description: Realtime Doctor 모바일 앱의 Flutter UI/UX 디자인 시스템과 아키텍처 컨벤션. 새 화면·위젯을 만들거나 기존 UI를 다듬을 때, 디자인 토큰·공통 위젯·Riverpod 3 codegen·GoRouter 패턴을 일관되게 적용하기 위해 사용한다.
---

# Flutter Design System — Realtime Doctor mobile

`mobile/` 앱의 UI를 만들거나 다듬을 때 따르는 규칙. 목표: **하드코딩 0, 토큰·공통위젯 재사용, 다크모드·i18n·애니메이션 기본 탑재.**

## 1. 절대 하드코딩하지 않는다

| 대상 | ❌ 하지 말 것 | ✅ 사용 |
|------|--------------|--------|
| 간격/패딩 | `EdgeInsets.all(12.r)` | `EdgeInsets.all(AppSpacing.md.r)` |
| 모서리 | `BorderRadius.circular(12.r)` | `AppRadius.mdAll` (또는 `AppRadius.md.r`) |
| 폰트 | `TextStyle(fontSize: 13.sp, ...)` | `context.cardBody` / `context.caption` 등 |
| 색 | `Color(0xFFFFF4CC)`, `Colors.amber` | `context.tokens.warning` 등 시맨틱 토큰 |
| 화면색 | `Theme.of(context).colorScheme.x` | `context.colors.x` (단축) |

모든 토큰은 `import '../../app/theme.dart';` 한 줄로 들어온다 (배럴 export).

### 토큰 정의 위치 (`lib/app/theme/`)
- `app_spacing.dart` — `AppSpacing.{xs4, sm8, md12, lg16, xl20, xxl24, xxxl32}`. 값은 디자인 px → 호출부에서 `.r/.h/.w`.
- `app_radius.dart` — `AppRadius.{sm6, md12, lg16, pill}` + `*All` BorderRadius 헬퍼(이미 `.r` 적용).
- `app_tokens.dart` — `AppTokens` ThemeExtension: `warning/onWarning/warningContainer/onWarningContainer`, `dirty`(편집 더티), `speakerDoctor/Patient/Unknown`. 라이트/다크 둘 다 정의. 접근: `context.tokens`.
- `app_typography.dart` — `BuildContext` 확장 시맨틱 스타일: `sectionLabel`, `cardTitle`, `cardBody`, `caption`, `quote`, `monoTime`(고정폭 숫자/시간).

새 색이 필요하면 hex를 박지 말고 `AppTokens`에 라이트/다크 한 쌍을 추가하고 `copyWith`/`lerp`도 갱신한다.

## 2. 공통 위젯 먼저 찾는다 (`lib/presentation/common/`)

| 위젯 | 용도 |
|------|------|
| `SectionHeader(label)` | 대문자형 작은 섹션 라벨 (설정 그룹, 뷰 내부 라벨) |
| `ContentCard(child, accent?, onTap?)` | 카드형 항목 컨테이너 (패딩·테두리 통일) |
| `TagChip(label, color?, icon?)` | pill 태그 (화자/신뢰도/상태) |
| `ActionBanner(message, severity, onDismiss?, actions)` | 상단 알림 (info/warning/error), 등장 애니메이션 내장 |
| `FallbackBanner` | `ActionBanner` warning 변형 (전사 폴백) |
| `showConfirmDialog(...)` | 파괴적 동작 확인 다이얼로그 |
| `FadeSlideIn(child, index)` | 리스트 staggered 진입 애니메이션 (implicit, 컨트롤러 無) |
| `AuthScaffold` / `AuthErrorText` | 인증 화면 공통 레이아웃 |
| `EditableTextSection` | 읽기/편집 토글 텍스트 섹션 |
| `EmptyView` / `LoadingView` / `ErrorView` | 빈/로딩/에러 상태 (항상 제공) |

같은 패턴을 두 번째 쓰게 되면 새 공통 위젯으로 추출한다.

## 3. 컴포넌트 테마를 신뢰한다

`buildLightTheme`/`buildDarkTheme`(`lib/app/theme.dart`)가 Card·입력·다이얼로그·바텀시트·슬라이더·칩·Divider·TabBar·SnackBar 스타일을 전역 정의한다. 그러므로:
- `Card`, `TextField`, `AlertDialog`, `Slider` 등은 **별도 스타일 없이** 쓰면 자동으로 라운드/색/여백을 상속한다. 개별 위젯에서 `shape`/`border`를 다시 지정하지 말 것.
- 새 컴포넌트 종류의 스타일이 필요하면 화면이 아니라 `_baseTheme`에 추가한다.

## 4. 상태 화면은 3종을 항상 갖춘다

비동기 데이터는 `AsyncValue.when`으로 분기하고 `LoadingView`/`ErrorView(onRetry)`/`EmptyView(icon)`를 반드시 제공한다. 리스트는 `RefreshIndicator` + `FadeSlideIn(index: i)`.

## 5. 애니메이션 기본값

- 리스트/카드 진입: `FadeSlideIn`.
- 페이지 전환: GoRoute `pageBuilder`에서 `_fadePage`(인증) / `_sharedAxisPage`(상세 push) 사용 (`lib/app/router.dart`).
- 무거운 `AnimationController`보다 `TweenAnimationBuilder`/implicit 애니메이션을 선호.

## 6. 아키텍처 컨벤션 (Clean Architecture)

- `domain/`(entity·repository 인터페이스·usecase) → `data/`(dto·mapper·repository impl·datasource) → `presentation/`(screen·controller·widget). 의존성은 안쪽으로만.
- **Riverpod 3 codegen**: `@riverpod` 함수형 프로바이더는 `Ref ref`(통합 타입, `FooRef` 아님)를 받는다. Notifier는 `@riverpod class X extends _$X { build() {...} }`. 레거시 `StateProvider` 류 금지.
- **freezed** entity/DTO + 수동 mapper. 화면은 entity만 본다.
- **GoRouter**: 탭은 `StatefulShellRoute.indexedStack`(상태 보존). 인증 리다이렉트는 `redirect` + `refreshListenable`.
- 코드 변경 후 `fvm dart run build_runner build`로 `.g.dart` 재생성.

## 7. i18n & 반응형

- 모든 사용자 노출 문자열은 `AppLocalizations.of(context)` (arb: `lib/l10n/app_en.arb`, `app_ko.arb`). 리터럴 금지.
- 크기는 `flutter_screenutil`: 가로 `.w`, 세로 `.h`, 정사각/폰트 비율 `.r`, 폰트 `.sp`. 토큰 값에 이 확장을 붙여 쓴다.

## 8. 새 화면 체크리스트

- [ ] `import '../../app/theme.dart';` 로 토큰 사용, 하드코딩 사이즈/색 0
- [ ] 텍스트는 시맨틱 스타일(`context.cardBody` 등), 색은 `context.colors`/`context.tokens`
- [ ] 가능한 공통 위젯 재사용, 반복 시 추출
- [ ] 로딩/빈/에러 3종 상태 제공
- [ ] 다크모드 확인 (시맨틱 토큰만 쓰면 자동)
- [ ] 모든 문자열 i18n (en/ko arb 동시 추가)
- [ ] 리스트/진입 애니메이션 (`FadeSlideIn`), 라우트 전환 page builder
- [ ] `fvm flutter analyze` 0 에러
