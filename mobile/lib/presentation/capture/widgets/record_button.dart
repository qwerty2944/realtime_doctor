import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';

/// 캡처 시작/정지 히어로 CTA — 브랜드 그라데이션 + 글로우.
/// 녹음 중엔 붉은 톤으로 바뀌고 숨쉬듯 펄스 + 빛 스윕이 돈다.
class RecordButton extends StatelessWidget {
  final bool active;
  final VoidCallback onPressed;
  final String label;

  const RecordButton({
    super.key,
    required this.active,
    required this.onPressed,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final colors = active
        ? [cs.error, cs.error.withValues(alpha: 0.75)]
        : [cs.primary, cs.tertiary];
    final glow = active ? cs.error : cs.primary;

    Widget button = AnimatedContainer(
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutCubic,
      height: 56.h,
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: colors),
        borderRadius: AppRadius.pillAll,
        boxShadow: [
          BoxShadow(
            color: glow.withValues(alpha: 0.42),
            blurRadius: 22,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: AppRadius.pillAll,
          onTap: onPressed,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                active ? LucideIcons.square : LucideIcons.mic,
                size: 20.r,
                color: cs.onPrimary,
              ),
              SizedBox(width: AppSpacing.sm.w),
              Text(
                label,
                style: TextStyle(
                  fontSize: 15.sp,
                  fontWeight: FontWeight.w800,
                  color: cs.onPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (!active) {
      // 대기 상태 — 몇 초에 한 번 은은한 빛 스윕으로 시선을 끈다.
      return ClipRRect(borderRadius: AppRadius.pillAll, child: button)
          .animate(onPlay: (c) => c.repeat())
          .shimmer(
            delay: 2600.ms,
            duration: 1100.ms,
            angle: 0.6,
            color: Colors.white.withValues(alpha: 0.30),
          );
    }
    // 녹음 중 — 숨쉬듯 미세한 펄스.
    return button
        .animate(onPlay: (c) => c.repeat(reverse: true))
        .scaleXY(
          begin: 1,
          end: 1.015,
          duration: 900.ms,
          curve: Curves.easeInOut,
        );
  }
}
