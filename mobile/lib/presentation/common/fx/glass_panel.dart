import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../../../app/theme.dart';

/// 글래스몰피즘 패널 — 백드롭 블러 + 반투명 그라데이션 필 + 스윕 그라데이션
/// 스펙큘러 보더(좌상단에서 빛을 받은 유리 모서리). 인증 화면 카드 공용.
class GlassPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double blur;

  const GlassPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.xl),
    this.blur = 22,
  });

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final isDark = cs.brightness == Brightness.dark;
    final r = AppRadius.xlAll;
    // 유리 필 — 다크에선 흰빛 박막, 라이트에선 우윳빛 반투명.
    final fill = isDark
        ? [
            Colors.white.withValues(alpha: 0.10),
            Colors.white.withValues(alpha: 0.035),
          ]
        : [
            Colors.white.withValues(alpha: 0.62),
            Colors.white.withValues(alpha: 0.34),
          ];

    return ClipRRect(
      borderRadius: r,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: CustomPaint(
          foregroundPainter: _SpecularBorderPainter(
            radius: r,
            dark: isDark,
            accent: cs.tertiary,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: r,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: fill,
              ),
            ),
            child: Padding(padding: padding, child: child),
          ),
        ),
      ),
    );
  }
}

/// [GlassPanel] 내부에 어울리는 반투명 인풋 스타일 — 유리 위에 살짝 가라앉은
/// 필드. `Theme(data: theme.copyWith(inputDecorationTheme: ...))`로 감싸 쓴다.
InputDecorationThemeData glassInputDecorationTheme(BuildContext context) {
  final cs = context.colors;
  final isDark = cs.brightness == Brightness.dark;
  final base = Theme.of(context).inputDecorationTheme;
  final fill = isDark
      ? Colors.white.withValues(alpha: 0.07)
      : Colors.black.withValues(alpha: 0.045);
  final edge = isDark
      ? Colors.white.withValues(alpha: 0.12)
      : Colors.black.withValues(alpha: 0.07);
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: AppRadius.mdAll,
    borderSide: BorderSide(color: c, width: w),
  );
  return base.copyWith(
    fillColor: fill,
    border: border(edge),
    enabledBorder: border(edge),
    focusedBorder: border(cs.primary, 1.6),
  );
}

/// 유리 가장자리의 빛 반사 — 좌상단이 가장 밝고 액센트 색이 한 줄기 도는
/// 스윕 그라데이션 1.2px 스트로크.
class _SpecularBorderPainter extends CustomPainter {
  final BorderRadius radius;
  final bool dark;
  final Color accent;

  _SpecularBorderPainter({
    required this.radius,
    required this.dark,
    required this.accent,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = radius.toRRect(rect).deflate(0.6);
    final hi = dark ? 0.45 : 0.95;
    final lo = dark ? 0.06 : 0.25;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..shader = SweepGradient(
        transform: const GradientRotation(-math.pi / 2.6),
        colors: [
          Colors.white.withValues(alpha: hi),
          Colors.white.withValues(alpha: lo),
          accent.withValues(alpha: dark ? 0.35 : 0.45),
          Colors.white.withValues(alpha: lo),
          Colors.white.withValues(alpha: hi),
        ],
        stops: const [0.0, 0.28, 0.55, 0.78, 1.0],
      ).createShader(rect);
    canvas.drawRRect(rrect, paint);
  }

  @override
  bool shouldRepaint(_SpecularBorderPainter old) =>
      old.dark != dark || old.radius != radius || old.accent != accent;
}
