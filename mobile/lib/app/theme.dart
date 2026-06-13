import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';

import 'theme/app_radius.dart';
import 'theme/app_spacing.dart';
import 'theme/app_tokens.dart';

// 디자인 토큰 배럴 — 화면 코드는 `import '../../app/theme.dart';` 한 줄로 전부 쓴다.
export 'theme/app_radius.dart';
export 'theme/app_spacing.dart';
export 'theme/app_tokens.dart';
export 'theme/app_typography.dart';

const seedColor = Color(0xFF4F46E5);

ThemeData buildLightTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: seedColor);
  return _baseTheme(
    scheme: scheme,
    tokens: AppTokens.light,
    baseTextTheme: GoogleFonts.notoSansKrTextTheme(),
  );
}

ThemeData buildDarkTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: seedColor,
    brightness: Brightness.dark,
  );
  return _baseTheme(
    scheme: scheme,
    tokens: AppTokens.dark,
    baseTextTheme: GoogleFonts.notoSansKrTextTheme(
      ThemeData(brightness: Brightness.dark).textTheme,
    ),
  );
}

/// 라이트/다크가 공유하는 컴포넌트 테마. plain Material 위젯이 별도 스타일 없이도
/// 일관된 라운드/여백/색을 상속하도록 한곳에서 정의한다.
ThemeData _baseTheme({
  required ColorScheme scheme,
  required AppTokens tokens,
  required TextTheme baseTextTheme,
}) {
  return ThemeData(
    useMaterial3: true,
    brightness: scheme.brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    textTheme: baseTextTheme,
    splashFactory: InkSparkle.splashFactory,
    extensions: [tokens],
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: baseTextTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w700,
        color: scheme.onSurface,
      ),
    ),
    tabBarTheme: TabBarThemeData(
      dividerColor: Colors.transparent,
      labelColor: scheme.primary,
      unselectedLabelColor: scheme.onSurfaceVariant,
      indicatorColor: scheme.primary,
      indicatorSize: TabBarIndicatorSize.label,
      labelStyle: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
      unselectedLabelStyle: TextStyle(fontSize: 13.sp),
      overlayColor: WidgetStatePropertyAll(
        scheme.primary.withValues(alpha: 0.06),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      // 글래스 탭바의 블러 레이어가 배경을 담당하므로 바 자체는 투명.
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      indicatorColor: scheme.primaryContainer,
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
      ),
    ),
    cardTheme: CardThemeData(
      color: scheme.surfaceContainerLowest,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.mdAll,
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant.withValues(alpha: 0.5),
      thickness: 0.5,
      space: AppSpacing.lg.h,
    ),
    chipTheme: ChipThemeData(
      labelStyle: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
      side: BorderSide.none,
      padding: EdgeInsets.symmetric(horizontal: AppSpacing.sm.w, vertical: 2.h),
      shape: RoundedRectangleBorder(borderRadius: AppRadius.pillAll),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
      contentPadding: EdgeInsets.symmetric(
        horizontal: AppSpacing.lg.w,
        vertical: AppSpacing.md.h,
      ),
      border: OutlineInputBorder(
        borderRadius: AppRadius.mdAll,
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: AppRadius.mdAll,
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: AppRadius.mdAll,
        borderSide: BorderSide(color: scheme.primary, width: 1.6),
      ),
      labelStyle: TextStyle(color: scheme.onSurfaceVariant),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.md.h),
        shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
        textStyle: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w700),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: scheme.surfaceContainerHigh,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.lgAll),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surfaceContainerLow,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppRadius.lg.r),
        ),
      ),
    ),
    listTileTheme: ListTileThemeData(
      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
    ),
    sliderTheme: SliderThemeData(
      trackHeight: 3.h,
      overlayShape: RoundSliderOverlayShape(overlayRadius: 14.r),
      thumbShape: RoundSliderThumbShape(enabledThumbRadius: 7.r),
      activeTrackColor: scheme.primary,
      inactiveTrackColor: scheme.surfaceContainerHighest,
      thumbColor: scheme.primary,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
    ),
  );
}
