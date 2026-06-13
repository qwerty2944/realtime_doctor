import 'package:flutter/material.dart';

/// ColorScheme 으로 표현되지 않는 시맨틱 색을 담는 테마 확장.
///
/// `Theme.of(context).extension<AppTokens>()!` 또는 `context.tokens` 로 접근한다.
/// 하드코딩 hex 대신 여기를 단일 출처로 쓴다.
@immutable
class AppTokens extends ThemeExtension<AppTokens> {
  const AppTokens({
    required this.warning,
    required this.onWarning,
    required this.warningContainer,
    required this.onWarningContainer,
    required this.dirty,
    required this.speakerDoctor,
    required this.speakerPatient,
    required this.speakerUnknown,
  });

  /// 경고(폴백/주의) 강조색.
  final Color warning;
  final Color onWarning;
  final Color warningContainer;
  final Color onWarningContainer;

  /// 저장되지 않은 편집 상태 표시(앰버 점 등).
  final Color dirty;

  /// 화자 구분 강조색.
  final Color speakerDoctor;
  final Color speakerPatient;
  final Color speakerUnknown;

  static const light = AppTokens(
    warning: Color(0xFFB45309),
    onWarning: Color(0xFFFFFFFF),
    warningContainer: Color(0xFFFFF4CC),
    onWarningContainer: Color(0xFF5A4500),
    dirty: Color(0xFFD97706),
    speakerDoctor: Color(0xFF4F46E5),
    speakerPatient: Color(0xFF0D9488),
    speakerUnknown: Color(0xFF64748B),
  );

  static const dark = AppTokens(
    warning: Color(0xFFFCD34D),
    onWarning: Color(0xFF3A2D00),
    warningContainer: Color(0xFF4A3B00),
    onWarningContainer: Color(0xFFFFF0BF),
    dirty: Color(0xFFFBBF24),
    speakerDoctor: Color(0xFFA5B4FC),
    speakerPatient: Color(0xFF5EEAD4),
    speakerUnknown: Color(0xFF94A3B8),
  );

  @override
  AppTokens copyWith({
    Color? warning,
    Color? onWarning,
    Color? warningContainer,
    Color? onWarningContainer,
    Color? dirty,
    Color? speakerDoctor,
    Color? speakerPatient,
    Color? speakerUnknown,
  }) {
    return AppTokens(
      warning: warning ?? this.warning,
      onWarning: onWarning ?? this.onWarning,
      warningContainer: warningContainer ?? this.warningContainer,
      onWarningContainer: onWarningContainer ?? this.onWarningContainer,
      dirty: dirty ?? this.dirty,
      speakerDoctor: speakerDoctor ?? this.speakerDoctor,
      speakerPatient: speakerPatient ?? this.speakerPatient,
      speakerUnknown: speakerUnknown ?? this.speakerUnknown,
    );
  }

  @override
  AppTokens lerp(ThemeExtension<AppTokens>? other, double t) {
    if (other is! AppTokens) return this;
    return AppTokens(
      warning: Color.lerp(warning, other.warning, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      warningContainer: Color.lerp(
        warningContainer,
        other.warningContainer,
        t,
      )!,
      onWarningContainer: Color.lerp(
        onWarningContainer,
        other.onWarningContainer,
        t,
      )!,
      dirty: Color.lerp(dirty, other.dirty, t)!,
      speakerDoctor: Color.lerp(speakerDoctor, other.speakerDoctor, t)!,
      speakerPatient: Color.lerp(speakerPatient, other.speakerPatient, t)!,
      speakerUnknown: Color.lerp(speakerUnknown, other.speakerUnknown, t)!,
    );
  }
}

/// 테마 토큰/타이포 접근 단축 확장.
extension AppThemeContextX on BuildContext {
  ColorScheme get colors => Theme.of(this).colorScheme;
  TextTheme get texts => Theme.of(this).textTheme;
  AppTokens get tokens =>
      Theme.of(this).extension<AppTokens>() ?? AppTokens.light;
}
