import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../app/theme.dart';
import '../../generated/l10n/app_localizations.dart';
import '../settings/controllers/settings_controller.dart';
import 'fx/aurora_shader_background.dart';
import 'fx/glass_panel.dart';
import 'fx/kinetic_reveal_text.dart';
import 'fx/tilt_parallax.dart';

/// 로그인/회원가입 공통 스캐폴드 — 앱바 없이 오로라 셰이더 배경 위에
/// 우측 상단 라이트/다크 토글 + 틸트 브랜드 마크 + 키네틱 타이포 + 글래스 폼.
class AuthScaffold extends ConsumerWidget {
  const AuthScaffold({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final isDark = cs.brightness == Brightness.dark;

    return Scaffold(
      body: Stack(
        children: [
          const AuroraShaderBackground(intensity: 0.85),
          SafeArea(
            child: Column(
              children: [
                // 우측 상단 라이트/다크 토글 — 아이콘 전환 시 회전.
                Align(
                  alignment: Alignment.centerRight,
                  child: Padding(
                    padding: EdgeInsets.only(
                      top: AppSpacing.sm.h,
                      right: AppSpacing.sm.w,
                    ),
                    child: IconButton(
                      tooltip: isDark ? t.themeLight : t.themeDark,
                      icon: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 350),
                        transitionBuilder: (child, anim) => RotationTransition(
                          turns: Tween(begin: 0.75, end: 1.0).animate(anim),
                          child: FadeTransition(opacity: anim, child: child),
                        ),
                        child: Icon(
                          isDark ? LucideIcons.sun : LucideIcons.moon,
                          key: ValueKey(isDark),
                          color: cs.onSurface,
                        ),
                      ),
                      onPressed: () => ref
                          .read(settingsControllerProvider.notifier)
                          .setThemeMode(
                            isDark ? ThemeMode.light : ThemeMode.dark,
                          ),
                    ),
                  ),
                ),
                Expanded(
                  // 입력 외 영역을 누르면 키보드 내림.
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => FocusScope.of(context).unfocus(),
                    child: Center(
                      child: SingleChildScrollView(
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        padding: EdgeInsets.symmetric(
                          horizontal: AppSpacing.xxl.w,
                          vertical: AppSpacing.xl.h,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // 브랜드 마크 — 글로우 + 탄성 입장 후 둥실 플로팅,
                            // 손끝을 따라 기우는 3D 패럴랙스.
                            Center(
                              child: TiltParallax(
                                maxTilt: 0.22,
                                child:
                                    Container(
                                          width: 72.r,
                                          height: 72.r,
                                          decoration: BoxDecoration(
                                            color: cs.primaryContainer,
                                            borderRadius: AppRadius.lgAll,
                                            boxShadow: [
                                              BoxShadow(
                                                color: cs.primary.withValues(
                                                  alpha: 0.45,
                                                ),
                                                blurRadius: 42,
                                                spreadRadius: 2,
                                              ),
                                            ],
                                          ),
                                          child: Icon(
                                            LucideIcons.stethoscope,
                                            size: 34.r,
                                            color: cs.onPrimaryContainer,
                                          ),
                                        )
                                        .animate()
                                        .scale(
                                          begin: const Offset(0.6, 0.6),
                                          end: const Offset(1, 1),
                                          duration: 700.ms,
                                          curve: Curves.elasticOut,
                                        )
                                        .fadeIn(duration: 350.ms)
                                        .animate(
                                          onPlay: (c) => c.repeat(reverse: true),
                                        )
                                        .moveY(
                                          begin: -4,
                                          end: 4,
                                          duration: 2200.ms,
                                          curve: Curves.easeInOut,
                                        ),
                              ),
                            ),
                            SizedBox(height: AppSpacing.lg.h),
                            // 앱 타이틀 — 글자 단위 블러 리빌.
                            KineticRevealText(
                              t.appTitle,
                              textAlign: TextAlign.center,
                              delay: 120.ms,
                              style: context.texts.headlineSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            SizedBox(height: AppSpacing.xxxl.h),
                            // 폼 — 글래스 패널 + 유리 위 인풋 스타일.
                            TiltParallax(
                              child: GlassPanel(
                                padding: EdgeInsets.all(AppSpacing.xl.r),
                                child: Theme(
                                  data: Theme.of(context).copyWith(
                                    inputDecorationTheme:
                                        glassInputDecorationTheme(context),
                                  ),
                                  child: AutofillGroup(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      mainAxisSize: MainAxisSize.min,
                                      children: children,
                                    ),
                                  ),
                                ),
                              ),
                            ).animate(delay: 220.ms).fadeIn(duration: 400.ms).slideY(
                              begin: 0.08,
                              end: 0,
                              curve: Curves.easeOutCubic,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 인증 폼 에러 메시지(부드러운 컨테이너).
class AuthErrorText extends StatelessWidget {
  const AuthErrorText(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    return Container(
      margin: EdgeInsets.only(top: AppSpacing.md.h),
      padding: EdgeInsets.symmetric(
        horizontal: AppSpacing.md.w,
        vertical: AppSpacing.sm.h,
      ),
      decoration: BoxDecoration(
        color: cs.errorContainer.withValues(alpha: 0.6),
        borderRadius: AppRadius.smAll,
      ),
      child: Row(
        children: [
          Icon(LucideIcons.alertCircle, size: 16.sp, color: cs.error),
          SizedBox(width: AppSpacing.sm.w),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: cs.onErrorContainer, fontSize: 12.sp),
            ),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 250.ms).shake(
      hz: 4,
      offset: const Offset(2, 0),
      duration: 350.ms,
    );
  }
}
