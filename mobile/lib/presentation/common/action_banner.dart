import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../app/theme.dart';

enum BannerSeverity { info, warning, error }

/// 상단에서 부드럽게 등장하는 알림 배너. 에러/폴백/안내를 한 컴포넌트로 통일한다.
///
/// 색은 severity 에 따라 ColorScheme / AppTokens 에서 가져오므로 다크모드 자동 대응.
class ActionBanner extends StatelessWidget {
  const ActionBanner({
    required this.message,
    this.severity = BannerSeverity.info,
    this.icon,
    this.onDismiss,
    this.actions = const [],
    super.key,
  });

  final String message;
  final BannerSeverity severity;
  final IconData? icon;
  final VoidCallback? onDismiss;
  final List<Widget> actions;

  ({Color bg, Color fg, IconData icon}) _palette(BuildContext context) {
    final cs = context.colors;
    final tk = context.tokens;
    return switch (severity) {
      BannerSeverity.error => (
        bg: cs.errorContainer,
        fg: cs.onErrorContainer,
        icon: LucideIcons.alertCircle,
      ),
      BannerSeverity.warning => (
        bg: tk.warningContainer,
        fg: tk.onWarningContainer,
        icon: LucideIcons.alertTriangle,
      ),
      BannerSeverity.info => (
        bg: cs.primaryContainer,
        fg: cs.onPrimaryContainer,
        icon: LucideIcons.info,
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final p = _palette(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, (t - 1) * 16),
          child: child,
        ),
      ),
      child: Material(
        color: p.bg,
        borderRadius: AppRadius.mdAll,
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            AppSpacing.md.w,
            AppSpacing.sm.h,
            onDismiss != null ? AppSpacing.xs.w : AppSpacing.md.w,
            AppSpacing.sm.h,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Icon(icon ?? p.icon, size: 18.sp, color: p.fg),
              SizedBox(width: AppSpacing.sm.w),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(fontSize: 12.5.sp, color: p.fg, height: 1.3),
                ),
              ),
              ...actions,
              if (onDismiss != null)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  iconSize: 16.sp,
                  color: p.fg,
                  onPressed: onDismiss,
                  icon: const Icon(LucideIcons.x),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
