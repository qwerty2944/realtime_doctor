import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../../../app/theme.dart';

/// 프로스트 글래스 앱바 — 백드롭 블러 + 미세한 틴트 + 아래쪽에 빛이 지나가는
/// 그라데이션 헤어라인. 배경(오로라 등)이 비치도록 투명 Scaffold 또는
/// `extendBodyBehindAppBar: true`와 함께 쓴다. [bottom]으로 TabBar 지원.
class GlassAppBar extends StatelessWidget implements PreferredSizeWidget {
  final Widget? title;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;

  const GlassAppBar({super.key, this.title, this.actions, this.bottom});

  @override
  Size get preferredSize =>
      Size.fromHeight(kToolbarHeight + (bottom?.preferredSize.height ?? 0));

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final isDark = cs.brightness == Brightness.dark;
    final hairline = isDark
        ? Colors.white.withValues(alpha: 0.22)
        : Colors.white.withValues(alpha: 0.75);
    return AppBar(
      backgroundColor: Colors.transparent,
      elevation: 0,
      title: title,
      actions: actions,
      bottom: bottom,
      flexibleSpace: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
          child: Container(
            color: cs.surface.withValues(alpha: isDark ? 0.05 : 0.18),
            alignment: Alignment.bottomCenter,
            child: Container(
              height: 1,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    hairline.withValues(alpha: 0),
                    hairline,
                    hairline.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
